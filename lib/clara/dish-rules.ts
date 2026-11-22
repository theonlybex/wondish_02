// The switches a person can turn off on how Clara builds a dish, and the rules
// they add in their own words ("How Clara cooks" in the app, piece D).
// Pure: no database, no model client.
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
  mainsOnProtein: { title: "Build meals on protein when I need it", detail: "Lunch and dinner are built on a protein when you are behind on it." },
  sameProteinToday: { title: "Same protein through the day", detail: "What you open at lunch is used again at dinner." },
  sizeToCalories: { title: "Size dishes to my calories", detail: "Each dish is sized for its meal from your day's calories." },
  followMacroSplit: { title: "Follow my macro split", detail: "Dishes aim for your split of protein, carbs and fat." },
  steerByLevels: { title: "Steer by my Numbers", detail: "Dishes favour what you have had little of and hold back what you have had a lot of." },
  favourFavourites: { title: "Favour my favourites", detail: "Your favourite foods come up more often." },
  keepWeekVaried: { title: "Keep my week varied", detail: "A different kind of dish each day, and no repeats of the last few days." },
  proteinFreeLunches: { title: "Protein-free lunches", detail: "When you are getting enough protein, some lunches have no meat, fish or eggs." },
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

/**
 * The food a "no such food" rule names, when the rule is that simple: "no mushrooms", "never put
 * cilantro in my dishes", "without pork". Such a rule is held in code (a dish that uses the food is
 * dropped); any other rule is an instruction only. null for a rule that is not about one food.
 */
export function ruleFood(text: string): string | null {
  const m = /^(?:no|never(?: use| put| add| cook with| give me)?|don'?t(?: use| put| add| give me)|do not(?: use| put| add| give me)|without|i (?:don'?t|do not|never) eat|i hate|i can'?t stand)\s+(?:any\s+)?(.+?)(?:\s+(?:in|on|with)\s+(?:my|any|the)\s+(?:dish|dishes|food|meal|meals))?[.!]?$/i.exec(text.trim());
  if (!m) return null;
  const food = m[1].trim().toLowerCase();
  // One food, a few words, and not a sentence ("no cooking over 30 minutes" is not a food).
  if (food.split(/\s+/).length > 3 || /\d|\b(over|under|more|less|than|after|before|on|at|when|cooking|dishes|meals|days?|minutes?|hours?|weekdays?|spicy|fried|raw|cold|hot)\b/.test(food)) return null;
  return food;
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
