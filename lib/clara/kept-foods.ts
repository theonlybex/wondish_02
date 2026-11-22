// What a person keeps at home and loves, and the one rule it drives: when they
// have marked meat or fish as at home, dishes stick to those and nothing else.
// Pure: no database, no model client.
import { INGREDIENT_CATALOG } from "../ingredient-catalog";
import { evaluateDishAgainstProfile, hasAnyBan, type DietMatchers } from "../diet-match";

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
  codfish: "cod", grouper: "grouper", monkfish: "monkfish", crayfish: "crayfish", crawfish: "crayfish",
  rabbit: "rabbit", goose: "goose", quail: "quail", oxtail: "oxtail", rib: "ribs",
  hotdog: "hot dog", bratwurst: "bratwurst", kielbasa: "kielbasa", pancetta: "pancetta",
  meatball: "meat",
  hamburger: "beef", pastrami: "pastrami", frankfurter: "frankfurter",
  gammon: "gammon", lardon: "lardons", hake: "hake", plaice: "plaice", bream: "bream",
  langoustine: "langoustine", liver: "liver", lox: "salmon",
};

// An animal word directly followed by one of these (an optional "'s" between) names dairy, eggs, a
// plant or bread, not the animal: "goat cheese", "quail eggs", "oyster mushrooms", "crab apples",
// "lamb's lettuce", "hamburger buns". Only the following word counts, so "bacon and eggs" and
// "chicken and egg fried rice" keep their meat. Cured and processed meats are never excused, so
// "bacon egg sandwich" is still bacon.
const DAIRY_OR_PLANT_AFTER = new Set([
  "cheese", "milk", "egg", "mushroom", "apple", "lettuce", "yogurt", "yoghurt", "butter", "cream", "ghee", "kefir",
]);
const BREAD_AFTER = new Set(["bun", "roll"]);
const PROCESSED = new Set([
  "bacon", "ham", "sausage", "pepperoni", "salami", "prosciutto", "chorizo", "pancetta",
  "bratwurst", "kielbasa", "hotdog", "pastrami", "frankfurter", "gammon", "lardon",
]);

// Generic words stand for a kind of their own: never a kept key unless marked that exact way.
const GENERIC_KINDS: Record<string, string> = { meat: "meat", fish: "fish", seafood: "seafood", poultry: "poultry" };

// Steak cuts are beef, but only when no animal is named (tuna steak is tuna).
const BEEF_CUTS = new Set(["steak", "sirloin", "ribeye", "brisket", "flank", "chuck", "mignon"]);

// Plant-based and imitation products are not the animal they copy.
const PLANT_BASED = /\b(meatless|meat[- ]free|plant[- ]based|vegan|vegetarian|veggie|imitation|substitutes?|mock|faux)\b/;
const NOT_MEAT = new RegExp(
  `\\b(broths?|stocks?|bouillons?|sauces?|seasonings?|flavou?r(s|ed)?)\\b|${PLANT_BASED.source}`,
);
const GROUND = new Set(["ground", "minced", "mince"]);
const GENERIC_PROTEIN = new Set(["meat", "fish", "seafood", "poultry", "steak"]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/\bhot[ -]dogs?\b/g, "hotdog").split(/[^a-z]+/).filter(Boolean);
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
  if (tokens.some(cutOf)) return "beef";
  for (const t of tokens) {
    const g = GENERIC_KINDS[t] ?? GENERIC_KINDS[singular(t)];
    if (g) return g;
  }
  return null;
}

/** Drops animal words that are really dairy, eggs, a plant or bread ("goat cheese", "celery ribs"). */
function withoutNonMeatAnimals(tokens: string[]): string[] {
  return tokens.filter((t, i) => {
    if (animalOf(t) === null) return true;
    const base = singular(t);
    if (base === "rib" && i > 0 && singular(tokens[i - 1]) === "celery") return false;
    let j = i + 1;
    if (tokens[j] === "s") j += 1; // "lamb's lettuce"
    const next = tokens[j] === undefined ? undefined : singular(tokens[j]);
    if (next === undefined) return true;
    if (BREAD_AFTER.has(next) && base === "hamburger") return false;
    return PROCESSED.has(base) || !DAIRY_OR_PLANT_AFTER.has(next);
  });
}

/** "salmon", "ground beef", "chicken"… or null when the name is not a meat, fish or seafood. */
export function proteinKey(name: string): string | null {
  const lower = name.toLowerCase();
  if (NOT_MEAT.test(lower)) return null;
  const tokens = words(lower);
  const kind = kindIn(withoutNonMeatAnimals(tokens));
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
  if (PLANT_BASED.test(lower)) return false;
  const tokens = withoutNonMeatAnimals(words(lower));
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

export interface CatalogRow { id: string; name: string; groupKey: string; groupTitle: string; atHome: boolean; favorite: boolean }

/** Pure: catalog x marks, minus foods the matchers ban (names and stored allergen groups). Catalog order kept. */
export function visibleRows(args: {
  idByName: Map<string, string>;
  groupsById: Map<string, string[]>;
  matchers: DietMatchers;
  atHomeIds: ReadonlySet<string>;
  likedIds: ReadonlySet<string>;
}): CatalogRow[] {
  const { idByName, groupsById, matchers, atHomeIds, likedIds } = args;
  const hasBans = hasAnyBan(matchers);
  const seen = new Set<string>();
  const rows: CatalogRow[] = [];
  for (const cat of INGREDIENT_CATALOG) {
    for (const name of cat.items) {
      const id = idByName.get(name);
      if (!id || seen.has(name)) continue;
      if (hasBans && !evaluateDishAgainstProfile([name], matchers, [groupsById.get(id) ?? []]).passed) continue;
      seen.add(name);
      rows.push({ id, name, groupKey: cat.key, groupTitle: cat.title, atHome: atHomeIds.has(id), favorite: likedIds.has(id) });
    }
  }
  return rows;
}
