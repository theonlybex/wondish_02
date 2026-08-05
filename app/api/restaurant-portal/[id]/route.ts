import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M2 — portal restaurant summary (design §5.1): header data +
// dashboard counts, scoped by requireRestaurantStaff.
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
