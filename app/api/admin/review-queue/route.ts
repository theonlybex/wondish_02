import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { ingredientDiff } from "@/lib/restaurant-review";
import type { PortalIngredientInput } from "@/lib/restaurant-portal";

// Phase 6a M3 — ops review queue (design §7). Lists every pending
// RestaurantDishRevision with the data ops needs to decide: the dish as
// diners would see it, the staged payload (EDIT), and the ingredient diff.
// Decisions are POST /api/admin/review-queue/[revisionId].

// M2 shipped submits before revision rows existed, so a dish can sit in
// PENDING_REVIEW with no pending revision. Backfill those lazily — the queue
// is the only surface that cares, and this keeps it complete.
async function backfillLegacyPublishSubmits() {
  const orphans = await prisma.restaurantDish.findMany({
    where: {
      status: "PENDING_REVIEW",
      deletedAt: null,
      revisions: { none: { status: "PENDING" } },
    },
    select: { id: true, restaurantId: true },
  });
  for (const dish of orphans) {
    await prisma.restaurantDishRevision.create({
      data: {
        dishId: dish.id,
        restaurantId: dish.restaurantId,
        kind: "PUBLISH",
        submittedBy: "system-backfill", // pre-M3 submit; submitter unknown
      },
    });
  }
}

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
    await backfillLegacyPublishSubmits();

    const revisions = await prisma.restaurantDishRevision.findMany({
      where: { status: "PENDING", dish: { deletedAt: null } },
      orderBy: { createdAt: "asc" }, // oldest first — FIFO for ops
      include: {
        restaurant: { select: { id: true, name: true } },
        dish: {
          include: {
            ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } },
          },
        },
      },
    });

    const submitterIds = Array.from(
      new Set(revisions.map((r) => r.submittedBy).filter((id) => id !== "system-backfill"))
    );
    const submitters = await prisma.account.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const submitterById = new Map(submitters.map((a) => [a.id, a]));

    const items = revisions.map((r) => {
      const staged = (r.ingredients as unknown as PortalIngredientInput[] | null) ?? null;
      const submitter = submitterById.get(r.submittedBy) ?? null;
      return {
        id: r.id,
        kind: r.kind,
        createdAt: r.createdAt.toISOString(),
        submittedBy: submitter
          ? { email: submitter.email, name: `${submitter.firstName} ${submitter.lastName}`.trim() }
          : null,
        restaurant: r.restaurant,
        dish: {
          id: r.dish.id,
          name: r.dish.name,
          section: r.dish.section,
          description: r.dish.description,
          price: r.dish.price ? r.dish.price.toFixed(2) : null,
          currency: r.dish.currency,
          calories: r.dish.calories,
          status: r.dish.status,
          ingredients: r.dish.ingredients,
        },
        staged: r.kind === "EDIT" ? { name: r.name, ingredients: staged } : null,
        diff: staged ? ingredientDiff(r.dish.ingredients, staged) : null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
