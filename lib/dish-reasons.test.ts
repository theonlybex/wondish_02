import { test } from "node:test";
import assert from "node:assert/strict";
import { dishReasons, fibreRichIngredient, SODIUM_REASON_MAX_MG } from "./dish-reasons";
import { summarizeLevels, type LevelDayInput, type LevelSummary } from "./levels";

const RANGE = { fromDate: "2026-11-06", toDate: "2026-11-12" };

function day(localDate: string, fibre: number, sodium: number | null): LevelDayInput {
  return { localDate, meals: 3, calories: 1800, protein: 90, carbs: 200, fat: 60, fibre, sodium };
}
/** Three full days at the given daily fibre and sodium. */
function summary(fibre: number, sodium: number | null): LevelSummary {
  return summarizeLevels(
    [day("2026-11-10", fibre, sodium), day("2026-11-11", fibre, sodium), day("2026-11-12", fibre, sodium)],
    null,
    RANGE,
  );
}

const LITTLE_FIBRE = summary(10, 1800); // 10 g < 70% of 28 g; sodium within limit
const A_LOT_OF_SODIUM = summary(30, 3200); // fibre on track; sodium over 2,300
const BOTH = summary(10, 3200);
const NEITHER = summary(30, 1800);

const LENTIL_DISH = ["red lentils", "spinach", "olive oil"];
const NO_FIBRE_DISH = ["chicken breast", "white rice", "olive oil"];

test("the sodium threshold is the brief's 350 mg", () => {
  assert.equal(SODIUM_REASON_MAX_MG, 350);
});

test("fibre: little this week and the dish has a fibre-rich ingredient → up, naming it", () => {
  const reasons = dishReasons({ ingredients: LENTIL_DISH, sodium: 900 }, LITTLE_FIBRE);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].level, "fibre");
  assert.equal(reasons[0].direction, "up");
  assert.equal(reasons[0].text, "Red lentils are rich in fibre, and you've had little this week.");
});

test("fibre: the reason states no grams and no share of the day", () => {
  const [r] = dishReasons({ ingredients: LENTIL_DISH, sodium: null }, LITTLE_FIBRE);
  assert.ok(!/\d/.test(r.text), r.text);
  assert.ok(!/%|\bg\b|gram/i.test(r.text), r.text);
});

test("fibre: a singular ingredient reads 'is'", () => {
  const [r] = dishReasons({ ingredients: ["salmon", "quinoa"], sodium: null }, LITTLE_FIBRE);
  assert.equal(r.text, "Quinoa is rich in fibre, and you've had little this week.");
});

test("fibre: no fibre-rich ingredient → no fibre reason, whatever the model claimed", () => {
  assert.deepEqual(dishReasons({ ingredients: NO_FIBRE_DISH, sodium: 900 }, LITTLE_FIBRE), []);
});

test("fibre: on track this week gives no fibre reason, however rich the dish", () => {
  assert.deepEqual(dishReasons({ ingredients: LENTIL_DISH, sodium: 900 }, NEITHER), []);
});

test("fibre list: catalog spellings, singular and plural, match (the plural trap)", () => {
  for (const name of [
    "Lentils", "lentil", "Chickpeas", "chickpea", "Black beans", "kidney bean", "Green peas", "split pea",
    "Rolled oats", "oat", "Pearl barley", "Quinoa", "Brown rice", "Whole-wheat bread", "whole wheat pasta",
    "Wholemeal tortillas", "Chia seeds", "chia seed", "Flaxseeds", "flax seed", "Ground linseed", "Edamame",
  ]) {
    assert.ok(fibreRichIngredient([name]), name);
  }
});

test("fibre list: lookalikes that are not fibre-rich do not match", () => {
  for (const name of [
    "Green beans", "string beans", "vanilla bean", "coffee beans", "Snow peas", "sugar snap peas", "oat milk",
    "pea protein", "white rice", "white bread", "pasta", "goats cheese", "peanut butter", "boats",
  ]) {
    assert.equal(fibreRichIngredient([name]), null, name);
  }
});

test("fibre: the first fibre-rich ingredient in the dish's own order is named", () => {
  assert.equal(fibreRichIngredient(["chicken", "brown rice", "black beans"])?.name, "brown rice");
});

test("sodium: a lot this week and the dish has 350 mg or less per serving → down", () => {
  const reasons = dishReasons({ ingredients: NO_FIBRE_DISH, sodium: 350 }, A_LOT_OF_SODIUM);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].level, "sodium");
  assert.equal(reasons[0].direction, "down");
  assert.match(reasons[0].text, /you've had a lot of sodium this week/);
});

test("sodium: 351 mg gives no sodium reason", () => {
  assert.deepEqual(dishReasons({ ingredients: NO_FIBRE_DISH, sodium: 351 }, A_LOT_OF_SODIUM), []);
});

test("sodium: an incompletely priced dish (null) never gets a sodium reason", () => {
  assert.deepEqual(dishReasons({ ingredients: NO_FIBRE_DISH, sodium: null }, A_LOT_OF_SODIUM), []);
});

test("sodium within limit gives no sodium reason, however little the dish has", () => {
  assert.deepEqual(dishReasons({ ingredients: NO_FIBRE_DISH, sodium: 100 }, NEITHER), []);
});

test("nothing fires → []", () => {
  assert.deepEqual(dishReasons({ ingredients: NO_FIBRE_DISH, sodium: 800 }, BOTH), []);
});

test("no logs at all → [] (no level has a word, nothing is invented)", () => {
  const empty = summarizeLevels([], null, RANGE);
  assert.deepEqual(dishReasons({ ingredients: LENTIL_DISH, sodium: 50 }, empty), []);
});

test("both rules fire → two reasons, never more than three", () => {
  const reasons = dishReasons({ ingredients: LENTIL_DISH, sodium: 200 }, BOTH);
  assert.deepEqual(reasons.map((r) => [r.level, r.direction]), [["fibre", "up"], ["sodium", "down"]]);
  assert.ok(reasons.length <= 3);
});

test("wording is about intake, never the body", () => {
  for (const r of dishReasons({ ingredients: LENTIL_DISH, sodium: 200 }, BOTH)) {
    assert.ok(!/your (fibre|sodium) is/i.test(r.text), r.text);
  }
});
