import { test } from "node:test";
import assert from "node:assert/strict";
import { COOKED_MEAT_FACTOR, foodsNutritionHandler, parseFoodRows, priceFoodRow, priceFoods } from "./food-grams";

test("oil is priced as fat: 14 g of olive oil ≈ 126 kcal, 14 g fat", () => {
  const r = priceFoodRow({ name: "olive oil", grams: 14, asServed: true });
  assert.equal(r.source, "food data");
  assert.equal(r.fat, 14);
  assert.equal(r.calories, 126);
});

test("cooked rice is priced cooked, not dry: 180 g as served is about a third of dry", () => {
  const served = priceFoodRow({ name: "white rice", grams: 180, asServed: true });
  const dry = priceFoodRow({ name: "white rice", grams: 180, asServed: false });
  assert.ok(served.calories! > 150 && served.calories! < 300, `served ${served.calories}`);
  assert.ok(dry.calories! > 550, `dry ${dry.calories}`);
});

test("cooked chicken weighs less than raw, so it carries more per gram", () => {
  const cooked = priceFoodRow({ name: "chicken breast", grams: 100, asServed: true });
  const raw = priceFoodRow({ name: "chicken breast", grams: 100, asServed: false });
  assert.equal(cooked.protein, Math.round(raw.protein! * COOKED_MEAT_FACTOR * 10) / 10);
});

test("herbs and lemon are negligible; a food the table does not know is unknown", () => {
  assert.equal(priceFoodRow({ name: "parsley", grams: 5, asServed: true }).source, "negligible");
  const u = priceFoodRow({ name: "tikka masala sauce", grams: 80, asServed: true });
  assert.equal(u.source, "unknown");
  assert.equal(u.calories, null);
});

test("totals add the known rows and list the unknown ones", () => {
  const t = priceFoods([
    { name: "olive oil", grams: 10, asServed: true },
    { name: "white rice", grams: 150, asServed: true },
    { name: "tikka masala sauce", grams: 80, asServed: true },
  ]);
  assert.equal(t.known.calories, t.rows[0].calories! + t.rows[1].calories!);
  assert.deepEqual(t.unknown, ["tikka masala sauce"]);
});

test("parseFoodRows: empty, too many, bad grams and missing names are refused; asServed defaults true", () => {
  assert.equal(parseFoodRows({}).ok, false);
  assert.equal(parseFoodRows({ foods: [] }).ok, false);
  assert.equal(parseFoodRows({ foods: Array(21).fill({ name: "rice", grams: 10 }) }).ok, false);
  assert.equal(parseFoodRows({ foods: [{ name: "rice", grams: 0 }] }).ok, false);
  assert.equal(parseFoodRows({ foods: [{ name: "rice", grams: 5000 }] }).ok, false);
  assert.equal(parseFoodRows({ foods: [{ name: " ", grams: 10 }] }).ok, false);
  const ok = parseFoodRows({ foods: [{ name: "rice", grams: 100 }] });
  assert.ok(ok.ok && ok.rows[0].asServed === true);
});

test("the tool adds a note only when something is unknown", async () => {
  const known = await foodsNutritionHandler(null, { foods: [{ name: "rice", grams: 100 }] });
  assert.ok(known.ok && !("note" in (known.data as object)));
  const unknown = await foodsNutritionHandler(null, { foods: [{ name: "mystery stew", grams: 100 }] });
  assert.ok(unknown.ok && "note" in (unknown.data as object));
  const bad = await foodsNutritionHandler(null, { foods: "rice" });
  assert.equal(bad.ok, false);
});
