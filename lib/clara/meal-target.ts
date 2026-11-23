// How big a dish should be for its meal, the macro split to aim for, and what
// the person's goal leans towards. The shares and splits come from the caloric
// engine; nothing here restates them. No database, no model client of its own.
import { computeMealCalories, resolveMacroProfile, getMacroPercentages, type MacroPercentages } from "@/lib/caloric-engine";
import { macroSplitLine } from "@/lib/clara/recipe-generation";
import type { MealType } from "@/lib/local-date";
import type { DishRules } from "./dish-rules";

export const MAIN_SIZE_BAND = { min: 0.7, max: 1.25 } as const;
/** The floor SAID to the model, higher than the one the judge holds: told "between 418 and 950", it wrote 428 for a 760 kcal lunch. */
export const MAIN_SAID_FLOOR = 0.85;
export const MAIN_MIN_PROTEIN_SHARE = 0.15;

export type Leaning = "protein" | "fibre" | "less fat";

export interface MealTarget {
  /** kcal per serving for this meal, rounded; null without a day target or with sizeToCalories off. */
  calories: number | null;
  dayCalories: number | null;
  /** Lunch and dinner only: whole kcal, min rounded up, max rounded down. */
  band: { min: number; max: number } | null;
  /** null with followMacroSplit off. */
  split: MacroPercentages | null;
  leanings: Leaning[];
}

const isMain = (m: MealType) => m === "lunch" || m === "dinner";

// Whole-number arithmetic (70 / 125 percent), so 0.7 × 700 is 490 exactly.
function bandFor(calories: number): { min: number; max: number } {
  return { min: Math.ceil((calories * 70) / 100), max: Math.floor((calories * 125) / 100) };
}

function leaningsFrom(motivationNames: readonly string[]): Leaning[] {
  const mots = motivationNames.map((n) => n.toLowerCase());
  const has = (s: string) => mots.some((m) => m.includes(s));
  const out: Leaning[] = [];
  if (has("muscle")) out.push("protein");
  if (has("energy") || has("health")) out.push("fibre");
  if (has("health")) out.push("less fat");
  return out;
}

export function mealTarget(a: {
  mealType: MealType;
  dayCalories: number | null;
  conditionNames: readonly string[];
  motivationNames: readonly string[];
  rules: Pick<DishRules, "sizeToCalories" | "followMacroSplit">;
}): MealTarget {
  const sized = a.rules.sizeToCalories && a.dayCalories != null && a.dayCalories > 0;
  const calories = sized ? Math.round(computeMealCalories(a.dayCalories as number)[a.mealType]) : null;
  const band = calories != null && isMain(a.mealType) ? bandFor(calories) : null;
  const split = a.rules.followMacroSplit
    ? getMacroPercentages(resolveMacroProfile([...a.conditionNames], [...a.motivationNames]))
    : null;
  return {
    calories,
    dayCalories: sized ? a.dayCalories : null,
    band,
    split,
    leanings: leaningsFrom(a.motivationNames),
  };
}

/** Lunch and dinner only; null for other meals and without a target. */
export function sizeProblem(mealType: MealType, calories: number, targetCalories: number | null): "too-small" | "too-large" | null {
  if (!isMain(mealType) || targetCalories == null) return null;
  const band = bandFor(targetCalories);
  if (calories < band.min) return "too-small";
  if (calories > band.max) return "too-large";
  return null;
}

/** Lunch and dinner only: protein × 4 below 15% of the calories. False when calories ≤ 0. */
export function proteinShareLow(mealType: MealType, calories: number, proteinG: number): boolean {
  if (!isMain(mealType) || calories <= 0) return false;
  return proteinG * 400 < calories * 15;
}

export const MAIN_PROTEIN_LINE = "- A lunch or dinner gets at least 15% of its calories from protein.";

/** The instruction lines, in this order: size, macro split, the 15% line (lunch and dinner, only with `mainsOnProtein`), leanings. */
export function targetLines(t: MealTarget, mealType: MealType, mainsOnProtein: boolean): string[] {
  const lines: string[] = [];
  if (t.calories != null && t.dayCalories != null) {
    const meal = mealType.charAt(0).toUpperCase() + mealType.slice(1);
    let size = `- Size: this ${meal} should be about ${t.calories} kcal per serving (their day is ${t.dayCalories} kcal); choose the portions to land there.`;
    if (t.band) size += ` It must be no less than ${Math.ceil((t.calories * 85) / 100)} kcal and no more than ${t.band.max} kcal: a serving well under ${t.calories} kcal is too small to be this meal.`;
    lines.push(size);
  }
  if (t.split) lines.push(`- Macro split to aim for, by calories: ${macroSplitLine(t.split)}.`);
  // OFF 2026-11-22, with the judge's 15% check: if (mainsOnProtein && isMain(mealType)) lines.push(MAIN_PROTEIN_LINE);
  void mainsOnProtein;
  if (t.leanings.length > 0) lines.push(`- Their goal: lean towards ${t.leanings.join(", ")}.`);
  return lines;
}
