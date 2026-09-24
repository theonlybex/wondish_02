import { ingredientTokens } from "@/lib/basket-match";

// Curated "signature ingredients" per cuisine — the keys that unlock authentic
// dishes in that style (the lens model: a cuisine is a set of ingredients).
// Ingredients recur across cuisines on purpose (garlic, lime, ginger…); the
// pantry is the single source of "owned", so buying one checks it everywhere.

export const CUISINE_STAPLES: Record<string, string[]> = {
  Italian: ["olive oil", "garlic", "tomato", "basil", "parmesan", "pasta", "oregano", "onion"],
  Mexican: ["tortilla", "black beans", "cumin", "cilantro", "lime", "chili", "avocado", "onion"],
  Chinese: ["soy sauce", "ginger", "garlic", "sesame oil", "rice", "scallion", "chili", "rice vinegar"],
  Thai: ["fish sauce", "lime", "ginger", "chili", "lemongrass", "coconut milk", "cilantro", "rice"],
  Indian: ["cumin", "turmeric", "garam masala", "ginger", "garlic", "onion", "tomato", "yogurt"],
  Japanese: ["soy sauce", "rice", "miso", "ginger", "sesame oil", "nori", "scallion", "rice vinegar"],
  Mediterranean: ["olive oil", "garlic", "lemon", "tomato", "feta", "chickpea", "cucumber", "oregano"],
  American: ["potato", "cheddar", "chicken", "beef", "lettuce", "tomato", "onion", "bread"],
  French: ["butter", "garlic", "onion", "thyme", "cream", "dijon mustard", "parsley", "shallot"],
  Korean: ["soy sauce", "garlic", "ginger", "sesame oil", "gochujang", "rice", "scallion", "kimchi"],
  "Middle Eastern": ["olive oil", "garlic", "lemon", "cumin", "chickpea", "tahini", "parsley", "yogurt"],
};

// A cuisine is "ready to cook" once you have this fraction of its staples.
export const CUISINE_READY_THRESHOLD = 0.7;

export interface CuisineStaple {
  name: string;
  have: boolean;
  alsoIn: string[]; // other cuisines this ingredient unlocks
}
export interface CuisineChecklist {
  cuisine: string;
  staples: CuisineStaple[];
  have: number;
  total: number;
  ready: boolean;
}

// Which cuisines each staple ingredient appears in (for the "also unlocks…" hint).
function cuisinesByIngredient(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [cuisine, ings] of Object.entries(CUISINE_STAPLES)) {
    for (const ing of ings) {
      const k = ing.toLowerCase();
      const list = map.get(k) ?? [];
      list.push(cuisine);
      map.set(k, list);
    }
  }
  return map;
}

/**
 * Does the user own something that counts as this staple?
 *
 * The staples are bare generic words ("rice", "tomato", "olive oil") and a
 * pantry holds catalog names ("Basmati rice", "Roma tomatoes", "Extra virgin
 * olive oil"). The exact-equality check this replaces therefore never matched
 * anything: every one of the 11 cuisines read 0/8 for every user, forever,
 * including an account holding four kinds of rice and two kinds of chicken.
 * The existing tests passed only because they fed the generic names in as
 * "owned" — the lens was never exercised with real data.
 *
 * Matching is tolerant but not loose. The staple's tokens must be contained in
 * the owned name's tokens AND the two must share their head noun (the last
 * token), so "cherry tomatoes" satisfies "tomato" while "rice vinegar" does
 * NOT satisfy "rice" — a bottle of vinegar is not a bag of rice, and telling
 * someone their Chinese pantry is ready when they cannot make rice would be
 * the same class of lie in the other direction.
 */
const head = (tokens: Set<string>): string | null => {
  let last: string | null = null;
  for (const t of tokens) last = t;
  return last;
};

// Words naming a PART of an animal or plant rather than a different food.
// The head-noun rule alone gets "rice vinegar" right and "chicken breasts"
// wrong: in the first, "rice" modifies a different food; in the second,
// "breast" is a cut of the very thing being asked about. Someone holding
// boneless chicken breasts and chicken thighs owns chicken, and a lens telling
// them otherwise is the bug being fixed, not a nuance of it.
const CUT_WORDS = new Set([
  "breast", "thigh", "fillet", "filet", "loin", "tenderloin", "chop", "cutlet",
  "leg", "wing", "drumstick", "shank", "shoulder", "rib", "ribs", "mince",
  "steak", "roast", "strip", "strips", "piece", "pieces", "half", "halves",
  "floret", "stalk", "leaf", "kernel", "clove",
]);

export function ownsStaple(staple: string, ownedNames: readonly string[]): boolean {
  const want = ingredientTokens(staple);
  if (want.size === 0) return false;
  const wantHead = head(want);
  for (const owned of ownedNames) {
    const have = ingredientTokens(owned);
    if (have.size === 0) continue;
    if (![...want].every((t) => have.has(t))) continue;
    if (want.size === have.size) return true; // same thing, different wording
    if (wantHead && head(have) === wantHead) return true; // a variety of it
    const extra = [...have].filter((t) => !want.has(t));
    if (extra.length > 0 && extra.every((t) => CUT_WORDS.has(t))) return true; // a cut of it
  }
  return false;
}

/** Build the per-cuisine checklists against the user's owned ingredient names. */
export function buildCuisineChecklists(owned: Set<string> | readonly string[]): CuisineChecklist[] {
  const byIng = cuisinesByIngredient();
  const ownedNames = Array.from(owned);
  return Object.entries(CUISINE_STAPLES).map(([cuisine, ings]) => {
    const staples: CuisineStaple[] = ings.map((name) => {
      const k = name.toLowerCase();
      return { name, have: ownsStaple(name, ownedNames), alsoIn: (byIng.get(k) ?? []).filter((c) => c !== cuisine) };
    });
    const have = staples.filter((s) => s.have).length;
    return { cuisine, staples, have, total: staples.length, ready: have / staples.length >= CUISINE_READY_THRESHOLD };
  });
}
