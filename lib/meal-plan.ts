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
import { priceDish } from "@/lib/staple-density";
// Type-only import (erased at runtime). The implementation is loaded lazily at
// the call site below via dynamic import — a static import here would create a
// module cycle (meal-log → meal-plan → recipe-generation → fridge → meal-log)
// that throws a TDZ error on load.
import type { TopUpRequest } from "@/lib/clara/recipe-generation";

// How hard the day's remaining macro gap pulls on a pick. Chosen by measuring
// three built weeks each at 0/30/60/90/120/240 against the live database: 90
// gave the most slots filled (29-34), the calorie total closest to target
// (2,013-2,043 against ~2,100) AND the lowest fat share (41-42%, from 46% at
// zero). Higher was not better — at 120 and 240 the term started refusing the
// dishes that fill a day, and the week came in under target with the split no
// better. Single runs cannot rank these: the pick shuffles among the top few,
// so run-to-run spread is wider than the effect being measured.
const DAY_MACRO_WEIGHT = 90;

/** How far past the day's fat target a dish may push it before being refused. */
/**
 * How far past the day's fat target a dish may push it before being refused.
 *
 * Swept 1.10 / 1.15 / 1.25 over two built weeks each against the live database.
 * All three held 100% core coverage and landed calories within ~100 kcal of
 * target, so the tighter ceiling costs nothing measurable — the residual above
 * it is the last-tier relaxation, where the alternative is an empty slot and an
 * empty slot is worse than a fatty one.
 */
const DAY_FAT_CEILING = 1.15;

/** How far above its slot's calorie target a single dish may sit. */
export const MEAL_CAL_CEILING = 1.25;

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
// The dish's primary protein, by WORD rather than by substring.
//
// This matched with String.includes, and the catalog punished it twice:
// "caribbean citrus seasoning" was classed as a legume protein because
// "caribbean".includes("bean"), and "fish sauce" as seafood. Both then counted
// against the two-per-day protein cap, so a day could be refused a dish over a
// spice blend. Word boundaries fix that — and each pattern takes an explicit
// plural, because switching to \b is exactly how the trap on the other side gets
// reintroduced (\begg\b never matches the catalog's "Large eggs").
//
// A condiment is never a dish's protein however much of the animal is in its
// name: fish sauce, oyster sauce, anchovy paste and beef stock season a dish,
// they do not make it a fish dish.
const CONDIMENT = /\b(sauces?|pastes?|seasonings?|powders?|broths?|stocks?|bouillon|extracts?|marinades?|dressings?|vinegars?)\b/i;

const PROTEIN_TYPES: [string, RegExp][] = [
  ["chicken", /\bchickens?\b/i],
  ["beef", /\b(beef|steaks?|sirloins?|mince)\b/i],
  ["pork", /\b(pork|bacon|hams?|sausages?|chorizo|prosciutto)\b/i],
  ["turkey", /\bturkeys?\b/i],
  ["lamb", /\blambs?\b/i],
  ["seafood", /\b(fish|salmon|tuna|cod|tilapia|halibut|haddock|catfish|trout|sardines?|mackerel|shrimps?|prawns?|scallops?|mussels?|clams?)\b/i],
  ["egg", /\beggs?\b/i],
  ["tofu", /\b(tofu|tempeh|seitan)\b/i],
  ["legume", /\b(beans?|lentils?|chickpeas?|garbanzos?|peas?)\b/i],
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
/**
 * TOTAL dietary sodium a dish contributes, in mg — the added salt plus what the
 * food itself carries.
 *
 * This counted only the salt rows, and the ceiling it feeds is 2,300 mg: the FDA
 * guideline for total dietary sodium. Numerator and denominator were measuring
 * different things, and QA caught what that hides — a day priced at ~3,300 mg of
 * real sodium while the rail printed "2,034/2,300mg" in GREEN, with Clara
 * repeating the reassurance. Bread is ~490 mg per 100 g, cheese ~700, eggs 142,
 * a tablespoon of soy sauce over 800; a day of those is most of a guideline
 * before the salt cellar is touched.
 *
 * priceDish carries the food half (see the `sodium` column on DENSITY), so both
 * halves are now counted here, and the builder's ceiling and the rail finally
 * mean the same thing as the number they are compared to.
 */
export function dishSodiumMg(
  ings: readonly { quantity?: number | null; unit?: string | null; note?: string | null; ingredient: { name: string } }[]
): number {
  const priced = priceDish(
    ings.map((i) => ({ name: i.ingredient.name, quantity: i.quantity, unit: i.unit, note: i.note ?? null })),
    null
  );
  if (priced) return priced.sodiumMg;
  // Unpriceable dish: fall back to the salt rows alone rather than reporting
  // zero, which would read as "no sodium" for a dish that plainly has some.
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
  ["bread", /\b(breads?|toast|muffins?|bagels?|pitas?|tortillas?|wraps?|buns?|rolls?|crackers?|crumbs?|naan|baguettes?)\b/i],
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
  if (CONDIMENT.test(n)) return null;
  for (const [type, re] of PROTEIN_TYPES) if (re.test(n)) return type;
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
  weekUseCounts: Map<string, number> = new Map(),
  /**
   * The day's macro target in GRAMS, and what the day has eaten so far. Both or
   * neither — without them the day-aware term below is skipped and scoring
   * behaves exactly as it did before.
   */
  dayMacroTargetG: { protein: number; carbs: number; fat: number } | null = null,
  todayMacroG: { protein: number; carbs: number; fat: number } = { protein: 0, carbs: 0, fat: 0 }
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
    // …and then the same question asked of the DAY: where does the day land if
    // this dish is chosen?
    //
    // The per-dish rule above cannot see a day, which is the same shape of bug
    // the sodium ceiling had. QA measured the result on 7 of 7 days: calories
    // inside ±7% of target every day, and the split 15-25/21-41/44-55 against a
    // 30/50/20 target — the app's own rail rendering "Fat 111g of 46g · 241%"
    // next to "Carbs 139g of 261g · 53%". A nutrition app that displays a target
    // and then plans double it is worse than one that displays nothing.
    //
    // Every candidate in a slot deviates similarly on its own ratios, so the
    // per-dish term barely reorders them; what distinguishes them is what the
    // DAY still needs. This term rewards the dish that closes the day's gaps —
    // protein when protein is short, and against more fat once the fat is spent
    // — and it is why the pool's leaner half gets reached at all: 47% of usable
    // lunches sit at or under 30% fat while the builder was picking at 44-55%.
    if (dayMacroTargetG && (r.calories ?? 0) > 0) {
      let err = 0;
      for (const k of ["protein", "carbs", "fat"] as const) {
        const targetG = dayMacroTargetG[k];
        if (!targetG) continue;
        err += Math.abs(todayMacroG[k] + (r[k] ?? 0) - targetG) / targetG;
      }
      score -= err * DAY_MACRO_WEIGHT;
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
  // The random pick over the best few keeps two users (and two weeks) from
  // getting identical plans. But it was taking the top three by score and
  // choosing among them uniformly, which THREW AWAY the ordering the -500
  // penalty above had just established: with three eligible dishes all three
  // sit in that window, so the penalty decided nothing and the pick was a coin
  // toss. Exactly backwards — the penalty exists for the thin pool, and the
  // thin pool is the case where every candidate is in the top three.
  //
  // It looked like it worked because it was measured on a wide pool, where the
  // top three happen to be unused dishes anyway. A flaky unit test caught it
  // (one dish took 4 of 7 slots on some runs, 3 on others) and a QA week found
  // the same thing from the other side: one snack served three times.
  //
  // So the window is the least-used dishes only. This is still not a cap: when
  // every candidate has been used once, they all have the fewest uses and all
  // stay eligible, so a slot can never become unfillable — the failure mode of
  // the hard per-week cap this replaced.
  const fewestUses = Math.min(...scored.map((s) => weekUseCounts.get(s.id) ?? 0));
  const freshest = scored.filter((s) => (weekUseCounts.get(s.id) ?? 0) === fewestUses);
  return shuffleArray(freshest.slice(0, Math.min(3, freshest.length)))[0];
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
    // What the snack slot already holds, so the top-up below cannot exceed the
    // slot ceiling the graded pass respects.
    let snackSlotCalories = 0;
    // The day's macros so far, so scoring can ask where the DAY lands rather
    // than only what a dish looks like on its own.
    const todayMacroG = { protein: 0, carbs: 0, fat: 0 };
    const dayMacroTargetG = {
      protein: (weekCals * macroTarget.protein) / 4,
      carbs: (weekCals * macroTarget.carbs) / 4,
      fat: (weekCals * macroTarget.fat) / 9,
    };
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
          // The SLOT's remaining room, not only the dish's ceiling.
          //
          // MEAL_CAL_CEILING is a per-dish rule, and a per-dish rule cannot see
          // a slot — the lesson this file has now learnt for salt, oil, starch,
          // protein and repeats. QA measured the consequence: every individual
          // dish honoured 1.25×, and three snack slots came to 1.73-1.99× their
          // target because each held two of them. One day's "snack" was 609 kcal
          // — larger than that day's breakfast AND its dinner.
          const slotRoom = target !== null ? target * MEAL_CAL_CEILING - mealCalories : null;
          if (slotRoom !== null && slotRoom <= 0) return [];
          const boundedMax = slotRoom !== null ? Math.min(calMax, slotRoom) : calMax;
          const win = capWindowToDayBudget(calMin ?? 0, boundedMax, dayBudget, dayCalories);
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
        // Fat gets a CEILING, not only a score.
        //
        // Cycle 10 added a day-aware scoring term and cycle 13 tuned it, and QA
        // measured the result twice: 34.5-46% of calories from fat, then
        // 29-52%, against a 25% target, with the app's own rail printing
        // 153-177% in red. Scoring is a preference, and a preference loses to a
        // pool where the median lunch is 31% fat and the recipes genuinely call
        // for the oil — QA verified the rows against the step text and they
        // agree, so there is nothing to clamp away.
        //
        // Sodium had the identical shape and was fixed by a ceiling that relaxes
        // only when the alternative is an empty slot: 6 days of 7 over the
        // guideline became 0 of 7, and has stayed there for four cycles. This is
        // that instrument, applied to the macro the plan misses most.
        //
        // 1.25x the day's fat target, not 1.0: at parity almost nothing in the
        // catalog qualifies and every slot would fall through to the last tier,
        // which refuses nothing — a ceiling nobody can meet is the same as no
        // ceiling. This one is meetable, and what it refuses is the dish that
        // takes an already-fatty day further.
        const dayFatRoomLeft = (r: PoolRecipe): boolean => {
          const budget = dayMacroTargetG.fat;
          if (!budget) return true;
          return todayMacroG.fat + (r.fat ?? 0) <= budget * DAY_FAT_CEILING;
        };
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
          (relax.sameDay || dayFatRoomLeft(r)) &&
          (relax.sameDay || carbBaseRoomLeft(r)) &&
          (relax.protein || (() => { const dp = dishProtein(r.ingredients); return dp === null || !prevDayProteins.has(dp); })()) &&
          (relax.crossWeek || !excludeRecipeIds.has(r.id)) &&
          (relax.weekReuse || (!weekUsedIds.has(r.id) && !weekUsedSignatures.has(dishSignature(r.ingredients)))) &&
          (relax.sameDay || !todayUsedIds.has(r.id));
        for (const [ti, relax] of tiers.entries()) {
          const pool = selectionPool.filter((r) => matches(r, relax));
          if (pool.length > 0) {
            if (process.env.WONDISH_DEBUG_POOL) {
              console.log(`[pool] ${mealType.name} day${dayIndex} tier${ti} n=${pool.length} dishTypes=${dishTypeNames ?? "any"} win=${calWin ? `${calWin.min}-${calWin.max}` : "none"}`);
            }
            return pool;
          }
        }
        if (process.env.WONDISH_DEBUG_POOL) {
          console.log(`[pool] ${mealType.name} day${dayIndex} EMPTY dishTypes=${dishTypeNames ?? "any"} win=${calWin ? `${calWin.min}-${calWin.max}` : "none"}`);
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
        todayMacroG.protein += recipe.protein ?? 0;
        todayMacroG.carbs   += recipe.carbs ?? 0;
        todayMacroG.fat     += recipe.fat ?? 0;
        mealCalories += recipe.calories ?? 0;
        dayCalories  += recipe.calories ?? 0;
        menus.push({ patientId, recipeId: recipe.id, mealTypeId: mealType.id, date: new Date(current), planVersion });
      };

      const pick = (pool: RecipeCandidate[]) =>
        pickByMotivation(pool, motivationNames, affinityMap, seenIngredientNames, macroTarget, todaySodiumMg, weekUseCounts, dayMacroTargetG, todayMacroG);

      // ── Step 1: Try a complete meal ────────────────────────────────────────
      if (target !== null) {
        // 1.25, not 1.35. At 1.35 a 735 kcal lunch target admitted a 992 kcal
        // dish, and QA found two lunches at 977 and 955 — 44% of the day in one
        // sitting, with the arithmetic correct and the portion simply large
        // (140-145 g of dry rice plus 1.5 tbsp of oil). Costs 34 of 673 usable
        // lunches, and the slot keeps 626.
        const calMax = dinnerCalCap !== null ? Math.min(target * MEAL_CAL_CEILING, dinnerCalCap) : target * MEAL_CAL_CEILING;
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
      if (isSnack) snackSlotCalories = mealCalories;
    }

    // ── Calorie top-up ─────────────────────────────────────────────────────
    // If the day is still below 90 % of target, pad with snack-tagged recipes.
    if (snackMealType && dayCalories < weekCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;
      // The snack slot's own ceiling applies here too. Adding the cap to
      // queryRecipes fixed the graded slots and left this path alone, so a snack
      // slot still came to 1.41x its cap (556 kcal) — the top-up has its own
      // calorie window and had never heard of the slot. Third time a fix to the
      // graded pass has had to be repeated here (sodium, the day's macros, now
      // this); the top-up is a slot-filler and belongs under the slot's rules.
      const snackSlotCap = (caloriePlan["snack"] ?? 0) * MEAL_CAL_CEILING;
      while (dayCalories < weekCals * 0.9 && extraCount < MAX_EXTRA) {
        const roomInSlot = snackSlotCap > 0 ? snackSlotCap - snackSlotCalories : Number.POSITIVE_INFINITY;
        if (roomInSlot <= 0) break;
        const calGap  = weekCals - dayCalories;
        const minCals = Math.round(calGap * 0.25);
        const maxCals = Math.round(Math.min(calGap, roomInSlot));
        // The day's own limits apply here too, and they do NOT relax.
        //
        // This block enforced family and reuse and nothing else, and it updated
        // none of the day's counters — so every dish it added was invisible to
        // the sodium ceiling, the two-per-day protein and starch caps, the
        // variety penalty, and to the NEXT pass of this very loop. It stayed
        // hidden while the snack pool held one dish and this path almost never
        // ran; the moment 209 mislabelled rows were filed correctly and the
        // pool tripled, it fired on most days and took the week with it:
        // sodium over 2,300 mg on 6 days of 7 (one at 3,566), one protein in
        // three slots on 5 days, one dish six times in a week — all of it from
        // padding, after the graded slots had come out clean.
        //
        // In the main loop these relax on the last tier, because there the
        // alternative is an empty slot. Here the alternative is a day under
        // target, which this block already treats as the honest outcome, so
        // there is no tier to fall to: a 300 kcal top-up is never worth a third
        // helping of chicken or a day over the sodium guideline.
        const matchesExtra = (r: PoolRecipe, excludeUsed: boolean): boolean =>
          r.mealTypeId === snackMealType.id &&
          r.ingredients.length > 0 && r.description !== null &&
          r.calories !== null && r.calories >= minCals && r.calories <= maxCals &&
          (r.family === null || !dailyFamilies.has(r.family)) &&
          todaySodiumMg + dishSodiumMg(r.ingredients) <= DAILY_SODIUM_MAX_MG &&
          // The day's fat ceiling applies to padding too. Snacks are the
          // fattiest category in the catalog (median 54% of calories from fat),
          // so the slot that exists to close a calorie gap is the one most
          // likely to blow the day's fat — the fourth rule this top-up has had
          // to be told about after sodium, protein and starch.
          (dayMacroTargetG.fat === 0 ||
            todayMacroG.fat + (r.fat ?? 0) <= dayMacroTargetG.fat * DAY_FAT_CEILING) &&
          (() => { const b = dishCarbBase(r.ingredients); return b === null || (todayCarbBaseCounts.get(b) ?? 0) < MAX_SAME_CARB_BASE_PER_DAY; })() &&
          (() => { const p = dishProtein(r.ingredients); return p === null || (todayProteinCounts.get(p) ?? 0) < MAX_SAME_PROTEIN_PER_DAY; })() &&
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
        const extra = pickByMotivation(
          extraCandidates, motivationNames, affinityMap, seenIngredientNames, macroTarget, todaySodiumMg, weekUseCounts,
          dayMacroTargetG, todayMacroG
        );
        const extraCals = extra.calories ?? 0;
        if (extraCals <= 0) break; // no useful calorie contribution; further picks won't help
        dayCalories += extraCals;
        snackSlotCalories += extraCals;
        extraCount++;
        weekUsedIds.add(extra.id);
        todayUsedIds.add(extra.id);
        weekUsedSignatures.add(dishSignature(extra.ingredients));
        // Counted into the day, exactly as a graded slot is. Without this the
        // filters above read stale zeros and the second pass of this loop
        // repeated the first pass's protein and sodium.
        weekUseCounts.set(extra.id, (weekUseCounts.get(extra.id) ?? 0) + 1);
        todaySodiumMg += dishSodiumMg(extra.ingredients);
        todayMacroG.protein += extra.protein ?? 0;
        todayMacroG.carbs   += extra.carbs ?? 0;
        todayMacroG.fat     += extra.fat ?? 0;
        const extraCarb = dishCarbBase(extra.ingredients);
        if (extraCarb) todayCarbBaseCounts.set(extraCarb, (todayCarbBaseCounts.get(extraCarb) ?? 0) + 1);
        const extraProtein = dishProtein(extra.ingredients);
        if (extraProtein) {
          todayProteinCounts.set(extraProtein, (todayProteinCounts.get(extraProtein) ?? 0) + 1);
          todayProteins.add(extraProtein);
        }
        if (extra.family && !isBeverageExempt(extra)) dailyFamilies.add(extra.family);
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current), planVersion });
      }
    }

    // Carry today's proteins forward so tomorrow avoids them (no back-to-back).
    prevDayProteins = todayProteins;
    todayProteinCounts.clear();
    todayCarbBaseCounts.clear();
    todaySodiumMg = 0;
    snackSlotCalories = 0;
    todayMacroG.protein = 0;
    todayMacroG.carbs = 0;
    todayMacroG.fat = 0;
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
