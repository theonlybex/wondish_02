import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLogByDate, type LogRow } from "./log-view";

function row(over: Partial<LogRow> = {}): LogRow {
  return {
    id: "a",
    localDate: "2026-11-10",
    mealType: "lunch",
    name: "Soup",
    source: "CLARA",
    estimated: false,
    loggedAt: new Date("2026-11-10T12:00:00Z"),
    deletedAt: null,
    ...over,
  };
}

test("newest date first", () => {
  const out = groupLogByDate([
    row({ id: "1", localDate: "2026-11-09" }),
    row({ id: "2", localDate: "2026-11-11" }),
    row({ id: "3", localDate: "2026-11-10" }),
  ]);
  assert.deepEqual(out.map((d) => d.date), ["2026-11-11", "2026-11-10", "2026-11-09"]);
});

test("entries within a day are in loggedAt order", () => {
  const out = groupLogByDate([
    row({ id: "late", loggedAt: new Date("2026-11-10T19:00:00Z") }),
    row({ id: "early", loggedAt: new Date("2026-11-10T08:00:00Z") }),
  ]);
  assert.deepEqual(out[0].entries.map((e) => e.id), ["early", "late"]);
});

test("soft-deleted rows are excluded and a date with no rows is absent", () => {
  const out = groupLogByDate([
    row({ id: "gone", localDate: "2026-11-09", deletedAt: new Date() }),
    row({ id: "kept", localDate: "2026-11-10" }),
  ]);
  assert.deepEqual(out.map((d) => d.date), ["2026-11-10"]);
});

test("entry shape carries only the log fields", () => {
  const out = groupLogByDate([row({ id: "x", estimated: true })]);
  assert.deepEqual(out[0].entries[0], { id: "x", mealType: "lunch", name: "Soup", source: "CLARA", estimated: true });
});

test("grouping uses the localDate string, not the timestamp", () => {
  const out = groupLogByDate([row({ localDate: "2026-11-10", loggedAt: new Date("2026-11-11T02:00:00Z") })]);
  assert.equal(out[0].date, "2026-11-10");
});

test("a meal logged from a chat photo carries the photo's id; others do not", () => {
  const out = groupLogByDate([row({ id: "p", pictureResultId: "abc12345" }), row({ id: "q", pictureResultId: null })]);
  assert.equal(out[0].entries.find((e) => e.id === "p")?.photoId, "abc12345");
  assert.equal("photoId" in out[0].entries.find((e) => e.id === "q")!, false);
});

test("totals are per serving times servings; unknown numbers are left out", () => {
  const out = groupLogByDate([
    row({ id: "t", servings: 2, calories: 250.4, protein: 10.26, carbs: 30, fat: null }),
    row({ id: "u" }),
  ]);
  const t = out[0].entries.find((e) => e.id === "t")!;
  assert.deepEqual([t.calories, t.protein, t.carbs, t.fat], [501, 20.5, 60, undefined]);
  assert.equal("calories" in out[0].entries.find((e) => e.id === "u")!, false);
});
