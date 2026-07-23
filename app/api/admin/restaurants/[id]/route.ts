import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { isRestaurantStatus } from "@/lib/admin-restaurants";

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// PATCH — any schema field, including status transitions. Restaurants
// themselves have no publish gate (unlike RestaurantDish).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
    }

    const { status, slug, ...rest } = body as Record<string, unknown>;

    if (status !== undefined && !isRestaurantStatus(status)) {
      return NextResponse.json({ error: "status must be one of DRAFT, PUBLISHED, ARCHIVED" }, { status: 400 });
    }
    if (slug !== undefined && (typeof slug !== "string" || slug.trim().length === 0)) {
      return NextResponse.json({ error: "slug must be a non-empty string" }, { status: 400 });
    }

    const restaurant = await prisma.restaurant.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(status !== undefined && { status }),
        ...(slug !== undefined && { slug: (slug as string).trim() }),
      },
      include: { ethnic: true, _count: { select: { dishes: true } } },
    });

    return NextResponse.json(restaurant);
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return NextResponse.json({ error: "A restaurant with that slug already exists" }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    await prisma.restaurant.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
