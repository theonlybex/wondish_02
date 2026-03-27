import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ dishes: [] });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account.subscription;
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      foodAllergies: { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid: { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences: { include: { food: { include: { bannedIngredients: true } } } },
    },
  });
  if (!patient) return NextResponse.json({ dishes: [] });

  // Build banned ingredient list (same logic as meal planner)
  const bannedNames = [
    ...new Set([
      ...patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]),
      ...patient.foodToAvoid.map((f) => f.food.name),
      ...patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name)),
      ...patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name)),
    ]),
  ];

  const bannedFilter = bannedNames.length > 0
    ? {
        NOT: {
          ingredients: {
            some: {
              ingredient: { name: { in: bannedNames, mode: "insensitive" as const } },
            },
          },
        },
      }
    : {};

  // Get already-swiped IDs
  const swiped = await prisma.patientDishPreference.findMany({
    where: { patientId: patient.id },
    select: { recipeId: true },
  });
  const swipedIds = swiped.map((s) => s.recipeId);

  // Fetch diverse unrated public recipes with content, respecting banned ingredients
  const candidates = await prisma.recipe.findMany({
    where: {
      isPublic: true,
      ingredients: { some: {} },
      description: { not: null },
      ...(swipedIds.length > 0 ? { id: { notIn: swipedIds } } : {}),
      ...bannedFilter,
    },
    select: {
      id: true,
      name: true,
      emoji: true,
      description: true,
      calories: true,
      tags: true,
      mealType: { select: { name: true } },
      ethnic: { select: { name: true } },
    },
    take: 80,
  });

  // Shuffle and return 10 for variety
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return NextResponse.json({ dishes: shuffled.slice(0, 10) });
}
