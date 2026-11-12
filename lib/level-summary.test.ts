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
