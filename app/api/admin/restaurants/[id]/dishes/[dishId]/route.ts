import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { coercePrice, parseIngredients, checkDishPublishGate, isDishStatus } from "@/lib/admin-restaurants";

// Typed early-exits thrown from inside the $transaction below and mapped back
// to the same response shapes outside it (mirrors AccountClaimConflictError /
// lib/auth.ts's instanceof-catch convention) — adminErrorResponse's generic
// catch-all only knows UNAUTHORIZED/FORBIDDEN, so a bare Error would surface
// as a 500 here instead of the existing 404/400.
class DishNotFoundError extends Error {}
class DishGateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// PATCH — any schema field incl. status transitions. `ingredients`, when
// present, is a full replace-all of the dish's ingredient set (composite PK
// (dishId, name) — deleteMany + create, both inside one dish.update() call
// so there's no window where a dish's ingredient rows are orphaned/partial).
// The publish gate is evaluated against the EFFECTIVE post-write state
// (body.status ?? existing.status, body.ingredients ?? existing ingredients)
// so a payload that omits `ingredients` can't sneak a PUBLISHED dish down to
// zero ingredients, and a payload that omits `status` can't clear ingredients
// out from under an already-PUBLISHED dish.
//
// The gate-check + write run inside one interactive prisma.$transaction.
// The app runs default Postgres READ COMMITTED (no isolationLevel override,
// see lib/db.ts), so a plain in-tx findUnique only guarantees no dirty
// reads — it does NOT guarantee the gate is evaluated against the row a
// concurrent writer is about to commit. Two concurrent PATCHes — A
// clearing ingredients on a DRAFT dish, B publishing without touching
// ingredients — could still interleave under READ COMMITTED: both tx's
// findUnique run before either write lands, so B's gate passes against the
// pre-A ingredient count, A commits the delete, then B commits PUBLISHED
// with zero ingredients. To close this, the first statement in the
// transaction takes a `SELECT ... FOR UPDATE` row lock on the target dish.
// That serializes concurrent PATCHes to this dish: the second transaction
// blocks at the lock until the first commits, and once unblocked its
// subsequent findUnique reads the first transaction's committed state —
// so the gate is always evaluated against the row as it will actually be
// written, not a stale snapshot.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dishId: string } }
) {
  try {
    await requireAdmin();

    const existing = await prisma.restaurantDish.findUnique({
      where: { id: params.dishId },
    });
    if (!existing || existing.restaurantId !== params.id) {
      return NextResponse.json({ error: "Dish not found" }, { status: 404 });
    }

    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
    }

    const { price, status, ingredients, ...rest } = body as Record<string, unknown>;

    if (status !== undefined && !isDishStatus(status)) {
      return NextResponse.json({ error: "status must be one of DRAFT, PUBLISHED" }, { status: 400 });
    }

    let priceValue: string | null | undefined;
    if (price !== undefined) {
      const priceResult = coercePrice(price);
      if (!priceResult.ok) {
        return NextResponse.json({ error: priceResult.error }, { status: priceResult.status });
      }
      priceValue = priceResult.value;
    }

    let ingredientsValue: { name: string; quantity: number | null; unit: string | null }[] | undefined;
    if (ingredients !== undefined) {
      const ingredientsResult = parseIngredients(ingredients);
      if (!ingredientsResult.ok) {
        return NextResponse.json({ error: ingredientsResult.error }, { status: ingredientsResult.status });
      }
      ingredientsValue = ingredientsResult.value;
    }

    try {
      const dish = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "RestaurantDish" WHERE id = ${params.dishId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new DishNotFoundError();
        }

        const fresh = await tx.restaurantDish.findUnique({
          where: { id: params.dishId },
          include: { _count: { select: { ingredients: true } } },
        });
        if (!fresh || fresh.restaurantId !== params.id) {
          throw new DishNotFoundError();
        }

        const effectiveStatus = (status as string | undefined) ?? fresh.status;
        const effectiveIngredientCount =
          ingredientsValue !== undefined ? ingredientsValue.length : fresh._count.ingredients;
        const gate = checkDishPublishGate(effectiveStatus, effectiveIngredientCount);
        if (!gate.ok) {
          throw new DishGateError(gate.error, gate.status);
        }

        return tx.restaurantDish.update({
          where: { id: params.dishId },
          data: {
            ...rest,
            ...(priceValue !== undefined && { price: priceValue }),
            ...(status !== undefined && { status }),
            ...(ingredientsValue !== undefined && {
              ingredients: {
                deleteMany: {},
                create: ingredientsValue.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
              },
            }),
          },
          include: { dishType: true, mealType: true, ingredients: true },
        });
      });

      return NextResponse.json(dish);
    } catch (err) {
      if (err instanceof DishNotFoundError) {
        return NextResponse.json({ error: "Dish not found" }, { status: 404 });
      }
      if (err instanceof DishGateError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; dishId: string } }
) {
  try {
    await requireAdmin();

    const existing = await prisma.restaurantDish.findUnique({ where: { id: params.dishId } });
    if (!existing || existing.restaurantId !== params.id) {
      return NextResponse.json({ error: "Dish not found" }, { status: 404 });
    }

    await prisma.restaurantDish.delete({ where: { id: params.dishId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
