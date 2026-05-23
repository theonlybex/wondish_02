import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const mealTypeId      = searchParams.get("mealTypeId");
  const excludeRecipeId = searchParams.get("excludeRecipeId");
  const currentCalories = parseFloat(searchParams.get("currentCalories") ?? "0");

  if (!mealTypeId) {
    return NextResponse.json({ error: "mealTypeId required" }, { status: 400 });
  }

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

  const allergyNames      = patient?.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]) ?? [];
  const foodsToAvoidNames = patient?.foodToAvoid.map((f) => f.food.name) ?? [];
  const conditionBanned   = patient?.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name)) ?? [];
  const preferenceBanned  = patient?.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name)) ?? [];
  const motivationBanned  = patient?.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name)) ?? [];

  const allBannedNames = Array.from(new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));

  const bannedFilter =
    allBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: allBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const calorieFilter = currentCalories > 0
    ? { calories: { gte: currentCalories - 250, lte: currentCalories + 250 } }
    : {};

  const alternatives = await prisma.recipe.findMany({
    where: {
      mealTypeId,
      isPublic: true,
      ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {}),
      ...bannedFilter,
      ...calorieFilter,
    },
    take: 3,
    orderBy: { createdAt: "desc" },
    include: { mealType: true, dishType: true, ingredients: { include: { ingredient: true } } },
  });

  return NextResponse.json({ alternatives });
}
