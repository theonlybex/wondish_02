// One judge for every dish Clara shows. It runs after the diet and plausibility
// checks (gateGeneratedDishes) and decides, in order: the protein rule, honesty
// about the name, the size for the meal, enough protein in a main, and the
// level ceilings. Pure: no database, no model client.
import type { MealType } from "../local-date";
import type { FullLevelKey } from "@/lib/level-catalogue";
import { ingredientTokens } from "@/lib/basket-match";
import { builtOn, type DishIngredient, type HomeProtein } from "./dish-protein";
import type { DishRules } from "./dish-rules";
import { proteinRuleBreak } from "./protein-rule";
import { proteinShareLow, sizeProblem } from "./meal-target";

export interface JudgeInput {
  mealType: MealType; wants?: string;
  name: string;
  ingredients: readonly DishIngredient[];
  steps: readonly string[];
  /** Per serving, as the card shows them. */
  calories: number; proteinG: number;
  /** Per-serving amounts that are KNOWN. A level absent here is unknown, never 0. */
  known: Partial<Record<FullLevelKey, number>>;
  home: readonly HomeProtein[];
  rules: DishRules;
  targetCalories: number | null;
  ceilings: Partial<Record<FullLevelKey, number>>;
}

export interface DishVerdict {
  /** "pass": every check. "relaxed": only the size or protein-share check failed (ladder step 2). "fail": out. */
  level: "pass" | "relaxed" | "fail";
  /** In check order; [] for a pass. "protein:<ProteinBreak>", "honest:named-after-ingredient", "size:too-small", "size:too-large", "protein-share", "limit:<level key>". */
  reasons: string[];
  /** The key of the protein the dish is built on, or null. */
  builtOn: string | null;
}

/** The dish name's tokens are exactly one ingredient's tokens ("Wild Rice" with wild rice in it). */
export function namedAfterOwnIngredient(name: string, ingredientNames: readonly string[]): boolean {
  const named = ingredientTokens(name);
  if (named.size === 0) return false;
  return ingredientNames.some((n) => {
    const t = ingredientTokens(n);
    return t.size === named.size && [...named].every((w) => t.has(w));
  });
}

export function judgeDish(input: JudgeInput): DishVerdict {
  const reasons: string[] = [];
  const built = builtOn(input.ingredients, input.steps);

  const broke = proteinRuleBreak({
    mealType: input.mealType, wants: input.wants,
    ingredients: input.ingredients, steps: input.steps,
    home: input.home, rules: input.rules,
  });
  if (broke) reasons.push(`protein:${broke}`);

  // OFF 2026-11 (dish brain, "Other ingredients"): the count of foods to buy and its penalty. Owner: "comment out this part of the algorithm for now"; anything not at home is settled at the ingredients check (piece B). Restore: uncomment, write foodsToBuy(ingredients, kept, basics), and add its reason to the list.
  // const toBuy = foodsToBuy(input.ingredients, input.kept, input.basics);
  // if (toBuy.length > MAX_FOODS_TO_BUY) reasons.push(`to-buy:${toBuy.length}`);

  if (namedAfterOwnIngredient(input.name, input.ingredients.map((i) => i.name))) reasons.push("honest:named-after-ingredient");

  if (input.rules.sizeToCalories) {
    const size = sizeProblem(input.mealType, input.calories, input.targetCalories);
    if (size) reasons.push(`size:${size}`);
  }
  if (input.rules.mainsOnProtein && proteinShareLow(input.mealType, input.calories, input.proteinG)) reasons.push("protein-share");

  for (const [key, amount] of Object.entries(input.known) as [FullLevelKey, number | undefined][]) {
    const ceiling = input.ceilings[key];
    if (amount !== undefined && ceiling !== undefined && amount > ceiling) reasons.push(`limit:${key}`);
  }

  const hard = reasons.some((r) => r.startsWith("protein:") || r.startsWith("honest:") || r.startsWith("limit:"));
  return { level: hard ? "fail" : reasons.length ? "relaxed" : "pass", reasons, builtOn: built?.key ?? null };
}
