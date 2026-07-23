import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { coercePrice, parseIngredients, checkDishPublishGate, isDishStatus } from "@/lib/admin-restaurants";

// PATCH — any schema field incl. status transitions. `ingredients`, when
// present, is a full replace-all of the dish's ingredient set (composite PK
// (dishId, name) — deleteMany + create, both inside one dish.update() call
// so there's no window where a dish's ingredient rows are orphaned/partial).
// The publish gate is evaluated against the EFFECTIVE post-write state
// (body.status ?? existing.status, body.ingredients ?? existing ingredients)
// so a payload that omits `ingredients` can't sneak a PUBLISHED dish down to
// zero ingredients, and a payload that omits `status` can't clear ingredients
// out from under an already-PUBLISHED dish.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dishId: string } }
) {
  try {
    await requireAdmin();

    const existing = await prisma.restaurantDish.findUnique({
      where: { id: params.dishId },
      include: { _count: { select: { ingredients: true } } },
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

    const effectiveStatus = (status as string | undefined) ?? existing.status;
    const effectiveIngredientCount = ingredientsValue !== undefined ? ingredientsValue.length : existing._count.ingredients;
    const gate = checkDishPublishGate(effectiveStatus, effectiveIngredientCount);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const dish = await prisma.restaurantDish.update({
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

    return NextResponse.json(dish);
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
