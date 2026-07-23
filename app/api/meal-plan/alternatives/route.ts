import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { derivePatientBans, buildDietMatchers, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mealTypeId      = searchParams.get("mealTypeId");
  const excludeRecipeId = searchParams.get("excludeRecipeId");
  const currentCalories = parseFloat(searchParams.get("currentCalories") ?? "0");

  if (!mealTypeId) {
    return NextResponse.json({ error: "mealTypeId required" }, { status: 400 });
  }

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });

  const { allergyNames, exactBanned } = derivePatientBans(
    patient ?? { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] }
  );
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const exactBannedNames = matchers.exactBanned.map((b) => b.name);

  const bannedFilter =
    exactBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: exactBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const calorieFilter = currentCalories > 0
    ? { calories: { gte: currentCalories - 250, lte: currentCalories + 250 } }
    : {};

  // Exact-ban names (avoid/condition/preference/motivation) are still
  // pushed down to the DB filter above. Allergy word-boundary matching
  // cannot be expressed as a Prisma `where` clause, so it's applied here
  // in-memory against a wider candidate pool before slicing to 3 — same
  // two-stage pattern lib/meal-plan.ts uses for its recipe catalog.
  const candidates = await prisma.recipe.findMany({
    where: {
      mealTypeId,
      isPublic: true,
      ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {}),
      ...bannedFilter,
      ...calorieFilter,
    },
    take: 30,
    orderBy: { createdAt: "desc" },
    include: { mealType: true, dishType: true, ingredients: { include: { ingredient: true } } },
  });

  const alternatives = (
    matchers.allergyMatchers.length === 0
      ? candidates
      : candidates.filter(
          (r) => !r.ingredients.some((ri) => matchers.allergyMatchers.some((rx) => rx.test(ri.ingredient.name)))
        )
  ).slice(0, 3);

  return NextResponse.json({ alternatives });
}
