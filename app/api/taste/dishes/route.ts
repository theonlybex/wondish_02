import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { accountHasActivePremium } from "@/lib/auth";
import { derivePatientBans, buildDietMatchers, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ dishes: [] });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = isAdmin || accountHasActivePremium(account.subscriptions);
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ dishes: [] });

  // Build banned ingredient list via the shared engine — full 5-source union
  // (this used to omit motivations; that omission is exactly the drift the
  // shared engine exists to end) plus word-boundary allergy matching.
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const exactBannedNames = matchers.exactBanned.map((b) => b.name);

  const bannedFilter = exactBannedNames.length > 0
    ? {
        NOT: {
          ingredients: {
            some: {
              ingredient: { name: { in: exactBannedNames, mode: "insensitive" as const } },
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

  // Fetch diverse unrated public recipes with content, respecting banned ingredients.
  // Exact-ban names are still pushed down to the DB filter above. Allergy
  // word-boundary matching can't be expressed as a Prisma `where` clause, so
  // ingredient names are selected here (stripped from the response below) and
  // matched in-memory.
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
      ingredients: { select: { ingredient: { select: { name: true } } } },
    },
    take: 80,
  });

  const allowed = matchers.allergyMatchers.length === 0
    ? candidates
    : candidates.filter(
        (r) => !r.ingredients.some((ri) => matchers.allergyMatchers.some((rx) => rx.test(ri.ingredient.name)))
      );

  // Shuffle and return 10 for variety; drop the ingredients field used only
  // for the in-memory allergy check above — response shape is unchanged.
  const shuffled = [...allowed].sort(() => Math.random() - 0.5);
  const dishes = shuffled.slice(0, 10).map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    description: r.description,
    calories: r.calories,
    tags: r.tags,
    mealType: r.mealType,
    ethnic: r.ethnic,
  }));
  return NextResponse.json({ dishes });
}
