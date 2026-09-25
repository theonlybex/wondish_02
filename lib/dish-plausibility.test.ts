import { test } from "node:test";
import assert from "node:assert/strict";
import { dishProblem, phrasePromisesMissingFood, breakfastIsQuickEnough, longestStepMinutes, truthfulDishName, clampAddedSalt, SEASONING_SALT_TSP, SEASONING_SALT_TSP_SMALL_DISH, clampCookingFat, breakfastIsBuiltOnBreakfastFood, snackIsQuickEnough, statedOrImpliedMinutes, nameWithoutFalseMethod, dishStyleMissingIngredient, fatStatedInSteps, measurableAmount, rawProteinNeverCooked, categoryWithNoMember, breakfastStarchWithSavouryProtein, snackIsSmallEnough } from "./dish-plausibility";

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
    macros: { protein: 40, carbs: 48, fat: 15 },
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
  const honest = { ...understated, name: "Baked Chicken Breast with Carrots and Jasmine Rice", macros: { protein: 30, carbs: 44, fat: 6 }, steps: ["Bake the chicken for 20 minutes."], prepMinutes: 5, cookMinutes: 20, ingredients: [
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

test("a dish with a missing macro is refused — a null lands in the ring as a zero", () => {
  const noProtein = dish({
    calories: 102,
    macros: { protein: null, carbs: 1, fat: 7 },
    ingredients: [{ name: "Large eggs", quantity: 1, unit: null }],
  });
  assert.equal(dishProblem(noProtein, CATALOG), "missing-macros");
  // Complete macros pass.
  assert.equal(
    dishProblem({ ...noProtein, macros: { protein: 6, carbs: 1, fat: 7 } }, CATALOG),
    null
  );
  // And a caller that does not supply macros at all is not second-guessed.
  assert.equal(dishProblem({ ...noProtein, macros: null }, CATALOG), null);
});

// truthfulDishName — the rename that returns a prose-rejected dish to the pool.
// Every case here is a real row from the live catalog.
test("truthfulDishName names a dish after its own ingredients, anchor first", () => {
  assert.equal(
    truthfulDishName(["Spinach", "Feta cheese", "Plain Greek yogurt", "Large eggs"], CATALOG),
    "Large Eggs with Feta Cheese and Plain Greek Yogurt"
  );
});

test("truthfulDishName never names a dish after a seasoning — but a bell pepper is a vegetable", () => {
  // The conflation this module exists to catch, reappearing in the namer.
  assert.equal(
    truthfulDishName(["Sea salt", "Black peppercorns", "Extra virgin olive oil", "Bell peppers", "Brown rice"], CATALOG),
    "Bell Peppers with Brown Rice"
  );
  // A nut butter IS a food; plain butter is not.
  assert.equal(truthfulDishName(["Unsalted butter", "Almond butter", "Bananas"], CATALOG), "Almond Butter with Bananas");
});

test("truthfulDishName refuses rather than inventing when nothing is nameable", () => {
  assert.equal(truthfulDishName(["Sea salt", "Water", "Coconut oil"], CATALOG), null);
});

// clampAddedSalt — a per-dish ceiling cannot see a day. Every dish in a
// measured week was under MAX_SALT_TSP and the week was over the 2,300 mg
// guideline on 6 days of 7, so the amount is clamped rather than the dish
// refused.
test("clampAddedSalt brings a legal-but-heavy amount down to a seasoning", () => {
  const { ingredients, changed } = clampAddedSalt(
    [{ name: "Chicken thighs", quantity: 150, unit: "g" }, { name: "Salt", quantity: 0.5, unit: "teaspoon" }],
    620
  );
  assert.equal(changed, true);
  assert.deepEqual(ingredients[1], { name: "Salt", quantity: SEASONING_SALT_TSP, unit: "teaspoon" });
  assert.deepEqual(ingredients[0], { name: "Chicken thighs", quantity: 150, unit: "g" });
});

test("clampAddedSalt holds a small dish to half the allowance", () => {
  const { ingredients } = clampAddedSalt([{ name: "Sea salt", quantity: 0.25, unit: "tsp" }], 210);
  assert.equal(ingredients[0].quantity, SEASONING_SALT_TSP_SMALL_DISH);
});

test("clampAddedSalt leaves an already-light dish exactly as it was", () => {
  const rows = [{ name: "Salt", quantity: 0.125, unit: "teaspoon" }, { name: "Salt", quantity: 1, unit: "pinch" }];
  const { changed } = clampAddedSalt(rows, 300);
  assert.equal(changed, false);
});

test("clampAddedSalt converts a tablespoon before judging it", () => {
  // 1/8 tbsp is 0.375 tsp — over the cap, though the number itself is small.
  const { ingredients, changed } = clampAddedSalt([{ name: "Salt", quantity: 0.125, unit: "tablespoon" }], 600);
  assert.equal(changed, true);
  assert.equal(ingredients[0].unit, "teaspoon");
  assert.equal(ingredients[0].quantity, SEASONING_SALT_TSP);
});

// clampCookingFat — narrow on purpose. Added oil is 59% of all fat in the
// generated catalog, but 543 of 1,014 rows have step text that AGREES with the
// row, so those recipes really do use that much and the row cannot be rewritten
// without the card contradicting itself.
test("clampCookingFat leaves the dish alone when the steps agree with the row", () => {
  const rows = [{ name: "Extra virgin olive oil", quantity: 1.5, unit: "tablespoon" }];
  const steps = ["Toss the vegetables with 1.5 tablespoons extra virgin olive oil and roast."];
  assert.equal(clampCookingFat(rows, steps, 620).changed, false);
});

test("clampCookingFat clamps to the budget when the steps name no amount", () => {
  const rows = [{ name: "Extra virgin olive oil", quantity: 1.5, unit: "tablespoon" }];
  const steps = ["Heat a little olive oil and sauté the onions."]; // no amount
  const { ingredients, changed } = clampCookingFat(rows, steps, 620);
  assert.equal(changed, true);
  // 1.5 tbsp is ~20 g; the budget is 14 g, so it scales to ~1 tbsp.
  assert.equal(ingredients[0].unit, "tablespoon");
  assert.ok(ingredients[0].quantity <= 1.05, `expected ~1 tbsp, got ${ingredients[0].quantity}`);
});

test("clampCookingFat clamps to what the steps say when the row over-declares", () => {
  const rows = [{ name: "Extra virgin olive oil", quantity: 2, unit: "tablespoon" }];
  const steps = ["Heat 1 tablespoon olive oil in a skillet.", "Serve."];
  const { ingredients, changed } = clampCookingFat(rows, steps, 700);
  assert.equal(changed, true);
  assert.ok(ingredients[0].quantity <= 1.05, `expected ~1 tbsp, got ${ingredients[0].quantity}`);
});

test("clampCookingFat keeps the ratio between two fats and each row's unit", () => {
  const rows = [
    { name: "Olive oil", quantity: 2, unit: "teaspoon" },
    { name: "Unsalted butter", quantity: 10, unit: "g" },
    { name: "Boneless chicken breasts", quantity: 150, unit: "g" },
  ];
  const { ingredients, changed } = clampCookingFat(rows, ["Sauté in oil and butter."], 300);
  assert.equal(changed, true);
  // ~9.4 g oil + 10 g butter = 19.4 g against a 5 g small-dish budget.
  assert.equal(ingredients[0].unit, "teaspoon");
  assert.equal(ingredients[1].unit, "g");
  assert.equal(ingredients[2].quantity, 150, "a non-fat row is never touched");
  // Both fats come down, and each lands on an amount its own unit can express —
  // spoons on an eighth, grams whole. Rounding to something measurable means the
  // two no longer scale by an identical factor, which is the right trade: a
  // 0.37-tablespoon row is exact and unusable.
  assert.ok(ingredients[0].quantity! < 2, `oil should come down, got ${ingredients[0].quantity}`);
  assert.ok(ingredients[1].quantity! < 10, `butter should come down, got ${ingredients[1].quantity}`);
  const spoons = ingredients[0].quantity! * 8;
  assert.ok(Math.abs(spoons - Math.round(spoons)) < 1e-9, `${ingredients[0].quantity} tsp is not an eighth`);
});

test("clampCookingFat is a no-op on a dish with no fat at all", () => {
  const rows = [{ name: "Rolled oats", quantity: 40, unit: "g" }];
  assert.equal(clampCookingFat(rows, ["Simmer the oats."], 300).changed, false);
});

// The breakfast-food rule asks whether a breakfast food is PRESENT, which is a
// different question from what the dish is built on. QA reported "Oatmeal with
// Ground Beef", "Rolled Oats with Ground Beef and Carrots" and "Oatmeal with
// Chicken and Zucchini" in three consecutive cycles, each passing the letter.
const bfast = (name: string, ings: string[], generated = true) => ({
  name, mealTypeName: "Breakfast", generated,
  ingredients: ings.map((n) => ({ name: n })),
}) as never;

test("a dinner protein at breakfast is refused even when oats are in the bowl", () => {
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Oatmeal with Ground Beef and Spinach", ["Rolled oats", "ground beef", "spinach"])), false);
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Salmon Fillet with Roasted Carrots and Toast", ["Salmon fillets", "carrots", "Sliced bread"])), false);
});

test("a breakfast protein makes the dish a breakfast whatever else is in it", () => {
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Large Eggs with Spinach and Bacon", ["Large eggs", "spinach", "bacon"])), true);
  // Smoked salmon on toast IS a breakfast; a salmon fillet with rice is not.
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Smoked Salmon with Sliced Bread", ["smoked salmon", "Sliced bread"])), true);
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Plain Greek Yogurt with Blueberries", ["Plain Greek yogurt", "blueberries"])), true);
});

test("the breakfast protein rule never touches a curated row or another slot", () => {
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Oatmeal with Ground Beef", ["Rolled oats", "ground beef"], false)), true);
  const atDinner = { name: "Ground Beef with Rice", mealTypeName: "Dinner", generated: true, ingredients: [{ name: "ground beef" }] } as never;
  assert.equal(breakfastIsBuiltOnBreakfastFood(atDinner), true);
});

test("clampCookingFat reaches a fixpoint — clamping twice changes nothing", () => {
  const rows = [{ name: "Extra virgin olive oil", quantity: 1.5, unit: "tablespoon" }];
  const steps = ["Sauté in olive oil."]; // silent on the amount
  const once = clampCookingFat(rows, steps, 620);
  assert.equal(once.changed, true);
  const twice = clampCookingFat(once.ingredients, steps, 620);
  assert.equal(twice.changed, false, `re-clamped to ${twice.ingredients[0].quantity}`);
});

// The timing ceilings asked two fields and nothing else, so a row with no
// prepTime/cookTime passed both unconditionally. 1,083 public rows are in that
// state and 764 of them state a time in their own steps.
test("a dish with no timings on file is judged by its steps, not waved through", () => {
  const slow = (mealTypeName: string) =>
    ({
      name: "Baked Chicken With Vegetables", mealTypeName,
      prepMinutes: null, cookMinutes: null,
      steps: ["Preheat the oven.", "Bake for 35 minutes until cooked through."],
      ingredients: [{ name: "Boneless chicken breasts" }],
    }) as never;
  assert.equal(snackIsQuickEnough(slow("Snack")), false);
  assert.equal(breakfastIsQuickEnough(slow("Breakfast")), false);
});

test("the steps fall back to the LONGEST step, so overlapping steps do not over-count", () => {
  // Three 8-minute steps sum to 24 and would fail a 20-minute snack ceiling,
  // but steps overlap ("while the rice cooks") — the longest alone is the only
  // safe lower bound.
  const quick = {
    name: "Egg and Tomato Toast", mealTypeName: "Snack",
    prepMinutes: null, cookMinutes: null,
    steps: ["Toast the bread for 8 minutes.", "Fry the egg for 8 minutes.", "Warm the tomato for 8 minutes."],
    ingredients: [{ name: "Large eggs" }],
  } as never;
  assert.equal(statedOrImpliedMinutes(quick), 8);
  assert.equal(snackIsQuickEnough(quick), true);
});

test("stated timings still win over the steps when they exist", () => {
  const d = {
    name: "Something", mealTypeName: "Snack", prepMinutes: 5, cookMinutes: 10,
    steps: ["Simmer for 90 minutes."], ingredients: [{ name: "rice" }],
  } as never;
  assert.equal(statedOrImpliedMinutes(d), 15);
});

test("a name claiming a method the steps never use loses the method, not the dish", () => {
  const seared = ["Heat a skillet over medium-high.", "Sear the salmon 4 minutes a side."];
  assert.equal(
    nameWithoutFalseMethod("Grilled Salmon with Quinoa and Herbs", seared),
    "Salmon with Quinoa and Herbs"
  );
  // Both adjectives are checked, and only the false one goes.
  const roastedNotGrilled = ["Roast the vegetables in the oven at 200C.", "Sear the chicken in a pan."];
  assert.equal(
    nameWithoutFalseMethod("Grilled Chicken with Roasted Vegetables", roastedNotGrilled),
    "Chicken with Roasted Vegetables"
  );
});

test("an honest method name is left alone, and a name that is only a method is refused", () => {
  const grilled = ["Grill the salmon over high heat for 8 minutes."];
  assert.equal(nameWithoutFalseMethod("Grilled Salmon", grilled), null, "the steps do grill it");
  // Nothing survives removing the method, so there is no honest name to use.
  assert.equal(nameWithoutFalseMethod("Grilled", ["Sear it in a pan."]), null);
});

// The fifth instance of the plural trap, and the first caught before shipping:
// /\b(egg)\b/ does not match the catalog's "Large eggs", so a dish made of eggs
// and named for its eggs was refused for having no egg — 81 of them.
test("a style rule sees the catalog's own plural spellings", () => {
  const cases: [string, string[]][] = [
    ["Egg Scramble with Carrots", ["Large eggs", "carrots"]],
    ["Spinach Frittata", ["Large eggs", "spinach"]],
    ["Ground Beef Bolognese", ["Roma tomatoes", "ground beef"]],
    ["Hummus and Carrot Sticks", ["Garbanzo beans", "carrots"]],
    ["Guacamole with Tortilla", ["Avocados", "flour tortillas"]],
    ["Beef Chili", ["Black beans", "ground beef"]],
    ["Beef Stroganoff", ["Mushrooms", "ground beef"]],
    ["Chicken Caesar Salad", ["anchovies", "Boneless chicken breasts"]],
  ];
  for (const [name, ings] of cases) {
    assert.equal(
      dishStyleMissingIngredient(name, ings),
      null,
      `${name} has what it claims: ${ings.join(", ")}`
    );
  }
});

test("a style rule still catches a dish that really lacks what it claims", () => {
  assert.equal(dishStyleMissingIngredient("Oatmeal with Chicken", ["Boneless chicken breasts", "Brown rice"]), "oats");
  assert.equal(dishStyleMissingIngredient("Ground Beef Bolognese", ["ground beef", "Spaghetti"]), "tomato");
  assert.equal(dishStyleMissingIngredient("Vegetable Scramble", ["broccoli", "carrots"]), "egg");
  // A tofu scramble is a real dish and must not be refused for having no egg.
  assert.equal(dishStyleMissingIngredient("Tofu Scramble with Peppers", ["tofu", "Bell peppers"]), null);
});

test("a step's oil amount counts whether written 0.5, 1/2 or ½", () => {
  // Requiring a digit made "½ tablespoon" look like no amount at all, so the
  // clamp rewrote the row and left the card contradicting its own steps — the
  // exact harm it was written narrow to avoid. QA found it in two weeks.
  for (const written of ["0.5 tablespoon", "1/2 tablespoon", "½ tablespoon"]) {
    assert.equal(
      Math.round(fatStatedInSteps([`Lightly oil a baking dish with ${written} olive oil.`]) ?? 0),
      7,
      written
    );
  }
  const rows = [{ name: "Extra virgin olive oil", quantity: 0.5, unit: "tablespoon" }];
  const steps = ["Lightly oil a baking dish with ½ tablespoon olive oil.", "Drizzle the remaining oil over the top."];
  // The steps commit to what the row holds, so a small dish is NOT clamped below it.
  assert.equal(clampCookingFat(rows, steps, 164).changed, false);
});

test("a clamped amount is one a person can measure", () => {
  // QA read "0.37 tablespoon", "1.03 teaspoon" and "1.1 teaspoon" off the
  // rendered cards. Nobody owns a 0.37-tablespoon spoon.
  assert.equal(measurableAmount(0.37, "tablespoon"), 0.25, "rounds DOWN, so the clamp's ceiling still holds");
  assert.equal(measurableAmount(1.03, "teaspoon"), 1);
  assert.equal(measurableAmount(1.1, "teaspoon"), 1);
  assert.equal(measurableAmount(0.7, "tablespoon"), 0.625);
  assert.equal(measurableAmount(0.02, "teaspoon"), 0.125, "never rounded away to nothing");
  // Mass and volume round to whole units, not eighths.
  assert.equal(measurableAmount(8.4, "g"), 8);
  assert.equal(measurableAmount(0.4, "g"), 0.4);
});

test("the clamp leaves a spoonable number behind", () => {
  const { ingredients } = clampCookingFat(
    [{ name: "Extra virgin olive oil", quantity: 1.5, unit: "tablespoon" }],
    ["Sauté in olive oil."],
    620
  );
  const q = ingredients[0].quantity!;
  assert.ok(Math.abs(q * 8 - Math.round(q * 8)) < 1e-9, `${q} is not a measurable eighth`);
});

// ── The one rule here that is about safety rather than plausibility ──────────
//
// QA found "Oats with Salmon and Broccoli" in a live plan: 70 g of raw salmon
// fillet, and the only step touching the fish says to "pat the salmon fillet dry
// and flake it into bite-sized pieces with a fork". The oats are simmered, the
// broccoli steamed, the salmon served raw — and the card declares a 12-minute
// cook time, so nothing on screen warns anybody.
const rawDish = (name: string, ings: string[], steps: string[], generated = true) =>
  ({ name, mealTypeName: "Snack", generated, steps, ingredients: ings.map((n) => ({ name: n })) }) as never;

test("a raw fish the steps never cook is refused", () => {
  assert.equal(
    rawProteinNeverCooked(
      rawDish(
        "Oats with Salmon and Broccoli",
        ["Rolled oats", "Salmon fillets", "broccoli"],
        [
          "Measure 40 g of rolled oats.",
          "Bring to a boil and simmer for 5 minutes.",
          "Steam the broccoli for 4 minutes.",
          "Pat the salmon fillet dry and flake it into bite-sized pieces with a fork.",
          "Top the oats with the steamed broccoli and flaked salmon.",
        ]
      )
    ),
    true
  );
  // Never mentioned in the steps at all is worse, not better.
  assert.equal(
    rawProteinNeverCooked(rawDish("Chicken Bowl", ["Boneless chicken breasts", "Brown rice"], ["Cook the rice.", "Serve."])),
    true
  );
});

test("heat anywhere in a step that names the protein satisfies the rule", () => {
  for (const step of [
    "Add the salmon and simmer for 6 minutes until opaque.",
    "Sear the salmon 4 minutes a side.",
    "Bake the salmon at 200C for 12 minutes.",
    "Poach the salmon gently until cooked through.",
  ]) {
    assert.equal(
      rawProteinNeverCooked(rawDish("Salmon with Broccoli", ["Salmon fillets", "broccoli"], ["Prep the broccoli.", step])),
      false,
      step
    );
  }
});

test("food that arrives safe to eat is exempt, and so is a curated recipe", () => {
  assert.equal(rawProteinNeverCooked(rawDish("Smoked Salmon on Toast", ["smoked salmon", "Sliced bread"], ["Toast the bread.", "Top with the salmon."])), false);
  assert.equal(rawProteinNeverCooked(rawDish("Tuna Salad", ["Canned tuna", "celery"], ["Drain the tuna.", "Mix with the celery."])), false);
  assert.equal(rawProteinNeverCooked(rawDish("Chickpea Bowl", ["Garbanzo beans", "spinach"], ["Rinse the beans.", "Toss with spinach."])), false);
  // A raw egg in a dressing is a normal recipe, so eggs are not in the list.
  assert.equal(rawProteinNeverCooked(rawDish("Caesar Dressing", ["Large eggs", "parmesan"], ["Whisk the egg with the parmesan."])), false);
  // A person wrote the curated steps.
  assert.equal(rawProteinNeverCooked(rawDish("Salmon Plate", ["Salmon fillets"], ["Flake the salmon over the salad."], false)), false);
});

test("a protein cooked in a step that does not repeat its name still counts", () => {
  // Every one of these was flagged by an earlier version of the rule and is
  // perfectly cooked. They are the reason it is written on step ORDER and on
  // heat-as-instruction rather than on proximity.
  const cooked: [string, string[], string[]][] = [
    // Cooked in a later step that names the sheet, not the fish.
    ["Salmon Fillet with Roasted Carrots", ["Salmon fillets", "carrots"], [
      "Pat the salmon fillet dry and place it on the baking sheet among the vegetables.",
      "Return the baking sheet to the oven and roast for another 10 minutes until the salmon is opaque.",
    ]],
    // "and cook for" is an instruction, not an adjective.
    ["Ground Turkey and Carrot Hash", ["Ground turkey", "carrots"], [
      "Heat olive oil in a large skillet.",
      "Add ground turkey and cook for 5 minutes, breaking it apart until no pink remains.",
    ]],
    // Cooked under a derived name.
    ["Ground Beef Meatballs with Zucchini", ["ground beef", "zucchini"], [
      "Form the ground beef into 8-10 small meatballs.",
      "Heat a skillet and cook meatballs for 8-10 minutes until browned and cooked through.",
    ]],
    // Breaded and baked without the noun in the baking step.
    ["Baked Chicken with Rolled Oats Crust", ["Boneless chicken breasts", "Rolled oats"], [
      "Dip the chicken in beaten egg, then coat evenly with the oat mixture.",
      "Place on a parchment-lined baking sheet and bake for 18-20 minutes until golden and cooked through.",
    ]],
  ];
  for (const [name, ings, steps] of cooked) {
    assert.equal(rawProteinNeverCooked(rawDish(name, ings, steps)), false, name);
  }
});

test("heat that describes another food does not cook the fish", () => {
  // The exact sentence that defeated the first two versions of this rule.
  assert.equal(
    rawProteinNeverCooked(
      rawDish("Quinoa Bowl with Salmon", ["Salmon fillets", "Quinoa", "zucchini"], [
        "Simmer the quinoa for 12 minutes.",
        "Roast the vegetables at 400F for 15 minutes.",
        "Top with roasted vegetables and flaked salmon.",
      ])
    ),
    true
  );
});

test("a breakfast of nothing but starch is not a meal", () => {
  // QA's day-1 breakfast: 60 g oats, one slice of bread, cinnamon — plus a
  // second slice served beside it. 14 g of protein for the whole meal, and the
  // rule passed it because "no dinner protein" was the only question asked.
  assert.equal(
    breakfastIsBuiltOnBreakfastFood(bfast("Rolled Oats with Cinnamon and Sliced Bread Toast", ["Rolled oats", "Sliced bread", "ground cinnamon"])),
    false
  );
  // Fruit on porridge is a real breakfast and stays.
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Oatmeal with Blueberries and Honey", ["Rolled oats", "blueberries", "honey"])), true);
  // So does anything carrying actual protein.
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Peanut Butter Toast", ["Sliced bread", "Peanut butter"])), true);
  assert.equal(breakfastIsBuiltOnBreakfastFood(bfast("Oatmeal with Almonds", ["Rolled oats", "Almonds"])), true);
});

test("a chicken breast on porridge is refused, not only a chicken thigh", () => {
  // QA found this served at 8am; the rule listed only thighs.
  assert.equal(
    breakfastIsBuiltOnBreakfastFood(bfast("Chicken Breast with Carrots and Rolled Oats", ["Boneless chicken breasts", "carrots", "Rolled oats"])),
    false
  );
});

test("a category word is satisfied by any member, and refused when there is none", () => {
  // The precise reason these words were exempt: a title saying "cheese" over
  // listed feta is accurate, and must stay accepted.
  assert.equal(phrasePromisesMissingFood("Cheese and Spinach Omelette", ["Feta cheese", "spinach", "Large eggs"], CATALOG), null);
  assert.equal(phrasePromisesMissingFood("Berry Yogurt Bowl", ["Strawberries", "Plain Greek yogurt"], CATALOG), null);
  assert.equal(phrasePromisesMissingFood("Nut Butter Toast", ["Almonds", "Sliced bread"], CATALOG), null);
  // And the reason exempting them outright was wrong. QA's dish: oats, bell
  // pepper, tomato, oil, salt, pepper — and a title and a step promising cheese.
  assert.equal(
    phrasePromisesMissingFood("Cheese and Bell Pepper Oat Bowl", ["Rolled oats", "Bell peppers", "Roma tomatoes"], CATALOG),
    "cheese"
  );
  assert.equal(phrasePromisesMissingFood("Berry Oatmeal", ["Rolled oats", "bananas"], CATALOG), "berry");
  assert.equal(phrasePromisesMissingFood("Seafood Rice Bowl", ["jasmine rice", "broccoli"], CATALOG), "seafood");
});

// QA caught this within hours of the category rule shipping, wrong in BOTH
// directions. The pattern was derived as `\b${word}s?\b`, so:
//   - \bberrys?\b could not match "berries", and "Oatmeal with Berries and
//     Cinnamon" — no berry of any kind — passed the very check written for it;
//   - and because the word was no longer exempt, the token rule then refused
//     "Oatmeal with Berries" over listed BLUEBERRIES, whose token is
//     "blueberry", not "berry".
test("a plural category word is detected, and a specific member still satisfies it", () => {
  // Direction 1: the lie must be caught however the title spells the category.
  assert.equal(categoryWithNoMember("Oatmeal with Berries and Cinnamon", ["Rolled oats", "carrots", "ground cinnamon"]), "berry");
  assert.equal(categoryWithNoMember("Berry Bowl", ["Rolled oats"]), "berry");
  assert.equal(categoryWithNoMember("Cheeses and Peppers", ["Bell peppers"]), "cheese");
  assert.equal(categoryWithNoMember("Mixed Nuts Bowl", ["Rolled oats"]), "nut");
  // Direction 2: a dish MORE precise than its title is not a lie.
  assert.equal(phrasePromisesMissingFood("Oatmeal with Berries", ["Rolled oats", "Blueberries"], CATALOG), null);
  assert.equal(phrasePromisesMissingFood("Berries and Yogurt", ["Strawberries", "Plain Greek yogurt"], CATALOG), null);
  assert.equal(phrasePromisesMissingFood("Cheese Omelette", ["Feta cheese", "Large eggs"], CATALOG), null);
  assert.equal(phrasePromisesMissingFood("Nuts and Banana", ["Almonds", "bananas"], CATALOG), null);
});

test("oats with a dinner protein is refused in every slot, not moved to another one", () => {
  const anySlot = (slot: string) =>
    ({ name: "Oatmeal with Carrots and Ground Beef", mealTypeName: slot, generated: true,
       steps: ["Simmer the oats.", "Brown the beef."],
       ingredients: [{ name: "Rolled oats" }, { name: "carrots" }, { name: "ground beef" }] }) as never;
  for (const slot of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
    assert.equal(breakfastStarchWithSavouryProtein(anySlot(slot)), true, slot);
  }
  // A full breakfast is a real dish: eggs, bacon and sausage are not on the list.
  const fullBreakfast = { name: "Oats with Bacon and Eggs", mealTypeName: "Breakfast", generated: true, steps: [],
    ingredients: [{ name: "Rolled oats" }, { name: "bacon" }, { name: "Large eggs" }] } as never;
  assert.equal(breakfastStarchWithSavouryProtein(fullBreakfast), false);
  // And so is porridge with nuts or yoghurt.
  const sweet = { name: "Oatmeal with Almonds and Yogurt", mealTypeName: "Breakfast", generated: true, steps: [],
    ingredients: [{ name: "Rolled oats" }, { name: "Almonds" }, { name: "Plain Greek yogurt" }] } as never;
  assert.equal(breakfastStarchWithSavouryProtein(sweet), false);
});

test("a snack is small as well as quick", () => {
  // QA on /pantry: "Turkey and Bell Pepper Stir-Fry with Jasmine Rice — Snack ·
  // 516 kcal", 20 minutes — inside the only rule a snack had. 104 of 143
  // generated snack rows were 250 kcal or more, the worst 876.
  const snack = (kcal: number) =>
    ({ name: "Broccoli and Salmon Fried Rice", mealTypeName: "Snack", generated: true,
       calories: kcal, prepMinutes: 5, cookMinutes: 15, steps: ["Fry it."],
       ingredients: [{ name: "jasmine rice" }, { name: "Salmon fillets" }] }) as never;
  assert.equal(snackIsSmallEnough(snack(876)), false);
  assert.equal(snackIsSmallEnough(snack(516)), false);
  assert.equal(snackIsSmallEnough(snack(400)), true, "the ceiling itself is allowed");
  assert.equal(snackIsSmallEnough(snack(286)), true, "the median snack is untouched");
  // Only the snack slot, and only where there is a figure to judge.
  const asLunch = { ...(snack(876) as object), mealTypeName: "Lunch" } as never;
  assert.equal(snackIsSmallEnough(asLunch), true);
  const noCalories = { ...(snack(876) as object), calories: null } as never;
  assert.equal(snackIsSmallEnough(noCalories), true);
});
