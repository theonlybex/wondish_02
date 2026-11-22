// What a person keeps at home and loves, and the one rule it drives: when they
// have marked meat or fish as at home, dishes stick to those and nothing else.
// Pure: no database, no model client.

// Animal word (singular) -> the kind it counts as.
const ANIMALS: Record<string, string> = {
  chicken: "chicken", turkey: "turkey", duck: "duck",
  beef: "beef", veal: "veal", pork: "pork", lamb: "lamb", mutton: "lamb", goat: "goat",
  venison: "venison", bison: "bison", bacon: "bacon", ham: "ham", sausage: "sausage",
  pepperoni: "pepperoni", salami: "salami", prosciutto: "prosciutto", chorizo: "chorizo",
  salmon: "salmon", tuna: "tuna", cod: "cod", tilapia: "tilapia", catfish: "catfish",
  trout: "trout", halibut: "halibut", haddock: "haddock", mackerel: "mackerel",
  sardine: "sardine", anchovy: "anchovy", herring: "herring", bass: "bass",
  snapper: "snapper", mahi: "mahi mahi", swordfish: "swordfish", pollock: "pollock",
  sole: "sole", flounder: "flounder", perch: "perch", walleye: "walleye", eel: "eel",
  shrimp: "shrimp", prawn: "shrimp", crab: "crab", lobster: "lobster", scallop: "scallop",
  clam: "clam", mussel: "mussel", oyster: "oyster", squid: "squid", calamari: "squid",
  octopus: "octopus",
};

// Steak cuts are beef, but only when no animal is named (tuna steak is tuna).
const BEEF_CUTS = new Set(["steak", "sirloin", "ribeye", "brisket", "flank", "chuck", "mignon"]);

const NOT_MEAT = /\b(broths?|stocks?|bouillons?|sauces?|seasonings?|flavou?r(s|ed)?|meatless|plant[- ]based)\b/;
const GROUND = new Set(["ground", "minced", "mince"]);
const GENERIC_PROTEIN = new Set(["meat", "fish", "seafood", "poultry", "steak"]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(ch|sh|x|o)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

function animalOf(word: string): string | null {
  return ANIMALS[word] ?? ANIMALS[singular(word)] ?? null;
}

function cutOf(word: string): boolean {
  return BEEF_CUTS.has(word) || BEEF_CUTS.has(singular(word));
}

function kindIn(tokens: string[]): string | null {
  for (const t of tokens) {
    const a = animalOf(t);
    if (a) return a;
  }
  return tokens.some(cutOf) ? "beef" : null;
}

/** "salmon", "ground beef", "chicken"… or null when the name is not a meat, fish or seafood. */
export function proteinKey(name: string): string | null {
  const lower = name.toLowerCase();
  if (NOT_MEAT.test(lower)) return null;
  const tokens = words(lower);
  const kind = kindIn(tokens);
  if (!kind) return null;
  return tokens.some((t) => GROUND.has(t)) ? `ground ${kind}` : kind;
}

export interface KeptFoods {
  /** proteinKey of each at-home food that has one, deduped. Empty = rule off. */
  proteinKeys: string[];
  /** At-home foods from the catalog's Proteins group, display names (meat, fish and tofu-type). */
  proteinNames: string[];
  /** At-home foods from every other group. */
  atHome: string[];
  favorites: string[];
}

export const NO_KEPT_FOODS: KeptFoods = Object.freeze({
  proteinKeys: [],
  proteinNames: [],
  atHome: [],
  favorites: [],
}) as KeptFoods;

export function splitKeptFoods(
  rows: readonly { name: string; groupKey: string; atHome: boolean; favorite: boolean }[],
): KeptFoods {
  const keys = new Set<string>();
  const out: KeptFoods = { proteinKeys: [], proteinNames: [], atHome: [], favorites: [] };
  for (const r of rows) {
    if (r.favorite) out.favorites.push(r.name);
    if (!r.atHome) continue;
    if (r.groupKey === "proteins") out.proteinNames.push(r.name);
    else out.atHome.push(r.name);
    const key = proteinKey(r.name);
    if (key) keys.add(key);
  }
  out.proteinKeys = [...keys];
  return out;
}

/** True when any name is a meat/fish/seafood whose key is not in kept.proteinKeys. Always false when proteinKeys is empty. */
export function breaksProteinRule(ingredientNames: readonly string[], kept: KeptFoods): boolean {
  if (kept.proteinKeys.length === 0) return false;
  return ingredientNames.some((n) => {
    const key = proteinKey(n);
    return key !== null && !kept.proteinKeys.includes(key);
  });
}

/** True when the request text names a meat, fish or seafood. */
export function requestNamesProtein(wants: string): boolean {
  const lower = wants.toLowerCase();
  if (/\b(meatless|plant[- ]based)\b/.test(lower)) return false;
  const tokens = words(lower);
  return tokens.some((t) => GENERIC_PROTEIN.has(t) || animalOf(t) !== null) || tokens.some(cutOf);
}

/** True when the rule applies to this ask: proteinKeys non-empty and (no wants, or wants names no protein). */
export function proteinRuleOn(kept: KeptFoods, wants: string | undefined): boolean {
  if (kept.proteinKeys.length === 0) return false;
  const text = wants?.trim();
  return !text || !requestNamesProtein(text);
}

// Words on the catalog side that describe a food without identifying it.
const DESCRIPTORS = new Set([
  "large", "small", "medium", "fresh", "frozen", "lean", "extra", "firm", "boneless",
  "skinless", "fillet", "plain", "raw", "whole", "organic", "baby", "dried", "canned",
]);

/** Does a recipe ingredient name mean this catalog food? Lowercase, singular tokens; descriptor words on the catalog side are ignored. */
export function foodMatches(catalogName: string, ingredientName: string): boolean {
  const ingredient = ingredientName.toLowerCase();
  if (NOT_MEAT.test(ingredient) && !NOT_MEAT.test(catalogName.toLowerCase())) return false;
  const catalog = words(catalogName).map(singular);
  if (catalog.length === 0) return false;
  const core = catalog.filter((t) => !DESCRIPTORS.has(t));
  const need = core.length > 0 ? core : catalog;
  const have = new Set(words(ingredient).map(singular));
  return need.every((t) => have.has(t));
}
