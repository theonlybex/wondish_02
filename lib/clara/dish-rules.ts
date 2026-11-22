// The switches a person can turn off on how Clara builds a dish, and the rules
// they add in their own words ("How Clara cooks" in the app, piece D).
// Pure: no database, no model client.
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import type { KeptFoods } from "./kept-foods";

export interface DishRules {
  cookFromHome: boolean; // off: the at-home list is ignored
  onlyHomeProteins: boolean; // off: any protein may be used
  mainsOnProtein: boolean; // off: mains need no protein ingredient and no protein minimum
  sameProteinToday: boolean; // off: rotate freely
  sizeToCalories: boolean; // off: no calorie target per meal
  followMacroSplit: boolean; // off: no macro split
  steerByLevels: boolean; // off: week and day levels are ignored
  favourFavourites: boolean; // off: favourites are not lifted
  keepWeekVaried: boolean; // off: no "kind of dish today", no "different from the last days", repeats are not held back
  proteinFreeLunches: boolean; // off: with protein on track a lunch is never asked to go without meat, fish and eggs
}

const KEYS: readonly (keyof DishRules)[] = [
  "cookFromHome", "onlyHomeProteins", "mainsOnProtein", "sameProteinToday",
  "sizeToCalories", "followMacroSplit", "steerByLevels", "favourFavourites",
  "keepWeekVaried", "proteinFreeLunches",
];
export const DISH_RULE_KEYS: readonly (keyof DishRules)[] = KEYS;

export const DEFAULT_DISH_RULES: Readonly<DishRules> = Object.freeze({
  cookFromHome: true,
  onlyHomeProteins: true,
  mainsOnProtein: true,
  sameProteinToday: true,
  sizeToCalories: true,
  followMacroSplit: true,
  steerByLevels: true,
  favourFavourites: true,
  keepWeekVaried: true,
  proteinFreeLunches: true,
});

/** How each switch reads in the app: what it does when on, in the person's words. */
export const DISH_RULE_COPY: Readonly<Record<keyof DishRules, { title: string; detail: string }>> = {
  cookFromHome: { title: "Cook from what I have", detail: "Dishes are built from the foods you marked at home." },
  onlyHomeProteins: { title: "Only proteins I have", detail: "No meat, fish or other protein you did not mark at home, unless you ask for it by name." },
  mainsOnProtein: { title: "Build meals on protein", detail: "Lunch and dinner are built on a protein, unless your week shows you are getting enough. Off: a dish may have none." },
  sameProteinToday: { title: "Same protein through the day", detail: "What you open at lunch is used again at dinner." },
  sizeToCalories: { title: "Size dishes to my calories", detail: "Each dish is sized for its meal from your day's calories." },
  followMacroSplit: { title: "Follow my macro split", detail: "Dishes built on a protein aim for your split of protein, carbs and fat." },
  steerByLevels: { title: "Steer by my Numbers", detail: "Dishes favour what you have had little of and hold back what you have had a lot of. Your sodium limit applies either way." },
  favourFavourites: { title: "Favour my favourites", detail: "Your favourite foods come up more often." },
  keepWeekVaried: { title: "Keep my week varied", detail: "A different kind of dish each day, and no repeats of the last few days. Off: the same dish can come back often." },
  proteinFreeLunches: { title: "Protein-free lunches", detail: "When you are getting enough protein, some lunches have no meat, fish or eggs. Needs \"Build meals on protein\" on." },
};

/** A rule the person added in their own words. */
export interface UserRule { id: string; text: string; on: boolean }
export const MAX_USER_RULES = 15;
export const MAX_USER_RULE_CHARS = 120;

/** One line of plain text: no quotes, breaks or control characters, trimmed; null when nothing is left or it is too long. */
export function cleanRuleText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/["\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= MAX_USER_RULE_CHARS ? t : null;
}

/** The stored list: well-formed rules only, at most fifteen, ids unique. */
export function userRulesFrom(raw: unknown): UserRule[] {
  if (!Array.isArray(raw)) return [];
  const out: UserRule[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = cleanRuleText(o.text);
    const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : null;
    if (!text || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text, on: o.on !== false });
    if (out.length >= MAX_USER_RULES) break;
  }
  return out;
}

/** The whole stored value (Patient.claraRules): `{ switches, mine }`. Anything malformed is the default. */
export interface StoredRules { switches: DishRules; mine: UserRule[] }
export function storedRulesFrom(raw: unknown): StoredRules {
  const o = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { switches: dishRulesFrom(o.switches), mine: userRulesFrom(o.mine) };
}

const singularWord = (w: string) => (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(oes|ses|shes|ches|xes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
// Two spellings or two names of one food.
const SAME_WORD: Readonly<Record<string, string>> = { yoghurt: "yogurt", coriander: "cilantro", chilli: "chili", chille: "chili", chickpea: "garbanzo", prawn: "shrimp", aubergine: "eggplant", courgette: "zucchini", tomatoe: "tomato", potatoe: "potato" };
const wordsOf = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean)
    .map(singularWord).map((w) => SAME_WORD[w] ?? w);
// Every word a catalog food is named with: what "a food" means here. A rule is held in code only when it names one of these.
const FOOD_WORDS: ReadonlySet<string> = new Set(INGREDIENT_CATALOG.flatMap((g) => g.items.flatMap(wordsOf)));
// Catalog words that describe, cut or prepare a food but are not one ("baking", "smoked", "fillets",
// "gold"), kinds of food ("vegetable"), and the kitchen's essentials: "no oil" or "no salt" as a
// food ban would drop nearly every dish, so those stay an instruction to Clara.
const NOT_A_FOOD = new Set([
  "red", "green", "white", "yellow", "black", "brown", "wild", "sweet", "sour", "fresh", "ground", "whole", "large", "plain", "extra", "firm",
  "sliced", "shredded", "grated", "canned", "diced", "crushed", "heavy", "unsalted", "boneless", "smoked", "dried", "toasted", "rolled", "granulated",
  "baking", "soda", "virgin", "gold", "yukon", "russet", "roma", "napa", "cherry", "greek", "thai", "dijon", "kosher", "roja", "verde", "adobo",
  "all", "purpose", "in", "o", "bay", "leave", "leaf", "seed", "flake", "fillet", "breast", "thigh", "chop", "extract", "syrup", "vegetable",
  "oil", "salt", "water", "pepper", "sugar", "flour", "sauce", "paste", "powder", "seasoning", "broth", "stock",
]);
// A food word that, beside one of these, names a different food: "olives" is not olive oil, "rice"
// is not rice vinegar, "butter" is not peanut butter, "potatoes" are not sweet potatoes.
const OTHER_FOOD_BESIDE: Readonly<Record<string, readonly string[]>> = {
  olive: ["oil"],
  rice: ["vinegar", "noodle", "wine", "paper", "flour", "milk", "syrup"],
  egg: ["noodle"],
  butter: ["peanut", "almond", "cashew", "nut", "sunflower", "bean", "lettuce", "cocoa", "apple"],
  milk: ["coconut", "almond", "oat", "soy", "rice", "cashew"],
  potato: ["sweet"],
  bean: ["green", "sprout", "vanilla", "coffee"],
  cream: ["ice", "cheese", "coconut"],
  steak: ["tuna", "salmon", "cauliflower"],
  corn: ["starch", "syrup", "oil"],
  wine: ["vinegar"],
  apple: ["cider", "vinegar"],
  cocoa: ["butter"],
};
// Foods that are the rule's food under another name: parmesan is cheese, bacon is pork.
const KINDS_OF: Readonly<Record<string, readonly string[]>> = {
  cheese: ["cheddar", "parmesan", "parmigiano", "mozzarella", "feta", "ricotta", "gouda", "brie", "halloumi", "paneer", "gruyere", "provolone", "pecorino"],
  pork: ["bacon", "ham", "prosciutto", "pancetta", "chorizo"],
  beef: ["sirloin", "ribeye", "brisket"],
  onion: ["scallion"],
};

/**
 * The food a "no such food" rule names, when the rule is that simple and the food is one the app
 * knows: "no mushrooms", "never put cilantro in my dishes, please", "without pork", "I don't like
 * olives". Such a rule is held in code (a dish that uses the food is dropped); any other rule is an
 * instruction to Clara only, and is said to be. null for a list ("onions or garlic"), a kind of
 * food ("red meat", "dairy", "nuts"), an essential ("oil", "salt"), a word that only describes a
 * food ("smoked", "baking"), a rule with a time or an amount in it, anything about an allergy
 * (that belongs in the profile), and any word that is not a catalog food.
 */
export function ruleFood(text: string): string | null {
  const m = /^(?:please[,]?\s+)?(?:no(?: more)?|never(?: use| put| add| cook with| give me)?|don'?t(?: use| put| add| give me)|do not(?: use| put| add| give me)|without|avoid|skip(?: the)?|hold the|i (?:don'?t|do not|never) (?:eat|like)|i dislike|i hate|i can'?t stand)\s+(?:any\s+|the\s+)?(.+?)(?:\s+(?:in|on|with)\s+(?:my|any|the)\s+(?:dish|dishes|food|meal|meals))?$/i.exec(
    text.trim().replace(/[.!,]+$/g, "").replace(/[,]?\s+(?:please|ever again|ever|again|at all|anymore|any more|for me)$/i, "").replace(/[.!,]+$/g, "").trim(),
  );
  if (!m) return null;
  const food = m[1].trim().toLowerCase();
  if (/[^a-zà-ÿ\s-]/.test(food) || /\b(and|or|allerg\w*|intoleran\w*|this|next|today|tonight|week|month)\b/.test(food)) return null;
  const words = wordsOf(food);
  if (words.length === 0 || words.length > 3) return null;
  // Every word a catalog food's word, and at least one of them a food itself (not "red" or "ground").
  if (!words.every((w) => FOOD_WORDS.has(w)) || !words.some((w) => !NOT_A_FOOD.has(w))) return null;
  return food;
}

/**
 * A rule food against one ingredient: the ingredient is, or is made of, that food. Every word of
 * the food is in the ingredient's name (before any comma: "jasmine rice, dry"), in either number:
 * "salmon" is "salmon fillets", "chicken" is "boneless chicken breasts", "garlic" is "garlic
 * cloves", "mushrooms" is "cremini mushrooms". Not when the word beside it makes it another food
 * ("olives" is never "olive oil", "rice" is not "rice vinegar", "butter" is not "peanut butter"),
 * and a kind counts ("cheese" is "grated parmesan", "pork" is "bacon"). The first version asked
 * for the same last word and let "salmon fillets" through a "no salmon" rule (review, 2026-11-22).
 */
export function ruleFoodMatches(food: string, ingredientName: string): boolean {
  const want = wordsOf(food);
  const have = wordsOf(ingredientName.split(/[,(]/)[0]);
  if (want.length === 0 || have.length === 0) return false;
  if (want.length === 1 && (KINDS_OF[want[0]] ?? []).some((k) => have.includes(k))) return true;
  if (!want.every((w) => have.includes(w))) return false;
  return !want.some((w) => (OTHER_FOOD_BESIDE[w] ?? []).some((o) => have.includes(o) && !want.includes(o)));
}

/** Piece D's stored JSON. Not an object, an unknown key, or a non-boolean value: the default for that key. */
export function dishRulesFrom(raw: unknown): DishRules {
  const out: DishRules = { ...DEFAULT_DISH_RULES };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of KEYS) {
    const v = Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** cookFromHome off: proteinKeys, proteinNames and atHome emptied. favourFavourites off: favorites emptied. */
export function keptUnderRules(kept: KeptFoods, rules: DishRules): KeptFoods {
  return {
    proteinKeys: rules.cookFromHome ? kept.proteinKeys : [],
    proteinNames: rules.cookFromHome ? kept.proteinNames : [],
    atHome: rules.cookFromHome ? kept.atHome : [],
    favorites: rules.favourFavourites ? kept.favorites : [],
  };
}
