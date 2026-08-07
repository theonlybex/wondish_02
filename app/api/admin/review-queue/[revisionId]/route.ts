import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
//
// Audit-fix invariants: the revision is CLAIMED inside the transaction
// (status PENDING → terminal via a guarded updateMany), and the dish is
// re-read + re-validated inside the same transaction, so a concurrent staff
// unpublish/delete/PATCH or a second admin's decision aborts with 409
// instead of overwriting a terminal state or applying a stale payload.

class DecisionConflict extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

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
      select: { id: true, status: true },
    });
    if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    if (revision.status !== "PENDING") {
      return NextResponse.json({ error: "This revision has already been decided" }, { status: 409 });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Claim first — terminal states are never overwritten. A concurrent
        // decision, or a staff unpublish/delete that cancelled the revision,
        // makes this a no-op and the whole transaction rolls back.
        const claimed = await tx.restaurantDishRevision.updateMany({
          where: { id: params.revisionId, status: "PENDING" },
          data: {
            status: action === "approve" ? "APPROVED" : "REJECTED",
            reviewNote: note,
            reviewedBy: admin.id,
            reviewedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new DecisionConflict("This revision has already been decided", 409);
        }

        // Re-read revision payload + dish state inside the claim.
        const rev = await tx.restaurantDishRevision.findUniqueOrThrow({
          where: { id: params.revisionId },
          include: {
            dish: { include: { ingredients: { select: { name: true } } } },
          },
        });
        const stagedIngredients =
          (rev.ingredients as unknown as PortalIngredientInput[] | null) ?? null;

        const decision = reviewDecision(
          rev.kind,
          action,
          {
            status: rev.dish.status,
            deletedAt: rev.dish.deletedAt,
            ingredientCount: rev.dish.ingredients.length,
          },
          { stagedIngredientCount: stagedIngredients ? stagedIngredients.length : null }
        );
        if (!decision.ok) throw new DecisionConflict(decision.error, 400);
        const outcome = decision.value;

        const dishData: Record<string, unknown> = {};
        if (outcome.dishStatus) dishData.status = outcome.dishStatus;
        if (outcome.stampVerified) dishData.lastVerifiedAt = new Date();

        if (outcome.applyStaged) {
          if (rev.name) dishData.name = rev.name;
          if (stagedIngredients) {
            // Free-text rows staged before ops mapped their name get the
            // catalog link now: exact-name catalog match first, then a
            // MAPPED IngredientRequest (covers synonym mappings), so an
            // approval can't revert rows the mapping queue already fixed.
            const rows = await resolveStagedCatalogLinks(tx, stagedIngredients);
            await tx.restaurantDishIngredient.deleteMany({ where: { dishId: rev.dishId } });
            if (rows.length) {
              await tx.restaurantDishIngredient.createMany({
                data: rows.map((i) => ({
                  dishId: rev.dishId,
                  name: i.name,
                  quantity: i.quantity,
                  unit: i.unit,
                  ingredientId: i.ingredientId,
                })),
                skipDuplicates: true,
              });
            }
          }
        }

        if (Object.keys(dishData).length) {
          await tx.restaurantDish.update({ where: { id: rev.dishId }, data: dishData });
        }

        await auditRestaurantChange(tx, {
          restaurantId: rev.restaurantId,
          accountId: admin.id,
          entity: rev.kind === "EDIT" ? "ingredients" : "dish",
          entityId: rev.dishId,
          action: action === "approve" ? "approve" : "reject",
          diff: {
            revisionId: rev.id,
            kind: rev.kind,
            note,
            ...(outcome.applyStaged
              ? {
                  name: rev.name,
                  ingredients: stagedIngredients ? stagedIngredients.map((i) => i.name) : null,
                }
              : {}),
          },
        });
      });
    } catch (err) {
      if (err instanceof DecisionConflict) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, status: action === "approve" ? "APPROVED" : "REJECTED" });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

async function resolveStagedCatalogLinks(
  tx: Prisma.TransactionClient,
  rows: PortalIngredientInput[]
): Promise<PortalIngredientInput[]> {
  const freeNames = rows.filter((r) => r.ingredientId === null).map((r) => r.name);
  if (freeNames.length === 0) return rows;

  const [catalog, mapped] = await Promise.all([
    tx.ingredient.findMany({
      where: { OR: freeNames.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })) },
      select: { id: true, name: true },
    }),
    tx.ingredientRequest.findMany({
      where: {
        status: "MAPPED",
        mappedToId: { not: null },
        OR: freeNames.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })),
      },
      select: { name: true, mappedToId: true },
    }),
  ]);
  const byName = new Map<string, string>();
  for (const m of mapped) {
    if (m.mappedToId) byName.set(m.name.toLowerCase(), m.mappedToId);
  }
  for (const c of catalog) byName.set(c.name.toLowerCase(), c.id); // exact match wins

  return rows.map((r) =>
    r.ingredientId === null
      ? { ...r, ingredientId: byName.get(r.name.toLowerCase()) ?? null }
      : r
  );
}
