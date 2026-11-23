import { test } from "node:test";
import assert from "node:assert/strict";
import { levelDaysFromRows, type MealLevelRow } from "./level-summary";
import { summarizeLevels } from "./levels";

const RANGE = { fromDate: "2026-11-06", toDate: "2026-11-12" };

function row(localDate: string, sodium: number | null, servings = 1): MealLevelRow {
  return { localDate, servings, calories: 600, protein: 30, carbs: 70, fat: 20, fiber: 8, sodium };
}

test("a day where only some meals carry sodium has no sodium for that day", () => {
  const days = levelDaysFromRows([row("2026-11-12", 900), row("2026-11-12", null), row("2026-11-12", null)]);
  assert.equal(days.length, 1);
  assert.equal(days[0].meals, 3);
  assert.equal(days[0].sodium, null);
  assert.equal(days[0].calories, 1800, "the other numbers still add up");
});

test("a day where every meal carries sodium sums each meal's per-serving sodium times its servings", () => {
  const days = levelDaysFromRows([row("2026-11-12", 400, 2), row("2026-11-12", 300, 0.5), row("2026-11-12", 1000)]);
  assert.equal(days[0].sodium, 400 * 2 + 300 * 0.5 + 1000);
});

test("a week where no day has sodium on every meal gives no sodium amount and no word", () => {
  const rows = [
    row("2026-11-10", 900), row("2026-11-10", null), row("2026-11-10", null),
    row("2026-11-11", null), row("2026-11-11", 3000), row("2026-11-11", null),
    row("2026-11-12", 2500), row("2026-11-12", null), row("2026-11-12", null),
  ];
  const summary = summarizeLevels(levelDaysFromRows(rows), null, RANGE);
  const sodium = summary.levels.find((l) => l.key === "sodium")!;
  assert.equal(sodium.amount, null);
  assert.equal(sodium.word, null);
});

// Simulation finding 1 (docs/qa/clara-first-sim.md): a meal with no fibre
// figure used to count as 0 g, which read as "little fibre". Fibre now follows
// the sodium rule: a day's fibre is known only when every meal carries it.
const fibreRow = (localDate: string, fiber: number | null): MealLevelRow =>
  ({ localDate, servings: 1, calories: 600, protein: 30, carbs: 70, fat: 20, fiber, sodium: 500 });

test("a day where one meal has no fibre figure has no fibre for that day", () => {
  const days = levelDaysFromRows([fibreRow("2026-11-12", 8), fibreRow("2026-11-12", null)]);
  assert.equal(days[0].fibre, null);
  assert.equal(days[0].protein, 60, "the other numbers still add up");
});

test("a week whose every day misses a fibre figure gives no fibre amount and no word", () => {
  const rows = ["2026-11-10", "2026-11-11", "2026-11-12"].flatMap((d) => [fibreRow(d, 3), fibreRow(d, null)]);
  const s = summarizeLevels(levelDaysFromRows(rows), null, RANGE);
  const fibre = s.levels.find((l) => l.key === "fibre")!;
  assert.equal(fibre.amount, null);
  assert.equal(fibre.word, null);
  assert.deepEqual(s.little, []);
});

test("fibre averages only the days whose fibre is fully known", () => {
  const rows = [fibreRow("2026-11-11", 20), fibreRow("2026-11-11", 10), fibreRow("2026-11-12", 5), fibreRow("2026-11-12", null)];
  const s = summarizeLevels(levelDaysFromRows(rows), null, RANGE);
  assert.equal(s.levels.find((l) => l.key === "fibre")!.amount, 30);
});

test("levelDaysFromRows counts the day's main meals once each; snacks are not meals; unknown types leave it out", () => {
  const row = (mealType: string | undefined) => ({ localDate: "2026-11-20", servings: 1, calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2, sodium: 100, ...(mealType ? { mealType } : {}) });
  assert.deepEqual(levelDaysFromRows([row("breakfast"), row("snack"), row("Snack"), row("dinner"), row("dinner")]).map((d) => [d.meals, d.mainMeals]), [[5, 2]]);
  assert.deepEqual(levelDaysFromRows([row("snack"), row("snack")]).map((d) => d.mainMeals), [0]);
  assert.deepEqual(levelDaysFromRows([row("lunch"), row(undefined)]).map((d) => d.mainMeals), [undefined]);
});
