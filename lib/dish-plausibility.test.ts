import { test } from "node:test";
import assert from "node:assert/strict";
import { dishProblem, phrasePromisesMissingFood, breakfastIsQuickEnough } from "./dish-plausibility";

// The catalog vocabulary, as lib/meal-plan.ts builds it from Ingredient.name.
const CATALOG = new Set([
  "bell", "pepper", "salmon", "chicken", "rice", "brown", "jasmine", "carrot",
  "broccoli", "lemon", "cinnamon", "bread", "grain", "whole", "egg", "oat", "garlic", "tomato",
]);

const dish = (over: Partial<Parameters<typeof dishProblem>[0]> = {}) => ({
  name: "Skillet Bowl",
  mealTypeName: "Dinner",
  prepMinutes: 10,
  cookMinutes: 20,
  ingredients: [{ name: "Boneless chicken breasts", quantity: 150, unit: "g" }, { name: "Jasmine rice", quantity: 0.75, unit: "cup" }],
  ...over,
});

test("a fit dish has no problem", () => {
  assert.equal(dishProblem(dish(), CATALOG), null);
});

// ---------------------------------------------------------------- rule 3a
// The defect that reached a real week: 7 of 25 dishes measured the user's
// bell peppers in teaspoons because a resolver read "salt and pepper".
test("a food measured as the seasoning inside its own name is rejected", () => {
  const d = dish({
    ingredients: [
      { name: "Boneless chicken breasts", quantity: 150, unit: "g" },
      { name: "Bell peppers", quantity: 0.5, unit: "teaspoon" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), "seasoning-quantity-on-food");
});

test("the same ingredient at a real portion is fine", () => {
  const d = dish({
    ingredients: [
      { name: "Boneless chicken breasts", quantity: 150, unit: "g" },
      { name: "Bell peppers", quantity: 90, unit: "g" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), null);
});

test("staples at seasoning size are correct, not a defect", () => {
  for (const ing of [
    { name: "Salt", quantity: 0.25, unit: "teaspoon" },
    { name: "Black pepper", quantity: 0.1, unit: "tsp" },
    { name: "Extra virgin olive oil", quantity: 1.5, unit: "tsp" },
    { name: "Dried thyme", quantity: 0.25, unit: "teaspoon" },
  ]) {
    assert.equal(dishProblem(dish({ ingredients: [ing, { name: "Jasmine rice", quantity: 1, unit: "cup" }] }), CATALOG), null, ing.name);
  }
});

test("a pantry item the staple list does not know is left alone without a category", () => {
  // No name collision with a staple and no category to lean on → not our call.
  const d = dish({ ingredients: [{ name: "Soy sauce", quantity: 1, unit: "tsp" }, { name: "Jasmine rice", quantity: 1, unit: "cup" }] });
  assert.equal(dishProblem(d, CATALOG), null);
});

test("real seasonings whose names contain a staple word are left alone", () => {
  // Measured against the live library: these four names account for 54 of the
  // 129 links the name-collision rule flags, and every one is correct as
  // written. Rejecting them would delete real dishes over a jar of chilli.
  for (const name of [
    "Crushed red pepper flakes",
    "lemon pepper seasoning blend",
    "salt free mexican seasoning blend",
    "salt-free citrus seasoning",
  ]) {
    const d = dish({ ingredients: [{ name, quantity: 0.25, unit: "teaspoon" }, { name: "Jasmine rice", quantity: 1, unit: "cup" }] });
    assert.equal(dishProblem(d, CATALOG), null, name);
  }
});

test("the library's small units for chopped produce are not a defect", () => {
  // A category-based rule ("produce in teaspoons is wrong") would have thrown
  // these out by the hundred. Chopped herbs and aromatics are measured this way.
  for (const ing of [
    { name: "Fresh cilantro", quantity: 1, unit: "tablespoon", category: "Produce" },
    { name: "Garlic", quantity: 0.5, unit: "teaspoon", category: "Produce" },
    { name: "Yellow onions", quantity: 0.5, unit: "tablespoon", category: "Produce" },
  ]) {
    const d = dish({ ingredients: [ing, { name: "Jasmine rice", quantity: 1, unit: "cup" }] });
    assert.equal(dishProblem(d, CATALOG), null, ing.name);
  }
});

// ------------------------------------------------------------------ salt
test("salt above one teaspoon per serving is rejected", () => {
  assert.equal(dishProblem(dish({ ingredients: [{ name: "Salt", quantity: 1.5, unit: "teaspoon" }] }), CATALOG), "oversalted");
  assert.equal(dishProblem(dish({ ingredients: [{ name: "Salt", quantity: 1, unit: "tablespoon" }] }), CATALOG), "oversalted");
  assert.equal(dishProblem(dish({ ingredients: [{ name: "Salt", quantity: 1, unit: "teaspoon" }, { name: "Jasmine rice", quantity: 1, unit: "cup" }] }), CATALOG), null);
});

// ------------------------------------------------------------- breakfast
test("a 40-minute roast is not breakfast, a 20-minute one is", () => {
  const slow = dish({ mealTypeName: "Breakfast", prepMinutes: 15, cookMinutes: 25 });
  assert.equal(dishProblem(slow, CATALOG), "breakfast-too-slow");
  assert.equal(breakfastIsQuickEnough({ ...slow, cookMinutes: 5 }), true);
  // Same dish in its own slot is fine — the rule is about the slot, not the dish.
  assert.equal(dishProblem({ ...slow, mealTypeName: "Dinner" }, CATALOG), null);
});

test("a dish with no timings is not guessed at", () => {
  assert.equal(dishProblem(dish({ mealTypeName: "Breakfast", prepMinutes: 0, cookMinutes: 0 }), CATALOG), null);
});

// ----------------------------------------------------------------- title
test("a title may not name food the dish does not list", () => {
  // Observed: "Salmon Fillet with Roasted Carrots and Brown Rice" built on jasmine rice.
  const d = dish({
    generated: true,
    name: "Salmon Fillet with Roasted Carrots and Brown Rice",
    ingredients: [
      { name: "Salmon fillets", quantity: 5, unit: "oz" },
      { name: "Carrots", quantity: 150, unit: "g" },
      { name: "Jasmine rice", quantity: 0.5, unit: "cup" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), "title-promises-missing-food");
  assert.equal(phrasePromisesMissingFood(d.name, d.ingredients.map((i) => i.name), CATALOG), "brown rice");
});

test("cooking words and formats never have to appear in the ingredients", () => {
  const d = dish({
    generated: true,
    name: "Grilled Chicken Skillet Bowl with Fresh Herbs",
    ingredients: [{ name: "Boneless chicken breasts", quantity: 150, unit: "g" }, { name: "Jasmine rice", quantity: 1, unit: "cup" }],
  });
  assert.equal(dishProblem(d, CATALOG), null);
});

test("without catalog vocabulary the title check is skipped, not faked", () => {
  const d = dish({ generated: true, name: "Salmon with Brown Rice", ingredients: [{ name: "Jasmine rice", quantity: 1, unit: "cup" }] });
  assert.equal(dishProblem(d, new Set()), null);
});

// A regression guard for the whole point of the module: the SAME predicate has
// to accept a Prisma-shaped row and a freshly generated recipe. If these two
// call sites ever diverge again, a dish rejected at generation can still be
// selected into a plan — which is exactly how a poisoned pool reached a user.
test("the predicate is shaped for stored rows, not just generated ones", () => {
  const storedRow = {
    name: "Ground Beef with Carrots and Jasmine Rice",
    mealTypeName: "Breakfast",
    prepMinutes: 13,
    cookMinutes: 20,
    ingredients: [
      { name: "ground beef", quantity: 4, unit: "oz", category: "Meat" },
      { name: "Carrots", quantity: 0.75, unit: "cup", category: "Produce" },
      { name: "Bell peppers", quantity: 0.1, unit: "teaspoon", category: "Produce" },
      { name: "Jasmine rice", quantity: 0.5, unit: "cup", category: "Grains" },
    ],
  };
  // Breakfast rule fires first; fix the slot and the poisoned row still fails.
  assert.equal(dishProblem(storedRow, CATALOG), "breakfast-too-slow");
  assert.equal(dishProblem({ ...storedRow, mealTypeName: "Dinner" }, CATALOG), "seasoning-quantity-on-food");
});

test("the title rule applies to Clara's dishes, not to the curated library", () => {
  // Same row, same catalog: a human-edited library name is left alone, the
  // generated one is not. Evidence for the split is in PlausibleDish.generated.
  const librarySynonym = {
    name: "Beef & Broccoli",
    mealTypeName: "Dinner",
    ingredients: [{ name: "Sirloin steak", quantity: 5, unit: "oz" }, { name: "broccoli", quantity: 150, unit: "g" }],
  };
  const withBeefToken = new Set([...CATALOG, "beef", "sirloin", "steak"]);
  assert.equal(dishProblem(librarySynonym, withBeefToken), null);
  assert.equal(dishProblem({ ...librarySynonym, generated: true }, withBeefToken), "title-promises-missing-food");
});

test("a portion-variant suffix is not part of the title's promise", () => {
  // "Boiled Potatoes With Herbs , V1M- 2 medium potatoes" was rejected over the
  // token "2" from its own storage id.
  const d = {
    name: "Boiled Potatoes With Herbs , V1M- 2 medium potatoes",
    mealTypeName: "Dinner",
    generated: true,
    ingredients: [{ name: "Russet potatoes", quantity: 2, unit: "unit" }, { name: "Fresh rosemary", quantity: 1, unit: "tsp" }],
  };
  assert.equal(dishProblem(d, new Set([...CATALOG, "potato", "rosemary", "medium"])), null);
});
