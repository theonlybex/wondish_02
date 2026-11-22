// The ingredients check before cooking (piece B): what a food can be exchanged
// for, and the exchange itself when it is a plain like-for-like one.
// Pure: no database, no model client.
//
// Owner, 2026-11-21/22: every ingredient can be changed when it is not at home,
// from foods of the same family, at-home ones first. A protein can be changed
// too, "to a different protein or non protein option". Whether the changed dish
// is still a good, safe dish is not decided here: it goes through the same
// gates and judge as any dish.
import type { ClaraRecipe } from "./parts";
import { proteinKind, type HomeProtein } from "./dish-protein";
import { foodMatches } from "./kept-foods";

export interface Family {
  key: string;
  /** A food of this family. */
  match: RegExp;
  /** Common members, offered when nothing of the family is at home. */
  members: readonly string[];
}

// The families of the design (dish brain, "B. Ingredients check before cooking").
// Order matters: the first match wins ("sweet potatoes" before "potatoes" is not needed, both are roots).
export const FAMILIES: readonly Family[] = [
  { key: "stock", match: /\b(stock|broth|bouillon)\b/i, members: ["vegetable stock", "chicken stock", "water"] },
  { key: "vinegars", match: /\bvinegar\b/i, members: ["apple cider vinegar", "white wine vinegar", "lemon juice"] },
  { key: "oils", match: /\b(oil|ghee)\b|(?<!\b(nut|peanut|almond|cashew|seed)\s)\bbutter\b/i, members: ["olive oil", "avocado oil", "butter"] },
  { key: "leafy greens", match: /\b(spinach|kale|chard|arugula|rocket|lettuce|romaine|collards?|bok choy|watercress|greens)\b/i, members: ["spinach", "kale", "chard", "arugula"] },
  { key: "cabbage family", match: /\b(cabbage|broccoli|cauliflower|brussels sprouts?|broccolini)\b/i, members: ["broccoli", "cauliflower", "cabbage"] },
  { key: "potatoes", match: /\b(potato(es)?|yams?)\b/i, members: ["potatoes", "sweet potatoes"] },
  { key: "root vegetables", match: /\b(carrots?|parsnips?|beets?|beetroot|turnips?|radish(es)?|celeriac)\b/i, members: ["carrots", "parsnips", "beets"] },
  // Garlic is not here on purpose: an onion is no garlic, and garlic has nothing like it (it goes to "Nothing similar").
  { key: "onions", match: /\b(onions?|shallots?|scallions?|leeks?|chives)\b/i, members: ["onion", "shallot", "scallions", "leek"] },
  { key: "tomatoes", match: /\btomato(es)?\b/i, members: ["tomatoes", "canned tomatoes", "cherry tomatoes"] },
  // "pepper" alone is the seasoning.
  { key: "peppers", match: /\b(bell peppers?|(red|green|yellow|orange|sweet|poblano|chil(l)?i) peppers?|peppers|jalapeños?|jalapenos?|chil(l)?ies|poblanos?)\b/i, members: ["bell pepper", "poblano pepper"] },
  { key: "squash", match: /\b(zucchini|courgettes?|squash|pumpkin|eggplants?|aubergines?|cucumbers?)\b/i, members: ["zucchini", "butternut squash", "eggplant"] },
  { key: "beans and peas", match: /\b(green beans?|peas?|edamame|snap peas?|snow peas?)\b/i, members: ["green beans", "peas"] },
  { key: "mushrooms", match: /\bmushrooms?\b/i, members: ["mushrooms"] },
  { key: "fresh herbs", match: /\b(parsley|cilantro|coriander leaves|basil|dill|mint)\b/i, members: ["parsley", "cilantro", "basil", "dill"] },
  // The woody herbs, usually dried in a home kitchen: one stands in for another, a soft fresh herb does not.
  { key: "dried herbs", match: /\b(oregano|thyme|rosemary|sage|tarragon|marjoram|italian seasoning)\b/i, members: ["thyme", "oregano", "rosemary"] },
  { key: "citrus", match: /\b(lemons?|limes?|oranges?|grapefruit)\b/i, members: ["lemon", "lime"] },
  { key: "pasta", match: /\b(pasta|spaghetti|penne|noodles?|macaroni|fusilli|orzo|linguine|fettuccine)\b/i, members: ["pasta", "noodles"] },
  { key: "bread", match: /\b(bread|toast|tortillas?|pitas?|buns?|bagels?|naan|rolls?)\b/i, members: ["bread", "tortillas", "pita"] },
  { key: "grains", match: /\b(rice|quinoa|barley|couscous|bulgur|farro|oats?|polenta|millet)\b/i, members: ["rice", "quinoa", "couscous", "bulgur"] },
  { key: "yogurt", match: /\b(yogh?urt|kefir|sour cream|cr[eè]me fra[iî]che)\b/i, members: ["plain yogurt", "Greek yogurt", "sour cream"] },
  { key: "milks", match: /\b(milk|cream|half[- ]and[- ]half)\b/i, members: ["milk", "oat milk", "soy milk"] },
  { key: "soft cheese", match: /\b(feta|goat cheese|ricotta|cottage cheese|cream cheese|mozzarella|halloumi|paneer)\b/i, members: ["feta", "mozzarella", "ricotta"] },
  { key: "hard cheese", match: /\b(parmesan|pecorino|cheddar|gruy[eè]re|gouda|swiss|manchego|cheese)\b/i, members: ["cheddar", "parmesan", "gouda"] },
  { key: "nuts", match: /\b(almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|peanuts?|pine nuts?)\b/i, members: ["almonds", "walnuts", "cashews", "peanuts"] },
  { key: "seeds", match: /\b(sesame|chia|flax|pumpkin seeds?|sunflower seeds?|hemp)\b/i, members: ["pumpkin seeds", "sunflower seeds", "sesame seeds"] },
];

// Names that carry a family word without being of that family.
const NOT_OF_FAMILY = /\b(powder|flakes?|sauce|paste|extract|peppercorns?)\b|\b(black|white|ground|cayenne|red)\s+pepper\b/i;

/** The family a food belongs to; null for a protein, a spice or anything the table does not know. */
export function familyOf(name: string): Family | null {
  if (proteinKind(name)) return null;
  if (NOT_OF_FAMILY.test(name)) return null;
  return FAMILIES.find((f) => f.match.test(name)) ?? null;
}

const STARCHY = /\b(rice|potato(es)?|pasta|spaghetti|noodles?|quinoa|couscous|bulgur|barley|bread|tortillas?)\b/i;

export interface SwapOption { name: string; atHome: boolean }
export const MAX_SWAP_OPTIONS = 4;

/** What a main can be built on with no protein food at all. */
export const NON_PROTEIN_OPTIONS = ["mushrooms", "potatoes", "beans", "lentils"] as const;

/**
 * The foods `ingredient` can be exchanged for, at-home ones first, at most four.
 * A protein is offered the other proteins at home, then foods a dish can be built
 * on without one. A food the table does not know gets none (the app then offers
 * only "Nothing similar"). `allowed` is the diet check.
 */
export function swapOptions(a: {
  ingredient: string;
  /** Every ingredient of the dish: a food already in it is not offered. */
  inDish: readonly string[];
  /** Every food marked at home (proteins and the rest). */
  atHome: readonly string[];
  home: readonly HomeProtein[];
  allowed: (food: string) => boolean;
}): { options: SwapOption[]; protein: boolean } {
  const taken = (food: string) => foodMatches(food, a.ingredient) || a.inDish.some((n) => foodMatches(food, n));
  const out: SwapOption[] = [];
  const add = (name: string, atHome: boolean) => {
    if (out.length >= MAX_SWAP_OPTIONS || taken(name) || !a.allowed(name)) return;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) return;
    out.push({ name, atHome });
  };
  const kind = proteinKind(a.ingredient);
  if (kind) {
    for (const p of a.home) if (p.key !== kind.key) add(p.name, true);
    // The ones they have come first. Potatoes are no stand-in in a dish that already has its starch.
    const hasStarch = a.inDish.some((n) => STARCHY.test(n));
    const plain = NON_PROTEIN_OPTIONS.filter((n) => !(hasStarch && n === "potatoes")).map((n) => ({ n, mine: a.atHome.find((h) => foodMatches(n, h)) }));
    for (const { mine } of plain) if (mine !== undefined) add(mine, true);
    for (const { n, mine } of plain) if (mine === undefined) add(n, false);
    return { options: out, protein: true };
  }
  const family = familyOf(a.ingredient);
  if (!family) return { options: [], protein: false };
  for (const h of a.atHome) if (familyOf(h)?.key === family.key) add(h, true);
  for (const m of family.members) add(m, false);
  return { options: out, protein: false };
}

/** True when the exchange is like for like: both foods of one family, neither a protein. */
export function plainSwap(from: string, to: string): boolean {
  const f = familyOf(from), t = familyOf(to);
  return f !== null && t !== null && f.key === t.key;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const singular = (w: string) => (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(oes|ses|shes|ches|xes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
const plural = (w: string) => (/[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(o|s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);
/** A phrase with its last word in both numbers: "russet potatoes" → "russet potatoes", "russet potato". */
function bothNumbers(phrase: string): string[] {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  const last = words.pop() ?? "";
  const one = singular(last);
  const head = words.length ? `${words.join(" ")} ` : "";
  return [...new Set([`${head}${last}`, `${head}${one}`, `${head}${plural(one)}`])];
}
/** The words a step or a title may use for the food: its whole name, then its last word, each in both numbers, longest first. */
function mentions(name: string): string[] {
  const whole = name.trim().toLowerCase();
  const last = whole.split(/\s+/).pop() ?? whole;
  return [...new Set([...bothNumbers(whole), ...bothNumbers(last)])].sort((x, y) => y.length - x.length);
}
const headOf = (name: string) => singular(name.trim().toLowerCase().split(/\s+/).pop() ?? "");

/**
 * The dish with `from` exchanged for `to`, by plain replacement: the ingredient
 * line (same amount), every step and the name. Numbers are NOT touched here; the
 * caller re-prices and re-checks the dish. null when `from` is not an ingredient.
 */
export function swapInRecipe(recipe: ClaraRecipe, from: string, to: string): ClaraRecipe | null {
  const at = recipe.ingredients.findIndex((i) => i.name.trim().toLowerCase() === from.trim().toLowerCase());
  if (at < 0) return null;
  const toLower = to.trim().toLowerCase();
  // One pass over every way the food can be written, longest first, so "russet potatoes" goes before "potato".
  const all = new RegExp(`\\b(${mentions(from).map(escapeRe).join("|")})\\b`, "gi");
  // The replacement takes the number of what it replaces: "Russet Potato Skillet" → "Sweet Potato Skillet", "each potato" → "each sweet potato".
  const toWords = toLower.split(/\s+/);
  const toLast = toWords.pop() ?? "";
  const toSingular = [...toWords, singular(toLast)].join(" ");
  const swapText = (text: string, cased: (s: string) => string) =>
    text.replace(all, (hit) => {
      const last = hit.toLowerCase().split(/\s+/).pop() ?? "";
      const one = singular(last) === last && plural(last) !== last && singular(toLast) !== toLast;
      return cased(one ? toSingular : toLower);
    });
  const out = {
    ...recipe,
    name: swapText(recipe.name, titleCase),
    ingredients: recipe.ingredients.map((i, k) => (k === at ? { ...i, name: toLower } : i)),
    steps: recipe.steps.map((s) => swapText(s, (x) => x)),
  };
  // The food must be gone from the name and every step, unless the new food is one of the same
  // kind by name ("brown rice" for "jasmine rice" keeps the word rice).
  if (headOf(from) !== headOf(to)) {
    const left = new RegExp(`\\b(${bothNumbers(headOf(from)).map(escapeRe).join("|")})\\b`, "i");
    if (left.test(out.name) || out.steps.some((st) => left.test(st))) return null;
  }
  return out;
}
