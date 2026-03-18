import { prisma } from "@/lib/db";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function calcBMR(weightKg: number, heightCm: number, ageYears: number, isMale: boolean): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (isMale ? 5 : -161);
}

function calcEER(bmr: number, activityLevel: number): number {
  const multipliers: Record<number, number> = {
    1: 1.2,
    2: 1.375,
    3: 1.55,
    4: 1.725,
    5: 1.9,
  };
  return bmr * (multipliers[activityLevel] ?? 1.2);
}

function adjustForGoal(eer: number, weeklyGoal: number): number {
  // weeklyGoal > 0 = lose weight (deficit), < 0 = gain weight (surplus)
  return eer - (weeklyGoal * 1000) / 7;
}

function mealCaloriesMap(daily: number): Record<string, number> {
  return {
    breakfast: daily * 0.25,
    lunch: daily * 0.35,
    dinner: daily * 0.3,
    snack: daily * 0.1,
  };
}

export async function generateMealPlan(
  patientId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      gender: true,
      physicalActivity: true,
      foodAllergies: { include: { food: true } },
    },
  });

  const allergyNames = patient?.foodAllergies.map((a) => a.food.name) ?? [];

  // Calculate daily calorie targets if we have enough data
  let caloriePlan: Record<string, number> | null = null;
  if (patient?.weight && patient?.height && patient?.birthday && patient?.physicalActivity?.level) {
    const weightKg = patient.weightUnit === "lbs" ? patient.weight * 0.453592 : patient.weight;
    const heightCm = patient.heightUnit === "in" ? patient.height * 2.54 : patient.height;
    const ageYears =
      (Date.now() - new Date(patient.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const genderName = (patient.gender?.name ?? "").toLowerCase();
    const isMale = genderName.includes("male") && !genderName.includes("female");
    const bmr = calcBMR(weightKg, heightCm, Math.floor(ageYears), isMale);
    const eer = calcEER(bmr, patient.physicalActivity.level);
    const daily =
      patient.weeklyGoal != null ? adjustForGoal(eer, patient.weeklyGoal) : eer;
    caloriePlan = mealCaloriesMap(Math.max(daily, 1200));
  }

  const mealTypes = await prisma.mealType.findMany();

  await prisma.menu.deleteMany({
    where: { patientId, date: { gte: startDate, lte: endDate } },
  });

  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];
  const usedIds = new Set<string>();

  // Only pick recipes that have ingredients and cooking instructions
  const hasContentFilter = {
    ingredients: { some: {} },
    description: { not: null },
  };

  const allergyFilter =
    allergyNames.length > 0
      ? {
          NOT: {
            ingredients: {
              some: {
                ingredient: {
                  name: { in: allergyNames, mode: "insensitive" as const },
                },
              },
            },
          },
        }
      : {};

  const current = new Date(startDate);
  while (current <= endDate) {
    for (const mealType of mealTypes) {
      const target = caloriePlan ? (caloriePlan[mealType.name.toLowerCase()] ?? null) : null;
      const usedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};

      let chosen: { id: string } | undefined;

      if (target !== null) {
        // Primary: calorie-targeted, exclude used, allergy-safe
        const candidates = await prisma.recipe.findMany({
          where: {
            mealTypeId: mealType.id,
            isPublic: true,
            calories: { gte: target - 250, lte: target + 250 },
            ...hasContentFilter,
            ...usedFilter,
            ...allergyFilter,
          },
          select: { id: true },
        });
        if (candidates.length > 0) {
          chosen = shuffleArray(candidates)[0];
        } else {
          // Fallback 1: no calorie restriction, exclude used, allergy-safe
          const fallback1 = await prisma.recipe.findMany({
            where: {
              mealTypeId: mealType.id,
              isPublic: true,
              ...hasContentFilter,
              ...usedFilter,
              ...allergyFilter,
            },
            select: { id: true },
          });
          if (fallback1.length > 0) chosen = shuffleArray(fallback1)[0];
        }
      } else {
        // No calorie data: shuffle allergy-safe recipes, exclude used
        const recipes = await prisma.recipe.findMany({
          where: {
            mealTypeId: mealType.id,
            isPublic: true,
            ...hasContentFilter,
            ...usedFilter,
            ...allergyFilter,
          },
          select: { id: true },
        });
        if (recipes.length > 0) chosen = shuffleArray(recipes)[0];
      }

      // Fallback 2: any recipe with content for this meal type
      if (!chosen) {
        const fallback2 = await prisma.recipe.findFirst({
          where: { mealTypeId: mealType.id, isPublic: true, ...hasContentFilter },
          select: { id: true },
        });
        if (fallback2) chosen = fallback2;
      }

      if (!chosen) continue;

      usedIds.add(chosen.id);
      menus.push({
        patientId,
        recipeId: chosen.id,
        mealTypeId: mealType.id,
        date: new Date(current),
      });
    }

    current.setDate(current.getDate() + 1);
  }

  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }

  return menus.length;
}
