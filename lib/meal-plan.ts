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
  resolveSexForCalories,
} from "@/lib/caloric-engine";
import { macroDeviation } from "@/lib/macros";
import { buildIngredientAffinity } from "@/lib/ingredient-affinity";
import { dishProblem, catalogFoodVocabulary } from "@/lib/dish-plausibility";
import { isCoveredByBasket, BASKET_STAPLES } from "@/lib/basket-coverage";
import { ingredientTokens } from "@/lib/basket-match";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, ingredientGroupsOf, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { buildFoodMapText } from "@/lib/food-map";
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
  name?:      string;
  tags?:      string[];
  steps?:     string[];
  prepTime?:  number | null;
  cookTime?:  number | null;
  ingredients: {
    quantity?: number | null;
    unit?: string | null;
    ingredient: { name: string; allergenGroups?: string[]; groceryCategory?: string | null };
  }[];
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
/** Slots on one day that may share a primary protein. */
export const MAX_SAME_PROTEIN_PER_DAY = 2;

/** Slots on one day that may share a starch. */
export const MAX_SAME_CARB_BASE_PER_DAY = 2;

/**
 * Slots in a WEEK one dish may fill.
 *
 * Three, not one: a repeat twice over is normal home cooking, seven is the
 * product looking broken. QA measured a week of 30 slots filled by 18 dishes,
 * two of which took 14 of them — every breakfast and every snack identical.
 */
export const MAX_SAME_DISH_PER_WEEK = 3;

/**
 * The daily sodium guideline, in mg (WHO and most national bodies).
 *
 * Used as a ceiling the builder tries not to cross and as a preference that
 * biases it toward the lighter of two dishes. It is deliberately NOT a hard
 * refusal, and the arithmetic says why: four dishes at a quarter teaspoon of
 * salt each — the least any of them sensibly carries — is already 2,325 mg. A
 * hard cap would empty slots rather than lower salt.
 *
 * Measured effect on one basket: 3,023-4,069 mg a day before, 2,325-2,906 after
 * (a day of four dishes). The residue is real, which is why the number is now
 * also shown to the user rather than only aimed at.
 */
export const DAILY_SODIUM_MAX_MG = 2300;

/** Teaspoon of table salt in mg of sodium. */
const SODIUM_MG_PER_TSP = 2325;

/** Sodium a dish contributes, from the salt on its ingredient rows. */
export function dishSodiumMg(
  ings: readonly { quantity?: number | null; unit?: string | null; ingredient: { name: string } }[]
): number {
  let mg = 0;
  for (const i of ings) {
    if (!/\bsalt\b/i.test(i.ingredient.name)) continue;
    const q = i.quantity ?? 0;
    if (q <= 0) continue;
    const u = i.unit ?? "";
    if (/\b(tsp|teaspoons?)\b/i.test(u)) mg += q * SODIUM_MG_PER_TSP;
    else if (/\b(tbsp|tablespoons?)\b/i.test(u)) mg += q * SODIUM_MG_PER_TSP * 3;
    else if (/\b(pinch|pinches|dash(es)?)\b/i.test(u)) mg += q * (SODIUM_MG_PER_TSP / 16);
    else if (/^\s*(g|gram|grams|gr)\s*$/i.test(u)) mg += q * 393; // 1 g salt ≈ 393 mg sodium
  }
  return mg;
}

// Starches that define a plate. Two dishes a day may share one.
const CARB_BASES: [string, RegExp][] = [
  ["rice", /\brice\b/i],
  ["pasta", /\b(pasta|spaghetti|noodles?|macaroni|penne|orzo|couscous)\b/i],
  ["bread", /\b(bread|toast|muffin|bagel|pita|tortilla|wrap)\b/i],
  ["oats", /\b(oats?|oatmeal|porridge|granola)\b/i],
  ["potato", /\bpotato(es)?\b/i],
  ["grain", /\b(quinoa|bulgur|farro|barley|millet)\b/i],
  ["legume", /\b(lentils?|chickpeas?|beans?)\b/i],
];

/** The starch a dish is built on, or null when it has none. */
export function dishCarbBase(ings: readonly { ingredient: { name: string } }[]): string | null {
  const text = ings.map((i) => i.ingredient.name).join(" ");
  return CARB_BASES.find(([, re]) => re.test(text))?.[0] ?? null;
}

function proteinType(name: string): string | null {
  const n = name.toLowerCase();
  for (const [type, kws] of PROTEIN_TYPES) if (kws.some((k) => n.includes(k))) return type;
  return null;
}
/** The same detection over bare ingredient NAMES (a generated dish's list). */
export function dishProteinOfNames(names: readonly string[]): string | null {
  for (const n of names) {
    const t = proteinType(n);
    if (t) return t;
  }
  return null;
}

export function dishProtein(ings: { ingredient: { name: string } }[]): string | null {
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
  macroTarget?: MacroPercentages,
  /**
   * Sodium already on the day's plate, in mg. The ceiling below can be relaxed
   * when nothing else fits a slot, so on a thin basket it was relaxed often and
   * five days of seven still came out over 2,300 mg. A ceiling only refuses; a
   * preference makes the builder reach for the lighter dish of two it would
   * otherwise pick between, which is what moves the daily total.
   */
  sodiumSoFarMg = 0,
  /**
   * How many slots each dish already fills this week.
   *
   * A hard cap here was the first attempt and it was the wrong instrument: it
   * changed which dish won a slot in small pools and broke nine assertions
   * about calorie windows and family rules for no gain. A penalty cannot make a
   * slot unfillable — it just means a dish already used this week loses every
   * tie to one that is not, which is what was missing when a QA week came back
   * with 30 slots, 18 dishes, and two of them filling 14.
   */
  weekUseCounts: Map<string, number> = new Map()
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
    // Every slot this dish already fills this week costs it heavily — more than
    // any affinity or macro bonus can recover, so a fresh dish always wins when
    // one exists, and a repeat only happens when nothing else is eligible.
    const used = weekUseCounts.get(r.id) ?? 0;
    if (used > 0) score -= used * 500;

    // Past ~60% of the day's sodium budget, salt starts to cost a dish points —
    // gently at first, hard once the day is over. Below that it is not a factor:
    // a dish is not worse for being seasoned.
    const spent = sodiumSoFarMg / DAILY_SODIUM_MAX_MG;
    if (spent > 0.6) {
      const mg = dishSodiumMg(r.ingredients.map((ri) => ({ ...ri, ingredient: ri.ingredient })));
      score -= (mg / 100) * (spent > 1 ? 4 : 1.5);
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
type PoolRecipe = RecipeCandidate & { mealTypeId: string | null; description: string | null; steps?: string[] };

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
export type BuildResult = {
  rows: MenuRow[];
  builtForWeight: number | null;
  /** Fraction of core (non-snack) day+meal slots the builder actually filled. */
  coreCoverage: number;
  filledCoreSlots: number;
  expectedCoreSlots: number;
};

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
    const sex = resolveSexForCalories(patient.sexAtBirth, patient.gender?.name);
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
    // name/tags/times and the per-link quantity feed the plausibility pass
    // below. They cost one wider read of a pool that is loaded exactly once.
    name: true, tags: true, prepTime: true, cookTime: true, steps: true,
    dishType:    { select: { name: true } },
    ingredients: {
      select: {
        quantity: true, unit: true,
        ingredient: { select: { name: true, allergenGroups: true, groceryCategory: true } },
      },
    },
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
  const recipePoolBanFiltered = !hasBans
    ? recipePoolRaw
    : recipePoolRaw.filter(
        (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers, ingredientGroupsOf(r.ingredients)).passed
      );

  // The catalog's food vocabulary — the words a dish title may only use when
  // the dish actually contains them. Derived from the pool that was just read
  // plus the user's basket, rather than a second query over Ingredient: the
  // rows are already in memory, and the two sources between them cover every
  // food word a dish or a generated recipe can legitimately name. Erring
  // small is the safe direction — an unknown word is skipped, not rejected.
  // Derived from the INGREDIENT CATALOG, with the pool and basket as a
  // fallback. Deriving it from the pool alone (the first attempt, to avoid a
  // second query) left out every food no stored recipe happened to use, and
  // the title rule can only judge words it knows: "Chickpea and Spinach Snack
  // Mix" containing no chickpeas passed cleanly because no pooled recipe used
  // chickpeas, so "chickpea" was not a food word (QA 2026-09-24).
  const poolAndBasketNames = [
    ...recipePoolRaw.flatMap((r) => r.ingredients.map((ri) => ri.ingredient.name)),
    ...(opts.basket ?? []),
  ];
  let catalogNames: string[] = [];
  try {
    catalogNames = (await prisma.ingredient.findMany({ select: { name: true } })).map((i) => i.name);
  } catch {
    // Test fixtures stub only the reads the builder needs; the vocabulary is a
    // quality gate, not a correctness one, so a missing catalog degrades to
    // the pool's own words rather than failing the build.
  }
  const catalogFoodTokens = catalogFoodVocabulary([...catalogNames, ...poolAndBasketNames]);

  // ── Plausibility ───────────────────────────────────────────────────────────
  // A dish is re-checked HERE, not only when it was written. The generation
  // gates (title, salt, breakfast timing) admit new dishes; they can do nothing
  // about the rows already in the table, and two QA runs on 2026-09-24 drew the
  // same poisoned dishes into two different users' weeks: bell peppers measured
  // at 0.1 teaspoon because a resolver read "season with salt and pepper", 1.5
  // teaspoons of salt in a single breakfast, and 40-minute roast dinners in the
  // 8am slot. Every one predates the gate that would have rejected it.
  //
  // Selection is the last place we can refuse, so it refuses. See
  // lib/dish-plausibility.ts for why each rule is shaped the way it is; the
  // measured cost is ~14% of the pool, leaving every meal type deep.
  const mealTypeNameById = new Map(rawMealTypes.map((mt) => [mt.id, mt.name]));
  const implausible = { total: 0 } as Record<string, number>;
  const recipePool = recipePoolBanFiltered.filter((r) => {
    const problem = dishProblem(
      {
        name: r.name ?? "",
        description: r.description,
        steps: r.steps,
        macros: { protein: r.protein, carbs: r.carbs, fat: r.fat },
        calories: r.calories,
        mealTypeName: (r.mealTypeId && mealTypeNameById.get(r.mealTypeId)) || "",
        prepMinutes: r.prepTime ?? null,
        cookMinutes: r.cookTime ?? null,
        generated: (r.tags ?? []).some((t) => t.toLowerCase().includes("clara")),
        ingredients: r.ingredients.map((ri) => ({
          name: ri.ingredient.name,
          quantity: ri.quantity ?? null,
          unit: ri.unit ?? null,
          category: ri.ingredient.groceryCategory ?? null,
        })),
      },
      catalogFoodTokens
    );
    if (problem) {
      implausible[problem] = (implausible[problem] ?? 0) + 1;
      implausible.total++;
    }
    return problem === null;
  });
  if (implausible.total > 0) {
    console.info(
      `[meal-plan] plausibility: dropped ${implausible.total} of ${recipePoolBanFiltered.length} dishes ${JSON.stringify(implausible)}`
    );
  }

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
  // Snack is padding rather than a slot, so it needs enough dishes for a
  // varied week and no more.
  const SNACK_POOL_TARGET = 5;
  // One week of dishes: 7 per meal type → 7 distinct breakfasts/lunches/
  // dinners/snacks, i.e. a full week of variety. The builder then fills the
  // (unchanged) plan from these, repeating week to week per its no-repeat rule.
  const CLARA_PER_TYPE = opts.claraPerType ?? 7;
  try {
    const baseMealCals = computeMealCalories(baseTDEE);
    const thin: TopUpRequest[] = mealTypes
      .map((mt) => {
        // Measure the pool selection ACTUALLY draws from. With a basket that is
        // selectionPool (library dishes the basket fully covers), not the whole
        // library — counting recipePool here asked "are there 12 breakfasts in
        // the catalog?" (474: plenty) while the basket covered 1, so nothing was
        // requested and the builder had nothing to place. Observed 2026-09-24:
        // a 15-ingredient basket of meat/veg/rice with no breakfast staples
        // produced a week of seven identical lunches and no other meal.
        const pool = opts.basket ? selectionPool : recipePool;
        const eligible = pool.filter((r) => r.mealTypeId === mt.id).length;
        // Snack is padding, not a slot: the builder only reaches for one when a
        // day lands under 90% of target (see the snack top-up below), so an
        // empty snack pool is normal and must not trigger generation. Breakfast,
        // lunch and dinner are real slots — a gap there is a broken week.
        const isSnack = mt.name.toLowerCase() === "snack";
        // Snacks get a SMALL top-up in basket mode, not none. Asking for zero
        // kept the cost down and produced the same snack on all seven days: a
        // 15-ingredient basket covers about one library snack, and the variety
        // tiers then have nothing to offer but reuse (QA 2026-09-24, one dish
        // in 7 of 28 rows). A handful is enough for a week of different
        // afternoons, and far cheaper than treating snack as a full slot.
        const count = opts.claraFirst
          ? CLARA_PER_TYPE
          : isSnack
            ? Math.min(SNACK_POOL_TARGET, Math.max(0, SNACK_POOL_TARGET - eligible))
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
        catalogFoodTokens,
        bannedNames: [...allergyNames, ...exactBanned.map((b) => b.name)],
        matchers,
        existingNames,
        macroTarget,
        cuisine: opts.cuisine ?? null,
        allowedIngredients: opts.basket ? Array.from(opts.basket) : undefined,
        profileContext: buildFoodMapText(patient),
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
  // How many slots each dish already fills this week. weekUsedIds is a set, so
  // once the ladder relaxed to "reuse is allowed" a thin pool could put ONE
  // dish in every slot of a meal: a QA week had 30 slots, 18 distinct dishes,
  // and two of them filled 14 — the same breakfast and the same snack seven
  // days running. Allowing reuse is not the same as allowing that.
  const weekUseCounts = new Map<string, number>();
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
    // The per-dish cap is a WEEK's worth of slots, so it resets on the same
    // 7-day boundary as weekUsedIds. A maintain plan runs 35 days: a cap that
    // never reset would starve the long horizon (the 35-day fixture tests
    // caught exactly that).
    if (dayIndex % 7 === 0) { weekUsedIds.clear(); weekUsedSignatures.clear(); weekUseCounts.clear(); }
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
    // How many of today's slots each protein already fills. The set above was
    // only ever read as "yesterday's proteins" for the NEXT day, so nothing
    // stopped one protein taking every slot of a single day: two QA weeks each
    // had days with the same protein in 3 of 4 slots (turkey breakfast, lunch
    // and dinner). Twice in a day is normal home cooking; three times is the
    // week feeling broken.
    const todayProteinCounts = new Map<string, number>();
    // Sodium for the day so far. The per-dish cap (1 tsp, half that under 450
    // kcal) passes on every dish and still lands every day of the week between
    // 3,000 and 4,100 mg against a 2,300 mg guideline, because three or four
    // dishes at half a teaspoon each add up — a QA run measured exactly that.
    // Sodium is a DAY-level quantity, so this is where it belongs.
    let todaySodiumMg = 0;
    // Which starch each slot used. One QA week was rice 21 times out of 26:
    // titles all distinct, macros correct, and the same plate every day. Two
    // slots may share a base; the third must look elsewhere.
    const todayCarbBaseCounts = new Map<string, number>();
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
        // The per-day protein cap is NOT one of the relaxable tiers. It was, at
        // first for every slot and then for snack only, and both versions put
        // one protein in 3 slots of a day — beef on four days of one week. A
        // tester counting slots does not care which of them was padding. An
        // unfilled snack is the honest alternative: the day lands under target
        // and the flex card says so, which is a smaller problem than eating the
        // same thing three times.
        const sodiumRoomLeft = (r: PoolRecipe): boolean =>
          todaySodiumMg + dishSodiumMg(r.ingredients) <= DAILY_SODIUM_MAX_MG;
        const carbBaseRoomLeft = (r: PoolRecipe): boolean => {
          const b = dishCarbBase(r.ingredients);
          return b === null || (todayCarbBaseCounts.get(b) ?? 0) < MAX_SAME_CARB_BASE_PER_DAY;
        };
        const proteinRoomLeft = (r: PoolRecipe): boolean => {
          const dp = dishProtein(r.ingredients);
          return dp === null || (todayProteinCounts.get(dp) ?? 0) < MAX_SAME_PROTEIN_PER_DAY;
        };
        const matches = (r: PoolRecipe, relax: (typeof tiers)[number]): boolean =>
          base(r) &&
          proteinRoomLeft(r) &&
          // Sodium and the starch relax on the LAST tier only, where the
          // alternative is an unfilled slot. Neither is worth an empty day, and
          // both are worth every other kind of compromise first.
          (relax.sameDay || sodiumRoomLeft(r)) &&
          (relax.sameDay || carbBaseRoomLeft(r)) &&
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
        weekUseCounts.set(recipe.id, (weekUseCounts.get(recipe.id) ?? 0) + 1);
        weekUsedSignatures.add(dishSignature(recipe.ingredients));
        todayUsedIds.add(recipe.id);
        const dp = dishProtein(recipe.ingredients);
        if (dp) {
          todayProteins.add(dp);
          todayProteinCounts.set(dp, (todayProteinCounts.get(dp) ?? 0) + 1);
        }
        todaySodiumMg += dishSodiumMg(recipe.ingredients);
        const cb = dishCarbBase(recipe.ingredients);
        if (cb) todayCarbBaseCounts.set(cb, (todayCarbBaseCounts.get(cb) ?? 0) + 1);
        mealCalories += recipe.calories ?? 0;
        dayCalories  += recipe.calories ?? 0;
        menus.push({ patientId, recipeId: recipe.id, mealTypeId: mealType.id, date: new Date(current), planVersion });
      };

      const pick = (pool: RecipeCandidate[]) =>
        pickByMotivation(pool, motivationNames, affinityMap, seenIngredientNames, macroTarget, todaySodiumMg, weekUseCounts);

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
        // Same ladder as the meals: fresh → week reuse — but never the same
        // dish twice in one day. A thin snack pool used to fall through to
        // "anything" and served "Salmon Fillet with Zucchini" twice on the
        // same day (2026-09-11); leaving the day under target is the honest
        // outcome and stays visible as "kcal free".
        let extraCandidates = selectionPool.filter((r) => matchesExtra(r, true) && !todayUsedIds.has(r.id));
        if (extraCandidates.length === 0) {
          extraCandidates = selectionPool.filter((r) => matchesExtra(r, false) && !todayUsedIds.has(r.id));
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
    todayProteinCounts.clear();
    todayCarbBaseCounts.clear();
    todaySodiumMg = 0;
    current.setDate(current.getDate() + 1);
  }

  // Coverage of the CORE slots (breakfast/lunch/dinner — snack is padding, see
  // the top-up above). rows.length alone cannot tell a full week from a broken
  // one: seven lunches across seven days is seven rows, exactly like one full
  // day, and the caller's only guard was `rows.length === 0`. Reporting the
  // filled fraction lets the runner refuse a plan that merely looks finished.
  const coreMealTypeIds = new Set(
    mealTypes.filter((mt) => mt.name.toLowerCase() !== "snack").map((mt) => mt.id)
  );
  const dayKeys = new Set(menus.map((m) => m.date.toDateString()));
  const filledCoreSlots = new Set(
    menus.filter((m) => coreMealTypeIds.has(m.mealTypeId)).map((m) => `${m.date.toDateString()}|${m.mealTypeId}`)
  ).size;
  const expectedCoreSlots = dayKeys.size * coreMealTypeIds.size;
  const coreCoverage = expectedCoreSlots > 0 ? filledCoreSlots / expectedCoreSlots : 0;

  return { rows: menus, builtForWeight: patient.weight ?? null, coreCoverage, filledCoreSlots, expectedCoreSlots };
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
  const sex = resolveSexForCalories(patient.sexAtBirth, patient.gender?.name);
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

  // Rounded for display (the engine's deficit-cap floor is a float).
  return Math.round(gradualDailyCals(
    Math.round(profile.tdeeCBW),
    dayNumber,
    resolvePlanDirection(profile),
    profile.minCaloriesValue,
    maxDailyDeficit(profile.cbmi),
  ));
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
