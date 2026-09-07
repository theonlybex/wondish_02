import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIngredientAffinity } from "./ingredient-affinity";

test("liked ingredients get positive affinity; all rated names are 'seen'", () => {
  const { affinityMap, seenIngredientNames } = buildIngredientAffinity([
    { liked: true, ingredient: { name: "Chicken" } },
    { liked: false, ingredient: { name: "Tofu" } },
  ]);
  assert.equal(affinityMap["chicken"], 1);
  assert.equal(affinityMap["tofu"], undefined); // disliked -> no affinity
  assert.ok(seenIngredientNames.has("chicken"));
  assert.ok(seenIngredientNames.has("tofu")); // rated either way -> seen
});

test("empty prefs yield empty affinity and seen set", () => {
  const { affinityMap, seenIngredientNames } = buildIngredientAffinity([]);
  assert.deepEqual(affinityMap, {});
  assert.equal(seenIngredientNames.size, 0);
});
