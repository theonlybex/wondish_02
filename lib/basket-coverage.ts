// A dish is "covered" by a basket when every one of its ingredients is either
// in the basket or a free staple. This is the eligibility test that turns the
// recipe library into a cache-first source for basket-constrained weeks — the
// same coverage rule pantry/cook-day uses, factored out for reuse.

// Includes the catalog spellings the alias remap folds recipe rows onto
// ("salt" → "Kosher salt", "ground black pepper" → "Black peppercorns").
// Things a kitchen is assumed to already have. Two consequences, both
// intended: a dish may use them without the basket listing them, and
// What-to-buy never suggests purchasing them (lib/to-buy.ts STAPLE_NAMES).
//
// This list was salt/pepper/water only until 2026-09-24, and that was too
// narrow to cook with. A real 15-ingredient basket of meat, rice and
// vegetables rejected 14 of 20 everyday ingredients — every oil, every dried
// spice — so Clara could only write dishes from the literal basket plus
// seasoning. The observed result was a week of "Wild Rice" and
// "Ground Beef with Bell Peppers and Brown Rice": food you cannot cook,
// because nothing in the basket was a fat.
//
// The line drawn here: COOKING FATS and DRIED SEASONINGS are staples; fresh
// produce is not. Garlic, onions, lemons and fresh herbs stay out on purpose —
// they are real shopping items, and freeing them would both silence the
// grocery list and let plans assume food the user does not have.
export const BASKET_STAPLES = new Set([
  // Seasoning
  "salt", "kosher salt", "sea salt", "table salt",
  "pepper", "black pepper", "black peppercorns", "white pepper", "ground black pepper",
  "water", "tap water", "boiling water",
  // Cooking fats — without one of these almost no cooked dish can be written.
  "oil", "cooking oil", "olive oil", "extra virgin olive oil", "vegetable oil",
  "canola oil", "sunflower oil", "avocado oil", "cooking spray", "nonstick cooking spray",
  "butter", "unsalted butter",
  // Dried spices and herbs — the jars in the cupboard, not the fresh bunch.
  "garlic powder", "onion powder", "paprika", "smoked paprika",
  "cumin", "ground cumin", "chili powder", "cayenne", "cayenne pepper",
  "red pepper flakes", "crushed red pepper", "italian seasoning",
  "oregano", "dried oregano", "basil", "dried basil", "thyme", "dried thyme",
  "rosemary", "dried rosemary", "parsley", "dried parsley",
  "bay leaf", "bay leaves", "cinnamon", "ground cinnamon",
  "turmeric", "ground turmeric", "ground ginger", "curry powder",
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
