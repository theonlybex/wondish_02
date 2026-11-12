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
