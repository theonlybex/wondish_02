import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";
import { parsePortalProfile } from "@/lib/restaurant-portal";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M2/M4 — portal restaurant summary (design §5.1) + staff profile
// edits (design §5.5). PATCH is allowlisted to display/profile fields only:
// no name (renames go through ops), no status/slug/isRecommended.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-read", ctx.account.id, 120, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: {
        id: true, name: true, slug: true, status: true, neighborhood: true,
        description: true, ethnic: { select: { name: true } },
      },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const dishes = await prisma.restaurantDish.findMany({
      where: { restaurantId: params.id, deletedAt: null },
      select: { status: true, available: true, calories: true, lastVerifiedAt: true },
    });

    const counts = {
      total: dishes.length,
      published: dishes.filter((d) => d.status === "PUBLISHED").length,
      inReview: dishes.filter((d) => d.status === "PENDING_REVIEW").length,
      draft: dishes.filter((d) => d.status === "DRAFT").length,
      unavailable: dishes.filter((d) => !d.available).length,
      missingNutrition: dishes.filter((d) => d.calories == null).length,
    };
    const lastVerifiedAt = dishes.reduce<Date | null>(
      (max, d) => (d.lastVerifiedAt && (!max || d.lastVerifiedAt > max) ? d.lastVerifiedAt : max),
      null
    );

    return NextResponse.json({
      restaurant: { ...restaurant, cuisine: restaurant.ethnic?.name ?? null, ethnic: undefined },
      staffRole: ctx.staff?.role ?? "SUPER",
      counts,
      lastVerifiedAt,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = parsePortalProfile(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const diff: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.value)) {
      diff[key] = { from: (restaurant as unknown as Record<string, unknown>)[key] ?? null, to: value };
    }

    // `hours` is a Json column — clearing it needs an explicit DB null.
    const { hours, ...scalars } = parsed.value;
    const data: Prisma.RestaurantUpdateInput = { ...scalars };
    if ("hours" in parsed.value) data.hours = hours ?? Prisma.DbNull;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.restaurant.update({ where: { id: params.id }, data });
      await auditRestaurantChange(tx, {
        restaurantId: params.id,
        accountId: ctx.account.id,
        entity: "restaurant",
        entityId: params.id,
        action: "update",
        diff: diff as never,
      });
      return row;
    });

    return NextResponse.json({
      restaurant: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        neighborhood: updated.neighborhood,
        addressLine: updated.addressLine,
        city: updated.city,
        state: updated.state,
        postalCode: updated.postalCode,
        phone: updated.phone,
        website: updated.website,
        hours: updated.hours,
        imageUrl: updated.imageUrl,
        logoUrl: updated.logoUrl,
      },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
