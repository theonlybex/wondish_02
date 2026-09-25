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

/**
 * Does the basket cover every ingredient this dish needs (staples free)?
 *
 * Both sides are normalised HERE rather than trusted to arrive normalised. The
 * function used to lowercase only the dish's ingredient name and test it against
 * the basket set as given, so a caller that passed catalog names unchanged —
 * "Large eggs", "Roma tomatoes" — matched nothing but staples, and the dish pool
 * silently collapsed to whatever could be built from oil and spices. The
 * production caller does lowercase (app/api/meal-plan/new-week/route.ts), so
 * this was never wrong in the app; it cost an afternoon of chasing a "breakfast
 * repeats four times" bug that existed only in a QA harness, which is exactly
 * how long it will cost the next person. A predicate that silently returns false
 * for correct input is worth one Set allocation.
 */
export function isCoveredByBasket(
  ingredientNames: string[],
  basket: Set<string>,
  staples: Set<string> = BASKET_STAPLES
): boolean {
  const have = new Set<string>();
  for (const b of basket) have.add(b.trim().toLowerCase());
  for (const raw of ingredientNames) {
    const n = raw.trim().toLowerCase();
    if (!have.has(n) && !staples.has(n)) return false;
  }
  return true;
}
