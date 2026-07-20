// ─── Wondish Shared Macro Module ──────────────────────────────────────────────
// The single home for all INTAKE macro arithmetic (logged meals, custom
// ingredients, recipe pricing, ingredient summation). Target math ("should
// eat") stays in lib/caloric-engine.ts; this module ("did eat") re-exports the
// pieces of it every intake caller needs so there is one import surface.
//
// ROUNDING POLICY: internal snapshots and sums stay UNROUNDED floats end-to-
// end. r1 (and the script's own Math.round on calories) is applied only by
// callers at a display/persistence boundary, exactly once. Never round then
// rescale — that is how 3 servings of a 1000 kcal recipe drifts to 999.9.
//
// No float-equality comparisons anywhere in this module — all threshold
// checks (by callers) are ratio/>= based.
// ────────────────────────────────────────────────────────────────────────────

import {
  computeDailyMacros,
  resolveMacroProfile,
  getMacroPercentages,
  KCAL_PER_KG,
  type MealMacros,
  type MacroPercentages,
} from "@/lib/caloric-engine";

export type { MealMacros } from "@/lib/caloric-engine"; // re-export, no duplicate type
export { computeDailyMacros, resolveMacroProfile, getMacroPercentages, KCAL_PER_KG } from "@/lib/caloric-engine";

// ─── Snapshot shape ────────────────────────────────────────────────────────

// Per-serving OR totals — same shape either way; which one a given value
// represents is a matter of caller convention, not the type.
export interface MacroSnapshot {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  incomplete: boolean; // any contributing value was null/unpriceable
}

export const ZERO_SNAPSHOT: MacroSnapshot = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  incomplete: false,
};

export const r1 = (n: number): number => Math.round(n * 10) / 10;

// ─── Ingredient → grams, summation ──────────────────────────────────────────
// Extracted verbatim from scripts/fetch-nutrition.mjs (formerly lines 63-95 /
// 249-281). The script imports these back and keeps its own call-site
// rounding (Math.round on calories, r1 on protein/carbs/fat) so its DB output
// is byte-identical pre/post extraction. Fiber is summed here (unlike the
// script's original loop, which never touched it) so other callers — Fridge
// Mode's ingredient pricing, in particular — get a complete snapshot; the
// script itself simply doesn't read the returned fiber field, preserving its
// existing gap rather than silently "fixing" it.

// These are rough estimates; solid foods in cups/tbsp vary by density.
export const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1, gr: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.59, pound: 453.59, pounds: 453.59,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000,
  cup: 240, cups: 240,
  tablespoon: 15, tbsp: 15, tbs: 15,
  teaspoon: 5, tsp: 5,
  fl_oz: 29.57, "fl oz": 29.57,
  // Size descriptors — rough median weights
  whole: 100, piece: 50,
  small: 50, medium: 100, large: 150,
  slice: 30,
  pinch: 0.35, dash: 0.6,
  clove: 5,
  sprig: 3,
  leaves: 2, leaf: 2,
  stalk: 40, spear: 30, stick: 40,
  scoop: 30,
  can: 400,
  teabag: 2,
  crackers: 15,
};

/**
 * Converts a quantity + freeform unit string to grams. Unknown/missing unit
 * or quantity → null (never throws, never guesses). Callers that need to
 * surface unknown units (rather than silently drop them) do so via
 * sumIngredientMacros's onUnknownUnit callback.
 */
export function toGrams(qty: number | null, unit: string | null): number | null {
  if (!qty || !unit) return null;
  const key = unit.toLowerCase().trim();
  const factor = UNIT_TO_GRAMS[key];
  if (!factor) return null;
  return qty * factor;
}

export interface IngredientMacroInput {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
}

export interface IngredientLineInput {
  ingredient: IngredientMacroInput;
  quantity?: number | null;
  unit?: string | null;
}

/**
 * Sums per-100g ingredient macros across a recipe's ingredient lines,
 * converting each line's quantity+unit to grams first. Returns RAW
 * (unrounded) sums. Any line whose ingredient lacks nutrient data, or whose
 * unit can't be converted to grams, is dropped from the sum and flags
 * `incomplete: true` on the result — undercounting is never silent. Dropped
 * lines with a genuinely unknown (non-empty) unit additionally invoke
 * `onUnknownUnit` (default: console.warn) so the gap is logged, not swallowed.
 */
export function sumIngredientMacros(
  items: IngredientLineInput[],
  onUnknownUnit: (unit: string | null) => void = (unit) =>
    console.warn(`[lib/macros] sumIngredientMacros: unknown unit "${unit}"`)
): MacroSnapshot {
  let calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
  let incomplete = false;

  for (const item of items) {
    const ing = item.ingredient;
    if (ing.calories == null) {
      incomplete = true;
      continue;
    }
    const grams = toGrams(item.quantity ?? null, item.unit ?? null);
    if (grams == null) {
      incomplete = true;
      const unit = item.unit ?? null;
      if (unit && !(unit.toLowerCase().trim() in UNIT_TO_GRAMS)) onUnknownUnit(unit);
      continue;
    }
    const factor = grams / 100;
    calories += (ing.calories ?? 0) * factor;
    protein  += (ing.protein  ?? 0) * factor;
    carbs    += (ing.carbs    ?? 0) * factor;
    fat      += (ing.fat      ?? 0) * factor;
    fiber    += (ing.fiber    ?? 0) * factor;
  }

  return { calories, protein, carbs, fat, fiber, incomplete };
}

// ─── Macro ratio / deviation (single source, replaces both inline copies) ──
// Extracted from BOTH verified inline copies: lib/meal-plan.ts (pickByMotivation
// scoring, weight ×40) and app/api/meal-plan/[menuId]/swap/route.ts (validation,
// threshold > 0.50). Both call sites import these back and keep their own
// threshold/weight — only the ratio/deviation math itself is shared.

/**
 * Calorie-normalized macro ratios: grams × kcal/g, divided by total calories.
 * Protein/carbs: 4 kcal/g. Fat: 9 kcal/g. Zero/missing calories → all-zero
 * ratios (never divides by zero).
 */
export function macroRatios(m: {
  calories: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}): { protein: number; carbs: number; fat: number } {
  if (!m.calories || m.calories <= 0) return { protein: 0, carbs: 0, fat: 0 };
  const cal = m.calories;
  return {
    protein: ((m.protein ?? 0) * 4) / cal,
    carbs:   ((m.carbs   ?? 0) * 4) / cal,
    fat:     ((m.fat     ?? 0) * 9) / cal,
  };
}

/**
 * Sum of absolute deviations between a dish's macro ratios and a target
 * macro-percentage profile. Callers apply their own threshold/weight to this
 * value (swap: reject when > 0.50; meal-plan scoring: score -= deviation*40).
 */
export function macroDeviation(
  m: Parameters<typeof macroRatios>[0],
  target: MacroPercentages
): number {
  const r = macroRatios(m);
  return Math.abs(r.protein - target.protein) + Math.abs(r.carbs - target.carbs) + Math.abs(r.fat - target.fat);
}

// ─── Whole-dish → per-serving boundary ──────────────────────────────────────

export interface RecipeMacroInput {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  servings?: number | null;
}

/**
 * The ONE place the whole-dish → per-serving boundary is crossed. Recipe
 * columns are WHOLE-DISH totals (undivided); divide by Recipe.servings
 * (null/0 → treated as 1). Result is UNROUNDED so N-servings totals
 * (via scaleSnapshot) re-sum to the whole dish exactly.
 */
export function recipeToPerServing(recipe: RecipeMacroInput): MacroSnapshot {
  const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
  return {
    calories: (recipe.calories ?? 0) / servings,
    protein:  (recipe.protein  ?? 0) / servings,
    carbs:    (recipe.carbs    ?? 0) / servings,
    fat:      (recipe.fat      ?? 0) / servings,
    fiber:    (recipe.fiber    ?? 0) / servings,
    incomplete: recipe.calories == null,
  };
}

// ─── Caller-supplied per-serving macros (MANUAL / PICTURE / FRIDGE) ────────

export function snapshotFromMacros(
  perServing: Partial<Omit<MacroSnapshot, "incomplete">>
): MacroSnapshot {
  const keys: (keyof Omit<MacroSnapshot, "incomplete">)[] = ["calories", "protein", "carbs", "fat", "fiber"];
  let incomplete = false;
  const out = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const key of keys) {
    const v = perServing[key];
    if (v == null) {
      incomplete = true;
    } else {
      out[key] = v;
    }
  }
  return { ...out, incomplete };
}

// ─── PatientCustomIngredient → per-unit snapshot (no multiplier param) ─────
// PatientCustomIngredient macros are per its freeform `unit`. This maps the
// ci fields 1:1 into a per-UNIT snapshot — NO multiplier parameter. The
// MealLog `servings` column is the sole multiplier, applied exactly once at
// read time by scaleSnapshot ("servings" for CUSTOM rows means "quantity in
// the ingredient's unit"; the UI labels it with ci.unit). This kills the
// double-scaling path where quantity baked into the snapshot AND servings at
// read → 4x totals.
// PatientCustomIngredient has NO fiber column (verified schema): fiber
// defaults to 0 WITHOUT setting incomplete — incomplete is only for values
// the model could have had but were null/unpriceable.
export function snapshotFromCustomIngredient(ci: {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}): MacroSnapshot {
  const incomplete = ci.calories == null || ci.protein == null || ci.carbs == null || ci.fat == null;
  return {
    calories: ci.calories ?? 0,
    protein:  ci.protein  ?? 0,
    carbs:    ci.carbs    ?? 0,
    fat:      ci.fat      ?? 0,
    fiber: 0,
    incomplete,
  };
}

// ─── Per-serving → totals (the only rounding boundary for snapshots) ──────

/**
 * per-serving snapshot × servings → totals, r1-rounded AT THIS BOUNDARY ONLY.
 * Fractional servings exact (input snapshot is unrounded).
 */
export function scaleSnapshot(snap: MacroSnapshot, servings: number): MacroSnapshot {
  return {
    calories: r1(snap.calories * servings),
    protein:  r1(snap.protein  * servings),
    carbs:    r1(snap.carbs    * servings),
    fat:      r1(snap.fat      * servings),
    fiber:    r1(snap.fiber    * servings),
    incomplete: snap.incomplete,
  };
}

// ─── Aggregate logged rows → day/window totals ─────────────────────────────

export interface MealLogRowInput {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  servings: number;
  incomplete?: boolean;
  deletedAt?: Date | string | null;
}

/**
 * Aggregate rows → day/window totals. Excludes deletedAt != null. Empty →
 * ZERO_SNAPSHOT. Sums raw (unrounded) per-row scaling and rounds once at the
 * total, avoiding cumulative per-row rounding drift.
 */
export function sumMealLogs(rows: MealLogRowInput[]): MacroSnapshot {
  let calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
  let incomplete = false;

  for (const row of rows) {
    if (row.deletedAt != null) continue;
    const s = row.servings;
    calories += (row.calories ?? 0) * s;
    protein  += (row.protein  ?? 0) * s;
    carbs    += (row.carbs    ?? 0) * s;
    fat      += (row.fat      ?? 0) * s;
    fiber    += (row.fiber    ?? 0) * s;
    if (row.incomplete) incomplete = true;
  }

  return { calories: r1(calories), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: r1(fiber), incomplete };
}
