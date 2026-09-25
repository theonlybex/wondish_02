import { test } from "node:test";
import assert from "node:assert/strict";
import { passesSanity, chunkTopUpRequests, freeStaplesFor, proteinOptionsFor, titlePromisesMissingFood, breakfastIsQuickEnough, repairProse } from "./recipe-generation";
import { buildDietMatchers, derivePatientBans } from "../diet-match";
import { validateFridgeRecipeSnapshot, type FridgeRecipe } from "../fridge";

test("validateFridgeRecipeSnapshot parses an optional per-dish cuisine", () => {
  const base = { name: "Pad Thai", steps: ["cook"], perServing: { calories: 500, protein: 25, carbs: 55, fat: 15, fiber: 3 }, fitsPlan: true };
  assert.equal(validateFridgeRecipeSnapshot({ ...base, cuisine: "Thai" })?.cuisine, "Thai");
  assert.equal(validateFridgeRecipeSnapshot(base)?.cuisine, undefined);
  assert.equal(validateFridgeRecipeSnapshot({ ...base, cuisine: "   " })?.cuisine, undefined);
});

// A realistic, self-consistent dish: 30p/50c/18f → 482 derived kcal vs 500
// stated (inside the ±35% band). Override per-test to probe each gate.
function dish(over: Partial<FridgeRecipe> = {}, perServingOver = {}): FridgeRecipe {
  return {
    id: "",
    name: "Grilled chicken bowl",
    description: "",
    emoji: "",
    usesIngredients: ["chicken breast", "brown rice", "broccoli"],
    missingIngredients: [],
    steps: ["Cook."],
    mealType: "Lunch",
    servings: 1,
    perServing: { calories: 500, protein: 30, carbs: 50, fat: 18, fiber: 6, ...perServingOver },
    fitsPlan: true,
    conflicts: [],
    ...over,
  };
}

test("passesSanity: a realistic self-consistent dish passes", () => {
  assert.equal(passesSanity(dish()), true);
});

test("passesSanity: calories out of the [80,1400] band fail", () => {
  assert.equal(passesSanity(dish({}, { calories: 50 })), false);
  assert.equal(passesSanity(dish({}, { calories: 1600 })), false);
});

test("passesSanity: negative macros fail", () => {
  assert.equal(passesSanity(dish({}, { protein: -5 })), false);
  assert.equal(passesSanity(dish({}, { carbs: -1 })), false);
  assert.equal(passesSanity(dish({}, { fat: -1 })), false);
  assert.equal(passesSanity(dish({}, { fiber: -1 })), false);
});

test("passesSanity: macros that don't explain the calories fail (4/4/9 band)", () => {
  // 1p/1c/1f → 17 derived kcal, nowhere near 500 stated.
  assert.equal(passesSanity(dish({}, { protein: 1, carbs: 1, fat: 1 })), false);
  // Wildly high macros for the stated calories.
  assert.equal(passesSanity(dish({}, { protein: 90, carbs: 90, fat: 60 })), false);
});

test("passesSanity: ingredient count must be 2–25", () => {
  assert.equal(passesSanity(dish({ usesIngredients: ["egg"] })), false);
  assert.equal(
    passesSanity(dish({ usesIngredients: Array.from({ length: 26 }, (_, i) => `i${i}`) })),
    false
  );
  assert.equal(passesSanity(dish({ usesIngredients: ["egg", "toast"] })), true);
});

test("passesSanity: a missing perServing fails safely", () => {
  // Force the object to lack perServing (models sometimes omit it).
  const bad = dish();
  // @ts-expect-error deliberately removing a required field to test the guard
  delete bad.perServing;
  assert.equal(passesSanity(bad), false);
});

// The top-up used to ask for a whole week (7 × 3 meal types = 21 dishes, each
// with 5–10 steps) in ONE call capped at 4096 output tokens — the tool JSON was
// truncated and every dish dropped, so basket weeks came back with only raw
// library items. One call per meal type keeps each response well inside budget.
test("chunkTopUpRequests: one chunk per meal type, empty counts dropped, per-chunk cap honoured", () => {
  const chunks = chunkTopUpRequests([
    { mealTypeId: "b", mealTypeName: "Breakfast", count: 7, targetCalories: 400 },
    { mealTypeId: "l", mealTypeName: "Lunch", count: 0, targetCalories: 700 },
    { mealTypeId: "d", mealTypeName: "Dinner", count: 12, targetCalories: 600 },
  ], 8);
  assert.deepEqual(chunks.map((c) => c.map((r) => [r.mealTypeName, r.count])), [[["Breakfast", 7]], [["Dinner", 8]]]);
});

test("proteinOptionsFor keeps only proteins the profile allows (Vegan + Kidney → tofu, tempeh, plant-based egg…)", () => {
  const vegan = ["chicken", "turkey", "beef", "pork", "salmon", "tuna", "cod", "shrimp", "eggs", "yogurt", "cheese"];
  const kidney = ["lentils", "chickpeas", "black beans", "peanut butter", "almonds"];
  const empty = { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] };
  const m = buildDietMatchers(derivePatientBans({
    ...empty,
    foodPreferences: [{ food: { bannedIngredients: vegan.map((name) => ({ name })) } }],
    healthConditions: [{ condition: { bannedIngredients: kidney.map((name) => ({ name })) } }],
  }));
  assert.deepEqual(proteinOptionsFor(m), ["tofu", "tempeh", "edamame", "seitan", "plant-based egg", "meatless chicken", "quinoa"]);
  assert.equal(proteinOptionsFor(buildDietMatchers(derivePatientBans(empty))).length, 23);
});

test("freeStaplesFor drops a staple the profile bans (Hypertension → no free salt)", () => {
  const empty = { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] };
  // The list is the cupboard the prompt may draw on for free — salt, pepper,
  // water, a cooking fat and the dried spices. What matters here is that a
  // profile ban removes an item rather than the exact membership.
  const none = freeStaplesFor(buildDietMatchers(derivePatientBans(empty)));
  for (const expected of ["salt", "pepper", "water", "olive oil", "butter"]) {
    assert.ok(none.includes(expected), `${expected} should be free by default`);
  }
  const hypertension = { ...empty, healthConditions: [{ condition: { bannedIngredients: [{ name: "salt" }, { name: "kosher salt" }] } }] };
  const banned = freeStaplesFor(buildDietMatchers(derivePatientBans(hypertension)));
  assert.ok(!banned.includes("salt"), "a hypertension profile must not be handed free salt");
  assert.ok(banned.includes("pepper") && banned.includes("olive oil"));
});

// ── A dish name must not promise food the dish lacks ────────────────────────
// Observed in two real weeks (2026-09-24): "…with Brown Rice" built on jasmine
// rice, "…with Almond Butter" containing none, "Grilled Salmon with Broccoli
// and Lemon" with no lemon, "Oatmeal with Sliced Carrots and Cinnamon" with no
// cinnamon. A tester shopping from those names buys what the recipe never uses.
//
// The gate is vocabulary-driven, so it must catch real ingredients while
// ignoring how a dish is cooked or served. These titles are verbatim from the
// runs, with their actual stored ingredient lists.

const FOOD_VOCAB = new Set([
  // a stand-in for the ingredient catalog's food words
  "beef", "bell", "pepper", "brown", "rice", "jasmine", "basmati", "wild", "salmon",
  "broccoli", "lemon", "oat", "carrot", "cinnamon", "bread", "almond", "butter", "egg",
  "olive", "oil", "turkey", "breast", "zucchini", "chicken", "spinach", "spaghetti",
  "ground", "salt", "thyme",
]);
const titled = (name: string, usesIngredients: string[]) => ({ name, usesIngredients }) as never;

test("title gate rejects a name promising food the dish does not list", () => {
  assert.equal(
    titlePromisesMissingFood(titled("Ground Beef with Bell Peppers and Brown Rice", ["ground beef", "Bell peppers", "jasmine rice", "salt"]), FOOD_VOCAB),
    "brown rice"
  );
  assert.equal(
    titlePromisesMissingFood(titled("Grilled Salmon with Broccoli and Lemon", ["Salmon fillets", "broccoli", "Extra virgin olive oil", "salt"]), FOOD_VOCAB),
    "lemon"
  );
  assert.equal(
    titlePromisesMissingFood(titled("Sliced Bread with Almond Butter and Egg", ["Sliced bread", "Large eggs", "broccoli"]), FOOD_VOCAB),
    "almond"
  );
  // A staple in the cupboard does NOT satisfy a title claim — the steps have
  // to actually use it, or the name is still a promise the dish breaks.
  assert.equal(
    titlePromisesMissingFood(titled("Oatmeal with Sliced Carrots and Cinnamon", ["Rolled oats", "carrots", "water", "salt"]), FOOD_VOCAB),
    "cinnamon"
  );
});

// A health claim IS the dish, not a flourish. This case sat in the "do not
// reject" list below until a QA run called it a P1 on its own: "Scrambled Eggs
// with Whole Grain Bread and Mixed Vegetables" whose ingredient is plain
// "Sliced bread" tells someone managing fibre or glycaemic load something
// false. ingredientTokens cannot see it — "whole" and "grain" are descriptor
// words there, on purpose — so it is matched as a phrase.
test("a health claim in the name has to be in the ingredients", () => {
  assert.equal(
    titlePromisesMissingFood(titled("Egg Salad on Whole Grain Bread with Spinach and Carrots", ["Large eggs", "Sliced bread", "spinach", "carrots"]), FOOD_VOCAB),
    "whole grain"
  );
  assert.equal(
    titlePromisesMissingFood(titled("Egg Salad on Whole Grain Bread with Spinach", ["Large eggs", "whole grain bread", "spinach"]), FOOD_VOCAB),
    null
  );
  // Hyphenation and spacing must not decide whether a claim counts.
  assert.equal(
    titlePromisesMissingFood(titled("Toast with Whole-Grain Bread", ["Whole grain bread"]), FOOD_VOCAB),
    null
  );
});

test("\"herb-roasted\" with no herb in the list is rejected", () => {
  // The generic word demands no SPECIFIC herb, but it does promise one exists.
  assert.equal(
    titlePromisesMissingFood(titled("Herb-Roasted Turkey Breast with Wild Rice", ["Turkey breast", "Wild rice", "Extra virgin olive oil", "salt"]), FOOD_VOCAB),
    "herbs"
  );
});

test("title gate does not reject over cooking methods, formats or generic seasoning", () => {
  // Every one of these is a real accepted dish; a gate that rejects them would
  // thin the pool and bring back the repeated-dish weeks.
  for (const [name, ings] of [
    ["Roasted Broccoli with Olive Oil and Herbs", ["broccoli", "Extra virgin olive oil", "salt", "dried thyme"]],
    ["Herb-Roasted Turkey Breast with Wild Rice and Zucchini", ["Turkey breast", "Wild rice", "zucchini", "Extra virgin olive oil", "dried thyme"]],
    ["Ground Turkey Taco Bowl with Jasmine Rice and Bell Peppers", ["Ground turkey", "jasmine rice", "Bell peppers", "salt"]],
    ["Turkey and Vegetable Hash with Jasmine Rice", ["Turkey breast", "carrots", "zucchini", "jasmine rice"]],
    ["Pan-Seared Ground Beef with Basmati Rice and Carrots", ["ground beef", "Basmati rice", "carrots"]],
    ["Baked Chicken Breast with Spaghetti and Spinach", ["Boneless chicken breasts", "Spaghetti", "spinach", "salt"]],
  ] as [string, string[]][]) {
    assert.equal(titlePromisesMissingFood(titled(name, ings), FOOD_VOCAB), null, name);
  }
});

// Salt is a health limit, not a taste preference: a generated breakfast came
// back with "Salt 1.5 teaspoon" — ~3.5 g sodium, over a whole day's intake in
// one meal, in a product people use to manage blood pressure (2026-09-24).
test("sanity gate rejects an implausible amount of salt per serving", () => {
  const base = {
    name: "Test dish",
    usesIngredients: ["Boneless chicken breasts", "Brown rice", "salt"],
    perServing: { calories: 500, protein: 40, carbs: 50, fat: 12, fiber: 3 },
    steps: ["cook"],
    missingIngredients: [],
  };
  const withSalt = (quantity: number, unit: string) =>
    ({ ...base, amounts: [{ name: "salt", quantity, unit }] }) as never;

  assert.equal(passesSanity(withSalt(1.5, "teaspoon")), false, "1.5 tsp is over a day's sodium");
  assert.equal(passesSanity(withSalt(2, "tsp")), false);
  assert.equal(passesSanity(withSalt(1, "tablespoon")), false);
  // Normal seasoning still passes.
  assert.equal(passesSanity(withSalt(0.5, "teaspoon")), true);
  assert.equal(passesSanity(withSalt(1, "teaspoon")), true);
  assert.equal(passesSanity(withSalt(0.25, "teaspoon")), true);
  // A dish with no salt row is unaffected.
  assert.equal(passesSanity(base as never), true);
});

// Nobody braises chicken thighs before work. Observed 2026-09-24: a generated
// week served braised thighs (15 prep + 35 cook) at 8am on all seven days,
// because the prompt constrained only calories and the slot name.
test("a slow dish cannot claim the breakfast slot", () => {
  const timed = (prepMinutes: number, cookMinutes: number) =>
    ({ name: "Braised Chicken Thighs with Wild Rice", usesIngredients: ["chicken thighs", "Wild rice"], prepMinutes, cookMinutes }) as never;

  assert.equal(breakfastIsQuickEnough(timed(15, 35), "Breakfast"), false, "50 min is not a breakfast");
  assert.equal(breakfastIsQuickEnough(timed(10, 25), "Breakfast"), false, "35 min is over the bar");
  // Real breakfasts pass.
  assert.equal(breakfastIsQuickEnough(timed(5, 10), "Breakfast"), true);
  assert.equal(breakfastIsQuickEnough(timed(10, 20), "Breakfast"), true, "30 min exactly is allowed");
  // Other slots are unconstrained — a 50-minute dinner is fine.
  assert.equal(breakfastIsQuickEnough(timed(15, 35), "Dinner"), true);
  assert.equal(breakfastIsQuickEnough(timed(15, 35), "Lunch"), true);
  // Missing timings are not treated as evidence of a slow dish.
  assert.equal(breakfastIsQuickEnough({ name: "x", usesIngredients: ["a", "b"] } as never, "Breakfast"), true);
});

// ── The claim moves down the card if only the title is checked ──────────────
test("the description is held to the same promise as the title", async () => {
  const { descriptionPromisesMissingFood } = await import("./recipe-generation");
  // Verbatim from a run AFTER the title gate shipped: title clean, prose not.
  const d = {
    name: "Poached Salmon with Zucchini and Toast",
    description: "Gently poached salmon served with zucchini and toasted whole-grain bread.",
    usesIngredients: ["Salmon fillets", "zucchini", "Sliced bread", "salt"],
  } as never;
  assert.equal(descriptionPromisesMissingFood(d, FOOD_VOCAB), "whole grain");

  const honest = {
    name: "Poached Salmon with Zucchini and Toast",
    description: "Gently poached salmon served with zucchini and toasted bread.",
    usesIngredients: ["Salmon fillets", "zucchini", "Sliced bread", "salt"],
  } as never;
  assert.equal(descriptionPromisesMissingFood(honest, FOOD_VOCAB), null);
  // No description is not a lie.
  assert.equal(descriptionPromisesMissingFood({ name: "x", usesIngredients: ["a"] } as never, FOOD_VOCAB), null);
});

// ── You cannot sear in a pan with nothing in it ─────────────────────────────
test("steps that sear, sauté or fry must list a fat", async () => {
  const { cooksWithUnlistedFat } = await import("./recipe-generation");
  const searsWithNothing = {
    name: "Chicken Breast with Zucchini Over Rice",
    usesIngredients: ["Boneless chicken breasts", "zucchini", "jasmine rice", "salt"],
    steps: ["Pat the chicken dry.", "Pan-sear chicken for 6-7 minutes per side.", "Sauté diced zucchini."],
  } as never;
  assert.equal(cooksWithUnlistedFat(searsWithNothing), true);

  const listsTheOil = {
    ...(searsWithNothing as object),
    usesIngredients: ["Boneless chicken breasts", "zucchini", "jasmine rice", "Extra virgin olive oil", "salt"],
  } as never;
  assert.equal(cooksWithUnlistedFat(listsTheOil), false);

  // Nothing is fried, so no fat is required.
  const boiled = {
    name: "Poached Chicken with Rice",
    usesIngredients: ["Boneless chicken breasts", "jasmine rice", "water"],
    steps: ["Bring water to a boil.", "Poach the chicken for 15 minutes.", "Steam the rice."],
  } as never;
  assert.equal(cooksWithUnlistedFat(boiled), false);
});

// ── Calories are the macros, not an independent claim ───────────────────────
test("a dish's calories are reconciled to its own macro rows", async () => {
  const { reconcileCalories, CALORIE_MACRO_TOLERANCE } = await import("./recipe-generation");
  // Verbatim: "Grilled Chicken Breast with Jasmine Rice and Roasted Broccoli"
  // declared 805 kcal on the card, the ring and the weekly grid. 48*4 + 92*4 +
  // 12*9 = 668. Every one of the 26 mismatches measured was an overstatement.
  const inflated = { perServing: { calories: 805, protein: 48, carbs: 92, fat: 12 } } as never;
  assert.equal(reconcileCalories(inflated), 668);

  // Inside the tolerance the model's own rounding is left alone.
  const close = { perServing: { calories: 670, protein: 48, carbs: 92, fat: 12 } } as never;
  assert.equal(reconcileCalories(close), null);
  assert.ok(CALORIE_MACRO_TOLERANCE <= 0.1, "the tolerance has to be tighter than the sanity band");

  // No macros to derive from → nothing to reconcile, not a zero.
  assert.equal(reconcileCalories({ perServing: { calories: 500, protein: 0, carbs: 0, fat: 0 } } as never), null);
  assert.equal(reconcileCalories({} as never), null);

  // A dish whose macros imply an impossible total is left for the sanity gate
  // to reject rather than being quietly rewritten to something plausible.
  assert.equal(reconcileCalories({ perServing: { calories: 600, protein: 1, carbs: 2, fat: 1 } } as never), null);
});

// repairProse — the cycle-9 fix. 8 of 16 rejections in a measured generation
// batch were prose-only: the dish was sound and its name lied. Discarding it
// left the snack pool at one dish, which the builder then served four times in
// a week. The ingredient list is the truth; the prose is what gets replaced.

const prosed = (name: string, usesIngredients: string[], description = "") =>
  ({ name, usesIngredients, description }) as never;

test("repairProse renames a lying title from the dish's own ingredients", () => {
  const fixed = repairProse(
    prosed("Ground Beef with Bell Peppers and Brown Rice", ["ground beef", "Bell peppers", "jasmine rice", "salt"]),
    FOOD_VOCAB,
    new Set()
  );
  assert.ok(fixed);
  assert.equal(fixed.name, "Ground Beef with Bell Peppers and Jasmine Rice");
  // Built truthful AND verified truthful by the predicate that rejected the old name.
  assert.equal(titlePromisesMissingFood(fixed, FOOD_VOCAB), null);
});

test("repairProse leaves an honest dish untouched", () => {
  const dish = prosed("Turkey Breast with Wild Rice", ["Turkey breast", "Wild rice", "Extra virgin olive oil", "salt"], "A plain description.");
  assert.equal(repairProse(dish, FOOD_VOCAB, new Set()), dish);
});

test("repairProse never names a dish after its salt or oil", () => {
  const fixed = repairProse(
    prosed("Lemon Herb Chicken", ["salt", "Extra virgin olive oil", "chicken breast", "broccoli"]),
    FOOD_VOCAB,
    new Set()
  );
  assert.ok(fixed);
  assert.equal(fixed.name, "Chicken Breast with Broccoli");
});

test("repairProse replaces a description that promises what the dish lacks", () => {
  const fixed = repairProse(
    prosed("Chicken Breast with Broccoli", ["chicken breast", "broccoli"], "Served over brown rice with a squeeze of lemon."),
    FOOD_VOCAB,
    new Set()
  );
  assert.ok(fixed);
  assert.equal(fixed.name, "Chicken Breast with Broccoli");
  assert.equal(fixed.description, "Chicken Breast with Broccoli");
});

test("repairProse lengthens the name rather than colliding with one already taken", () => {
  const fixed = repairProse(
    prosed("Lemon Chicken", ["chicken breast", "broccoli", "carrots"]),
    FOOD_VOCAB,
    new Set(["chicken breast with broccoli"])
  );
  assert.ok(fixed);
  assert.equal(fixed.name, "Chicken Breast with Broccoli and Carrots");
});

test("repairProse gives up when the dish has no nameable ingredient", () => {
  assert.equal(repairProse(prosed("Lemon Salt Bowl", ["salt", "water"]), FOOD_VOCAB, new Set()), null);
});
