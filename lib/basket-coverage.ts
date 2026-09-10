// A dish is "covered" by a basket when every one of its ingredients is either
// in the basket or a free staple. This is the eligibility test that turns the
// recipe library into a cache-first source for basket-constrained weeks — the
// same coverage rule pantry/cook-day uses, factored out for reuse.

// Includes the catalog spellings the alias remap folds recipe rows onto
// ("salt" → "Kosher salt", "ground black pepper" → "Black peppercorns").
export const BASKET_STAPLES = new Set([
  "salt", "kosher salt", "sea salt",
  "pepper", "black pepper", "black peppercorns",
  "water", "tap water", "boiling water",
]);

export function isCoveredByBasket(
  ingredientNames: string[],
  basket: Set<string>,
  staples: Set<string> = BASKET_STAPLES
): boolean {
  for (const raw of ingredientNames) {
    const n = raw.trim().toLowerCase();
    if (!basket.has(n) && !staples.has(n)) return false;
  }
  return true;
}
