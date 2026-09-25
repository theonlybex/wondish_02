import { test } from "node:test";
import assert from "node:assert/strict";
import { isMeasurableAmount, repairAmount, snapToKitchenFraction } from "./dish-plausibility";

// ── Amounts a kitchen can produce ────────────────────────────────────────────
//
// QA reported "0.37 tablespoons" in three consecutive cycles. Each time the fix
// touched the generator and the 2,584 STORED rows stayed as they were.
//
// Writing the rule down also found the rule itself was wrong, the same way four
// earlier thresholds were wrong — too strict, against real data. Every value
// below came out of the live catalog on 2026-09-25, and the "already fine" list
// is the important half: it is what the first version of this predicate would
// have rewritten.

test("thirds are measurable — a measuring set has a 1/3 cup", () => {
  for (const [q, u] of [
    [1 / 3, "cup"],
    [0.33, "cup"],
    [0.66, "cup"],
    [2 / 3, "tablespoon"],
    [0.25, "medium"], // a quarter lemon is a knife cut
    [0.75, "teaspoon"],
    [1.5, "cup"],
    [0.125, "teaspoon"],
    [3, "oz"],
    [5.25, "oz"], // a scale reads quarter-ounces
    [200, "ml"],
  ] as const) {
    assert.equal(
      isMeasurableAmount(q as number, u as string),
      true,
      `${q} ${u} is something a person can measure — rewriting it damages a correct row`
    );
  }
});

test("what no drawer contains", () => {
  for (const [q, u] of [
    [0.37, "tablespoon"],
    [1.03, "tablespoon"],
    [0.0625, "teaspoon"],
    [0.06, "teaspoon"],
    [0.4, "cup"],
    [0.25, "g"],
    [4.7, "ml"],
  ] as const) {
    assert.equal(isMeasurableAmount(q as number, u as string), false, `${q} ${u} should be repaired`);
  }
});

test("below the smallest spoon is a pinch, and the salt does not double", () => {
  // 1 pinch = 1/16 tsp in lib/staple-density.ts, so this conversion moves no
  // sodium. Rounding up to the old 0.125 floor would have doubled 1,340 rows.
  assert.deepEqual(repairAmount(0.0625, "teaspoon", "Kosher salt"), { quantity: 1, unit: "pinch" });
  assert.deepEqual(repairAmount(0.06, "teaspoon", "Black peppercorns"), { quantity: 1, unit: "pinch" });
  // A sub-spoon tablespoon amount converts through teaspoons first.
  assert.deepEqual(repairAmount(0.03, "tablespoon", "salt"), { quantity: 1, unit: "pinch" });
});

test("odd spoon amounts snap to the nearest real fraction", () => {
  assert.deepEqual(repairAmount(0.37, "tablespoon", "Extra virgin olive oil"), {
    quantity: 0.3333,
    unit: "tablespoon",
  });
  assert.deepEqual(repairAmount(1.03, "tablespoon", "Extra virgin olive oil"), { quantity: 1, unit: "tablespoon" });
  assert.deepEqual(repairAmount(0.4, "cup", "Quinoa"), { quantity: 0.3333, unit: "cup" });
});

test("a quarter gram of oil is a spray, not a weight", () => {
  assert.deepEqual(repairAmount(0.25, "g", "avocado oil"), { quantity: 1, unit: "pinch" });
  assert.deepEqual(repairAmount(0.1, "g", "garlic powder"), { quantity: 1, unit: "pinch" });
  // Something that is neither spice nor fat keeps its unit and becomes a gram.
  assert.deepEqual(repairAmount(0.4, "g", "Almonds"), { quantity: 1, unit: "g" });
});

test("small millilitre amounts are spoons; large ones stay millilitres", () => {
  assert.deepEqual(repairAmount(4.7, "ml", "olive oil"), { quantity: 1, unit: "teaspoon" });
  assert.deepEqual(repairAmount(9.33, "ml", "olive oil"), { quantity: 2, unit: "teaspoon" });
  assert.equal(repairAmount(200, "ml", "water"), null, "200 ml of water is already an amount");
});

test("repairAmount returns null for anything already measurable", () => {
  for (const [q, u] of [
    [0.33, "cup"],
    [1, "teaspoon"],
    [0.5, "tablespoon"],
    [3, "oz"],
    [2, "medium"],
  ] as const) {
    assert.equal(repairAmount(q as number, u as string, "x"), null, `${q} ${u} needs no repair`);
  }
});

test("snapping down never exceeds the input — the salt and fat caps depend on it", () => {
  for (const raw of [0.37, 1.03, 0.9, 2.4, 0.13]) {
    assert.ok(
      snapToKitchenFraction(raw, "down") <= raw + 1e-9,
      `${raw} snapped up, which would let a clamped amount back over its cap`
    );
  }
  // …while "near" may round up to the whole: 0.95 cup is a cup.
  assert.equal(snapToKitchenFraction(0.95), 1);
});
