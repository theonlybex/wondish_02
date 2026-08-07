import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

// Phase 6a M3 — ingredient-request queue (design §5.4). Free-text portal
// ingredient rows file these; ops maps each to a catalog Ingredient (which
// backfills ingredientId on matching dish rows) or rejects it.

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();

    const requests = await prisma.ingredientRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    const restaurantIds = Array.from(new Set(requests.map((r) => r.restaurantId)));
    const restaurants = await prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, name: true },
    });
    const restaurantById = new Map(restaurants.map((r) => [r.id, r.name]));

    // How many dish rows would a mapping touch right now (any restaurant —
    // canonical ids are global; same-name rows elsewhere benefit too).
    const items = await Promise.all(
      requests.map(async (r) => {
        const usageCount = await prisma.restaurantDishIngredient.count({
          where: { name: { equals: r.name, mode: "insensitive" }, ingredientId: null },
        });
        return {
          id: r.id,
          name: r.name,
          restaurant: { id: r.restaurantId, name: restaurantById.get(r.restaurantId) ?? "—" },
          createdAt: r.createdAt.toISOString(),
          usageCount,
        };
      })
    );

    return NextResponse.json({ items });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
