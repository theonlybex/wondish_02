import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBasketReadiness, MIN_BASKET } from "./basket-readiness";

const enough = [
  "chicken", "beef", "salmon", "rice", "oats", "bread",
  "broccoli", "spinach", "carrot", "tomato", "onion", "apple",
];

test("ready when count >= MIN and protein/carb/veg all present", () => {
  const r = computeBasketReadiness(enough);
  assert.equal(r.min, MIN_BASKET);
  assert.equal(r.ready, true);
  assert.deepEqual(r.missingCategories, []);
});

test("not ready when below the minimum count", () => {
  const r = computeBasketReadiness(["chicken", "rice", "broccoli"]);
  assert.equal(r.ready, false);
});

test("not ready when a required category is missing", () => {
  const only = Array.from({ length: 14 }, (_, i) => `rice ${i}`); // all carbs
  const r = computeBasketReadiness(only);
  assert.equal(r.ready, false);
  assert.ok(r.missingCategories.includes("protein"));
  assert.ok(r.missingCategories.includes("vegetable"));
});
