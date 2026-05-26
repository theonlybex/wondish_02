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


function resolveSex(sexAtBirth: string | null | undefined, genderName?: string | null): Sex | null {
  for (const val of [sexAtBirth, genderName]) {
    if (!val) continue;
    const s = val.toLowerCase();
    if (s === "male") return "male";
    if (s === "female") return "female";
  }
  return null;
}

type RecipeCandidate = {
  id:        string;
  protein:   number | null;
  calories:  number | null;
  carbs:     number | null;
  fiber:     number | null;
  fat:       number | null;
  family:    string | null;
  subFamily: string | null;
  dishType:  { name: string } | null;
  ingredients: { ingredient: { name: string } }[];
};

function pickByMotivation(
  candidates: RecipeCandidate[],
  motivationNames: string[],
  affinityMap: Record<string, number> = {},
  seenIngredientNames: Set<string> = new Set()
): RecipeCandidate {
  if (candidates.length === 1) return candidates[0];

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

// Beverages not tagged fruity/veggie are exempt from the daily family constraint (per spec).
function isBeverageExempt(recipe: RecipeCandidate): boolean {
  const dishType = recipe.dishType?.name?.toLowerCase() ?? "";
  const family   = recipe.family?.toLowerCase() ?? "";
  return dishType === "beverage" && !family.includes("fruity") && !family.includes("veggie");
}

function trackChosen(
  recipe: RecipeCandidate,
  dailyFamilies: Set<string>,
  mealSubFamilies: Set<string>,
  weekUsedIds: Set<string>
) {
  weekUsedIds.add(recipe.id);
  if (recipe.family && !isBeverageExempt(recipe)) dailyFamilies.add(recipe.family);
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
      gender:           true,
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

  if (!patient) throw new Error("PATIENT_NOT_FOUND");
  if (!patient.profileCompleted) throw new Error("PROFILE_INCOMPLETE");

  // ── Build banned ingredients set ───────────────────────────────────────────
  const allergyNames      = patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  const foodsToAvoidNames = patient.foodToAvoid.map((f) => f.food.name);
  const conditionBanned   = patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name));
  const preferenceBanned  = patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name));
  const motivationBanned  = patient.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name));

  const allBannedNames = Array.from(new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));

  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);

  // ── Build affinity map from liked dishes ───────────────────────────────────
  const likedDishPrefs = patient.dishPreferences.filter((dp) => dp.liked);
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
  for (const dp of patient.dishPreferences) {
    for (const ri of dp.recipe.ingredients) seenIngredientNames.add(ri.ingredient.name.toLowerCase());
  }

  // ── Caloric targets ────────────────────────────────────────────────────────
  let dailyCals = 0;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth, patient.gender?.name);
    if (sex) {
      const profileInput: CaloricProfileInput = {
        sex,
        birthday:      new Date(patient.birthday),
        heightValue:   patient.height,
        heightUnit:    patient.heightUnit === "in" ? "in" : "cm",
        cbwValue:      patient.weight,
        cbwUnit:       (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue:     patient.goalWeight,
        utbwUnit:      (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      const profile = computeAllMetrics(profileInput);
      dailyCals = Math.round(profile.dailyCalories);
    }
  }

  // Fall back to 2000 kcal when the full caloric profile cannot be computed
  // (e.g. sexAtBirth missing). This ensures sides, dessert, and top-up logic
  // always run so every user gets a nutritionally complete meal.
  if (dailyCals === 0) dailyCals = 2000;

  const caloriePlan = mealCaloriesMap(dailyCals);

  const mealTypes = await prisma.mealType.findMany();

  await prisma.menu.deleteMany({
    where: { patientId, date: { gte: startDate, lte: endDate } },
  });

  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];

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
    dishType:    { select: { name: true } },
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? mealTypes[mealTypes.length - 1];

  // weekUsedIds resets every 7 days — prevents recipe exhaustion while still
  // ensuring no recipe repeats within the same week.
  const weekUsedIds = new Set<string>();
  let dayIndex = 0;

  const current = new Date(startDate);
  while (current <= endDate) {
    if (dayIndex % 7 === 0) weekUsedIds.clear();
    dayIndex++;

    let dayCalories = 0;
    const dailyFamilies = new Set<string>();

    for (const mealType of mealTypes) {
      const mealNameLower   = mealType.name.toLowerCase();
      const target          = caloriePlan[mealNameLower] ?? null;
      const mealSubFamilies = new Set<string>();
      let   mealCalories    = 0;

      // Helper: query recipes for this meal type with optional calorie range.
      // Re-reads weekUsedIds / family sets each call so filters stay fresh.
      // Family and subFamily filters are combined via AND to avoid OR-key collision.
      const queryRecipes = async (calMin?: number, calMax?: number): Promise<RecipeCandidate[]> => {
        const usedFilter = weekUsedIds.size > 0 ? { id: { notIn: Array.from(weekUsedIds) } } : {};
        const calFilter  = calMin != null && calMax != null ? { calories: { gte: calMin, lte: calMax } } : {};
        const andFilters = [
          ...( dailyFamilies.size   > 0 ? [buildFamilyFilter(dailyFamilies)]     : []),
          ...( mealSubFamilies.size > 0 ? [buildSubFamilyFilter(mealSubFamilies)] : []),
        ];
        return prisma.recipe.findMany({
          where: {
            mealTypeId: mealType.id,
            isPublic: true,
            ...hasContentFilter,
            ...usedFilter,
            ...bannedFilter,
            ...calFilter,
            ...(andFilters.length > 0 ? { AND: andFilters } : {}),
          },
          select: recipeSelect,
        });
      };

      // ── Primary recipe ─────────────────────────────────────────────────────
      // Try calories in [55 %, 135 %] of the meal target, then fall back to any.
      let primary: RecipeCandidate | undefined;
      if (target !== null) {
        const targeted = await queryRecipes(target * 0.55, target * 1.35);
        if (targeted.length > 0) {
          primary = pickByMotivation(targeted, motivationNames, affinityMap, seenIngredientNames);
        }
      }
      if (!primary) {
        const any = await queryRecipes();
        if (any.length > 0) primary = pickByMotivation(any, motivationNames, affinityMap, seenIngredientNames);
      }
      if (!primary) continue;

      trackChosen(primary, dailyFamilies, mealSubFamilies, weekUsedIds);
      mealCalories += primary.calories ?? 0;
      dayCalories  += primary.calories ?? 0;
      menus.push({ patientId, recipeId: primary.id, mealTypeId: mealType.id, date: new Date(current) });

      // ── Secondary recipe — fill gap when primary is < 70 % of target ───────
      if (target !== null && mealCalories < target * 0.70) {
        const gap = target - mealCalories;
        const fillers = await queryRecipes(gap * 0.25, gap * 1.10);
        if (fillers.length > 0) {
          const secondary = pickByMotivation(fillers, motivationNames, affinityMap, seenIngredientNames);
          trackChosen(secondary, dailyFamilies, mealSubFamilies, weekUsedIds);
          mealCalories += secondary.calories ?? 0;
          dayCalories  += secondary.calories ?? 0;
          menus.push({ patientId, recipeId: secondary.id, mealTypeId: mealType.id, date: new Date(current) });
        }
      }
    }

    // ── Calorie top-up ─────────────────────────────────────────────────────
    // If the day is still below 90 % of target, pad with snack-tagged recipes.
    if (snackMealType && dayCalories < dailyCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;
      while (dayCalories < dailyCals * 0.9 && extraCount < MAX_EXTRA) {
        const calGap          = dailyCals - dayCalories;
        const extraUsedFilter = weekUsedIds.size > 0 ? { id: { notIn: Array.from(weekUsedIds) } } : {};
        const extraCandidates = await prisma.recipe.findMany({
          where: {
            mealTypeId: snackMealType.id,
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
        const extraCals = extra.calories ?? 0;
        if (extraCals <= 0) break; // no useful calorie contribution; further picks won't help
        dayCalories += extraCals;
        extraCount++;
        weekUsedIds.add(extra.id);
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
