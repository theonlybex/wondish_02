import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrialView } from "./view";
import { addDays } from "./schedule";

const start = new Date(2026, 8, 20);
const rule = { id: "r1", code: "TR-001", category: "ACIDIC_CITRUS", conditionName: "GERD", examples: "Citrus", safetyNote: null, sourceUrl: null, baselineDays: 7, trialDays: 28, reintroductionDays: 3, washoutDays: 3, monitoredIds: ["hb", "rg"] };
const trial = { id: "t1", startDate: start, status: "ACTIVE" as const, classification: null, baselineScore: null, eliminationScore: null, challengeScore: null, notes: null, createdAt: start };
const entry = (dayN: number, hb: "NOT_PRESENT" | "MILD" | "MODERATE" | "SEVERE") => ({ date: addDays(start, dayN - 1), symptoms: [{ trackingItemId: "hb", severity: hb }, { trackingItemId: "other", severity: "SEVERE" as const }] });

test("buildTrialView scores baseline vs elimination from journal entries and suggests at evaluation", () => {
  // Elimination is scored on its last 14 days (14–27); day 10 is deliberately outside.
  const entries = [entry(-6, "SEVERE"), entry(-4, "MODERATE"), entry(-2, "SEVERE"), entry(10, "SEVERE"), entry(16, "MILD"), entry(20, "MILD"), entry(24, "NOT_PRESENT")];
  const v = buildTrialView({ trial, rule, entries, today: addDays(start, 27) }); // day 28
  assert.equal(v.phase.phase, "EVALUATION");
  assert.equal(v.phase.enforced, true);
  assert.equal(v.scores.baseline, (3 + 2 + 3) / 3);
  assert.equal(v.scores.elimination, (1 + 1 + 0) / 3);
  assert.equal(v.scores.loggedDays.baseline, 3);
  assert.equal(v.evaluation.suggestion, "PROCEED");
  assert.equal(v.canClassify, true);
  assert.equal(v.title, "Acidic citrus");
  assert.ok(v.terms.includes("orange juice"));
  assert.equal(v.startDate, "2026-09-20");
  assert.equal(v.windows.EVALUATION.from, "2026-10-17");
});

test("buildTrialView: too few logged days → insufficient data; frozen scores win; challenge suggests classification", () => {
  const few = buildTrialView({ trial, rule, entries: [entry(-6, "SEVERE"), entry(5, "MILD")], today: addDays(start, 27) });
  assert.equal(few.evaluation.suggestion, "INSUFFICIENT_DATA");
  assert.equal(few.scores.baseline, null);
  const frozen = buildTrialView({ trial: { ...trial, baselineScore: 2, eliminationScore: 0.5 }, rule, entries: [], today: addDays(start, 30) });
  assert.equal(frozen.evaluation.improvementPct, 75);
  const challenged = buildTrialView({
    trial: { ...trial, eliminationScore: 0.5 },
    rule,
    entries: [entry(29, "SEVERE"), entry(30, "MODERATE"), entry(31, "SEVERE")],
    today: addDays(start, 33),
  });
  assert.equal(challenged.phase.phase, "WASHOUT");
  assert.equal(challenged.suggestedClassification, "LIKELY_TRIGGER");
  assert.equal(buildTrialView({ trial, rule, entries: [], today: addDays(start, 3) }).canClassify, false);
});
