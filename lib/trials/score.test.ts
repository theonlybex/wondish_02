import { test } from "node:test";
import assert from "node:assert/strict";
import { dayScore, phaseScore, evaluate, classify } from "./score";

test("dayScore averages only the monitored items", () => {
  const monitored = new Set(["a", "b"]);
  assert.equal(dayScore([{ trackingItemId: "a", severity: "SEVERE" }, { trackingItemId: "b", severity: "MILD" }, { trackingItemId: "zzz", severity: "SEVERE" }], monitored), 2);
  assert.equal(dayScore([{ trackingItemId: "zzz", severity: "SEVERE" }], monitored), null);
  assert.equal(dayScore([], monitored), null);
});

test("phaseScore needs three logged days", () => {
  assert.equal(phaseScore([1, null, 2]), null);
  assert.equal(phaseScore([1, 2, 3]), 2);
  assert.equal(phaseScore([0, null, 0, 3, null]), 1);
});

test("evaluate suggests PROCEED at 30% improvement and STOP below it", () => {
  assert.deepEqual(evaluate({ baseline: 2, elimination: 1.4 }), { improvementPct: 30, suggestion: "PROCEED" });
  assert.deepEqual(evaluate({ baseline: 2, elimination: 1.402 }), { improvementPct: 29.9, suggestion: "STOP_RESTRICTION" });
  assert.deepEqual(evaluate({ baseline: null, elimination: 1 }), { improvementPct: null, suggestion: "INSUFFICIENT_DATA" });
  assert.deepEqual(evaluate({ baseline: 0, elimination: 0 }), { improvementPct: 100, suggestion: "PROCEED" });
  assert.deepEqual(evaluate({ baseline: 0, elimination: 1 }), { improvementPct: 0, suggestion: "STOP_RESTRICTION" });
});

test("classify suggests LIKELY_TRIGGER only when the challenge is clearly worse", () => {
  assert.equal(classify({ elimination: 1, challenge: 1.5 }), "TOLERATED");
  assert.equal(classify({ elimination: 1, challenge: 1.51 }), "LIKELY_TRIGGER");
  assert.equal(classify({ elimination: 1, challenge: 0.2 }), "TOLERATED");
  assert.equal(classify({ elimination: null, challenge: 2 }), null);
});
