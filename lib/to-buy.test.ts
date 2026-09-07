import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIngredientDishCounts, rankToBuy } from "./to-buy";

const recipes = [
  { ingredients: [{ ingredientId: "chicken", name: "Chicken" }, { ingredientId: "rice", name: "Rice" }] },
  { ingredients: [{ ingredientId: "chicken", name: "Chicken" }, { ingredientId: "salt", name: "Salt" }] },
  { ingredients: [{ ingredientId: "rice", name: "Rice" }, { ingredientId: "egg", name: "Egg" }] },
];

test("computeIngredientDishCounts counts occurrences per ingredient", () => {
  const counts = computeIngredientDishCounts(recipes);
  assert.equal(counts.get("chicken")?.count, 2);
  assert.equal(counts.get("rice")?.count, 2);
  assert.equal(counts.get("egg")?.count, 1);
});

test("rankToBuy: favorites first, then dish-count desc; excludes pantry + staples", () => {
  const items = rankToBuy({
    recipes,
    pantry: new Set(["rice"]), // already have rice -> excluded
    liked: new Set(["egg"]), // favorite -> floats to top
    cap: 10,
  });
  // rice excluded (pantry); salt excluded (staple)
  assert.deepEqual(items.map((i) => i.ingredientId), ["egg", "chicken"]);
  assert.equal(items[0].favorite, true);
  assert.equal(items[1].dishCount, 2);
});

test("rankToBuy respects the cap", () => {
  const items = rankToBuy({ recipes, pantry: new Set(), liked: new Set(), cap: 1 });
  assert.equal(items.length, 1);
});
