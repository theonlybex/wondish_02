import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { coercePrice, parseIngredients, checkDishPublishGate, isDishStatus } from "@/lib/admin-restaurants";

// GET — list all dishes for a restaurant (all statuses; admin view).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    const dishes = await prisma.restaurantDish.findMany({
      where: { restaurantId: params.id },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
      include: { dishType: true, mealType: true, ingredients: true },
    });

    return NextResponse.json({ items: dishes });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// POST — create a dish; ingredients (if provided) are the full ingredient
// set for the dish (there is nothing to "replace" yet on create).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
    if (!restaurant) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
    }

    const { name, section, price, status, ingredients, ...rest } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof section !== "string" || section.trim().length === 0) {
      return NextResponse.json({ error: "section is required" }, { status: 400 });
    }
    if (status !== undefined && !isDishStatus(status)) {
      return NextResponse.json({ error: "status must be one of DRAFT, PUBLISHED" }, { status: 400 });
    }

    const priceResult = coercePrice(price);
    if (!priceResult.ok) {
      return NextResponse.json({ error: priceResult.error }, { status: priceResult.status });
    }

    const ingredientsResult = parseIngredients(ingredients ?? []);
    if (!ingredientsResult.ok) {
      return NextResponse.json({ error: ingredientsResult.error }, { status: ingredientsResult.status });
    }

    const resolvedStatus = (status as string | undefined) ?? "DRAFT";
    const gate = checkDishPublishGate(resolvedStatus, ingredientsResult.value.length);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const dish = await prisma.restaurantDish.create({
      data: {
        ...rest,
        restaurantId: params.id,
        name,
        section,
        price: priceResult.value,
        ...(status !== undefined && { status }),
        ingredients: ingredientsResult.value.length
          ? { create: ingredientsResult.value.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })) }
          : undefined,
      },
      include: { dishType: true, mealType: true, ingredients: true },
    });

    return NextResponse.json(dish, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
