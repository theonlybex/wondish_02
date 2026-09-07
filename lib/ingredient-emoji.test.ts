import { test } from "node:test";
import assert from "node:assert/strict";
import { getIngredientEmoji } from "./ingredient-emoji";

test("maps known ingredients case-insensitively", () => {
  assert.equal(getIngredientEmoji("Chicken breast"), "🍗");
  assert.equal(getIngredientEmoji("brown RICE"), "🍚");
  assert.equal(getIngredientEmoji("avocado"), "🥑");
});

test("falls back to a generic emoji for unknown ingredients", () => {
  assert.equal(getIngredientEmoji("xanthan gum"), "🥘");
});
