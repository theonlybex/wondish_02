// One judge for every dish Clara shows. It runs after the diet and plausibility
// checks (gateGeneratedDishes) and decides, in order: the protein rule, honesty
// about the name, the size for the meal, enough protein in a main, and the
// level ceilings. Pure: no database, no model client.
import type { MealType } from "../local-date";
import type { FullLevelKey } from "@/lib/level-catalogue";
import { ingredientTokens } from "@/lib/basket-match";
import { builtOn, proteinKind, type DishIngredient, type HomeProtein } from "./dish-protein";
import type { DishRules } from "./dish-rules";
import { proteinRuleBreak } from "./protein-rule";
import { foodMatches } from "./kept-foods";
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
  /** Foods the person said they do not have for this dish: a dish that uses one is out. */
  without?: readonly string[];
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

// What a dish IS, read from its name (names say what is in the dish and how it is cooked): the
// protein, the starch and the way of cooking. Live run, 2026-11-22: with five foods at home every
// name shares "beef, spinach, jasmine rice", so shared words neither catch a lunch reworded at
// dinner (0.56) nor spare a different dish (stuffed peppers, 0.62).
const STARCHES: readonly (readonly [string, RegExp])[] = [
  ["rice", /\brice\b/],
  ["potato", /\bpotato(es)?\b/],
  ["pasta", /\b(pasta|spaghetti|penne|noodles?|macaroni|fusilli|orzo|lasagne?)\b/],
  ["bread", /\b(bread|toast|tortillas?|wraps?|pitas?|buns?|bagels?|sandwich(es)?)\b/],
  ["grain", /\b(quinoa|barley|oats?|oatmeal|couscous|bulgur|farro|polenta)\b/],
];
const NOT_A_STARCH = /\b(vinegar|flour|crumbs?|starch|milk|syrup|paper|wine)\b/;
/** The starch family a food or a dish name says: rice, potato, pasta, bread or grain; null for none. */
export const starchFamily = (text: string): string | null => starchOf(text);
const starchOf = (text: string): string | null => {
  const lower = text.toLowerCase();
  if (NOT_A_STARCH.test(lower)) return null;
  return STARCHES.find(([, re]) => re.test(lower))?.[0] ?? null;
};
const WAYS: readonly (readonly [string, RegExp])[] = [
  ["wet", /\b(soups?|stews?|curry|curries|chili|chowder|braised?|ragu|ragù|dal|dhal|congee|porridge)\b/],
  ["oven", /\b(bakes?|baked|roast(ed)?|stuffed|casserole|gratin|tray|sheet[- ]pan)\b/],
  ["cold", /\b(salads?|wraps?|sandwich(es)?|toast)\b/],
];
export interface DishShape { protein: string | null; starch: string | null; way: string }
export function dishShape(name: string): DishShape {
  const lower = name.toLowerCase();
  const key = proteinKind(name)?.key ?? null;
  return {
    protein: key && key.startsWith("ground ") ? key.slice(7) : key,
    starch: starchOf(lower),
    way: WAYS.find(([, re]) => re.test(lower))?.[0] ?? "pan",
  };
}
/**
 * A name rebuilt from the ingredients ("Ground Beef with Russet Potatoes and Spinach") loses how the
 * dish is cooked, which the next day's repeat check and the "last few days" list both read from the
 * name (live run 5, 2026-11-22: a sheet-pan roast became a plain name, and a bake two days later
 * was not seen as the same dish). The oven or pot word of the original is put back at the end.
 */
const WAY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(soups?)\b/, "Soup"], [/\b(stews?)\b/, "Stew"], [/\b(curry|curries)\b/, "Curry"], [/\b(chili)\b/, "Chili"], [/\b(chowder)\b/, "Chowder"],
  [/\b(roast(ed)?)\b/, "Roast"], [/\b(bakes?|baked|tray|sheet[- ]pan|casserole|gratin)\b/, "Bake"],
  [/\b(salads?)\b/, "Salad"],
];
// A wrap or a sandwich is only that with the bread in it.
const BREAD_WAY_WORDS: readonly (readonly [RegExp, string])[] = [[/\b(wraps?)\b/, "Wrap"], [/\b(sandwich(es)?)\b/, "Sandwich"]];
export function keepWayOfCooking(original: string, renamed: string, ingredientNames: readonly string[] = []): string {
  if (original.trim() === renamed.trim() || dishShape(renamed).way !== "pan" || dishShape(original).way === "pan") return renamed;
  const lower = original.toLowerCase();
  const hasBread = starchesIn(ingredientNames).includes("bread");
  const word = WAY_WORDS.find(([re]) => re.test(lower))?.[1] ?? (hasBread ? BREAD_WAY_WORDS.find(([re]) => re.test(lower))?.[1] : undefined);
  return word ? `${renamed.trim()} ${word}` : renamed;
}

/** The same protein, the same starch and the same way of cooking; with neither a protein nor a starch to go by, mostly the same words. */
export function sameDish(a: string | DishShape, b: string): boolean {
  const x = typeof a === "string" ? dishShape(a) : a, y = dishShape(b);
  if (typeof a !== "string") return x.protein === y.protein && x.starch === y.starch && x.way === y.way;
  if (x.protein === null && x.starch === null && y.protein === null && y.starch === null) return nameOverlap(a, b) >= REPEAT_OVERLAP;
  return x.protein === y.protein && x.starch === y.starch && x.way === y.way;
}

/** The starch families among the ingredients (rice, potato, pasta, bread, grain). */
export function starchesIn(ingredientNames: readonly string[]): string[] {
  return [...new Set(ingredientNames.map(starchOf).filter((x): x is string => x !== null))];
}

/** At or above this, a dish is another one reworded ("Salmon and Jasmine Rice Bowl with Sautéed Spinach" / "Salmon Jasmine Rice Bowl with Lemon Garlic Spinach" is 0.63). */
export const REPEAT_OVERLAP = 0.6;

export interface DishVerdict {
  /** "pass": every check. "relaxed": only the size or the repeat check failed (ladder step 2). "fail": out. */
  level: "pass" | "relaxed" | "fail";
  /** In check order; [] for a pass. "protein:<ProteinBreak>", "honest:named-after-ingredient", "size:too-small", "size:too-large", "repeat", "starches", "limit:<level key>". */
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

  for (const w of input.without ?? []) {
    if (input.ingredients.some((i) => foodMatches(w, i.name))) reasons.push(`without:${w}`);
  }

  if (namedAfterOwnIngredient(input.name, input.ingredients.map((i) => i.name))) reasons.push("honest:named-after-ingredient");

  if (input.rules.sizeToCalories) {
    const size = sizeProblem(input.mealType, input.calories, input.targetCalories);
    if (size) reasons.push(`size:${size}`);
  }
  // OFF 2026-11-22 (owner: "maybe this rule is a bit too much, maybe we remove it for now"): the 15% protein floor for a main. Restore: uncomment, and the line in targetLines.
  // if (input.rules.mainsOnProtein && proteinShareLow(input.mealType, input.calories, input.proteinG)) reasons.push("protein-share");

  // What the candidate IS comes from the dish itself where it can: the protein it is built on and
  // the starch in its ingredients (a rebuilt name may leave the potatoes out); the way from its name.
  const starches = starchesIn(input.ingredients.map((i) => i.name));
  const named = dishShape(input.name);
  const builtKey = built ? (built.key.startsWith("ground ") ? built.key.slice(7) : built.key) : null;
  const shape: DishShape = { protein: builtKey ?? named.protein, starch: starches[0] ?? named.starch, way: named.way };
  const repeats = (n: string) => (shape.protein === null && shape.starch === null ? sameDish(input.name, n) : sameDish(shape, n));
  if (input.wants === undefined && (input.notLike ?? []).some(repeats)) reasons.push("repeat");
  // One starch per dish (rice with potatoes, potatoes with barley): served only when nothing else passes.
  if (input.wants === undefined && starches.length > 1) reasons.push("starches");

  for (const [key, amount] of Object.entries(input.known) as [FullLevelKey, number | undefined][]) {
    const ceiling = input.ceilings[key];
    if (amount !== undefined && ceiling !== undefined && amount > ceiling) reasons.push(`limit:${key}`);
  }

  const hard = reasons.some((r) => r.startsWith("protein:") || r.startsWith("honest:") || r.startsWith("limit:") || r.startsWith("without:"));
  return { level: hard ? "fail" : reasons.length ? "relaxed" : "pass", reasons, builtOn: built?.key ?? null };
}
