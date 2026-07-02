import { test } from "node:test";
import assert from "node:assert/strict";
import { computePredictionEstimate } from "./prediction-data";

// BMI 39 → 23.4 journey (same shape as the engine test): a constant-TDEE walk
// finishes ~40 kg at the initial 2 lb/wk severity cap in ~320 days. Adapting
// TDEE + severity to the falling weight must lengthen the estimate materially.
test("prediction: ETA reflects TDEE and severity falling with weight", () => {
  const est = computePredictionEstimate({
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 160,
    heightUnit: "cm",
    weightValue: 100,
    weightUnit: "kg",
    goalWeight: 60,
    activityLevel: 2,
  });
  assert.ok(est, "estimate should exist for an obese profile with a lower goal");
  assert.ok(est!.days >= 365, `days=${est!.days} — a constant-TDEE model finishes unrealistically fast (~320)`);
  assert.ok(est!.days <= 3650, "still reachable within the 10-year cap");
  // Average pace must sit below the initial severity cap (2 lb/wk ≈ 0.91 kg/wk).
  assert.ok(est!.weeklyGoal < 0.91, `avg weekly loss ${est!.weeklyGoal} kg should be below the initial cap`);
});
