import { prisma } from "@/lib/db";
import {
  computeAllMetrics,
  computeMealCalories,
  resolveMacroProfile,
  getMacroPercentages,
  weeklyDailyCals,
  gradualDailyCals,
  type Sex,
  type CaloricProfileInput,
  type MacroPercentages,
  type CBMIClass,
} from "@/lib/caloric-engine";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  seenIngredientNames: Set<string> = new Set(),
  macroTarget?: MacroPercentages
): RecipeCandidate {
  if (candidates.length === 1) return candidates[0];

  const hasAffinity = Object.keys(affinityMap).length > 0;

  const scored = candidates.map((r) => {
    let score = 0;
    for (const m of motivationNames) {
      if (m === "Build muscle") score += (r.protein ?? 0) * 2;
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
    // Macro profile alignment: penalise recipes whose macro ratios deviate
    // from the patient's target (balanced / diabetic / gain_muscle).
    if (macroTarget && (r.calories ?? 0) > 0) {
      const cal = r.calories!;
      const deviation =
        Math.abs(((r.protein ?? 0) * 4) / cal - macroTarget.protein) +
        Math.abs(((r.carbs   ?? 0) * 4) / cal - macroTarget.carbs)   +
        Math.abs(((r.fat     ?? 0) * 9) / cal - macroTarget.fat);
      score -= deviation * 40;
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

export type MenuRow = { patientId: string; recipeId: string; mealTypeId: string; date: Date; planVersion: number };

// Pure builder: computes the menu rows for a plan. Does NOT touch the menu table.
// Persistence + version flip is handled by the orchestrator (meal-plan-runner).
export async function buildMealPlanMenus(
  patientId: string,
  startDate: Date,
  planVersion: number,
): Promise<MenuRow[]> {
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
  // baseTDEE is TDEE at current body weight (maintenance).
  // The slow deficit schedule is applied per-week inside the day loop.
  let baseTDEE: number = 0;
  let cbmiClass: CBMIClass = "healthy";
  let minCal: number = 2000;
  let maintenanceFloor: number = 0; // TDEE at goal weight — floor for the gradual deficit

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
      baseTDEE         = Math.round(profile.tdeeCBW);
      cbmiClass        = profile.cbmiClass;
      minCal           = profile.minCaloriesValue;
      maintenanceFloor = Math.round(profile.targetCalories);
    }
  }

  // Fall back to 2000 kcal / healthy class when the full caloric profile
  // cannot be computed (e.g. sexAtBirth missing).
  if (baseTDEE === 0) { baseTDEE = 2000; minCal = 1200; maintenanceFloor = 2000; }

  // Compute the plan end date dynamically:
  // - Overweight/obese: run the gradual ramp until the maintenance floor is hit,
  //   then add MAINTENANCE_BUFFER_DAYS at flat floor calories.
  // - All other CBMI classes: fixed 35 days using the original weekly schedule.
  const MAINTENANCE_BUFFER_DAYS = 35;
  const isDeficitPlan  = cbmiClass === "overweight" || cbmiClass === "obese";
  // Floor the deficit ramp at minimum safe calories (see gradualDailyCals),
  // not goal-weight maintenance, so the plan runs a standard-paced deficit.
  const effectiveFloor = minCal;

  let rampEndDay = 35;
  if (isDeficitPlan && baseTDEE > effectiveFloor) {
    for (let d = 1; d <= 365; d++) {
      if (gradualDailyCals(baseTDEE, d, cbmiClass, minCal, maintenanceFloor) <= effectiveFloor) {
        rampEndDay = d;
        break;
      }
    }
  }

  const totalExtraDays = isDeficitPlan ? rampEndDay + MAINTENANCE_BUFFER_DAYS - 1 : 34;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + totalExtraDays);
  endDate.setHours(23, 59, 59, 999);

  const healthConditionNames = patient.healthConditions.map((hc) => hc.condition.name);
  const macroProfile = resolveMacroProfile(healthConditionNames, motivationNames);
  const macroTarget  = getMacroPercentages(macroProfile);

  const rawMealTypes = await prisma.mealType.findMany();
  const mealTypeOrder = ["breakfast", "lunch", "dinner", "snack"];
  const mealTypes = [...rawMealTypes].sort((a, b) => {
    const ai = mealTypeOrder.indexOf(a.name.toLowerCase());
    const bi = mealTypeOrder.indexOf(b.name.toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const menus: MenuRow[] = [];

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

    // Overweight/obese: gradual cumulative deficit that ramps weekly.
    // All other CBMI classes: original flat weekly schedule.
    const weekCals    = isDeficitPlan
      ? gradualDailyCals(baseTDEE, dayIndex, cbmiClass, minCal, maintenanceFloor)
      : weeklyDailyCals(baseTDEE, cbmiClass, Math.ceil(dayIndex / 7), minCal);
    const caloriePlan = computeMealCalories(weekCals);

    let dayCalories = 0;
    const dailyFamilies = new Set<string>();
    let lunchTotalCalories = 0; // tracked after lunch to cap dinner

    const lunchMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "lunch");

    for (const mealType of mealTypes) {
      const mealNameLower   = mealType.name.toLowerCase();
      const target          = caloriePlan[mealNameLower] ?? null;
      const mealSubFamilies = new Set<string>();
      let   mealCalories    = 0;
      const isBiggestMeal   = mealNameLower === "lunch";
      const isDinner        = mealNameLower === "dinner";
      const isSnack         = mealNameLower === "snack";

      // Lunch/Dinner recipes are stored under the Lunch meal type (spec column
      // "Lunch/Dinner"). Dinner queries must include both IDs so the full
      // savoury pool is available for both slots.
      const eligibleMealTypeIds =
        isDinner && lunchMealType
          ? [mealType.id, lunchMealType.id]
          : [mealType.id];

      // Cap dinner so it doesn't exceed lunch (spec: lunch is the biggest meal).
      // Only enforce when lunch was well-served (≥ 85% of its target); if lunch
      // under-performed, using its actual calories as the cap would cascade and
      // starve dinner too — use dinner's own target as the floor instead.
      const lunchTarget = caloriePlan["lunch"] ?? 0;
      const dinnerCalCap = isDinner && lunchTotalCalories > 0 && lunchTotalCalories >= lunchTarget * 0.85
        ? lunchTotalCalories - 1
        : null;

      // dishTypeNames = null → no dish-type restriction (any dish type).
      // Re-reads weekUsedIds / family sets each call so filters stay fresh.
      // Snack-slot queries relax the content filter: simple items like fruits,
      // nuts, and beverages are valid without a full ingredient list.
      const contentFilter = isSnack ? {} : hasContentFilter;

      const queryRecipes = async (
        dishTypeNames: string[] | null,
        calMin?: number,
        calMax?: number
      ): Promise<RecipeCandidate[]> => {
        const calFilter  = calMin != null && calMax != null
          ? { calories: { gte: Math.round(calMin), lte: Math.round(calMax) } }
          : {};
        const dishFilter = dishTypeNames
          ? { dishType: { name: { in: dishTypeNames, mode: "insensitive" as const } } }
          : {};
        const andFilters = [
          ...(dailyFamilies.size   > 0 ? [buildFamilyFilter(dailyFamilies)]     : []),
          ...(mealSubFamilies.size > 0 ? [buildSubFamilyFilter(mealSubFamilies)] : []),
        ];
        const baseWhere = {
          mealTypeId: { in: eligibleMealTypeIds },
          isPublic: true,
          ...contentFilter,
          ...bannedFilter,
          ...calFilter,
          ...dishFilter,
          ...(andFilters.length > 0 ? { AND: andFilters } : {}),
        };
        // First attempt: exclude recipes already used this week
        if (weekUsedIds.size > 0) {
          const results = await prisma.recipe.findMany({
            where: { ...baseWhere, id: { notIn: Array.from(weekUsedIds) } },
            select: recipeSelect,
          });
          if (results.length > 0) return results;
        }
        // Fallback: allow recipe reuse when the weekly pool is exhausted
        return prisma.recipe.findMany({ where: baseWhere, select: recipeSelect });
      };

      const addRecipe = (recipe: RecipeCandidate) => {
        trackChosen(recipe, dailyFamilies, mealSubFamilies, weekUsedIds);
        mealCalories += recipe.calories ?? 0;
        dayCalories  += recipe.calories ?? 0;
        menus.push({ patientId, recipeId: recipe.id, mealTypeId: mealType.id, date: new Date(current), planVersion });
      };

      const pick = (pool: RecipeCandidate[]) =>
        pickByMotivation(pool, motivationNames, affinityMap, seenIngredientNames, macroTarget);

      // ── Step 1: Try a complete meal ────────────────────────────────────────
      if (target !== null) {
        const calMax = dinnerCalCap !== null ? Math.min(target * 1.35, dinnerCalCap) : target * 1.35;
        const pool   = await queryRecipes(["complete meal"], target * 0.55, calMax);
        if (pool.length > 0) addRecipe(pick(pool));
      }

      // ── Step 2: Main dish + sides (when no complete meal was found) ────────
      if (mealCalories === 0) {
        const mainTarget  = target ?? 0;
        const mainCalMax  = dinnerCalCap !== null ? Math.min(mainTarget * 0.80, dinnerCalCap) : mainTarget * 0.80;
        let mainPool      = await queryRecipes(["main dish"], mainTarget * 0.40, mainCalMax);
        if (mainPool.length === 0) mainPool = await queryRecipes(["main dish"]);

        if (mainPool.length > 0) {
          addRecipe(pick(mainPool));

          if (target !== null) {
            // Fill remaining calories with sides in spec-defined priority order.
            for (const sideType of ["veggie side dish", "starchy side dish", "fruity side dish"]) {
              if (mealCalories >= target * 0.90) break;
              const gap  = target - mealCalories;
              const pool = await queryRecipes([sideType], gap * 0.15, gap * 0.80);
              if (pool.length > 0) addRecipe(pick(pool));
            }
          }
        } else {
          // No typed dish found — fall back to any recipe for this meal slot.
          // Always keep a calorie cap to avoid oversized recipes landing here.
          const cap      = target ?? 800;
          const anyPool  = await queryRecipes(null, cap * 0.30, cap * 1.20);
          const fallback = anyPool.length > 0 ? anyPool : await queryRecipes(null, undefined, cap * 1.20);
          if (fallback.length > 0) addRecipe(pick(fallback));
        }
      }

      if (mealCalories === 0) continue;

      // ── Step 3: Dessert for the biggest meal (lunch) ───────────────────────
      if (isBiggestMeal && target !== null && mealCalories < target * 0.85) {
        const gap  = target - mealCalories;
        const pool = await queryRecipes(["dessert"], gap * 0.25, gap * 1.10);
        if (pool.length > 0) addRecipe(pick(pool));
      }

      // ── Step 4: Generic filler if still < 70 % of target ──────────────────
      if (target !== null && mealCalories < target * 0.70) {
        const gap    = target - mealCalories;
        const capMax = dinnerCalCap !== null ? Math.min(gap * 1.10, dinnerCalCap - mealCalories) : gap * 1.10;
        const pool   = await queryRecipes(null, gap * 0.25, capMax);
        if (pool.length > 0) addRecipe(pick(pool));
      }

      if (isBiggestMeal) lunchTotalCalories = mealCalories;
    }

    // ── Calorie top-up ─────────────────────────────────────────────────────
    // If the day is still below 90 % of target, pad with snack-tagged recipes.
    if (snackMealType && dayCalories < weekCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;
      while (dayCalories < weekCals * 0.9 && extraCount < MAX_EXTRA) {
        const calGap          = weekCals - dayCalories;
        const extraFamilyFilter = buildFamilyFilter(dailyFamilies);
        const extraAndFilters = Object.keys(extraFamilyFilter).length > 0 ? [extraFamilyFilter] : [];
        const extraBaseWhere = {
          mealTypeId: snackMealType.id,
          isPublic: true,
          calories: { gte: Math.round(calGap * 0.25), lte: Math.round(calGap) },
          ...hasContentFilter,
          ...bannedFilter,
          ...(extraAndFilters.length > 0 ? { AND: extraAndFilters } : {}),
        };
        let extraCandidates = weekUsedIds.size > 0
          ? await prisma.recipe.findMany({
              where: { ...extraBaseWhere, id: { notIn: Array.from(weekUsedIds) } },
              select: recipeSelect,
            })
          : [];
        if (extraCandidates.length === 0) {
          extraCandidates = await prisma.recipe.findMany({ where: extraBaseWhere, select: recipeSelect });
        }
        if (extraCandidates.length === 0) break;
        const extra = pickByMotivation(extraCandidates, motivationNames, affinityMap, seenIngredientNames, macroTarget);
        const extraCals = extra.calories ?? 0;
        if (extraCals <= 0) break; // no useful calorie contribution; further picks won't help
        dayCalories += extraCals;
        extraCount++;
        weekUsedIds.add(extra.id);
        if (extra.family && !isBeverageExempt(extra)) dailyFamilies.add(extra.family);
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current), planVersion });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return menus;
}
