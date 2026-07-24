import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse, pickFields, RECIPE_MUTABLE_FIELDS } from "@/lib/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { ingredients } = body;
    const recipeData = pickFields(body, RECIPE_MUTABLE_FIELDS) as Prisma.RecipeUncheckedUpdateInput;

    const recipe = await prisma.recipe.update({
      where: { id: params.id },
      data: {
        ...recipeData,
        ...(ingredients !== undefined && {
          ingredients: {
            deleteMany: {},
            create: ingredients.map(
              (ing: {
                ingredientId: string;
                quantity?: number;
                unit?: string;
              }) => ({
                ingredient: { connect: { id: ing.ingredientId } },
                quantity: ing.quantity,
                unit: ing.unit,
              })
            ),
          },
        }),
      },
      include: {
        mealType: true,
        dishType: true,
        ethnic: true,
        ingredients: { include: { ingredient: true } },
      },
    });

    return NextResponse.json(recipe);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin();

    await prisma.recipe.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
