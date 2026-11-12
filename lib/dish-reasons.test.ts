import { test } from "node:test";
import assert from "node:assert/strict";
import { dishReasons, FIBRE_REASON_MIN_G, SODIUM_REASON_MAX_MG } from "./dish-reasons";
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

test("the thresholds are the brief's: 25% of 28 g fibre, 350 mg sodium", () => {
  assert.equal(FIBRE_REASON_MIN_G, 7);
  assert.equal(SODIUM_REASON_MAX_MG, 350);
});

test("fibre: little this week and the dish gives 25% or more of 28 g → up", () => {
  const reasons = dishReasons({ fibre: 7, sodium: 900 }, LITTLE_FIBRE);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].level, "fibre");
  assert.equal(reasons[0].direction, "up");
  assert.match(reasons[0].text, /you've had little fibre this week/);
});

test("fibre: a dish under 7 g gives no fibre reason", () => {
  assert.deepEqual(dishReasons({ fibre: 6.9, sodium: 900 }, LITTLE_FIBRE), []);
});

test("fibre: on track this week gives no fibre reason, however much the dish has", () => {
  assert.deepEqual(dishReasons({ fibre: 15, sodium: 900 }, NEITHER), []);
});

test("sodium: a lot this week and the dish has 350 mg or less per serving → down", () => {
  const reasons = dishReasons({ fibre: 2, sodium: 350 }, A_LOT_OF_SODIUM);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].level, "sodium");
  assert.equal(reasons[0].direction, "down");
  assert.match(reasons[0].text, /you've had a lot of sodium this week/);
});

test("sodium: 351 mg gives no sodium reason", () => {
  assert.deepEqual(dishReasons({ fibre: 2, sodium: 351 }, A_LOT_OF_SODIUM), []);
});

test("sodium: an unpriced dish (null) never gets a sodium reason", () => {
  assert.deepEqual(dishReasons({ fibre: 2, sodium: null }, A_LOT_OF_SODIUM), []);
});

test("sodium within limit gives no sodium reason, however little the dish has", () => {
  assert.deepEqual(dishReasons({ fibre: 2, sodium: 100 }, NEITHER), []);
});

test("nothing fires → []", () => {
  assert.deepEqual(dishReasons({ fibre: 3, sodium: 800 }, BOTH), []);
});

test("no logs at all → [] (no level has a word, nothing is invented)", () => {
  const empty = summarizeLevels([], null, RANGE);
  assert.deepEqual(dishReasons({ fibre: 20, sodium: 50 }, empty), []);
});

test("both rules fire → two reasons, never more than three", () => {
  const reasons = dishReasons({ fibre: 12, sodium: 200 }, BOTH);
  assert.deepEqual(reasons.map((r) => [r.level, r.direction]), [["fibre", "up"], ["sodium", "down"]]);
  assert.ok(reasons.length <= 3);
});

test("wording is about intake, never the body", () => {
  for (const r of dishReasons({ fibre: 12, sodium: 200 }, BOTH)) {
    assert.ok(!/your (fibre|sodium) is/i.test(r.text), r.text);
  }
});
