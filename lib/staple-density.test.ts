import { test } from "node:test";
import assert from "node:assert/strict";
import { gramsOf, macroFloor, priceDish } from "./staple-density";

// The long tail added 2026-09-25 to stop 301 null-macro dishes being refused
// over an ingredient that could not have changed their nutrition.
test("the seasoning tail prices as seasoning, and a vegetable pepper stays a vegetable", () => {
  // The conflation this table has now got wrong twice, in both directions.
  assert.equal(gramsOf("Green peppers", 110, "g"), 110);
  const greenPepper = macroFloor([{ name: "Green peppers", quantity: 200, unit: "g" }], null);
  const groundPepper = macroFloor([{ name: "Black peppercorns", quantity: 200, unit: "g" }], null);
  assert.ok(
    greenPepper.carbs < groundPepper.carbs / 4,
    `a vegetable pepper must not be priced as the seasoning: ${greenPepper.carbs} vs ${groundPepper.carbs}`
  );
});

test("garnish units price instead of taking the whole dish out of pricing", () => {
  assert.equal(gramsOf("Garlic", 2, "clove"), 6);
  assert.equal(gramsOf("Fresh basil", 6, "leaves"), 3);
  assert.equal(gramsOf("Fresh thyme", 2, "sprig"), 2);
  assert.equal(gramsOf("celery", 1, "stalk"), 40);
  assert.equal(gramsOf("Asparagus", 6, "spear"), 90);
  assert.equal(gramsOf("Kosher salt", 1, "pinch"), 0.3);
});

test("seasoning and water are skipped entirely, so they never cost a dish its coverage", () => {
  // A dish of nothing but seasoning has nothing to price — null is correct, and
  // is why these names never counted against coverage in the first place.
  assert.equal(priceDish([{ name: "tap water", quantity: 1.5, unit: "cup" }], null), null);
  assert.equal(priceDish([{ name: "Kosher salt", quantity: 0.25, unit: "teaspoon" }], null), null);
  // And a real dish keeps full coverage however much seasoning it carries.
  const dish = priceDish(
    [
      { name: "Boneless chicken breasts", quantity: 150, unit: "g" },
      { name: "Kosher salt", quantity: 0.25, unit: "teaspoon" },
      { name: "Black peppercorns", quantity: 0.1, unit: "teaspoon" },
      { name: "tap water", quantity: 1.5, unit: "cup" },
      { name: "Garlic", quantity: 2, unit: "clove" },
    ],
    null
  );
  assert.ok(dish);
  assert.equal(dish.coverage, 1);
  assert.ok(dish.protein > 30 && dish.protein < 40, `150 g chicken is ~35 g protein, got ${dish.protein}`);
});

test("mayonnaise is priced as the fat it is, not waved through as a condiment", () => {
  // A tablespoon is ~100 kcal of almost pure fat, which is why the tail lists
  // real values for the few entries that carry calories.
  const mayo = priceDish(
    [{ name: "Boneless chicken breasts", quantity: 100, unit: "g" }, { name: "Mayonnaise", quantity: 1, unit: "tablespoon" }],
    null
  );
  assert.ok(mayo);
  assert.ok(mayo.fat > 10, `expected the mayonnaise fat to land, got ${mayo.fat} g`);
});
