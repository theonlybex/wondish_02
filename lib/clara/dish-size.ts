// A dish's portions, scaled in code to the size the meal should be.
//
// The prompt used to ask the model for 12% more than the target, because the
// model's own calorie figures ran above the food table's on meat and fish
// dishes (2026-11-23: priced at 0.85 of declared). On lentil and tofu dishes
// they run below it (2026-11-28: priced at 1.15 of declared, so those dishes
// were served 27% over target). No one multiplier fits both. The card's
// calories come from the ingredient amounts, so the amounts are what is moved:
// when a priced dish misses the target by more than a tenth, its food rows are
// scaled until the priced dish lands on it. No model call.
//
// What is never scaled: seasonings and water (they carry no calories), the
// cooking fat (the prompt caps it and asks for full portions of protein and
// starch instead), counted foods ("2 eggs" cannot become 1.6), and any row
// whose amount a step repeats ("simmer in 400 ml", "add the 130 g chicken"),
// so the steps never contradict the ingredient list.
import type { FridgeRecipe } from "@/lib/fridge";
import { priceDish } from "@/lib/staple-density";
import { pricedMacros } from "./recipe-generation";

/** A dish within this share of its target is left as it is. */
export const SIZE_TOLERANCE = 0.1;
/** The most the food rows may be scaled, down or up. */
export const SIZE_FACTOR = { min: 0.6, max: 1.5 } as const;

const UNIT_WORDS = "g|grams?|gr|kg|kilograms?|ml|millilit(?:re|er)s?|l|lit(?:re|er)s?|oz|ounces?|lbs?|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?";
const MEASURED = new RegExp(`^\\s*(${UNIT_WORDS})\\s*$`, "i");
const SMALL_STEP = /^\s*(g|grams?|gr|ml|millilit(?:re|er)s?)\s*$/i;
const COOKING_FAT = /\b(oil|butter|ghee)\b/i;

/** Does a step repeat this row's amount ("400 ml", "130 g")? Then the row stays as written. */
function stepRepeatsAmount(quantity: number, steps: readonly string[]): boolean {
  const q = String(quantity).replace(".", "\\.");
  const re = new RegExp(`(?<![\\d.])${q}\\s*(${UNIT_WORDS})\\b`, "i");
  return steps.some((s) => re.test(s));
}

/** Kitchen amounts: grams and millilitres to the nearest 5 (1 below 25), everything else to the nearest quarter. */
function roundAmount(quantity: number, unit: string): number {
  if (SMALL_STEP.test(unit)) return quantity >= 25 ? Math.max(5, Math.round(quantity / 5) * 5) : Math.max(1, Math.round(quantity));
  return Math.max(0.25, Math.round(quantity * 4) / 4);
}

/**
 * The dish with its food rows scaled towards `targetKcal`, or the SAME object
 * when nothing was changed: no target, not priced from its amounts, already
 * within SIZE_TOLERANCE, nothing scalable, or scaling did not bring it closer.
 */
export function sizeToTarget(r: FridgeRecipe, targetKcal: number | null): FridgeRecipe {
  if (targetKcal == null || !(targetKcal > 0) || !r.amounts || r.amounts.length === 0) return r;
  const before = pricedMacros(r);
  if (!before || !(before.calories > 0)) return r;
  const miss = Math.abs(before.calories / targetKcal - 1);
  if (miss <= SIZE_TOLERANCE) return r;

  // What each row is worth, and whether it may move.
  let scalable = 0;
  const rows = r.amounts.map((a) => {
    const priced = priceDish([{ name: a.name, quantity: a.quantity, unit: a.unit }], r.steps);
    const kcal = priced && priced.coverage > 0 ? priced.calories : 0;
    const moves = kcal > 0 && MEASURED.test(a.unit) && !COOKING_FAT.test(a.name) && !stepRepeatsAmount(a.quantity, r.steps);
    if (moves) scalable += kcal;
    return { a, moves };
  });
  if (!(scalable > 0)) return r;
  const fixed = before.calories - scalable;
  const factor = Math.min(SIZE_FACTOR.max, Math.max(SIZE_FACTOR.min, (targetKcal - fixed) / scalable));
  if (Math.abs(factor - 1) < 0.05) return r;

  const amounts = rows.map(({ a, moves }) => (moves ? { ...a, quantity: roundAmount(a.quantity * factor, a.unit) } : a));
  const resized: FridgeRecipe = { ...r, amounts };
  const after = pricedMacros(resized);
  if (!after || Math.abs(after.calories / targetKcal - 1) >= miss) return r;
  // The model's own per-serving figures follow the dish, so nothing downstream reads a size it no longer has.
  const k = after.calories / before.calories;
  const p = r.perServing;
  return {
    ...resized,
    perServing: { ...p, calories: Math.round(p.calories * k), protein: p.protein * k, carbs: p.carbs * k, fat: p.fat * k, fiber: p.fiber * k },
  };
}
