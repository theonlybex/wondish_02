import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateGaps, MIN_SAMPLE_USERS, MIN_SAMPLE_DAYS } from "./admin-gaps";

const row = (patientId: string, category: string, reason = "NOT_BUILT", summary = "s") => ({
  patientId,
  category,
  reason,
  summary,
  surface: "web",
  localDate: "2026-07-31",
});

test("ranking counts distinct users, not rows", () => {
  const report = aggregateGaps(
    [
      row("p1", "LOGS"),
      row("p1", "LOGS"),
      row("p1", "LOGS"),
      row("p2", "JOURNAL"),
      row("p3", "JOURNAL"),
    ],
    { previous: [] }
  );
  assert.deepEqual(
    report.buildable.map((r) => [r.category, r.distinctUsers, r.rows]),
    [
      ["JOURNAL", 2, 2],
      ["LOGS", 1, 3],
    ]
  );
});

test("OUT_OF_SCOPE and FLAGGED_OFF never enter the buildable list", () => {
  const report = aggregateGaps(
    [row("p1", "LOGS"), row("p2", "OTHER", "OUT_OF_SCOPE"), row("p3", "GROCERY", "FLAGGED_OFF")],
    { previous: [] }
  );
  assert.deepEqual(report.buildable.map((r) => r.category), ["LOGS"]);
  assert.deepEqual(report.outOfScope.map((r) => r.category), ["OTHER"]);
  assert.deepEqual(report.flaggedOff.map((r) => r.category), ["GROCERY"]);
});

test("UNCLEAR counts as buildable demand — it is still someone asking", () => {
  const report = aggregateGaps([row("p1", "LOGS", "UNCLEAR")], { previous: [] });
  assert.deepEqual(report.buildable.map((r) => r.category), ["LOGS"]);
});

test("trend compares distinct users against the previous window", () => {
  const report = aggregateGaps([row("p1", "LOGS"), row("p2", "LOGS")], {
    previous: [row("p9", "LOGS")],
  });
  assert.equal(report.buildable[0].trend, 1);
});

test("trend is null when the category is new this window", () => {
  const report = aggregateGaps([row("p1", "LOGS")], { previous: [] });
  assert.equal(report.buildable[0].trend, null);
});

test("at most three sample summaries are surfaced per category", () => {
  const rows = ["a", "b", "c", "d"].map((s, i) => row(`p${i}`, "LOGS", "NOT_BUILT", s));
  assert.equal(aggregateGaps(rows, { previous: [] }).buildable[0].samples.length, 3);
});

test("ties break alphabetically so the ranking is stable across reloads", () => {
  const report = aggregateGaps([row("p1", "TASTE"), row("p2", "FRIDGE")], { previous: [] });
  assert.deepEqual(report.buildable.map((r) => r.category), ["FRIDGE", "TASTE"]);
});

test("totalRows counts every row, including the excluded buckets", () => {
  const report = aggregateGaps([row("p1", "LOGS"), row("p2", "OTHER", "OUT_OF_SCOPE")], {
    previous: [],
  });
  assert.equal(report.totalRows, 2);
});

test("the re-rank thresholds match the spec", () => {
  assert.equal(MIN_SAMPLE_USERS, 20);
  assert.equal(MIN_SAMPLE_DAYS, 14);
});
