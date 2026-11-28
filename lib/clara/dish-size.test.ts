import { test } from "node:test";
import assert from "node:assert/strict";
import type { FridgeRecipe } from "@/lib/fridge";
import { pricedMacros } from "./recipe-generation";
import { sizeToTarget, SIZE_TOLERANCE } from "./dish-size";

const STEPS = ["Rinse the lentils and simmer until tender.", "Cook the rice in boiling water.", "Fry the tofu in the olive oil, add the kale, then serve with the eggs."];
const dish = (amounts: { name: string; quantity: number; unit: string }[], steps = STEPS): FridgeRecipe => ({
  id: "d1", name: "Lentil and Tofu Bowl", description: "", emoji: "", usesIngredients: amounts.map((a) => a.name), missingIngredients: [],
  steps, mealType: "Dinner", servings: 1, perServing: { calories: 640, protein: 40, carbs: 80, fat: 15, fiber: 20 }, fitsPlan: true, conflicts: [], amounts,
});
const BIG = [
  { name: "dry green lentils", quantity: 90, unit: "g" }, { name: "firm tofu", quantity: 150, unit: "g" }, { name: "jasmine rice", quantity: 70, unit: "g" },
  { name: "kale", quantity: 60, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }, { name: "salt", quantity: 0.125, unit: "teaspoon" },
  { name: "eggs", quantity: 2, unit: "" },
];
const kcal = (r: FridgeRecipe) => pricedMacros(r)!.calories;
const amount = (r: FridgeRecipe, name: string) => r.amounts!.find((a) => a.name === name)!.quantity;

test("a dish priced well over its target has its food rows scaled down; fat, seasoning and counted foods stay", () => {
  const r = dish(BIG);
  assert.ok(kcal(r) > 950, `starts at ${kcal(r)}`);
  const sized = sizeToTarget(r, 640);
  assert.notEqual(sized, r);
  assert.ok(Math.abs(kcal(sized) / 640 - 1) <= 0.12, `lands at ${kcal(sized)}`);
  assert.ok(amount(sized, "dry green lentils") < 90 && amount(sized, "firm tofu") < 150 && amount(sized, "jasmine rice") < 70);
  assert.equal(amount(sized, "olive oil"), 1);
  assert.equal(amount(sized, "salt"), 0.125);
  assert.equal(amount(sized, "eggs"), 2);
  // Grams come out as kitchen amounts, and the model's own figures follow the dish.
  for (const n of ["dry green lentils", "firm tofu", "jasmine rice", "kale"]) assert.equal(amount(sized, n) % 5, 0, n);
  assert.ok(sized.perServing.calories < r.perServing.calories);
});

test("a dish priced under its target is scaled up", () => {
  const small = dish([{ name: "chicken breast", quantity: 100, unit: "g" }, { name: "basmati rice", quantity: 40, unit: "g" }, { name: "broccoli", quantity: 100, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }], ["Cook the rice in boiling water.", "Fry the chicken in the olive oil with the broccoli."]);
  const before = kcal(small);
  const sized = sizeToTarget(small, 470);
  assert.ok(before < 400 && kcal(sized) > before);
  assert.ok(Math.abs(kcal(sized) / 470 - 1) <= 0.1, `lands at ${kcal(sized)}`);
  // Never by more than half again: a target far above the dish is the judge's to refuse, not ours to invent.
  assert.ok(kcal(sizeToTarget(small, 900)) < before * 1.55);
  assert.equal(amount(sized, "olive oil"), 1);
});

test("a dish already close to its target, or with no target, is returned as it is", () => {
  const r = dish(BIG);
  assert.equal(sizeToTarget(r, kcal(r) * (1 + SIZE_TOLERANCE / 2)), r);
  assert.equal(sizeToTarget(r, null), r);
  const bare = { ...r, amounts: undefined };
  assert.equal(sizeToTarget(bare, 640), bare);
});

test("a row whose amount a step repeats is not moved, so the steps stay true", () => {
  const steps = ["Simmer the 90 g lentils until tender.", "Cook the rice in boiling water.", "Fry the tofu in the olive oil, add the kale, then serve with the eggs."];
  const sized = sizeToTarget(dish(BIG, steps), 640);
  assert.equal(amount(sized, "dry green lentils"), 90);
  assert.ok(amount(sized, "firm tofu") < 150);
});

test("a dish the table cannot price in full is left alone", () => {
  const r = dish([...BIG.slice(0, 2), { name: "mystery paste", quantity: 200, unit: "g" }]);
  assert.equal(pricedMacros(r), null);
  assert.equal(sizeToTarget(r, 300), r);
});
