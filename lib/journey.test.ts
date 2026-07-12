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

test('mealSourceBreakdown: skipped counts both the flag and preparation === "skipped"', () => {
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
  // A skipped-flagged meal with preparation "cooked" is double-counted as cooked too.
  assert.equal(s.mealSourceBreakdown.cooked, 2);
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

test("dailyMoods: a non-numeric mood string is charted as NaN", () => {
  // Documents a source hazard: dailyMoods filters only falsy strings, so a
  // truthy non-numeric mood passes the filter and parseFloat yields NaN —
  // a chart-breaking data point avgMood correctly excludes.
  const s = computeJourneyStats([entry({ date: d(2026, 6, 1), mood: "great" })]);
  assert.equal(s.avgMood, 0);
  assert.deepEqual(s.dailyMoods, [{ date: "2026-06-01", mood: NaN }]);
});

test('dailyMoods: mood "0" is excluded from avgMood but still charted (truthy string)', () => {
  // Documents an inconsistency: avgMood filters n > 0, dailyMoods only filters
  // falsy strings — "0" passes and charts a 0-mood point the average ignores.
  const s = computeJourneyStats([entry({ date: d(2026, 6, 1), mood: "0" })]);
  assert.equal(s.avgMood, 0);
  assert.deepEqual(s.dailyMoods, [{ date: "2026-06-01", mood: 0 }]);
});
