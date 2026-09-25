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

test("a savoury-dinner basket is not ready, however big it is", () => {
  // The QA basket that passed as "enough to fill a full week" and then produced
  // seven breakfasts the app could not make: four rices, four meats, six
  // vegetables, and nothing anybody eats at 8am.
  const savouryOnly = [
    "Basmati rice", "jasmine rice", "Brown rice", "Wild rice",
    "Boneless chicken breasts", "chicken thighs", "ground beef", "Ground turkey", "Turkey breast",
    "broccoli", "cauliflower", "carrots", "celery", "zucchini", "Bell peppers",
  ];
  const r = computeBasketReadiness(savouryOnly);
  assert.equal(r.count, 15);
  assert.deepEqual(r.missingCategories, [], "protein, carb and vegetable are all present");
  assert.equal(r.missingBreakfast, true);
  assert.equal(r.ready, false, "15 savoury items is not a week");

  // One breakfast item is enough to close it.
  const withEggs = computeBasketReadiness([...savouryOnly, "Large eggs"]);
  assert.equal(withEggs.missingBreakfast, false);
  assert.equal(withEggs.ready, true);
  // As is oats, bread or yoghurt.
  for (const item of ["Rolled oats", "Sliced bread", "Plain Greek yogurt", "Apples"]) {
    assert.equal(computeBasketReadiness([...savouryOnly, item]).ready, true, item);
  }
});
