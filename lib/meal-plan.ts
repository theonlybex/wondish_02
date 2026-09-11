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
import { buildIngredientAffinity } from "@/lib/ingredient-affinity";
import { isCoveredByBasket, BASKET_STAPLES } from "@/lib/basket-coverage";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, ingredientGroupsOf, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
// Type-only import (erased at runtime). The implementation is loaded lazily at
// the call site below via dynamic import — a static import here would create a
// module cycle (meal-log → meal-plan → recipe-generation → fridge → meal-log)
// that throws a TDZ error on load.
import type { TopUpRequest } from "@/lib/clara/recipe-generation";

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
  ingredients: { ingredient: { name: string; allergenGroups?: string[] } }[];
};

// A dish's "sameness" signature: its sorted, non-staple ingredient names. Two
// dishes with the same signature are near-duplicates (same components) even
// with different ids/names — used to keep a week varied beyond exact-id repeats
// (e.g. "grilled chicken + roasted vegetables" appearing on two days).
const SIG_STAPLES = BASKET_STAPLES;
function dishSignature(ings: { ingredient: { name: string } }[]): string {
  return Array.from(
    new Set(ings.map((i) => i.ingredient.name.trim().toLowerCase()).filter((n) => n && !SIG_STAPLES.has(n)))
  ).sort().join("|");
}

// Primary-protein detection, so the week doesn't serve the same protein type
// over and over ("grilled chicken every day"). Returns a coarse protein family.
const PROTEIN_TYPES: [string, string[]][] = [
  ["chicken", ["chicken"]],
  ["beef", ["beef", "steak"]],
  ["pork", ["pork", "bacon", "ham", "sausage"]],
  ["turkey", ["turkey"]],
  ["lamb", ["lamb"]],
  ["seafood", ["fish", "salmon", "tuna", "cod", "tilapia", "shrimp", "prawn"]],
  ["egg", ["egg"]],
  ["tofu", ["tofu", "tempeh", "seitan"]],
  ["legume", ["bean", "lentil", "chickpea"]],
];
function proteinType(name: string): string | null {
  const n = name.toLowerCase();
  for (const [type, kws] of PROTEIN_TYPES) if (kws.some((k) => n.includes(k))) return type;
  return null;
}
function dishProtein(ings: { ingredient: { name: string } }[]): string | null {
  for (const i of ings) {
    const t = proteinType(i.ingredient.name);
    if (t) return t;
  }
  return null;
}

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
  opts: {
    claraFirst?: boolean;
    cuisine?: string | null;
    windowDays?: number;
    anchorDate?: Date;
    basket?: Set<string>;
    excludeRecipeIds?: Set<string>;
    claraPerType?: number; // dishes to generate per meal type (default 7)
  } = {},
): Promise<BuildResult> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      physicalActivity: true,
      gender:           true,
      ...PATIENT_DIET_INCLUDE,
      // DISHES-RETIRED (2026-09-07): affinity now comes from liked ingredients.
      ingredientPreferences: { include: { ingredient: { select: { name: true } } } },
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

  // ── Build affinity map from liked ingredients ──────────────────────────────
  // DISHES-RETIRED (2026-09-07): replaces the liked-dish affinity map.
  const { affinityMap, seenIngredientNames } = buildIngredientAffinity(patient.ingredientPreferences);

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

  // windowDays caps the plan to a fixed length (rolling weeks); default keeps
  // the dynamic ramp+buffer / 35-day maintenance length.
  const totalExtraDays = opts.windowDays && opts.windowDays > 0
    ? opts.windowDays - 1
    : isRampPlan ? rampEndDay + MAINTENANCE_BUFFER_DAYS - 1 : 34;
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
    ingredients: { select: { ingredient: { select: { name: true, allergenGroups: true } } } },
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
        (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers, ingredientGroupsOf(r.ingredients)).passed
      );

  // Basket mode (cache-first): selection is limited to library dishes the
  // basket fully covers — reusing previously-generated/curated dishes for free.
  // The generated top-up below is basket-constrained, so its dishes join this
  // pool too. Without a basket, selectionPool IS recipePool (identical old
  // behavior), so every read/push below is a no-op change when unset.
  const selectionPool: PoolRecipe[] = opts.basket
    ? recipePool.filter((r) =>
        isCoveredByBasket(r.ingredients.map((ri) => ri.ingredient.name), opts.basket!)
      )
    : recipePool;

  // ── Clara catalog top-up (hybrid pool) ─────────────────────────────────────
  // When a meal type's eligible pool is thin (small catalog, or heavy bans
  // filtered it down), ask Clara to generate dishes for exactly those slots.
  // Generated dishes are persisted as ordinary public Recipe rows (tagged
  // "clara") and re-validated with the SAME deterministic ban filter as DB
  // dishes before entering the pool — so selection, calorie windows, macros,
  // logging, and swaps all behave identically. Strictly fail-soft: any AI
  // failure leaves the DB-only pool untouched.
  // claraFirst (test/preview): generate Clara candidates for EVERY meal type
  // regardless of pool depth, so the plan is assembled predominantly from
  // Clara dishes — still under every builder rule below. Default stays
  // thin-pool-only top-up.
  const MIN_POOL_PER_TYPE = opts.claraFirst ? 0 : 12;
  // One week of dishes: 7 per meal type → 7 distinct breakfasts/lunches/
  // dinners/snacks, i.e. a full week of variety. The builder then fills the
  // (unchanged) plan from these, repeating week to week per its no-repeat rule.
  const CLARA_PER_TYPE = opts.claraPerType ?? 7;
  try {
    const baseMealCals = computeMealCalories(baseTDEE);
    const thin: TopUpRequest[] = mealTypes
      .map((mt) => {
        const eligible = recipePool.filter((r) => r.mealTypeId === mt.id).length;
        const count = opts.claraFirst
          ? CLARA_PER_TYPE
          : Math.max(0, MIN_POOL_PER_TYPE - eligible);
        return {
          mealTypeId: mt.id,
          mealTypeName: mt.name,
          count,
          targetCalories: baseMealCals[mt.name.toLowerCase()] ?? Math.round(baseTDEE * 0.25),
        };
      })
      .filter((r) => r.count > 0);

    if (thin.length > 0) {
      const existingNames = new Set(
        (
          await prisma.recipe.findMany({ where: { isPublic: true }, select: { name: true } })
        ).map((r) => r.name.trim().toLowerCase())
      );
      // Lazy import breaks the module cycle (see the type-only import note up top).
      const { generateAndPersistRecipes } = await import("@/lib/clara/recipe-generation");
      const createdIds = await generateAndPersistRecipes({
        requests: thin,
        bannedNames: [...allergyNames, ...exactBanned.map((b) => b.name)],
        matchers,
        existingNames,
        macroTarget,
        cuisine: opts.cuisine ?? null,
        allowedIngredients: opts.basket ? Array.from(opts.basket) : undefined,
      });
      if (createdIds.length > 0) {
        const created: PoolRecipe[] = await prisma.recipe.findMany({
          where: { id: { in: createdIds } },
          select: { ...recipeSelect, mealTypeId: true, description: true },
        });
        // Belt over suspenders: generated rows pass the same gate as DB rows.
        const safe = !hasBans
          ? created
          : created.filter(
              (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers, ingredientGroupsOf(r.ingredients)).passed
            );
        selectionPool.push(...safe);
      }
    }
  } catch (err) {
    // Top-up must never break plan generation — but a silent failure here
    // produces a plan of repeats with no trace, so always say why.
    console.warn("[meal-plan] Clara top-up failed; building from the library pool only:", err);
  }

  // weekUsedIds resets every 7 days — prevents recipe exhaustion while still
  // ensuring no recipe repeats within the same week.
  const weekUsedIds = new Set<string>();
  // Near-duplicate guard within the week: signatures of dishes already used.
  const weekUsedSignatures = new Set<string>();
  // Protein spread: the last few protein types used, avoided while fresh options
  // exist so the same protein doesn't dominate the week. Window of 2.
  // Protein spread: avoid serving a protein two days in a row (same-day repeats
  // are fine). prevDayProteins holds yesterday's proteins; excluded today.
  let prevDayProteins = new Set<string>();
  // Cross-week variety: dishes from the previous week are avoided all week
  // (soft — the fallback tier still allows them if the pool is exhausted). Not
  // cleared by the 7-day weekUsedIds reset, so it holds for the whole build.
  const excludeRecipeIds = opts.excludeRecipeIds ?? new Set<string>();
  let dayIndex = 0;

  // Day number is measured from the fixed anchor (day-1 of the deficit
  // schedule), not this build's start — so a rolling week starting at anchor+7
  // continues the ramp. Defaults to startDate, i.e. planDay === dayIndex (old
  // behavior) when no anchor is passed.
  const anchor = new Date(opts.anchorDate ?? startDate);
  anchor.setHours(0, 0, 0, 0);

  const current = new Date(startDate);
  while (current <= endDate) {
    if (dayIndex % 7 === 0) { weekUsedIds.clear(); weekUsedSignatures.clear(); }
    dayIndex++;

    // One schedule for every direction: gradual deficit (lose), gradual
    // surplus (gain), or flat maintenance — same shape the projections use.
    const planDay     = Math.round((current.getTime() - anchor.getTime()) / 86400000) + 1;
    const weekCals    = gradualDailyCals(baseTDEE, planDay, direction, minCal, maxDeficit);
    const caloriePlan = computeMealCalories(weekCals);
    // Hard ceiling for the whole day — per-meal windows reach 135% of a meal's
    // target, so without this the assembled day can erase the planned deficit.
    const dayBudget = weekCals * DAY_CALORIE_TOLERANCE;

    let dayCalories = 0;
    const dailyFamilies = new Set<string>();
    const todayProteins = new Set<string>();
    // Dishes already on today's plate — the one repeat we never allow while
    // any other eligible dish exists (a week can repeat; a day must not).
    const todayUsedIds = new Set<string>();
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
        const base = (r: PoolRecipe): boolean =>
          r.mealTypeId !== null && eligibleIds.has(r.mealTypeId) &&
          (isSnack || (r.ingredients.length > 0 && r.description !== null)) &&
          (calWin === null ||
            (r.calories !== null && r.calories >= calWin.min && r.calories <= calWin.max)) &&
          (dishNames === null ||
            (r.dishType !== null && dishNames.has(r.dishType.name.toLowerCase()))) &&
          (r.family === null || !dailyFamilies.has(r.family)) &&
          (r.subFamily === null || !mealSubFamilies.has(r.subFamily));
        // Variety rules relax in order of how much a repeat would hurt: first
        // the "not the same protein as yesterday" rule, then last week's
        // dishes, then this week's dishes — and only when NOTHING else fits
        // does a dish already on today's plate come back. The old two-tier
        // fallback jumped straight to "anything", so a thin basket pool put
        // the same chicken dish at lunch AND dinner every day.
        const tiers: { protein: boolean; crossWeek: boolean; weekReuse: boolean; sameDay: boolean }[] = [
          { protein: false, crossWeek: false, weekReuse: false, sameDay: false },
          { protein: true,  crossWeek: false, weekReuse: false, sameDay: false },
          { protein: true,  crossWeek: true,  weekReuse: false, sameDay: false },
          { protein: true,  crossWeek: true,  weekReuse: true,  sameDay: false },
          { protein: true,  crossWeek: true,  weekReuse: true,  sameDay: true },
        ];
        const matches = (r: PoolRecipe, relax: (typeof tiers)[number]): boolean =>
          base(r) &&
          (relax.protein || (() => { const dp = dishProtein(r.ingredients); return dp === null || !prevDayProteins.has(dp); })()) &&
          (relax.crossWeek || !excludeRecipeIds.has(r.id)) &&
          (relax.weekReuse || (!weekUsedIds.has(r.id) && !weekUsedSignatures.has(dishSignature(r.ingredients)))) &&
          (relax.sameDay || !todayUsedIds.has(r.id));
        for (const relax of tiers) {
          const pool = selectionPool.filter((r) => matches(r, relax));
          if (pool.length > 0) return pool;
        }
        return [];
      };

      const addRecipe = (recipe: RecipeCandidate) => {
        trackChosen(recipe, dailyFamilies, mealSubFamilies, weekUsedIds);
        weekUsedSignatures.add(dishSignature(recipe.ingredients));
        todayUsedIds.add(recipe.id);
        const dp = dishProtein(recipe.ingredients);
        if (dp) todayProteins.add(dp);
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
          !(excludeUsed && (weekUsedIds.has(r.id) || excludeRecipeIds.has(r.id) || weekUsedSignatures.has(dishSignature(r.ingredients))));
        // Same ladder as the meals: fresh → week reuse (never today) → anything.
        let extraCandidates = selectionPool.filter((r) => matchesExtra(r, true) && !todayUsedIds.has(r.id));
        if (extraCandidates.length === 0) {
          extraCandidates = selectionPool.filter((r) => matchesExtra(r, false) && !todayUsedIds.has(r.id));
        }
        if (extraCandidates.length === 0) {
          extraCandidates = selectionPool.filter((r) => matchesExtra(r, false));
        }
        if (extraCandidates.length === 0) break;
        const extra = pickByMotivation(extraCandidates, motivationNames, affinityMap, seenIngredientNames, macroTarget);
        const extraCals = extra.calories ?? 0;
        if (extraCals <= 0) break; // no useful calorie contribution; further picks won't help
        dayCalories += extraCals;
        extraCount++;
        weekUsedIds.add(extra.id);
        todayUsedIds.add(extra.id);
        weekUsedSignatures.add(dishSignature(extra.ingredients));
        if (extra.family && !isBeverageExempt(extra)) dailyFamilies.add(extra.family);
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current), planVersion });
      }
    }

    // Carry today's proteins forward so tomorrow avoids them (no back-to-back).
    prevDayProteins = todayProteins;
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

// ─── S3 extractions: alternatives + swap validation (shared route/Clara) ─────
// Behavior parity with the original route blocks is pinned by lib tests; the
// routes now delegate here, and the Clara plan skill reuses the same gates.

export type DietPatientLike = Parameters<typeof derivePatientBans>[0];

export interface AlternativeRecipe {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  mealType: unknown;
  dishType: unknown;
  ingredients: { ingredient: { name: string; allergenGroups?: string[] } }[];
}

export interface AlternativesDb {
  findCandidates(q: {
    mealTypeId: string;
    excludeRecipeId?: string;
    calorieBand?: { gte: number; lte: number };
  }): Promise<AlternativeRecipe[]>;
}

const prismaAlternativesDb: AlternativesDb = {
  findCandidates: async (q) =>
    prisma.recipe.findMany({
      where: {
        mealTypeId: q.mealTypeId,
        isPublic: true,
        ...(q.excludeRecipeId ? { id: { not: q.excludeRecipeId } } : {}),
        ...(q.calorieBand ? { calories: q.calorieBand } : {}),
      },
      take: 30,
      orderBy: { createdAt: "desc" },
      include: { mealType: true, dishType: true, ingredients: { include: { ingredient: true } } },
    }) as unknown as Promise<AlternativeRecipe[]>,
};

/** Route-parity: ±250 kcal band when currentCalories > 0, ban filter in-memory, ≤3. */
export async function findAlternatives(
  patient: DietPatientLike,
  q: { mealTypeId: string; excludeRecipeId?: string; currentCalories?: number },
  db: AlternativesDb = prismaAlternativesDb
): Promise<AlternativeRecipe[]> {
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const candidates = await db.findCandidates({
    mealTypeId: q.mealTypeId,
    excludeRecipeId: q.excludeRecipeId,
    ...(q.currentCalories && q.currentCalories > 0
      ? { calorieBand: { gte: q.currentCalories - 250, lte: q.currentCalories + 250 } }
      : {}),
  });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;
  return (
    !hasBans
      ? candidates
      : candidates.filter(
          (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers, ingredientGroupsOf(r.ingredients)).passed
        )
  ).slice(0, 3);
}

export type SwapRejection =
  | "MEAL_TYPE_MISMATCH"
  | "BANNED_INGREDIENTS"
  | "MACRO_MISALIGNED"
  | "FAMILY_CONFLICT"
  | "SUBFAMILY_CONFLICT";

export interface SwapCandidateRecipe {
  mealTypeId?: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  family: string | null;
  subFamily: string | null;
  dishType: { name: string } | null;
  ingredients: { ingredient: { name: string; allergenGroups?: string[] } }[];
}

export interface SameDayMenuLike {
  mealTypeId: string | null;
  recipe: { family: string | null; subFamily: string | null; dishType: { name: string } | null };
}

// Omit-override (not a plain intersection): intersecting two array-typed
// fields leaves element access on the FIRST shape, hiding `.name`.
export type SwapPatientLike = Omit<DietPatientLike, "healthConditions" | "motivations"> & {
  healthConditions: { condition: { name: string; bannedIngredients: { name: string }[] } }[];
  motivations: { motivation: { name: string; bannedIngredients: { name: string }[] } }[];
};

const beverageExempt = (family: string | null, dishTypeName: string | null | undefined): boolean => {
  const fam = (family ?? "").toLowerCase();
  return (dishTypeName ?? "").toLowerCase() === "beverage" && !fam.includes("fruity") && !fam.includes("veggie");
};

/**
 * Pure swap gate — EXACT route order and messages (parity pinned by tests):
 * meal-type → bans → macro deviation (>0.50, skipped when calories<=0) →
 * family (same-day, beverage exemption both sides) → sub-family (same meal).
 */
export function validateSwapCandidate(
  patient: SwapPatientLike,
  menu: { mealTypeId: string | null },
  recipe: SwapCandidateRecipe,
  sameDayMenus: SameDayMenuLike[]
): { ok: true } | { ok: false; code: SwapRejection; message: string } {
  if (menu.mealTypeId && recipe.mealTypeId !== menu.mealTypeId) {
    return { ok: false, code: "MEAL_TYPE_MISMATCH", message: "Recipe not suitable for this meal slot" };
  }

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed } = evaluateDishAgainstProfile(
    recipe.ingredients.map((ri) => ri.ingredient.name),
    matchers,
    ingredientGroupsOf(recipe.ingredients)
  );
  if (!passed) {
    return { ok: false, code: "BANNED_INGREDIENTS", message: "Recipe contains ingredients you cannot eat" };
  }

  const conditionNames = patient.healthConditions.map((hc) => hc.condition.name);
  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);
  const macroTarget = getMacroPercentages(resolveMacroProfile(conditionNames, motivationNames));
  if (recipe.calories && recipe.calories > 0) {
    const deviation = macroDeviation(
      { calories: recipe.calories, protein: recipe.protein, carbs: recipe.carbs, fat: recipe.fat },
      macroTarget
    );
    if (deviation > 0.5) {
      return { ok: false, code: "MACRO_MISALIGNED", message: "Recipe macros do not align with your nutrition profile" };
    }
  }

  if (recipe.family && !beverageExempt(recipe.family, recipe.dishType?.name)) {
    const familyConflict = sameDayMenus.some((m) => {
      if (m.recipe.family !== recipe.family) return false;
      return !beverageExempt(m.recipe.family, m.recipe.dishType?.name);
    });
    if (familyConflict) {
      return { ok: false, code: "FAMILY_CONFLICT", message: "A dish from the same family is already in today's plan" };
    }
  }

  if (recipe.subFamily) {
    const sameMealConflict = sameDayMenus.some(
      (m) => m.mealTypeId === menu.mealTypeId && m.recipe.subFamily === recipe.subFamily
    );
    if (sameMealConflict) {
      return { ok: false, code: "SUBFAMILY_CONFLICT", message: "A dish from the same sub-family is already in this meal" };
    }
  }

  return { ok: true };
}
