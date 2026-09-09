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

/** Build the per-cuisine checklists against the set of owned ingredient names (lowercased). */
export function buildCuisineChecklists(ownedLower: Set<string>): CuisineChecklist[] {
  const byIng = cuisinesByIngredient();
  return Object.entries(CUISINE_STAPLES).map(([cuisine, ings]) => {
    const staples: CuisineStaple[] = ings.map((name) => {
      const k = name.toLowerCase();
      return { name, have: ownedLower.has(k), alsoIn: (byIng.get(k) ?? []).filter((c) => c !== cuisine) };
    });
    const have = staples.filter((s) => s.have).length;
    return { cuisine, staples, have, total: staples.length, ready: have / staples.length >= CUISINE_READY_THRESHOLD };
  });
}
