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
import { sizeProblem } from "./meal-target";

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
  /** Dish names they had today or in the last days, or were just shown. A dish that is one of them reworded is only served when nothing else passes. */
  notLike?: readonly string[];
}

const NAME_FILLER = new Set(["and", "with", "the", "of", "on", "in", "a", "an", "over", "style", "quick", "easy", "simple"]);
const nameWords = (name: string): Set<string> =>
  new Set(name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter((w) => w.length > 1 && !NAME_FILLER.has(w)));

/** How much two dish names share: words in both over words in either (0 to 1). */
export function nameOverlap(a: string, b: string): number {
  const x = nameWords(a), y = nameWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** At or above this, a dish is another one reworded ("Salmon and Jasmine Rice Bowl with Sautéed Spinach" / "Salmon Jasmine Rice Bowl with Lemon Garlic Spinach" is 0.63). */
export const REPEAT_OVERLAP = 0.6;

export interface DishVerdict {
  /** "pass": every check. "relaxed": only the size or the repeat check failed (ladder step 2). "fail": out. */
  level: "pass" | "relaxed" | "fail";
  /** In check order; [] for a pass. "protein:<ProteinBreak>", "honest:named-after-ingredient", "size:too-small", "size:too-large", "repeat", "limit:<level key>". */
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
  // OFF 2026-11-22 (owner: "maybe this rule is a bit too much, maybe we remove it for now"): the 15% protein floor for a main. Restore: uncomment, and the line in targetLines.
  // if (input.rules.mainsOnProtein && proteinShareLow(input.mealType, input.calories, input.proteinG)) reasons.push("protein-share");

  if (input.wants === undefined && (input.notLike ?? []).some((n) => nameOverlap(input.name, n) >= REPEAT_OVERLAP)) reasons.push("repeat");

  for (const [key, amount] of Object.entries(input.known) as [FullLevelKey, number | undefined][]) {
    const ceiling = input.ceilings[key];
    if (amount !== undefined && ceiling !== undefined && amount > ceiling) reasons.push(`limit:${key}`);
  }

  const hard = reasons.some((r) => r.startsWith("protein:") || r.startsWith("honest:") || r.startsWith("limit:"));
  return { level: hard ? "fail" : reasons.length ? "relaxed" : "pass", reasons, builtOn: built?.key ?? null };
}
