import { prisma } from "@/lib/db";
import {
  computeAllMetrics,
  type Sex,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mealCaloriesMap(daily: number): Record<string, number> {
  return {
    breakfast: daily * 0.20,
    lunch:     daily * 0.35,
    dinner:    daily * 0.30,
    snack:     daily * 0.15,
  };
}

const MACRO_RATIOS: Record<string, { protein: number; carbs: number; fat: number }> = {
  "Lose weight":     { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Build muscle":    { protein: 0.30, carbs: 0.40, fat: 0.30 },
  "Improve energy":  { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Eat healthier":   { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Type 2 Diabetes": { protein: 0.35, carbs: 0.45, fat: 0.20 },
  "Diabetes":        { protein: 0.35, carbs: 0.45, fat: 0.20 },
};
const DEFAULT_MACRO_RATIO = { protein: 0.30, carbs: 0.50, fat: 0.20 };

function calcMacroRatio(
  motivationNames: string[],
  conditionNames: string[] = []
): { protein: number; carbs: number; fat: number } {
  const allNames = [...motivationNames, ...conditionNames];
  const active = allNames.filter((m) => MACRO_RATIOS[m]);
  if (active.length === 0) return DEFAULT_MACRO_RATIO;
  const sum = active.reduce(
    (acc, m) => {
      const r = MACRO_RATIOS[m];
      return { protein: acc.protein + r.protein, carbs: acc.carbs + r.carbs, fat: acc.fat + r.fat };
    },
    { protein: 0, carbs: 0, fat: 0 }
  );
  return {
    protein: sum.protein / active.length,
    carbs:   sum.carbs   / active.length,
    fat:     sum.fat     / active.length,
  };
}

function resolveSex(sexAtBirth: string | null | undefined): Sex | null {
  if (sexAtBirth) {
    const s = sexAtBirth.toLowerCase();
    if (s === "male") return "male";
    if (s === "female") return "female";
  }
  return null;
}

type RecipeCandidate = {
  id: string;
  protein:   number | null;
  calories:  number | null;
  carbs:     number | null;
  fiber:     number | null;
  fat:       number | null;
  family:    string | null;
  subFamily: string | null;
  ingredients: { ingredient: { name: string } }[];
};

function pickByMotivation(
  candidates: RecipeCandidate[],
  motivationNames: string[],
  affinityMap: Record<string, number> = {},
  seenIngredientNames: Set<string> = new Set()
): RecipeCandidate {
  if (candidates.length <= 1) return candidates[0] ?? shuffleArray(candidates)[0];

  const hasAffinity = Object.keys(affinityMap).length > 0;

  const scored = candidates.map((r) => {
    let score = 0;
    for (const m of motivationNames) {
      if (m === "Build muscle") score += (r.protein ?? 0) * 2;
      if (m === "Lose weight") {
        score -= (r.fat ?? 0) * 0.8;
        score -= (r.calories ?? 0) * 0.03;
        score += (r.fiber ?? 0) * 2;
      }
      if (m === "Improve energy") {
        score += (r.fiber ?? 0) * 3;
        score += (r.protein ?? 0) * 0.5;
      }
      if (m === "Eat healthier") {
        score += (r.fiber ?? 0) * 2;
        score -= (r.fat ?? 0) * 0.5;
        score += (r.protein ?? 0) * 0.5;
      }
    }
    if (hasAffinity) {
      for (const ri of r.ingredients) {
        score += (affinityMap[ri.ingredient.name.toLowerCase()] ?? 0) * 14;
      }
    }
    if (seenIngredientNames.size > 0 && r.ingredients.length > 0) {
      const unseen = r.ingredients.filter(
        (ri) => !seenIngredientNames.has(ri.ingredient.name.toLowerCase())
      ).length;
      score += (unseen / r.ingredients.length) * 6;
    }
    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return shuffleArray(scored.slice(0, Math.min(3, scored.length)))[0];
}

// Recipes with null family/subFamily are never blocked.
function buildFamilyFilter(dailyFamilies: Set<string>) {
  if (dailyFamilies.size === 0) return {};
  return {
    OR: [
      { family: null },
      { family: { notIn: Array.from(dailyFamilies) } },
    ],
  };
}

function buildSubFamilyFilter(mealSubFamilies: Set<string>) {
  if (mealSubFamilies.size === 0) return {};
  return {
    OR: [
      { subFamily: null },
      { subFamily: { notIn: Array.from(mealSubFamilies) } },
    ],
  };
}

// Beverages are exempt from the daily family constraint.
function trackChosen(
  recipe: RecipeCandidate,
  isBeverage: boolean,
  dailyFamilies: Set<string>,
  mealSubFamilies: Set<string>,
  usedIds: Set<string>
) {
  usedIds.add(recipe.id);
  if (recipe.family && !isBeverage) dailyFamilies.add(recipe.family);
  if (recipe.subFamily) mealSubFamilies.add(recipe.subFamily);
}

export async function generateMealPlan(
  patientId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      physicalActivity: true,
      foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid:      { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences:  { include: { food:      { include: { bannedIngredients: true } } } },
      motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
      dishPreferences:  {
        include: {
          recipe: {
            include: { ingredients: { include: { ingredient: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Profile completeness gate
  if (!patient?.profileCompleted) {
    throw new Error("PROFILE_INCOMPLETE");
  }

  const allergyNames     = patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  const foodsToAvoidNames = patient.foodToAvoid.map((f) => f.food.name);
  const conditionBanned  = patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name));
  const preferenceBanned = patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name));
  const motivationBanned = patient.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name));

  const allBannedNames = Array.from(new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));

  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);
  const conditionNames  = patient.healthConditions.map((hc) => hc.condition.name);

  const allDishPrefs   = patient.dishPreferences;
  const likedDishPrefs = allDishPrefs.filter((dp) => dp.liked);
  const totalLiked     = likedDishPrefs.length;
  const ingredientCount: Record<string, number> = {};
  for (const dp of likedDishPrefs) {
    for (const ri of dp.recipe.ingredients) {
      const n = ri.ingredient.name.toLowerCase();
      ingredientCount[n] = (ingredientCount[n] ?? 0) + 1;
    }
  }
  const affinityMap: Record<string, number> = {};
  if (totalLiked > 0) {
    for (const [n, c] of Object.entries(ingredientCount)) affinityMap[n] = c / totalLiked;
  }
  const seenIngredientNames = new Set<string>();
  for (const dp of allDishPrefs) {
    for (const ri of dp.recipe.ingredients) seenIngredientNames.add(ri.ingredient.name.toLowerCase());
  }

  let caloriePlan: Record<string, number> | null = null;
  let dailyCals = 0;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth);
    if (sex) {
      const profileInput: CaloricProfileInput = {
        sex,
        birthday:    new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit:  patient.heightUnit === "in" ? "in" : "cm",
        cbwValue:    patient.weight,
        cbwUnit:     (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue:   patient.goalWeight,
        utbwUnit:    (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      const profile = computeAllMetrics(profileInput);
      dailyCals   = Math.round(profile.dailyCalories);
      caloriePlan = mealCaloriesMap(dailyCals);
    }
  }

  let dailyMacros: { proteinG: number; carbsG: number; fatG: number } | null = null;
  if (dailyCals > 0) {
    const ratio = calcMacroRatio(motivationNames, conditionNames);
    dailyMacros = {
      proteinG: (ratio.protein * dailyCals) / 4,
      carbsG:   (ratio.carbs   * dailyCals) / 4,
      fatG:     (ratio.fat     * dailyCals) / 9,
    };
  }

  const mealTypes = await prisma.mealType.findMany();

  await prisma.menu.deleteMany({
    where: { patientId, date: { gte: startDate, lte: endDate } },
  });

  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];
  const usedIds = new Set<string>();

  const hasContentFilter = {
    ingredients: { some: {} },
    description: { not: null },
  };

  const bannedFilter =
    allBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: allBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const recipeSelect = {
    id: true, protein: true, calories: true, carbs: true, fiber: true, fat: true,
    family: true, subFamily: true,
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? mealTypes[mealTypes.length - 1];

  const current = new Date(startDate);
  while (current <= endDate) {
    let dayCalories  = 0;
    const dailyFamilies = new Set<string>();

    for (const mealType of mealTypes) {
      const mealNameLower = mealType.name.toLowerCase();
      const target        = caloriePlan ? (caloriePlan[mealNameLower] ?? null) : null;
      const mealSubFamilies = new Set<string>();

      const usedFilter      = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
      const familyFilter    = buildFamilyFilter(dailyFamilies);
      const subFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

      const baseWhere = {
        mealTypeId: mealType.id,
        isPublic: true,
        ...hasContentFilter,
        ...usedFilter,
        ...bannedFilter,
        ...familyFilter,
        ...subFamilyFilter,
      };

      // ── Step A: Complete Meal ──────────────────────────────────────────────
      const completeCandidates = await prisma.recipe.findMany({
        where: {
          ...baseWhere,
          dishType: { name: "Complete Meal" },
          ...(target ? { calories: { gte: target - 250, lte: target + 250 } } : {}),
        },
        select: recipeSelect,
      });

      if (completeCandidates.length > 0) {
        const chosen = pickByMotivation(completeCandidates, motivationNames, affinityMap, seenIngredientNames);
        trackChosen(chosen, false, dailyFamilies, mealSubFamilies, usedIds);
        dayCalories += chosen.calories ?? 0;
        menus.push({ patientId, recipeId: chosen.id, mealTypeId: mealType.id, date: new Date(current) });
        continue;
      }

      // ── Step B: Main Dish ──────────────────────────────────────────────────
      const mainTarget = target !== null
        ? (mealNameLower === "lunch" || mealNameLower === "dinner" ? target * 0.75 : target)
        : null;

      let mainChosen: RecipeCandidate | undefined;

      if (mainTarget !== null) {
        const mainCandidates = await prisma.recipe.findMany({
          where: {
            ...baseWhere,
            dishType: { name: { in: ["Main Dish", "Main Course"] } },
            calories: { gte: mainTarget - 250, lte: mainTarget + 250 },
          },
          select: recipeSelect,
        });
        if (mainCandidates.length > 0) {
          mainChosen = pickByMotivation(mainCandidates, motivationNames, affinityMap, seenIngredientNames);
        }
      }

      if (!mainChosen) {
        const fallback1 = await prisma.recipe.findMany({
          where: {
            ...baseWhere,
            dishType: { name: { in: ["Main Dish", "Main Course"] } },
          },
          select: recipeSelect,
        });
        if (fallback1.length > 0) mainChosen = pickByMotivation(fallback1, motivationNames, affinityMap, seenIngredientNames);
      }

      if (!mainChosen) {
        const fallback2 = await prisma.recipe.findFirst({
          where: { mealTypeId: mealType.id, isPublic: true, ...hasContentFilter },
          select: recipeSelect,
        });
        if (fallback2) mainChosen = fallback2;
      }

      if (!mainChosen) continue;

      trackChosen(mainChosen, false, dailyFamilies, mealSubFamilies, usedIds);
      dayCalories += mainChosen.calories ?? 0;
      menus.push({ patientId, recipeId: mainChosen.id, mealTypeId: mealType.id, date: new Date(current) });

      // ── Step C: Side dishes (lunch and dinner only) ────────────────────────
      const needsSides = dailyMacros !== null && target !== null &&
        (mealNameLower === "lunch" || mealNameLower === "dinner");

      if (needsSides && dailyMacros) {
        const mealShare         = target! / dailyCals;
        const mealProteinTarget = dailyMacros.proteinG * mealShare;
        const mealCarbsTarget   = dailyMacros.carbsG   * mealShare;
        const mealFatTarget     = dailyMacros.fatG      * mealShare;

        const proteinGap = Math.max(0, mealProteinTarget - (mainChosen.protein ?? 0));
        const carbsGap   = Math.max(0, mealCarbsTarget   - (mainChosen.carbs   ?? 0));
        const fatGap     = Math.max(0, mealFatTarget      - (mainChosen.fat     ?? 0));

        const sideCalBudget = target! * 0.25;

        const pickSide = async (dishTypeName: string, scoreByGap: (r: RecipeCandidate) => number) => {
          const sideUsedFilter      = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
          const sideFamilyFilter    = buildFamilyFilter(dailyFamilies);
          const sideSubFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

          const sideCandidates = await prisma.recipe.findMany({
            where: {
              isPublic: true,
              dishType: { name: dishTypeName },
              calories: { gte: sideCalBudget * 0.5, lte: sideCalBudget * 1.5 },
              ...hasContentFilter,
              ...sideUsedFilter,
              ...bannedFilter,
              ...sideFamilyFilter,
              ...sideSubFamilyFilter,
            },
            select: recipeSelect,
          });
          if (sideCandidates.length === 0) return;

          const scored = sideCandidates.map((r) => ({ ...r, _score: scoreByGap(r) }));
          scored.sort((a, b) => b._score - a._score);
          const side = shuffleArray(scored.slice(0, 3))[0];

          trackChosen(side, false, dailyFamilies, mealSubFamilies, usedIds);
          dayCalories += side.calories ?? 0;
          menus.push({ patientId, recipeId: side.id, mealTypeId: mealType.id, date: new Date(current) });
        };

        await pickSide("Veggie Side Dish", (r) =>
          -(Math.abs((r.protein ?? 0) - proteinGap) + Math.abs((r.fat ?? 0) - fatGap))
        );

        await pickSide("Starchy Side Dish", (r) =>
          -(Math.abs((r.carbs ?? 0) - carbsGap) + Math.abs((r.fat ?? 0) - fatGap))
        );

        const calRemaining = target! - (dayCalories % (target! + 1));
        if (calRemaining > sideCalBudget * 0.4) {
          await pickSide("Fruity Side Dish", (r) => -(Math.abs((r.calories ?? 0) - calRemaining)));
        }
      }

      // ── Step D: Dessert (lunch only) ───────────────────────────────────────
      if (mealNameLower === "lunch" && target !== null && !dailyFamilies.has("dessert")) {
        const dessertUsedFilter      = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
        const dessertFamilyFilter    = buildFamilyFilter(dailyFamilies);
        const dessertSubFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

        const dessertBudget = target * 0.15;
        const dessertCandidates = await prisma.recipe.findMany({
          where: {
            isPublic: true,
            dishType: { name: "Dessert" },
            calories: { gte: dessertBudget * 0.5, lte: dessertBudget * 1.5 },
            ...hasContentFilter,
            ...dessertUsedFilter,
            ...bannedFilter,
            ...dessertFamilyFilter,
            ...dessertSubFamilyFilter,
          },
          select: recipeSelect,
        });

        if (dessertCandidates.length > 0) {
          const dessert = pickByMotivation(dessertCandidates, motivationNames, affinityMap, seenIngredientNames);
          trackChosen(dessert, false, dailyFamilies, mealSubFamilies, usedIds);
          dayCalories += dessert.calories ?? 0;
          menus.push({ patientId, recipeId: dessert.id, mealTypeId: mealType.id, date: new Date(current) });
        }
      }
    }

    // ── Calorie top-up ─────────────────────────────────────────────────────
    if (snackMealType && dailyCals > 0 && dayCalories < dailyCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;
      while (dayCalories < dailyCals * 0.9 && extraCount < MAX_EXTRA) {
        const calGap          = dailyCals - dayCalories;
        const extraUsedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
        const extraCandidates = await prisma.recipe.findMany({
          where: {
            isPublic: true,
            calories: { gte: Math.round(calGap * 0.25), lte: Math.round(calGap) },
            ...hasContentFilter,
            ...extraUsedFilter,
            ...bannedFilter,
          },
          select: recipeSelect,
        });
        if (extraCandidates.length === 0) break;
        const extra = pickByMotivation(extraCandidates, motivationNames, affinityMap, seenIngredientNames);
        dayCalories += extra.calories ?? 0;
        extraCount++;
        usedIds.add(extra.id);
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current) });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }
  return menus.length;
}
