import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Phase 6a M3 — ops decision on an ingredient request (design §5.4).
// map: link to a catalog Ingredient and backfill ingredientId on every
// unmapped dish row with the same name (case-insensitive, any restaurant —
// canonical ids are global by design), then resolve every same-name pending
// request in one go. reject: mark REJECTED; the free-text rows stay valid
// verdict inputs by name, exactly like pre-portal data.

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    const admin = await requireAdmin();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const action = body.action;
    if (action !== "map" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'map' or 'reject'" }, { status: 400 });
    }

    const request = await prisma.ingredientRequest.findUnique({ where: { id: params.requestId } });
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.status !== "PENDING") {
      return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
    }

    if (action === "reject") {
      await prisma.ingredientRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED" },
      });
      await auditRestaurantChange(prisma, {
        restaurantId: request.restaurantId,
        accountId: admin.id,
        entity: "ingredients",
        action: "reject_request",
        diff: { requestId: request.id, name: request.name },
      });
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }

    const ingredientId = body.ingredientId;
    if (typeof ingredientId !== "string" || !ingredientId) {
      return NextResponse.json({ error: "ingredientId is required to map" }, { status: 400 });
    }
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: ingredientId },
      select: { id: true, name: true },
    });
    if (!ingredient) return NextResponse.json({ error: "Ingredient not found" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      const backfilled = await tx.restaurantDishIngredient.updateMany({
        where: { name: { equals: request.name, mode: "insensitive" }, ingredientId: null },
        data: { ingredientId: ingredient.id },
      });
      // Same free-text name filed by other restaurants — resolved by the
      // same mapping, so close them all.
      const resolved = await tx.ingredientRequest.updateMany({
        where: { name: { equals: request.name, mode: "insensitive" }, status: "PENDING" },
        data: { status: "MAPPED", mappedToId: ingredient.id },
      });
      await auditRestaurantChange(tx, {
        restaurantId: request.restaurantId,
        accountId: admin.id,
        entity: "ingredients",
        action: "map_request",
        diff: {
          requestId: request.id,
          name: request.name,
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          backfilledRows: backfilled.count,
        },
      });
      return { backfilled: backfilled.count, resolvedRequests: resolved.count };
    });

    return NextResponse.json({ ok: true, status: "MAPPED", ...result });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
