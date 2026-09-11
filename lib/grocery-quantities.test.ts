import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateNeeds, toBase, formatPurchase } from "./grocery-quantities";

test("aggregate keeps units apart, toBase converts and flags LOW confidence", () => {
  const needs = aggregateNeeds([
    { ingredientId: "oil", quantity: 1, unit: "tablespoon" },
    { ingredientId: "oil", quantity: 2, unit: "Tablespoon " },
    { ingredientId: "oil", quantity: 0.25, unit: "cup" },
    { ingredientId: "onion", quantity: 1.7, unit: "" },
    { ingredientId: "onion", quantity: null, unit: "" },
    { ingredientId: "onion", quantity: 0, unit: "count" },
  ]);
  assert.equal(needs.get("oil")!.get("tablespoon"), 3);
  assert.equal(needs.get("oil")!.get("cup"), 0.25);
  assert.equal(needs.get("onion")!.get(""), 1.7);
  assert.equal(needs.get("onion")!.has("count"), false);

  const out = toBase(needs, [
    { ingredientId: "oil", unit: "tablespoon", baseQuantity: 13.6, baseUnit: "g", confidence: "HIGH" },
    { ingredientId: "oil", unit: "cup", baseQuantity: 218, baseUnit: "g", confidence: "LOW" },
  ]);
  const oil = out.find((o) => o.ingredientId === "oil")!;
  assert.equal(Math.round(oil.base), 95);
  assert.equal(oil.baseUnit, "g");
  assert.equal(oil.approx, true);
  assert.deepEqual(oil.unconverted, []);
  const onion = out.find((o) => o.ingredientId === "onion")!;
  assert.equal(onion.baseUnit, "count");
  assert.equal(onion.base, 1.7);
  assert.equal(onion.approx, false);
});

test("toBase never mixes bases: a unit with no conversion, or a different base, is reported unconverted", () => {
  const needs = aggregateNeeds([
    { ingredientId: "milk", quantity: 1, unit: "cup" },
    { ingredientId: "milk", quantity: 2, unit: "splash" },
    { ingredientId: "flour", quantity: 1, unit: "cup" },
    { ingredientId: "flour", quantity: 1, unit: "pinch" },
    { ingredientId: "nothing", quantity: 1, unit: "handful" },
  ]);
  const out = toBase(needs, [
    { ingredientId: "milk", unit: "cup", baseQuantity: 236.588, baseUnit: "mL", confidence: "HIGH" },
    { ingredientId: "flour", unit: "cup", baseQuantity: 125, baseUnit: "g", confidence: "HIGH" },
    { ingredientId: "flour", unit: "pinch", baseQuantity: 0.3, baseUnit: "mL", confidence: "LOW" },
  ]);
  const milk = out.find((o) => o.ingredientId === "milk")!;
  assert.equal(milk.baseUnit, "mL");
  assert.deepEqual(milk.unconverted, [{ unit: "splash", quantity: 2 }]);
  const flour = out.find((o) => o.ingredientId === "flour")!;
  assert.equal(flour.base, 125);
  assert.equal(flour.approx, false); // the LOW-confidence row was not used
  assert.deepEqual(flour.unconverted, [{ unit: "pinch", quantity: 1 }]);
  // Nothing convertible at all → no entry (the caller shows no amount).
  assert.equal(out.find((o) => o.ingredientId === "nothing"), undefined);
});

test("formatPurchase follows the Wondish 06 rounding rules", () => {
  assert.equal(formatPurchase(412, "g"), "1 lb");
  assert.equal(formatPurchase(95, "g"), "3.5 oz");
  assert.equal(formatPurchase(700, "g"), "1.75 lb");
  assert.equal(formatPurchase(2300, "g"), "5.25 lb");
  assert.equal(formatPurchase(820, "mL"), "1 L");
  assert.equal(formatPurchase(300, "mL"), "10.5 fl oz");
  assert.equal(formatPurchase(1100, "mL"), "1.25 L");
  assert.equal(formatPurchase(1.7, "count"), "2");
  assert.equal(formatPurchase(3, "count"), "3");
  assert.equal(formatPurchase(0.4, "g"), "0.5 oz");
});

test("mass and volume units convert universally without a per-ingredient row", () => {
  const needs = aggregateNeeds([
    { ingredientId: "beef", quantity: 4, unit: "oz" },
    { ingredientId: "beef", quantity: 100, unit: "gr" },
    { ingredientId: "beef", quantity: 1, unit: "cup" },
    { ingredientId: "broth", quantity: 250, unit: "ml" },
    { ingredientId: "broth", quantity: 1, unit: "Fl  Oz" },
  ]);
  const out = toBase(needs, []);
  const beef = out.find((o) => o.ingredientId === "beef")!;
  assert.equal(beef.baseUnit, "g");
  assert.equal(Math.round(beef.base), 213);
  assert.deepEqual(beef.unconverted, [{ unit: "cup", quantity: 1 }]);
  const broth = out.find((o) => o.ingredientId === "broth")!;
  assert.equal(broth.baseUnit, "mL");
  assert.equal(Math.round(broth.base), 280);
  assert.equal(formatPurchase(beef.base, beef.baseUnit), "8 oz"); // 213 g = 7.53 oz → up to ½ oz
});
