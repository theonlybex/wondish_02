import { test } from "node:test";
import assert from "node:assert/strict";
import { computeJourneyStats } from "./journey";

// Local-time Date constructor avoids timezone off-by-one: fmt() formats with
// local getFullYear/getMonth/getDate, so UTC-parsed strings like "2026-06-30"
// can render as the previous day in negative-offset timezones.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

const meal = (over: Partial<{ skipped: boolean; preparation: string | null }> = {}) => ({
  skipped: false,
  preparation: "cooked" as string | null,
  ...over,
});

const entry = (
  over: Partial<{
    date: Date | string;
    mood: string | null;
    energyLevel: string | null;
    weight: number | null;
    meals: { skipped: boolean; preparation?: string | null }[];
  }> = {}
) => ({
  date: d(2026, 6, 30),
  mood: null,
  energyLevel: null,
  weight: null,
  meals: [] as { skipped: boolean; preparation?: string | null }[],
  ...over,
});

test("empty entries: all-zero stats with null avgWeight and empty series", () => {
  const s = computeJourneyStats([]);
  assert.deepEqual(s, {
    avgMood: 0,
    avgEnergy: 0,
    avgWeight: null,
    engagementPercent: 0,
    mealSourceBreakdown: { cooked: 0, skipped: 0, readyToEat: 0, restaurant: 0 },
    dailyMoods: [],
    dailyWeights: [],
  });
});

test("avgMood/avgEnergy: averages parseable values and rounds to 1 decimal", () => {
  const s = computeJourneyStats([
    entry({ mood: "3", energyLevel: "2" }),
    entry({ mood: "4", energyLevel: "5" }),
    entry({ mood: "5", energyLevel: "3" }),
  ]);
  assert.equal(s.avgMood, 4); // (3+4+5)/3
  assert.equal(s.avgEnergy, 3.3); // 10/3 = 3.333... -> 3.3
});

test("avgMood: null, zero, negative, and non-numeric moods are excluded from the average", () => {
  const s = computeJourneyStats([
    entry({ mood: null }),
    entry({ mood: "0" }),
    entry({ mood: "-2" }),
    entry({ mood: "not-a-number" }),
    entry({ mood: "4" }),
  ]);
  assert.equal(s.avgMood, 4); // only the "4" survives the > 0 filter
});

test("avgMood/avgEnergy: 0 when no entry has a positive value", () => {
  const s = computeJourneyStats([entry({ mood: "0" }), entry({ energyLevel: null })]);
  assert.equal(s.avgMood, 0);
  assert.equal(s.avgEnergy, 0);
});

test("avgWeight: averages present weights, rounds to 1 decimal, null when absent", () => {
  const withWeights = computeJourneyStats([
    entry({ weight: 70.25 }),
    entry({ weight: 71 }),
    entry({ weight: null }),
  ]);
  assert.equal(withWeights.avgWeight, 70.6); // 141.25/2 = 70.625 -> 70.6

  const noWeights = computeJourneyStats([entry(), entry()]);
  assert.equal(noWeights.avgWeight, null);
});

test("avgWeight: a literal 0 weight is treated as absent (falsy filter)", () => {
  const s = computeJourneyStats([entry({ weight: 0 }), entry({ weight: 80 })]);
  assert.equal(s.avgWeight, 80);
  assert.deepEqual(s.dailyWeights.map((w) => w.weight), [80]);
});

test("mealSourceBreakdown: counts each preparation across all entries", () => {
  const s = computeJourneyStats([
    entry({
      meals: [
        meal({ preparation: "cooked" }),
        meal({ preparation: "ready-to-eat" }),
        meal({ preparation: "restaurant" }),
      ],
    }),
    entry({
      meals: [meal({ preparation: "cooked" }), meal({ skipped: true, preparation: null })],
    }),
  ]);
  assert.deepEqual(s.mealSourceBreakdown, {
    cooked: 2,
    skipped: 1,
    readyToEat: 1,
    restaurant: 1,
  });
});

test('mealSourceBreakdown: skipped (flag or preparation === "skipped") is an exclusive bucket', () => {
  const s = computeJourneyStats([
    entry({
      meals: [
        meal({ skipped: true, preparation: "cooked" }), // flag wins even with a preparation
        meal({ skipped: false, preparation: "skipped" }),
        meal({ preparation: "cooked" }),
      ],
    }),
  ]);
  assert.equal(s.mealSourceBreakdown.skipped, 2);
  // A skipped-flagged meal never double-counts in its preparation bucket.
  assert.equal(s.mealSourceBreakdown.cooked, 1);
});

test("mealSourceBreakdown: unknown preparations count toward no bucket", () => {
  const s = computeJourneyStats([entry({ meals: [meal({ preparation: "microwaved" })] })]);
  assert.deepEqual(s.mealSourceBreakdown, {
    cooked: 0,
    skipped: 0,
    readyToEat: 0,
    restaurant: 0,
  });
});

test("engagementPercent: engaged entries over totalDays window", () => {
  const engaged = entry({ meals: [meal()] });
  const allSkipped = entry({ meals: [meal({ skipped: true })] });
  const noMeals = entry({ meals: [] });
  const s = computeJourneyStats([engaged, engaged, allSkipped, noMeals], 10);
  assert.equal(s.engagementPercent, 20); // 2 engaged / 10 days
});

test("engagementPercent: falls back to entries.length when totalDays omitted", () => {
  const engaged = entry({ meals: [meal()] });
  const idle = entry({ meals: [meal({ skipped: true })] });
  const s = computeJourneyStats([engaged, idle, idle, idle]);
  assert.equal(s.engagementPercent, 25); // 1/4
});

test("engagementPercent: totalDays smaller than entry count cannot inflate past entries.length denominator", () => {
  const engaged = entry({ meals: [meal()] });
  const s = computeJourneyStats([engaged, engaged, engaged], 1);
  // Math.max(totalDays, entries.length, 1) keeps the denominator at 3 -> 100, not 300.
  assert.equal(s.engagementPercent, 100);
});

test("engagementPercent: rounds to nearest integer in both directions", () => {
  const engaged = entry({ meals: [meal()] });
  const down = computeJourneyStats([engaged], 3);
  assert.equal(down.engagementPercent, 33); // 1/3 -> 33.33 -> 33
  const idle = entry({ meals: [] });
  const up = computeJourneyStats([engaged, engaged, idle], 3);
  assert.equal(up.engagementPercent, 67); // 2/3 -> 66.67 -> 67
});

test("engagementPercent: 0 when every entry is fully skipped", () => {
  const s = computeJourneyStats(
    [entry({ meals: [meal({ skipped: true }), meal({ skipped: true })] })],
    7
  );
  assert.equal(s.engagementPercent, 0);
});

test("dailyMoods: formats Date and string dates as YYYY-MM-DD with zero padding", () => {
  const s = computeJourneyStats([
    entry({ date: d(2026, 6, 5), mood: "3" }),
    entry({ date: "2026-01-09T12:00:00", mood: "4" }), // local-noon string avoids TZ shift
  ]);
  assert.deepEqual(s.dailyMoods, [
    { date: "2026-06-05", mood: 3 },
    { date: "2026-01-09", mood: 4 },
  ]);
});

test("dailyMoods/dailyWeights: entries without the value are omitted", () => {
  const s = computeJourneyStats([
    entry({ date: d(2026, 6, 1), mood: "2", weight: null }),
    entry({ date: d(2026, 6, 2), mood: null, weight: 65.5 }),
    entry({ date: d(2026, 6, 3) }),
  ]);
  assert.deepEqual(s.dailyMoods, [{ date: "2026-06-01", mood: 2 }]);
  assert.deepEqual(s.dailyWeights, [{ date: "2026-06-02", weight: 65.5 }]);
});

test("dailyMoods: a non-numeric mood string is excluded from the chart", () => {
  // A truthy non-numeric mood must not become a NaN chart point: dailyMoods
  // shares avgMood's numeric > 0 inclusion rule.
  const s = computeJourneyStats([entry({ date: d(2026, 6, 1), mood: "great" })]);
  assert.equal(s.avgMood, 0);
  assert.deepEqual(s.dailyMoods, []);
});

test('dailyMoods: mood "0" is excluded from both avgMood and the chart', () => {
  // Chart and average share the same n > 0 inclusion rule — "0" appears in neither.
  const s = computeJourneyStats([entry({ date: d(2026, 6, 1), mood: "0" })]);
  assert.equal(s.avgMood, 0);
  assert.deepEqual(s.dailyMoods, []);
});

test("fmt: a date-only ISO string formats as itself in every timezone", () => {
  // new Date("2026-06-01") is midnight UTC — read back through local getters it
  // renders as 2026-05-31 anywhere west of UTC. A date-only string is already
  // the answer and must pass through untouched.
  const s = computeJourneyStats([entry({ date: "2026-06-01", mood: "3", weight: 70 })]);
  assert.deepEqual(s.dailyMoods, [{ date: "2026-06-01", mood: 3 }]);
  assert.deepEqual(s.dailyWeights, [{ date: "2026-06-01", weight: 70 }]);
});

// ─── computeMacroStats (additive — everything above this line is pinned) ─────

import { computeMacroStats } from "./journey";

const log = (
  over: Partial<{
    localDate: string;
    servings: number;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    incomplete: boolean;
    deletedAt: Date | null;
  }> = {}
) => ({
  localDate: "2026-07-01",
  servings: 1,
  calories: 2000,
  protein: 100,
  carbs: 200,
  fat: 60,
  fiber: 20,
  incomplete: false,
  deletedAt: null as Date | null,
  ...over,
});

const TGT = { calories: 2100, protein: 158, carbs: 236, fat: 47 };

test("computeMacroStats: empty logs → zeroed stats with target passthrough", () => {
  const s = computeMacroStats([], TGT);
  assert.deepEqual(s, {
    dailyMacros: [],
    avgCalories: 0,
    avgProtein: 0,
    avgCarbs: 0,
    avgFat: 0,
    daysLogged: 0,
    daysComplete: 0,
    daysIncomplete: 0,
    daysOnTarget: 0,
    target: TGT,
  });
  assert.equal(computeMacroStats([], null).target, null);
});

test("computeMacroStats: groups by the localDate string — no Date math, no tz shift", () => {
  // A UTC-7 clock would render new Date("2026-07-01") as 2026-06-30; grouping
  // on the string is structurally immune. Output dates must be the exact
  // input strings, ascending.
  const s = computeMacroStats(
    [
      log({ localDate: "2026-07-02", calories: 500, protein: 30, carbs: 40, fat: 10, servings: 2 }),
      log({ localDate: "2026-07-01", calories: 2000, protein: 100, carbs: 200, fat: 60 }),
      log({ localDate: "2026-07-02", calories: 300, protein: 10, carbs: 50, fat: 5 }),
    ],
    null
  );
  assert.deepEqual(
    s.dailyMacros.map((d) => d.date),
    ["2026-07-01", "2026-07-02"]
  );
  // servings scale per row: 500×2 + 300×1 = 1300.
  assert.deepEqual(s.dailyMacros[1], {
    date: "2026-07-02",
    calories: 1300,
    protein: 70,
    carbs: 130,
    fat: 25,
    incomplete: false,
  });
  assert.equal(s.daysLogged, 2);
  assert.equal(s.daysComplete, 2);
  // averages over day totals: (2000 + 1300) / 2.
  assert.equal(s.avgCalories, 1650);
  assert.equal(s.avgProtein, 85);
});

test("computeMacroStats: tombstoned rows are excluded; an all-tombstone day vanishes", () => {
  const dead = new Date(2026, 6, 3);
  const s = computeMacroStats(
    [
      log({ localDate: "2026-07-01", calories: 1000 }),
      log({ localDate: "2026-07-01", calories: 400, deletedAt: dead }),
      log({ localDate: "2026-07-02", calories: 900, deletedAt: dead }),
    ],
    null
  );
  assert.deepEqual(s.dailyMacros.map((d) => d.date), ["2026-07-01"]);
  assert.equal(s.dailyMacros[0].calories, 1000);
  assert.equal(s.daysLogged, 1);
});

test("computeMacroStats: all-incomplete day quarantined — flagged in dailyMacros, out of averages and daysOnTarget, counted in daysIncomplete", () => {
  // Plan fixture: 3 days, one fully incomplete. Without the quarantine the
  // unpriceable 0-kcal day would drag avgCalories to 1400 and read as
  // "wildly under target".
  const s = computeMacroStats(
    [
      log({ localDate: "2026-07-01", calories: 2000 }),
      log({ localDate: "2026-07-02", calories: 2200 }),
      log({ localDate: "2026-07-03", calories: 0, protein: 0, carbs: 0, fat: 0, incomplete: true }),
      log({ localDate: "2026-07-03", calories: 0, protein: 0, carbs: 0, fat: 0, incomplete: true }),
    ],
    TGT
  );
  assert.equal(s.daysLogged, 3);
  assert.equal(s.daysComplete, 2);
  assert.equal(s.daysIncomplete, 1);
  // Still present-but-flagged in the series.
  assert.deepEqual(s.dailyMacros.map((d) => [d.date, d.incomplete]), [
    ["2026-07-01", false],
    ["2026-07-02", false],
    ["2026-07-03", true],
  ]);
  // Averages divide by daysComplete (2), not daysLogged (3).
  assert.equal(s.avgCalories, 2100);
  // 2000 and 2200 are both within ±10% of 2100; the quarantined day is excluded.
  assert.equal(s.daysOnTarget, 2);
});

test("computeMacroStats: a day with SOME complete rows counts normally, flagged incomplete", () => {
  const s = computeMacroStats(
    [
      log({ localDate: "2026-07-01", calories: 1800 }),
      log({ localDate: "2026-07-01", calories: 0, protein: 0, carbs: 0, fat: 0, incomplete: true }),
    ],
    null
  );
  assert.equal(s.daysComplete, 1);
  assert.equal(s.daysIncomplete, 0);
  assert.equal(s.dailyMacros[0].incomplete, true);
  assert.equal(s.avgCalories, 1800);
});

test("computeMacroStats: daysOnTarget ±10% edges are ratio-based (target 2100)", () => {
  const s = computeMacroStats(
    [
      log({ localDate: "2026-07-01", calories: 1889 }), // 10.05% under → out
      log({ localDate: "2026-07-02", calories: 1891 }), //  9.95% under → in
      log({ localDate: "2026-07-03", calories: 2309 }), //  9.95% over  → in
      log({ localDate: "2026-07-04", calories: 2311 }), // 10.05% over  → out
    ],
    TGT
  );
  assert.equal(s.daysOnTarget, 2);
  // No target → nothing can be "on target", complete days unaffected.
  const noTarget = computeMacroStats([log({ calories: 2100 })], null);
  assert.equal(noTarget.daysOnTarget, 0);
  assert.equal(noTarget.daysComplete, 1);
});

test("computeMacroStats: every logged day incomplete → zero averages via the Math.max(1) guard", () => {
  const s = computeMacroStats(
    [log({ calories: 0, protein: 0, carbs: 0, fat: 0, incomplete: true })],
    TGT
  );
  assert.equal(s.daysLogged, 1);
  assert.equal(s.daysComplete, 0);
  assert.equal(s.daysIncomplete, 1);
  assert.equal(s.avgCalories, 0);
  assert.equal(s.daysOnTarget, 0);
});

test("computeMacroStats: day totals and averages are r1-rounded at the boundary", () => {
  // 433.33 × 1.5 = 649.995 → r1 → 650 at the day-total boundary (sumMealLogs),
  // and the average of one day echoes it.
  const s = computeMacroStats(
    [log({ calories: 433.33, protein: 21.11, carbs: 40.04, fat: 10.02, servings: 1.5 })],
    null
  );
  assert.equal(s.dailyMacros[0].calories, 650);
  assert.equal(s.avgCalories, 650);
  assert.equal(s.avgProtein, 31.7); // 21.11 × 1.5 = 31.665 → r1 → 31.7
});
