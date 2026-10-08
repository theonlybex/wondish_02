import { test } from "node:test";
import assert from "node:assert/strict";
import { rankIssues, issueScore } from "./rank";

const now = new Date("2026-10-07T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86400000);
const issue = (id: string, severity: any, status: any, reports: [string, number][]) => ({ id, severity, status, reports: reports.map(([patientId, d]) => ({ patientId, createdAt: day(d) })) });

test("score = weight × distinct reporters × recency", () => {
  assert.equal(issueScore(issue("a", "HIGH", "NEW", [["u1", 1], ["u1", 2], ["u2", 3]]), now), 20 * 2 * 1);
  assert.equal(issueScore(issue("b", "MEDIUM", "NEW", [["u1", 20]]), now), 5 * 1 * 0.5);
  assert.equal(issueScore(issue("c", "LOW", "NEW", [["u1", 90]]), now), 1 * 1 * 0.25);
});

test("CRITICAL first even with fewer reporters; closed go to their own list", () => {
  const r = rankIssues([
    issue("many", "HIGH", "NEW", [["u1", 1], ["u2", 1], ["u3", 1], ["u4", 1], ["u5", 1], ["u6", 1]]),
    issue("crit", "CRITICAL", "INVESTIGATING", [["u9", 40]]),
    issue("done", "CRITICAL", "FIXED", [["u1", 1]]),
  ], now);
  assert.deepEqual(r.open.map((i) => i.id), ["crit", "many"]);
  assert.deepEqual(r.closed.map((i) => i.id), ["done"]);
  assert.equal(r.open[1].reporters, 6);
});

test("an issue with no reports scores 0 and does not crash", () => {
  assert.equal(issueScore(issue("e", "HIGH", "NEW", []), now), 0);
});
