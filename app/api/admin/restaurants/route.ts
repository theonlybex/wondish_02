import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse, pickFields } from "@/lib/admin";
import { slugify, isRestaurantStatus, RESTAURANT_MUTABLE_FIELDS } from "@/lib/admin-restaurants";

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// GET — admin list, all statuses (unlike the consumer route, which is
// PUBLISHED-only via lib/restaurants.ts).
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? "";

    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};

    const restaurants = await prisma.restaurant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { ethnic: true, _count: { select: { dishes: true } } },
    });

    return NextResponse.json({ items: restaurants });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// POST — create; slug auto-generated from name when not supplied.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
    }

    const { name, slug, status, neighborhood, ...rest } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof neighborhood !== "string" || neighborhood.trim().length === 0) {
      return NextResponse.json({ error: "neighborhood is required" }, { status: 400 });
    }
    if (status !== undefined && !isRestaurantStatus(status)) {
      return NextResponse.json({ error: "status must be one of DRAFT, PUBLISHED, ARCHIVED" }, { status: 400 });
    }

    const resolvedSlug = typeof slug === "string" && slug.trim().length > 0 ? slug.trim() : slugify(name);
    if (resolvedSlug.length === 0) {
      return NextResponse.json({ error: "could not derive a slug from name; provide one explicitly" }, { status: 400 });
    }

    const restaurant = await prisma.restaurant.create({
      data: {
        ...pickFields(rest, RESTAURANT_MUTABLE_FIELDS),
        name,
        neighborhood,
        slug: resolvedSlug,
        ...(status !== undefined && { status }),
      },
      include: { ethnic: true, _count: { select: { dishes: true } } },
    });

    return NextResponse.json(restaurant, { status: 201 });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return NextResponse.json({ error: "A restaurant with that slug already exists" }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
