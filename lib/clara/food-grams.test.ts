import { test } from "node:test";
import assert from "node:assert/strict";
import { COOKED_MEAT_FACTOR, foodsNutritionHandler, mealTotals, parseFoodRows, priceFoodRow } from "./food-grams";

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

test("the tool adds a note only when an unknown food has no figures", async () => {
  const known = await foodsNutritionHandler(null, { foods: [{ name: "rice", grams: 100 }] });
  assert.ok(known.ok && !("note" in (known.data as object)));
  const unknown = await foodsNutritionHandler(null, { foods: [{ name: "mystery stew", grams: 100 }] });
  assert.ok(unknown.ok && "note" in (unknown.data as object));
  // With Clara's own figures the unknown food is in the totals and there is nothing to ask for.
  const own = await foodsNutritionHandler(null, { foods: [{ name: "mystery stew", grams: 100, calories: 150, protein: 8, carbs: 12, fat: 7 }] });
  assert.ok(own.ok && !("note" in (own.data as object)));
  const bad = await foodsNutritionHandler(null, { foods: "rice" });
  assert.equal(bad.ok, false);
});

// 2026-11-27: logged meals came out too low. Three faults, each confirmed by pricing real foods.
test("a food that only CONTAINS a seasoning word is not counted as zero", () => {
  // Either left to Clara's estimate, or priced as the food it is (the table has rows for the common ones).
  for (const name of ["cinnamon roll", "garlic bread", "lemon cake", "lemon chicken", "basil pesto", "mint chocolate ice cream"]) {
    const r = priceFoodRow({ name, grams: 100, asServed: true });
    assert.ok(r.calories === null || r.calories > 180, `${name}: ${r.source} ${r.calories}`);
  }
  assert.equal(priceFoodRow({ name: "lemon chicken", grams: 100, asServed: true }).source, "unknown");
  // Protein powder has its own row in the table: 30 g is about 120 kcal.
  const powder = priceFoodRow({ name: "protein powder", grams: 30, asServed: true });
  assert.ok(powder.calories! > 100 && powder.calories! < 140, `protein powder ${powder.calories}`);
  // A seasoning on its own is still nothing.
  for (const name of ["salt", "black pepper", "fresh parsley", "garlic", "lemon juice", "soy sauce"]) {
    const r = priceFoodRow({ name, grams: 5, asServed: true });
    assert.equal(r.source, "negligible", name);
    assert.equal(r.calories, 0, name);
  }
  // Olives are food: 40 g is about 46 kcal.
  const olives = priceFoodRow({ name: "olives", grams: 40, asServed: true });
  assert.ok(olives.calories! > 35 && olives.calories! < 60, `olives ${olives.calories}`);
});

test("a prepared food is not priced as the raw food in its name", () => {
  // [food, the least 100 g of it can be worth]. Unknown is fine too: then Clara's own figure is used.
  for (const [name, least] of [["potato chips", 450], ["milk chocolate", 450], ["carrot cake", 300], ["mushroom risotto", 110], ["apple pie", 200], ["onion rings", 350], ["corn flakes", 300], ["sweet potato fries", 250], ["fried rice", 140]] as const) {
    const r = priceFoodRow({ name, grams: 100, asServed: true });
    assert.ok(r.calories === null || r.calories >= least, `${name}: ${r.calories}`);
  }
  for (const name of ["chocolate milk", "coconut milk", "potato curry", "rice pudding"]) {
    assert.equal(priceFoodRow({ name, grams: 100, asServed: true }).source, "unknown", name);
  }
  // A prepared food is priced as eaten: no cooking-loss factor, whatever meat is in its name.
  assert.equal(priceFoodRow({ name: "ham pizza", grams: 100, asServed: true }).calories, priceFoodRow({ name: "plain pizza", grams: 100, asServed: true }).calories);
});

test("plain foods with ordinary describing words are still priced from the table", () => {
  for (const name of ["white rice", "brown basmati rice", "grilled chicken breast", "skinless chicken breast", "extra virgin olive oil", "cherry tomatoes", "boiled eggs", "wholemeal bread", "Greek yogurt", "whole milk", "cheddar cheese", "mixed berries", "sweet potato", "green beans", "lean ground beef"]) {
    assert.equal(priceFoodRow({ name, grams: 100, asServed: true }).source, "food data", name);
  }
});

test("the most specific table row wins: peanut butter is not butter, almond milk is not almonds", () => {
  const pb = priceFoodRow({ name: "peanut butter", grams: 20, asServed: true });
  assert.ok(pb.protein! > 4, `peanut butter protein ${pb.protein}`);
  const am = priceFoodRow({ name: "almond milk", grams: 250, asServed: true });
  assert.ok(am.calories! < 100, `almond milk ${am.calories}`);
});

test("'cooked' shrinks grains only: cooked chicken and salmon keep their calories", () => {
  const plain = priceFoodRow({ name: "chicken breast", grams: 150, asServed: true });
  const said = priceFoodRow({ name: "cooked chicken breast", grams: 150, asServed: true });
  assert.equal(said.calories, plain.calories);
  const salmon = priceFoodRow({ name: "cooked salmon", grams: 150, asServed: true });
  assert.ok(salmon.calories! > 300, `salmon ${salmon.calories}`);
  // Green beans are a vegetable, not a dry pulse.
  const beans = priceFoodRow({ name: "green beans", grams: 100, asServed: true });
  assert.ok(beans.calories! > 18, `green beans ${beans.calories}`);
  // Grains still shrink.
  const rice = priceFoodRow({ name: "cooked rice", grams: 180, asServed: false });
  assert.ok(rice.calories! > 150 && rice.calories! < 300, `rice ${rice.calories}`);
});

// 2026-11-27: the sums are made in code. Clara used to add her own estimates to the table's totals herself and
// then retype the result into logs_create.
test("mealTotals: table figures for known foods, Clara's own for unknown ones, and nothing silently left out", () => {
  const t = mealTotals([
    { name: "white rice", grams: 180, asServed: true, own: { calories: 9999, protein: 0, carbs: 0, fat: 0 } },
    { name: "tikka masala sauce", grams: 80, asServed: true, own: { calories: 110, protein: 2, carbs: 8, fat: 8 } },
    { name: "mystery stew", grams: 100, asServed: true },
  ]);
  const rice = priceFoodRow({ name: "white rice", grams: 180, asServed: true });
  assert.equal(t.calories, rice.calories! + 110);
  assert.equal(t.fat, Math.round((rice.fat! + 8) * 10) / 10);
  assert.deepEqual(t.estimated, ["tikka masala sauce"]);
  assert.deepEqual(t.missing, ["mystery stew"]);
});

test("the tool returns the finished totals, and asks again only for an unknown food with no figures", async () => {
  const done = await foodsNutritionHandler(null, {
    foods: [
      { name: "olive oil", grams: 10 },
      { name: "moussaka", grams: 200, calories: 530, protein: 22, carbs: 66, fat: 20 },
    ],
  });
  assert.ok(done.ok);
  const d = done.data as { totals: { calories: number }; estimated: string[]; missing?: string[]; note?: string };
  assert.equal(d.totals.calories, 90 + 530);
  assert.deepEqual(d.estimated, ["moussaka"]);
  assert.ok(!("missing" in d) && !("note" in d));
  const short = await foodsNutritionHandler(null, { foods: [{ name: "moussaka", grams: 200 }] });
  const s = short.ok ? (short.data as { missing?: string[]; note?: string }) : {};
  assert.deepEqual(s.missing, ["moussaka"]);
  assert.ok(typeof s.note === "string" && s.note.includes("call foods_nutrition again"));
});

// 2026-11-27: the foods and totals are written into the reply by code. In a live run Clara priced a meal and
// then asked "Log as lunch?" without ever saying what it came to.
test("the tool writes the foods and totals itself, and names what is Clara's own estimate", async () => {
  const r = await foodsNutritionHandler(null, {
    foods: [
      { name: "olive oil", grams: 10 },
      { name: "moussaka", grams: 200, calories: 530, protein: 22, carbs: 66, fat: 20 },
    ],
  });
  assert.ok(r.ok);
  assert.equal(
    (r as { say?: string }).say,
    "Olive oil 10 g, moussaka 200 g.\nPer serving: 620 kcal, 22 g protein, 66 g carbs, 30 g fat.\nMy own estimate: moussaka.",
  );
  const known = await foodsNutritionHandler(null, { foods: [{ name: "white rice", grams: 180 }] });
  assert.ok(known.ok && !(known as { say: string }).say.includes("My own estimate"));
  // Not while a food still has no figures: the totals are not finished.
  const short = await foodsNutritionHandler(null, { foods: [{ name: "moussaka", grams: 200 }] });
  assert.ok(short.ok && !("say" in short));
});
