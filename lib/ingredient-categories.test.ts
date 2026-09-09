import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIngredient } from "./ingredient-categories";

test("classifies common ingredients by first keyword match", () => {
  assert.equal(classifyIngredient("Chicken breast"), "protein");
  assert.equal(classifyIngredient("brown rice"), "carb");
  assert.equal(classifyIngredient("Broccoli"), "vegetable");
  assert.equal(classifyIngredient("olive oil"), "fat");
});

test("unknown ingredients fall to 'other'", () => {
  assert.equal(classifyIngredient("xanthan gum"), "other");
});
