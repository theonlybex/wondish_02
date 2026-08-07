import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { auditRestaurantChange } from "@/lib/restaurant-audit";
import { parseReviewAction, reviewDecision } from "@/lib/restaurant-review";
import type { PortalIngredientInput } from "@/lib/restaurant-portal";

// Phase 6a M3 — ops decision on a pending revision (design §7).
// approve PUBLISH → dish goes PUBLISHED; reject → back to DRAFT.
// approve EDIT → staged name/ingredients swap into the live dish;
// reject → dish untouched. Rejections carry a note the portal shows the
// restaurant. Every decision is audited and (on approve) stamps
// lastVerifiedAt — ops just verified the list.

export async function POST(
  req: NextRequest,
  { params }: { params: { revisionId: string } }
) {
  try {
    const admin = await requireAdmin();

    const body = await req.json().catch(() => null);
    const parsed = parseReviewAction(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { action, note } = parsed.value;

    const revision = await prisma.restaurantDishRevision.findUnique({
      where: { id: params.revisionId },
      include: {
        dish: {
          include: { ingredients: { select: { name: true } } },
        },
      },
    });
    if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    if (revision.status !== "PENDING") {
      return NextResponse.json({ error: "This revision has already been decided" }, { status: 409 });
    }

    const decision = reviewDecision(revision.kind, action, {
      status: revision.dish.status,
      deletedAt: revision.dish.deletedAt,
      ingredientCount: revision.dish.ingredients.length,
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: 400 });
    const outcome = decision.value;

    const stagedIngredients =
      (revision.ingredients as unknown as PortalIngredientInput[] | null) ?? null;

    await prisma.$transaction(async (tx) => {
      const dishData: Record<string, unknown> = {};
      if (outcome.dishStatus) dishData.status = outcome.dishStatus;
      if (outcome.stampVerified) dishData.lastVerifiedAt = new Date();

      if (outcome.applyStaged) {
        if (revision.name) dishData.name = revision.name;
        if (stagedIngredients) {
          await tx.restaurantDishIngredient.deleteMany({ where: { dishId: revision.dishId } });
          if (stagedIngredients.length) {
            await tx.restaurantDishIngredient.createMany({
              data: stagedIngredients.map((i) => ({
                dishId: revision.dishId,
                name: i.name,
                quantity: i.quantity,
                unit: i.unit,
                ingredientId: i.ingredientId,
              })),
            });
          }
        }
      }

      if (Object.keys(dishData).length) {
        await tx.restaurantDish.update({ where: { id: revision.dishId }, data: dishData });
      }

      await tx.restaurantDishRevision.update({
        where: { id: revision.id },
        data: {
          status: action === "approve" ? "APPROVED" : "REJECTED",
          reviewNote: note,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });

      await auditRestaurantChange(tx, {
        restaurantId: revision.restaurantId,
        accountId: admin.id,
        entity: revision.kind === "EDIT" ? "ingredients" : "dish",
        entityId: revision.dishId,
        action: action === "approve" ? "approve" : "reject",
        diff: {
          revisionId: revision.id,
          kind: revision.kind,
          note,
          ...(outcome.applyStaged
            ? {
                name: revision.name,
                ingredients: stagedIngredients ? stagedIngredients.map((i) => i.name) : null,
              }
            : {}),
        },
      });
    });

    return NextResponse.json({ ok: true, status: action === "approve" ? "APPROVED" : "REJECTED" });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
