import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIngredientDishCounts, computeMarginalUnlocks, rankToBuy } from "./to-buy";

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

test("computeMarginalUnlocks counts dishes that are one ingredient short", () => {
  // basket has rice + egg → recipe [rice,egg] is fully covered (0 missing);
  // [chicken,rice] and [chicken,salt] are each one short of "chicken" (salt is a staple).
  const marginal = computeMarginalUnlocks(recipes, new Set(["rice", "egg"]));
  assert.equal(marginal.get("chicken"), 2);
  assert.equal(marginal.get("egg"), undefined); // egg already in basket
});

test("rankToBuy: marginal unlock ranks above raw dish-count", () => {
  // With rice+egg on hand, chicken unlocks 2 dishes NOW; nothing else is one-away.
  const items = rankToBuy({ recipes, pantry: new Set(["rice", "egg"]), liked: new Set() });
  assert.equal(items[0].ingredientId, "chicken");
  assert.equal(items[0].marginal, 2);
});
