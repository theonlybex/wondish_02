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
  resolveSex,
} from "@/lib/caloric-engine";
import { macroDeviation } from "@/lib/macros";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sex resolution moved to lib/caloric-engine.ts resolveSex (audit Task 16)
// so every caloric consumer shares the same gender-name fallback.

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
      const deviation = macroDeviation(
        { calories: r.calories!, protein: r.protein, carbs: r.carbs, fat: r.fat },
        macroTarget
      );
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
      ...PATIENT_DIET_INCLUDE,
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
  // Derivation + word-boundary allergy matching / exact-name non-allergy
  // matching now lives in lib/diet-match.ts (shared with the other four call
  // sites); behavior here is unchanged — this is a lift, not a rewrite.
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { allergyMatchers } = matchers;

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

  // Exact bans are no longer pushed down as a SQL name-equality filter — the
  // "name in [...]" predicate let "brown sugar" through a "sugar" ban. The
  // pool filter below applies word-boundary phrase matching for BOTH allergy
  // and exact-ban sources via evaluateDishAgainstProfile.

  const recipeSelect = {
    id: true, protein: true, calories: true, carbs: true, fiber: true, fat: true,
    family: true, subFamily: true,
    dishType:    { select: { name: true } },
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  // Product decision 2026-07-20: no "snack" meal type in the DB means NO calorie
  // top-up — never stamp top-up rows with another meal type. The day may land
  // under the 90% floor; a missing snack type is a data problem that stays visible.
  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? null;

  // Perf: load the eligible catalog ONCE and filter in memory. The previous
  // implementation issued 2–10 Prisma round-trips per meal slot (thousands
  // over a long deficit plan). isPublic and the banned-ingredient exclusion
  // are constant for the whole build, so they stay in the DB query; all
  // per-pick filters below reproduce the old queries' semantics exactly.
  const recipePoolRaw: PoolRecipe[] = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { ...recipeSelect, mealTypeId: true, description: true },
  });
  // Allergy AND exact bans apply by word boundary against every ingredient name.
  const hasBans = allergyMatchers.length > 0 || matchers.exactBanned.length > 0;
  const recipePool = !hasBans
    ? recipePoolRaw
    : recipePoolRaw.filter(
        (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers).passed
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

// ─── Plan-day calorie lookup (shared by /api/meal-plan GET and tracking) ────

// Parses a "YYYY-MM-DD" local-calendar string into a local-midnight Date —
// the string-in twin of localMidnight() in app/api/meal-plan/route.ts, kept
// here so getPlanDayCalories has no dependency on the route file.
function localDateFromString(localDate: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Daily calorie budget for a given patient + local calendar date, per the
 * SAME gradual ramp schedule (gradualDailyCals) the active meal plan itself
 * is built from — one ramp computation shared by /api/meal-plan GET and
 * tracking's daily-target derivation, so the two never drift apart.
 * Returns null when the patient has no active plan start date, an
 * incomplete caloric profile, or when `localDate` falls before the plan's
 * first day (dayNumber < 1).
 */
export async function getPlanDayCalories(patientId: string, localDate: string): Promise<number | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      mealPlanStartDate: true,
      weight: true, weightUnit: true,
      goalWeight: true, goalWeightUnit: true,
      height: true, heightUnit: true,
      sexAtBirth: true, birthday: true,
      physicalActivity: { select: { level: true } },
      gender: { select: { name: true } },
    },
  });
  if (!patient) return null;
  if (!patient.mealPlanStartDate || !patient.weight || !patient.height || !patient.birthday || !patient.physicalActivity?.level) {
    return null;
  }
  const sex = resolveSex(patient.sexAtBirth, patient.gender?.name);
  if (!sex) return null;

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

  const planStart = new Date(patient.mealPlanStartDate);
  planStart.setHours(0, 0, 0, 0);
  const target = localDateFromString(localDate);
  const dayNumber = Math.round((target.getTime() - planStart.getTime()) / 86400000) + 1;
  if (dayNumber < 1) return null;

  return gradualDailyCals(
    Math.round(profile.tdeeCBW),
    dayNumber,
    resolvePlanDirection(profile),
    profile.minCaloriesValue,
    maxDailyDeficit(profile.cbmi),
  );
}

// ─── deriveLoggedRecipeIds ──────────────────────────────────────────────────
// A plan dish counts as "logged" when it was completed in the journal OR a
// live intake row for its recipe exists for the day (log-to-numbers sync fix,
// 2026-07-30): "Log meal" writes /api/meal-log intake, the plan surfaces'
// progress previously read only JournalMeal completions, so logging never
// moved the numbers. Deleting the intake log naturally un-logs (callers pass
// only deletedAt-null rows). Journal order first, then new intake ids.
export function deriveLoggedRecipeIds(
  journalRecipeIds: string[],
  intakeRecipeIds: string[]
): string[] {
  const seen = new Set(journalRecipeIds);
  const out = [...journalRecipeIds];
  for (const id of intakeRecipeIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
