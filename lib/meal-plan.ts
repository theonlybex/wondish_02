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

// ─── Wondish Daily Caloric Distribution (from spec PDF) ─────────────────────
// Breakfast: 20%, Main meal: 35%, Secondary meal: 30%, Snack: 15%
// "Main meal" = lunch (biggest), "Secondary meal" = dinner
//
// The spec also defines ±50 kcal daily variance (pending review) — not yet applied.

function mealCaloriesMap(daily: number): Record<string, number> {
  return {
    breakfast: daily * 0.20,   // Breakfast — 20%
    lunch:    daily * 0.35,    // Main meal (biggest) — 35%
    dinner:   daily * 0.30,    // Secondary meal — 30%
    snack:    daily * 0.15,    // Snack — 15%
  };
}

// ─── Macronutrient Distribution (from spec PDF) ─────────────────────────────
//
// The spec defines three macro profiles:
//
// | Profile       | Protein | Carbs | Fats  |
// |---------------|---------|-------|-------|
// | Balanced      |   30%   |  50%  |  20%  |
// | Diabetic      |   35%   |  45%  |  20%  |
// | Gain Muscle   |   30%   |  40%  |  30%  |
//
// Calories per gram: Protein = 4, Carbs = 4, Fats = 9

// Maps motivation names AND health condition names to the official spec profiles.
// A user with "Type 2 Diabetes" health condition gets the Diabetic profile.
// A user with "Build muscle" motivation gets the Gain Muscle profile.
// All other combinations default to Balanced.
const MACRO_RATIOS: Record<string, { protein: number; carbs: number; fat: number }> = {
  // Motivations
  "Lose weight":      { protein: 0.30, carbs: 0.50, fat: 0.20 },  // Balanced
  "Build muscle":     { protein: 0.30, carbs: 0.40, fat: 0.30 },  // Gain Muscle (spec)
  "Improve energy":   { protein: 0.30, carbs: 0.50, fat: 0.20 },  // Balanced
  "Eat healthier":    { protein: 0.30, carbs: 0.50, fat: 0.20 },  // Balanced
  // Health conditions
  "Type 2 Diabetes":  { protein: 0.35, carbs: 0.45, fat: 0.20 },  // Diabetic (spec)
  "Diabetes":         { protein: 0.35, carbs: 0.45, fat: 0.20 },  // Diabetic alias
};
// Default profile = Balanced (from spec)
const DEFAULT_MACRO_RATIO = { protein: 0.30, carbs: 0.50, fat: 0.20 };

// Blend ratios when user has multiple motivations / conditions
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
  return { protein: sum.protein / active.length, carbs: sum.carbs / active.length, fat: sum.fat / active.length };
}

/**
 * Resolves the biological sex for caloric formulas from sexAtBirth.
 */
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
  protein: number | null;
  calories: number | null;
  carbs: number | null;
  fiber: number | null;
  fat: number | null;
  ingredients: { ingredient: { name: string } }[];
};

// Score candidates by:
//   1. Nutritional fit to motivations (existing logic)
//   2. Ingredient affinity (70% of taste preference) — boosts recipes with liked ingredients
//   3. Novelty bonus (30% of taste preference) — rewards recipes with unseen ingredients
// Picks randomly from top 3 to keep variety.
function pickByMotivation(
  candidates: RecipeCandidate[],
  motivationNames: string[],
  affinityMap: Record<string, number> = {},   // ingredient name → 0.0–1.0
  seenIngredientNames: Set<string> = new Set() // all ingredients from liked + disliked dishes
): RecipeCandidate {
  if (candidates.length <= 1) return candidates[0] ?? shuffleArray(candidates)[0];

  const hasAffinity = Object.keys(affinityMap).length > 0;

  const scored = candidates.map((r) => {
    let score = 0;

    // 1. Motivation scoring
    for (const m of motivationNames) {
      if (m === "Build muscle") {
        score += (r.protein ?? 0) * 2;
      }
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

    // 2. Affinity boost (70% of taste preference)
    if (hasAffinity) {
      for (const ri of r.ingredients) {
        const affinity = affinityMap[ri.ingredient.name.toLowerCase()] ?? 0;
        score += affinity * 14;
      }
    }

    // 3. Novelty bonus (30% of taste preference) — rewards unseen ingredients
    if (seenIngredientNames.size > 0 && r.ingredients.length > 0) {
      const unseen = r.ingredients.filter(
        (ri) => !seenIngredientNames.has(ri.ingredient.name.toLowerCase())
      ).length;
      score += (unseen / r.ingredients.length) * 6;
    }

    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, Math.min(3, scored.length));
  return shuffleArray(topN)[0];
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
      foodAllergies: { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid: { include: { food: true } },
      healthConditions: {
        include: { condition: { include: { bannedIngredients: true } } },
      },
      foodPreferences: {
        include: { food: { include: { bannedIngredients: true } } },
      },
      motivations: {
        include: { motivation: { include: { bannedIngredients: true } } },
      },
      dishPreferences: {
        include: {
          recipe: {
            include: { ingredients: { include: { ingredient: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Collect all banned ingredient names from every source
  const allergyNames = patient?.foodAllergies.flatMap((a) => [
    a.food.name,
    ...a.food.bannedIngredients.map((b) => b.name),
  ]) ?? [];

  const foodsToAvoidNames = patient?.foodToAvoid.map((f) => f.food.name) ?? [];

  const conditionBanned = patient?.healthConditions.flatMap((hc) =>
    hc.condition.bannedIngredients.map((b) => b.name)
  ) ?? [];

  const preferenceBanned = patient?.foodPreferences.flatMap((fp) =>
    fp.food.bannedIngredients.map((b) => b.name)
  ) ?? [];

  const motivationBanned = patient?.motivations.flatMap((pm) =>
    pm.motivation.bannedIngredients.map((b) => b.name)
  ) ?? [];

  const allBannedNames = Array.from(new Set([
    ...allergyNames,
    ...foodsToAvoidNames,
    ...conditionBanned,
    ...preferenceBanned,
    ...motivationBanned,
  ]));

  // Motivation names for scoring
  const motivationNames = patient?.motivations.map((pm) => pm.motivation.name) ?? [];

  // Health condition names — used for macro profile selection (e.g. Diabetic profile)
  const conditionNames = patient?.healthConditions.map((hc) => hc.condition.name) ?? [];

  // Dish Tinder affinity: ingredient frequency from liked dishes → 0.0–1.0
  const allDishPrefs = patient?.dishPreferences ?? [];
  const likedDishPrefs = allDishPrefs.filter((dp) => dp.liked);
  const totalLikedDishes = likedDishPrefs.length;

  const ingredientCount: Record<string, number> = {};
  for (const dp of likedDishPrefs) {
    for (const ri of dp.recipe.ingredients) {
      const name = ri.ingredient.name.toLowerCase();
      ingredientCount[name] = (ingredientCount[name] ?? 0) + 1;
    }
  }
  const affinityMap: Record<string, number> = {};
  if (totalLikedDishes > 0) {
    for (const [name, count] of Object.entries(ingredientCount)) {
      affinityMap[name] = count / totalLikedDishes;
    }
  }

  // Novelty: all ingredients seen in any dish preference (liked or disliked)
  const seenIngredientNames = new Set<string>();
  for (const dp of allDishPrefs) {
    for (const ri of dp.recipe.ingredients) {
      seenIngredientNames.add(ri.ingredient.name.toLowerCase());
    }
  }

  // Calculate daily calorie targets using the Wondish caloric engine
  let caloriePlan: Record<string, number> | null = null;
  let dailyCals = 0;
  if (patient?.weight && patient?.height && patient?.birthday && patient?.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth);
    if (sex) {
      const profileInput: CaloricProfileInput = {
        sex,
        birthday: new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit: patient.heightUnit === "in" ? "in" : "cm",
        cbwValue: patient.weight,
        cbwUnit: (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue: patient.goalWeight,
        utbwUnit: (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };

      const profile = computeAllMetrics(profileInput);
      dailyCals = Math.round(profile.dailyCalories);
      caloriePlan = mealCaloriesMap(dailyCals);
    }
  }

  // Daily macro targets in grams (spec: Protein=4kcal/g, Carbs=4kcal/g, Fats=9kcal/g)
  // Macro profile is determined by motivations + health conditions (e.g. Diabetic)
  // Defaults to Balanced profile if none match
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
      ? {
          NOT: {
            ingredients: {
              some: {
                ingredient: {
                  name: { in: allBannedNames, mode: "insensitive" as const },
                },
              },
            },
          },
        }
      : {};

  // Fields for scoring — includes ingredients for affinity + novelty scoring
  const recipeSelect = {
    id: true, protein: true, calories: true, carbs: true, fiber: true, fat: true,
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  // Find snack meal type for calorie top-up dishes
  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? mealTypes[mealTypes.length - 1];

  const current = new Date(startDate);
  while (current <= endDate) {
    let dayCalories = 0;

    for (const mealType of mealTypes) {
      const mealNameLower = mealType.name.toLowerCase();
      const target = caloriePlan ? (caloriePlan[mealNameLower] ?? null) : null;

      // Reserve 25% of meal calories for a side dish on lunch and dinner
      const needsSide = dailyMacros !== null && target !== null &&
        (mealNameLower === "lunch" || mealNameLower === "dinner");
      const mainTarget = needsSide ? target * 0.75 : target;

      const usedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};

      let chosen: RecipeCandidate | undefined;

      if (mainTarget !== null) {
        // Primary: calorie-targeted, banned-safe, motivation-scored
        const candidates = await prisma.recipe.findMany({
          where: {
            mealTypeId: mealType.id,
            isPublic: true,
            calories: { gte: mainTarget - 250, lte: mainTarget + 250 },
            ...hasContentFilter,
            ...usedFilter,
            ...bannedFilter,
          },
          select: recipeSelect,
        });
        if (candidates.length > 0) {
          chosen = pickByMotivation(candidates, motivationNames, affinityMap, seenIngredientNames);
        } else {
          // Fallback 1: no calorie restriction, banned-safe, motivation-scored
          const fallback1 = await prisma.recipe.findMany({
            where: {
              mealTypeId: mealType.id,
              isPublic: true,
              ...hasContentFilter,
              ...usedFilter,
              ...bannedFilter,
            },
            select: recipeSelect,
          });
          if (fallback1.length > 0) chosen = pickByMotivation(fallback1, motivationNames, affinityMap, seenIngredientNames);
        }
      } else {
        // No calorie data: banned-safe, motivation-scored
        const recipes = await prisma.recipe.findMany({
          where: {
            mealTypeId: mealType.id,
            isPublic: true,
            ...hasContentFilter,
            ...usedFilter,
            ...bannedFilter,
          },
          select: recipeSelect,
        });
        if (recipes.length > 0) chosen = pickByMotivation(recipes, motivationNames, affinityMap, seenIngredientNames);
      }

      // Fallback 2: last resort — any recipe with content for this meal type
      if (!chosen) {
        const fallback2 = await prisma.recipe.findFirst({
          where: { mealTypeId: mealType.id, isPublic: true, ...hasContentFilter },
          select: recipeSelect,
        });
        if (fallback2) chosen = fallback2;
      }

      if (!chosen) continue;

      dayCalories += chosen.calories ?? 0;
      usedIds.add(chosen.id);
      menus.push({
        patientId,
        recipeId: chosen.id,
        mealTypeId: mealType.id,
        date: new Date(current),
      });

      // Side dish for lunch/dinner: pick a "Side Dish" recipe that fills the macro gap
      if (needsSide && dailyMacros) {
        const mealShare = target! / dailyCals;
        const mealProteinTarget = dailyMacros.proteinG * mealShare;
        const mealCarbsTarget   = dailyMacros.carbsG   * mealShare;
        const mealFatTarget     = dailyMacros.fatG      * mealShare;

        const proteinGap = Math.max(0, mealProteinTarget - (chosen.protein ?? 0));
        const carbsGap   = Math.max(0, mealCarbsTarget   - (chosen.carbs   ?? 0));
        const fatGap     = Math.max(0, mealFatTarget     - (chosen.fat     ?? 0));

        const sideCalBudget = target! * 0.25;
        const sideUsedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};

        const sideCandidates = await prisma.recipe.findMany({
          where: {
            isPublic: true,
            dishType: { name: "Side Dish" },
            calories: { gte: sideCalBudget * 0.5, lte: sideCalBudget * 1.5 },
            ...hasContentFilter,
            ...sideUsedFilter,
            ...bannedFilter,
          },
          select: recipeSelect,
        });

        if (sideCandidates.length > 0) {
          // Score side dishes by how well they fill the macro gap
          const scoredSides = sideCandidates.map((r) => ({
            ...r,
            score: -(
              Math.abs((r.protein ?? 0) - proteinGap) +
              Math.abs((r.carbs   ?? 0) - carbsGap)   +
              Math.abs((r.fat     ?? 0) - fatGap)
            ),
          }));
          scoredSides.sort((a, b) => b.score - a.score);
          const side = shuffleArray(scoredSides.slice(0, 3))[0];
          dayCalories += side.calories ?? 0;
          usedIds.add(side.id);
          menus.push({ patientId, recipeId: side.id, mealTypeId: mealType.id, date: new Date(current) });
        }
      }
    }

    // Top-up: if daily calorie target is set and current total is below 90% of it,
    // keep adding extra snack-type dishes until the target is satisfied (max 4 extras).
    if (snackMealType && dailyCals > 0 && dayCalories < dailyCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;

      while (dayCalories < dailyCals * 0.9 && extraCount < MAX_EXTRA) {
        const calGap = dailyCals - dayCalories;
        const extraUsedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};

        // Look for any public recipe whose calories fit within the remaining gap
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
        menus.push({
          patientId,
          recipeId: extra.id,
          mealTypeId: snackMealType.id,
          date: new Date(current),
        });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }

  return menus.length;
}
