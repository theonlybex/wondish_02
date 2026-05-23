import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { recipeId } = await req.json();

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid:      { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
      motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id },
  });
  if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 });

  const newRecipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: { include: { ingredient: true } } },
  });
  if (!newRecipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  if (menu.mealTypeId && newRecipe.mealTypeId !== menu.mealTypeId) {
    return NextResponse.json({ error: "Recipe not suitable for this meal slot" }, { status: 400 });
  }

  const allergyNames      = patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  const foodsToAvoidNames = patient.foodToAvoid.map((f) => f.food.name);
  const conditionBanned   = patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name));
  const preferenceBanned  = patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name));
  const motivationBanned  = patient.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name));
  const allBannedNames    = new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ].map((n) => n.toLowerCase()));

  const recipeIngredientNames = newRecipe.ingredients.map((ri) => ri.ingredient.name.toLowerCase());
  const hasBanned = recipeIngredientNames.some((n) => allBannedNames.has(n));
  if (hasBanned) {
    return NextResponse.json({ error: "Recipe contains ingredients you cannot eat" }, { status: 400 });
  }

  const updated = await prisma.menu.update({
    where: { id: params.menuId },
    data: { recipeId },
    include: { recipe: { include: { mealType: true, dishType: true } }, mealType: true },
  });

  return NextResponse.json(updated);
}
