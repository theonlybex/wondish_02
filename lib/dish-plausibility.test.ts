import { test } from "node:test";
import assert from "node:assert/strict";
import { dishProblem, phrasePromisesMissingFood, breakfastIsQuickEnough, longestStepMinutes } from "./dish-plausibility";

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
  // Breakfast-typed, so it also has to look like breakfast — the fixture's
  // default ingredients are chicken and rice, which is the point of that rule.
  const noTimings = dish({
    mealTypeName: "Breakfast",
    prepMinutes: 0,
    cookMinutes: 0,
    ingredients: [{ name: "Large eggs", quantity: 2, unit: null }, { name: "Sliced bread", quantity: 1, unit: null }],
  });
  assert.equal(dishProblem(noTimings, CATALOG), null);
});

test("a plated dinner is not breakfast, however fast it cooks", () => {
  // "Baked Chicken Breast with Carrots and Jasmine Rice" cleared the 30-minute
  // ceiling at 25 minutes and was served at 8am — twice, in two QA weeks.
  const dinnerAt8am = dish({
    generated: true,
    name: "Baked Chicken Breast with Carrots and Jasmine Rice",
    mealTypeName: "Breakfast",
    prepMinutes: 5,
    cookMinutes: 20,
    ingredients: [
      { name: "Boneless chicken breasts", quantity: 120, unit: "g" },
      { name: "carrots", quantity: 80, unit: "g" },
      { name: "Jasmine rice", quantity: 60, unit: "g" },
    ],
  });
  assert.equal(dishProblem(dinnerAt8am, CATALOG), "not-breakfast-food");

  // A savoury breakfast still passes: one recognisable breakfast food is enough.
  const savoury = {
    ...dinnerAt8am,
    name: "Egg and Spinach Hash",
    ingredients: [
      { name: "Large eggs", quantity: 2, unit: null },
      { name: "spinach", quantity: 60, unit: "g" },
      { name: "Sliced bread", quantity: 1, unit: null },
    ],
  };
  assert.equal(dishProblem(savoury, CATALOG), null);
  // Only the breakfast slot, and only Clara's dishes — a curated library row
  // was put in that slot by a person.
  assert.equal(dishProblem({ ...dinnerAt8am, mealTypeName: "Dinner" }, CATALOG), null);
  assert.equal(dishProblem({ ...dinnerAt8am, generated: false }, CATALOG), null);
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
    name: "Grilled Chicken Skillet Bowl",
    ingredients: [{ name: "Boneless chicken breasts", quantity: 150, unit: "g" }, { name: "Jasmine rice", quantity: 1, unit: "cup" }],
  });
  assert.equal(dishProblem(d, CATALOG), null);
});

test("a generic \"with herbs\" still promises that SOME herb exists", () => {
  // Three dishes in one QA week were titled or described "with herbs" while
  // their only seasonings were salt and pepper. No specific herb is demanded —
  // any one satisfies it — but "none at all" is not a herb.
  const noHerb = dish({
    generated: true,
    name: "Zucchini and Tomato Bake with Herbs",
    ingredients: [
      { name: "zucchini", quantity: 200, unit: "g" },
      { name: "Roma tomatoes", quantity: 120, unit: "g" },
      { name: "Extra virgin olive oil", quantity: 1.75, unit: "tbsp" },
      { name: "Salt", quantity: 0.25, unit: "tsp" },
    ],
  });
  assert.equal(dishProblem(noHerb, CATALOG), "title-promises-missing-food");

  const withThyme = dish({
    generated: true,
    name: "Roasted Broccoli with Olive Oil and Herbs",
    ingredients: [
      { name: "broccoli", quantity: 200, unit: "g" },
      { name: "Extra virgin olive oil", quantity: 2, unit: "tsp" },
      { name: "dried thyme", quantity: 0.25, unit: "tsp" },
    ],
  });
  assert.equal(dishProblem(withThyme, CATALOG), null);
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

// ── Steps that need a fat, and steps that outlast the dish ──────────────────
// Both ran at generation only, so rows written earlier kept flowing into
// plans: 4 of 28 dishes in one week said "stir-fry" over four ingredients (one
// of them salt) and no fat, and four claimed a total shorter than a single one
// of their own steps.
test("a step that sears or stir-fries requires a listed fat", () => {
  const dry = dish({
    name: "Turkey Stir-Fry",
    steps: ["Heat a wok over high heat.", "Stir-fry cauliflower for 6-7 minutes until lightly charred."],
    ingredients: [
      { name: "Turkey breast", quantity: 160, unit: "g" },
      { name: "cauliflower", quantity: 120, unit: "g" },
      { name: "Salt", quantity: 0.25, unit: "tsp" },
    ],
  });
  assert.equal(dishProblem(dry, CATALOG), "cooks-without-listing-fat");

  const withOil = { ...dry, ingredients: [...dry.ingredients, { name: "Extra virgin olive oil", quantity: 1, unit: "tbsp" }] };
  assert.equal(dishProblem(withOil, CATALOG), null);

  // Nothing is fried, so no fat is required.
  const boiled = { ...dry, steps: ["Bring water to a boil.", "Poach for 12 minutes.", "Steam the rice."] };
  assert.equal(dishProblem(boiled, CATALOG), null);
});

test("no step may take longer than the dish's own stated total", () => {
  const d = dish({
    name: "Beef and Rice Bowl",
    prepMinutes: 10,
    cookMinutes: 25,
    steps: ["Cook brown rice according to package directions (about 45 minutes total).", "Brown the beef."],
    ingredients: [
      { name: "ground beef", quantity: 4, unit: "oz" },
      { name: "Brown rice", quantity: 60, unit: "g" },
      { name: "olive oil", quantity: 1, unit: "tsp" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), "step-outlasts-stated-time");
  // Honest timings pass, and a range is read at its top.
  assert.equal(dishProblem({ ...d, prepMinutes: 10, cookMinutes: 40 }, CATALOG), null);
  assert.equal(longestStepMinutes(["simmer for 35-40 minutes until tender"]), 40);
  assert.equal(longestStepMinutes(["braise for 1 hour"]), 60);
  assert.equal(longestStepMinutes(["season and serve"]), 0);
  // A dish with no timings claimed is not second-guessed.
  assert.equal(dishProblem({ ...d, prepMinutes: 0, cookMinutes: 0 }, CATALOG), null);
});

// ── The amounts have to be able to contain the macros ───────────────────────
test("declared macros may not fall below what the listed staples contain", () => {
  // Verbatim: 150 g of brown rice is ~117 g of carbohydrate; the dish declared
  // 48 g for the whole plate, and 535 kcal against ~1,075 kcal of ingredients.
  const understated = dish({
    generated: true,
    name: "Chicken Thighs with Brown Rice and Roasted Broccoli",
    prepMinutes: 15,
    cookMinutes: 35,
    macros: { carbs: 48, fat: 15 },
    ingredients: [
      { name: "chicken thighs", quantity: 200, unit: "g" },
      { name: "Brown rice", quantity: 150, unit: "g" },
      { name: "broccoli", quantity: 150, unit: "g" },
      { name: "olive oil", quantity: 1, unit: "tbsp" },
    ],
  });
  assert.equal(dishProblem(understated, CATALOG), "macros-contradict-amounts");

  // The same dish with an honest grain portion passes — this is the case that
  // proves the rule discriminates rather than just rejecting rice dishes.
  const honest = { ...understated, name: "Baked Chicken Breast with Carrots and Jasmine Rice", macros: { carbs: 44, fat: 6 }, steps: ["Bake the chicken for 20 minutes."], prepMinutes: 5, cookMinutes: 20, ingredients: [
    { name: "Boneless chicken breasts", quantity: 120, unit: "g" },
    { name: "carrots", quantity: 80, unit: "g" },
    { name: "jasmine rice", quantity: 60, unit: "g" },
  ] };
  assert.equal(dishProblem(honest, CATALOG), null);

  // Library rows are not argued with: their macro columns are measured data.
  assert.equal(dishProblem({ ...understated, generated: false }, CATALOG), null);
});

test("the salt cap scales with the size of the dish", () => {
  // A 396 kcal breakfast of four ingredients carried exactly 1 tsp — ~2,325 mg
  // of sodium, a whole day's guideline before 9am — and passed a flat cap.
  const small = dish({
    calories: 396,
    ingredients: [
      { name: "Turkey breast", quantity: 160, unit: "g" },
      { name: "Salt", quantity: 1, unit: "teaspoon" },
    ],
  });
  assert.equal(dishProblem(small, CATALOG), "oversalted");
  assert.equal(dishProblem({ ...small, ingredients: [small.ingredients[0], { name: "Salt", quantity: 0.5, unit: "teaspoon" }] }, CATALOG), null);

  // A full plate still gets the teaspoon.
  const large = { ...small, calories: 650 };
  assert.equal(dishProblem(large, CATALOG), null);
  assert.equal(dishProblem({ ...large, ingredients: [large.ingredients[0], { name: "Salt", quantity: 1.5, unit: "teaspoon" }] }, CATALOG), "oversalted");

  // Unknown calories keep the old behaviour rather than guessing small.
  assert.equal(dishProblem({ ...small, calories: null }, CATALOG), null);
});

test("a bare accented \"sauté\" is caught — \\b after é is never a word boundary", () => {
  // /saut[ée]\b/ is false for "sauté the onions", u flag or not, so the
  // commonest phrasing escaped the fat check entirely.
  const d = dish({
    name: "Beef Patty with Carrots",
    steps: ["Form the patty.", "In the same skillet, sauté carrots over medium heat for 4 minutes."],
    ingredients: [
      { name: "ground beef", quantity: 4, unit: "oz" },
      { name: "carrots", quantity: 80, unit: "g" },
      { name: "Salt", quantity: 0.3, unit: "tsp" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), "cooks-without-listing-fat");
  // And the accented past participle, and the plain spelling.
  for (const step of ["Sautéed until golden.", "Saute the onions.", "Sauté the garlic."]) {
    assert.equal(dishProblem({ ...d, steps: [step] }, CATALOG), "cooks-without-listing-fat", step);
  }
});

test("a bare count prices — the unit-shaped hole, not an ingredient-shaped one", () => {
  // QA's correlation was total: every dish in a fresh week with a unitless row
  // was wrong, every dish without one was exact. The worst declared 432 kcal
  // and 24 g of fat over food that is ~615 kcal and ~42 g, including 243 kcal
  // of poured olive oil, because "Sliced bread 2" could not be priced and the
  // dish therefore kept the model's numbers with no upper bound at all.
  const d = dish({
    generated: true,
    name: "Salmon and Spinach on Toasted Bread",
    prepMinutes: 5,
    cookMinutes: 12,
    steps: ["Toast the bread.", "Pan-sear the salmon in the oil."],
    calories: 432,
    macros: { protein: 28, carbs: 26, fat: 24 },
    ingredients: [
      { name: "Salmon fillets", quantity: 100, unit: "g" },
      { name: "Sliced bread", quantity: 2, unit: null },
      { name: "spinach", quantity: 60, unit: "g" },
      { name: "Extra virgin olive oil", quantity: 2, unit: "tablespoon" },
    ],
  });
  assert.equal(dishProblem(d, CATALOG), "macros-contradict-amounts");

  // Priced honestly, the same dish passes.
  const honest = { ...d, calories: 615, macros: { protein: 27, carbs: 33, fat: 42 } };
  assert.equal(dishProblem(honest, CATALOG), null);
});
