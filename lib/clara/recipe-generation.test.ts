import { test } from "node:test";
import assert from "node:assert/strict";
import { passesSanity } from "./recipe-generation";
import type { FridgeRecipe } from "../fridge";

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
