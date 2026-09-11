import { test } from "node:test";
import assert from "node:assert/strict";
import { passesSanity, chunkTopUpRequests, freeStaplesFor } from "./recipe-generation";
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

test("freeStaplesFor drops a staple the profile bans (Hypertension → no free salt)", () => {
  const empty = { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] };
  assert.deepEqual(freeStaplesFor(buildDietMatchers(derivePatientBans(empty))), ["salt", "pepper", "water"]);
  const hypertension = { ...empty, healthConditions: [{ condition: { bannedIngredients: [{ name: "salt" }, { name: "kosher salt" }] } }] };
  assert.deepEqual(freeStaplesFor(buildDietMatchers(derivePatientBans(hypertension))), ["pepper", "water"]);
});
