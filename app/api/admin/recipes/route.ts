import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse, pickFields, RECIPE_MUTABLE_FIELDS } from "@/lib/admin";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const search = searchParams.get("search") ?? "";

    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};

    const [items, total] = await Promise.all([
      prisma.recipe.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { mealType: true, dishType: true, ethnic: true, ingredients: { include: { ingredient: true } } },
      }),
      prisma.recipe.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, limit });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { ingredients } = body;
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    // Allowlisted scalars only; cast is sound because name is validated above
    // and every other listed field is optional on the model.
    const recipeData = pickFields(body, RECIPE_MUTABLE_FIELDS) as Prisma.RecipeUncheckedCreateInput;

    const recipe = await prisma.recipe.create({
      data: {
        ...recipeData,
        ingredients: ingredients?.length
          ? { create: ingredients.map((ing: { ingredientId: string; quantity?: number; unit?: string }) => ({ ingredient: { connect: { id: ing.ingredientId } }, quantity: ing.quantity, unit: ing.unit })) }
          : undefined,
      },
      include: { mealType: true, dishType: true, ethnic: true, ingredients: { include: { ingredient: true } } },
    });

    return NextResponse.json(recipe, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
