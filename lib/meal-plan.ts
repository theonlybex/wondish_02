import { prisma } from "@/lib/db";
import {
  computeAllMetrics,
  computeMealCalories,
  resolveMacroProfile,
  getMacroPercentages,
  gradualDailyCals,
  maxDailyDeficit,
  resolvePlanDirection,
  capWindowToDayBudget,
  DAY_CALORIE_TOLERANCE,
  type Sex,
  type CaloricProfileInput,
  type MacroPercentages,
  type PlanDirection,
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

// Pool entries carry mealTypeId + description so the in-memory filters can
// reproduce the per-pick Prisma queries (meal-type scoping, content filter).
type PoolRecipe = RecipeCandidate & { mealTypeId: string | null; description: string | null };

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

// rows + the weight (lbs) the calorie targets were computed from, so the
// runner stamps the drift anchor from the same read the plan was built with.
export type BuildResult = { rows: MenuRow[]; builtForWeight: number | null };

// Pure builder: computes the menu rows for a plan. Does NOT touch the menu table.
// Persistence + version flip is handled by the orchestrator (meal-plan-runner).
export async function buildMealPlanMenus(
  patientId: string,
  startDate: Date,
  planVersion: number,
): Promise<BuildResult> {
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

  // Allergy-derived names match by WORD BOUNDARY: "peanut" also bans
  // "peanut butter" / "roasted peanuts", but "egg" does not ban "eggplant".
  // Non-allergy sources (avoid list, conditions, preferences, motivations)
  // keep exact-name matching — guidance, not safety-critical.
  const exactBannedNames = Array.from(new Set([
    ...foodsToAvoidNames, ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const allergyMatchers = Array.from(new Set(allergyNames))
    .map((name) => name.trim().toLowerCase().replace(/(?<!s)s$/, "")) // singular stem; keep "-ss" words
    .filter((stem) => stem.length >= 2)
    .map((stem) => new RegExp(`\\b${escapeRe(stem)}(?:s|es)?\\b`, "i"));

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
  // baseTDEE is TDEE at current body weight (maintenance). The gradual
  // deficit/surplus schedule is keyed by the plan DIRECTION (goal-driven,
  // healthy-clamped — see resolvePlanDirection), so lose and gain plans use
  // the same schedule shape as the engine's projections.
  let baseTDEE: number = 0;
  let direction: PlanDirection = "maintain";
  let minCal: number = 2000;
  let maxDeficit: number = 0; // severity-scaled per-day deficit cap (see maxDailyDeficit)

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
      baseTDEE  = Math.round(profile.tdeeCBW);
      direction = resolvePlanDirection(profile);
      minCal    = profile.minCaloriesValue;
      maxDeficit = maxDailyDeficit(profile.cbmi);
    }
  }

  // Fall back to a flat 2000 kcal maintenance plan when the full caloric
  // profile cannot be computed (e.g. sexAtBirth missing).
  if (baseTDEE === 0) { baseTDEE = 2000; minCal = 1200; maxDeficit = maxDailyDeficit(22); }

  // Compute the plan end date dynamically:
  // - Lose/gain plans: run the gradual ramp until it plateaus at the severity-
  //   scaled cap, then add MAINTENANCE_BUFFER_DAYS at the plateau.
  // - Maintain plans: fixed 35 days at maintenance calories.
  const MAINTENANCE_BUFFER_DAYS = 35;
  const isRampPlan = direction !== "maintain";
  // Plateau intake: lose → the deeper of minCal and (maintenance − cap);
  // gain → maintenance + cap.
  const plateauCals = direction === "gain"
    ? Math.round(baseTDEE + maxDeficit)
    : Math.max(minCal, baseTDEE - maxDeficit);

  let rampEndDay = 35;
  if (isRampPlan && (direction === "gain" || baseTDEE > plateauCals)) {
    for (let d = 1; d <= 365; d++) {
      const cals = gradualDailyCals(baseTDEE, d, direction, minCal, maxDeficit);
      if (direction === "gain" ? cals >= plateauCals : cals <= plateauCals) {
        rampEndDay = d;
        break;
      }
    }
  }

  const totalExtraDays = isRampPlan ? rampEndDay + MAINTENANCE_BUFFER_DAYS - 1 : 34;
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

  const bannedFilter =
    exactBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: exactBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const recipeSelect = {
    id: true, protein: true, calories: true, carbs: true, fiber: true, fat: true,
    family: true, subFamily: true,
    dishType:    { select: { name: true } },
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? mealTypes[mealTypes.length - 1];

  // Perf: load the eligible catalog ONCE and filter in memory. The previous
  // implementation issued 2–10 Prisma round-trips per meal slot (thousands
  // over a long deficit plan). isPublic and the banned-ingredient exclusion
  // are constant for the whole build, so they stay in the DB query; all
  // per-pick filters below reproduce the old queries' semantics exactly.
  const recipePoolRaw: PoolRecipe[] = await prisma.recipe.findMany({
    where: { isPublic: true, ...bannedFilter },
    select: { ...recipeSelect, mealTypeId: true, description: true },
  });
  // Allergy bans apply by word boundary against every ingredient name.
  const recipePool = allergyMatchers.length === 0
    ? recipePoolRaw
    : recipePoolRaw.filter(
        (r) => !r.ingredients.some((ri) => allergyMatchers.some((rx) => rx.test(ri.ingredient.name)))
      );

  // weekUsedIds resets every 7 days — prevents recipe exhaustion while still
  // ensuring no recipe repeats within the same week.
  const weekUsedIds = new Set<string>();
  let dayIndex = 0;

  const current = new Date(startDate);
  while (current <= endDate) {
    if (dayIndex % 7 === 0) weekUsedIds.clear();
    dayIndex++;

    // One schedule for every direction: gradual deficit (lose), gradual
    // surplus (gain), or flat maintenance — same shape the projections use.
    const weekCals    = gradualDailyCals(baseTDEE, dayIndex, direction, minCal, maxDeficit);
    const caloriePlan = computeMealCalories(weekCals);
    // Hard ceiling for the whole day — per-meal windows reach 135% of a meal's
    // target, so without this the assembled day can erase the planned deficit.
    const dayBudget = weekCals * DAY_CALORIE_TOLERANCE;

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
      // Snack-slot picks relax the content filter: simple items like fruits,
      // nuts, and beverages are valid without a full ingredient list.
      const eligibleIds = new Set(eligibleMealTypeIds);

      const queryRecipes = (
        dishTypeNames: string[] | null,
        calMin?: number,
        calMax?: number
      ): RecipeCandidate[] => {
        // Clamp every bounded pick to the day's remaining calorie budget; skip
        // the pick entirely when the budget can't fit the window's minimum.
        // calMax-only calls filter too (previously the cap was silently dropped
        // unless calMin was also set).
        let calWin: { min: number; max: number } | null = null;
        if (calMax != null) {
          const win = capWindowToDayBudget(calMin ?? 0, calMax, dayBudget, dayCalories);
          if (!win) return [];
          calWin = { min: Math.round(win.calMin), max: Math.round(win.calMax) };
        }
        const dishNames = dishTypeNames
          ? new Set(dishTypeNames.map((n) => n.toLowerCase()))
          : null;
        const matches = (r: PoolRecipe, excludeUsed: boolean): boolean =>
          r.mealTypeId !== null && eligibleIds.has(r.mealTypeId) &&
          (isSnack || (r.ingredients.length > 0 && r.description !== null)) &&
          (calWin === null ||
            (r.calories !== null && r.calories >= calWin.min && r.calories <= calWin.max)) &&
          (dishNames === null ||
            (r.dishType !== null && dishNames.has(r.dishType.name.toLowerCase()))) &&
          (r.family === null || !dailyFamilies.has(r.family)) &&
          (r.subFamily === null || !mealSubFamilies.has(r.subFamily)) &&
          !(excludeUsed && weekUsedIds.has(r.id));
        // First attempt: exclude recipes already used this week
        if (weekUsedIds.size > 0) {
          const fresh = recipePool.filter((r) => matches(r, true));
          if (fresh.length > 0) return fresh;
        }
        // Fallback: allow recipe reuse when the weekly pool is exhausted
        return recipePool.filter((r) => matches(r, false));
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
        const pool   = queryRecipes(["complete meal"], target * 0.55, calMax);
        if (pool.length > 0) addRecipe(pick(pool));
      }

      // ── Step 2: Main dish + sides (when no complete meal was found) ────────
      if (mealCalories === 0) {
        const mainTarget  = target ?? 0;
        const mainCalMax  = dinnerCalCap !== null ? Math.min(mainTarget * 0.80, dinnerCalCap) : mainTarget * 0.80;
        let mainPool      = queryRecipes(["main dish"], mainTarget * 0.40, mainCalMax);
        // Wider retry keeps a calorie cap so the pick still honors the day
        // budget — an unbounded query here would bypass capWindowToDayBudget.
        if (mainPool.length === 0) mainPool = queryRecipes(["main dish"], undefined, (target ?? 800) * 1.2);

        if (mainPool.length > 0) {
          addRecipe(pick(mainPool));

          if (target !== null) {
            // Fill remaining calories with sides in spec-defined priority order.
            for (const sideType of ["veggie side dish", "starchy side dish", "fruity side dish"]) {
              if (mealCalories >= target * 0.90) break;
              const gap  = target - mealCalories;
              const pool = queryRecipes([sideType], gap * 0.15, gap * 0.80);
              if (pool.length > 0) addRecipe(pick(pool));
            }
          }
        } else {
          // No typed dish found — fall back to any recipe for this meal slot.
          // Always keep a calorie cap to avoid oversized recipes landing here.
          const cap      = target ?? 800;
          const anyPool  = queryRecipes(null, cap * 0.30, cap * 1.20);
          const fallback = anyPool.length > 0 ? anyPool : queryRecipes(null, undefined, cap * 1.20);
          if (fallback.length > 0) addRecipe(pick(fallback));
        }
      }

      if (mealCalories === 0) continue;

      // ── Step 3: Dessert for the biggest meal (lunch) ───────────────────────
      if (isBiggestMeal && target !== null && mealCalories < target * 0.85) {
        const gap  = target - mealCalories;
        const pool = queryRecipes(["dessert"], gap * 0.25, gap * 1.10);
        if (pool.length > 0) addRecipe(pick(pool));
      }

      // ── Step 4: Generic filler if still < 70 % of target ──────────────────
      if (target !== null && mealCalories < target * 0.70) {
        const gap    = target - mealCalories;
        const capMax = dinnerCalCap !== null ? Math.min(gap * 1.10, dinnerCalCap - mealCalories) : gap * 1.10;
        const pool   = queryRecipes(null, gap * 0.25, capMax);
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
        const calGap  = weekCals - dayCalories;
        const minCals = Math.round(calGap * 0.25);
        const maxCals = Math.round(calGap);
        const matchesExtra = (r: PoolRecipe, excludeUsed: boolean): boolean =>
          r.mealTypeId === snackMealType.id &&
          r.ingredients.length > 0 && r.description !== null &&
          r.calories !== null && r.calories >= minCals && r.calories <= maxCals &&
          (r.family === null || !dailyFamilies.has(r.family)) &&
          !(excludeUsed && weekUsedIds.has(r.id));
        let extraCandidates = weekUsedIds.size > 0
          ? recipePool.filter((r) => matchesExtra(r, true))
          : [];
        if (extraCandidates.length === 0) {
          extraCandidates = recipePool.filter((r) => matchesExtra(r, false));
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

  return { rows: menus, builtForWeight: patient.weight ?? null };
}
