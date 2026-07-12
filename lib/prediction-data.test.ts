import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePredictionEstimate,
  resolveSex,
  toKg,
  fromKg,
  kgToLbs,
  type PredictionProfileInput,
} from "./prediction-data";

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

// ─── Unit conversion helpers ─────────────────────────────────────────────────

const KG_PER_LB = 0.45359237;

test("toKg: kg passes through, lbs converts by the exact factor", () => {
  assert.equal(toKg(100, "kg"), 100);
  assert.equal(toKg(0, "kg"), 0);
  assert.equal(toKg(1, "lbs"), KG_PER_LB);
  assert.equal(toKg(220, "lbs"), 220 * KG_PER_LB);
  assert.equal(toKg(0, "lbs"), 0);
});

test("fromKg: kg passes through, lbs divides by the exact factor", () => {
  assert.equal(fromKg(80, "kg"), 80);
  assert.equal(fromKg(KG_PER_LB, "lbs"), 1);
  assert.ok(Math.abs(fromKg(1, "lbs") - 2.20462262) < 1e-6);
});

test("toKg/fromKg round-trip is the identity for both units", () => {
  for (const v of [0, 0.1, 1, 55.5, 100, 250]) {
    assert.ok(Math.abs(fromKg(toKg(v, "lbs"), "lbs") - v) < 1e-12);
    assert.equal(fromKg(toKg(v, "kg"), "kg"), v);
  }
});

test("kgToLbs matches fromKg(…, 'lbs') and the canonical factor", () => {
  assert.ok(Math.abs(kgToLbs(1) - 1 / KG_PER_LB) < 1e-15);
  assert.ok(Math.abs(kgToLbs(KG_PER_LB) - 1) < 1e-12);
  for (const v of [0.5, 10, 72.3]) {
    assert.equal(kgToLbs(v), fromKg(v, "lbs"));
  }
  assert.equal(kgToLbs(0), 0);
});

// ─── resolveSex ──────────────────────────────────────────────────────────────

test("resolveSex: recognizes male/female case-insensitively", () => {
  assert.equal(resolveSex("male"), "male");
  assert.equal(resolveSex("female"), "female");
  assert.equal(resolveSex("Male"), "male");
  assert.equal(resolveSex("FEMALE"), "female");
  assert.equal(resolveSex("MaLe"), "male");
});

test("resolveSex: null for missing, empty, or unknown values", () => {
  assert.equal(resolveSex(null), null);
  assert.equal(resolveSex(undefined), null);
  assert.equal(resolveSex(""), null);
  assert.equal(resolveSex("other"), null);
  assert.equal(resolveSex("m"), null);
  assert.equal(resolveSex("man"), null);
  // No trimming: padded values are not recognized.
  assert.equal(resolveSex(" male "), null);
});

// ─── computePredictionEstimate: gates (null cases) ───────────────────────────

function obeseKgProfile(): PredictionProfileInput {
  return {
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 160,
    heightUnit: "cm",
    weightValue: 100,
    weightUnit: "kg",
    goalWeight: 60,
    activityLevel: 2,
  };
}

test("null when goal is not below current weight (equal and above)", () => {
  assert.equal(computePredictionEstimate({ ...obeseKgProfile(), goalWeight: 100 }), null);
  assert.equal(computePredictionEstimate({ ...obeseKgProfile(), goalWeight: 120 }), null);
});

test("null when the goal override is not below current weight", () => {
  const est = computePredictionEstimate(obeseKgProfile(), { goalWeight: 100 });
  assert.equal(est, null);
  // The override wins even when the base goal would qualify.
  assert.equal(computePredictionEstimate(obeseKgProfile(), { goalWeight: 150 }), null);
});

test("null for a healthy-BMI profile even with a lower goal", () => {
  // 165 cm, 60 kg → BMI ~22 (healthy) → no weight-loss prediction.
  const est = computePredictionEstimate({
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 165,
    heightUnit: "cm",
    weightValue: 60,
    weightUnit: "kg",
    goalWeight: 55,
    activityLevel: 2,
  });
  assert.equal(est, null);
});

test("null for an underweight profile", () => {
  // 170 cm, 45 kg → BMI ~15.6 (underweight).
  const est = computePredictionEstimate({
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 170,
    heightUnit: "cm",
    weightValue: 45,
    weightUnit: "kg",
    goalWeight: 40,
    activityLevel: 2,
  });
  assert.equal(est, null);
});

test("BMI boundary at 25: just above is overweight (estimate), just below is healthy (null)", () => {
  // 160 cm → heightM2 ≈ 2.56; 64 kg is nominally BMI 25 but float rounding
  // (1.6 × 1.6 = 2.5600000000000005) puts it a hair under → healthy → null.
  const base: PredictionProfileInput = {
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 160,
    heightUnit: "cm",
    weightValue: 64.1, // BMI ≈ 25.04 → overweight
    weightUnit: "kg",
    goalWeight: 60,
    activityLevel: 2,
  };
  const justAbove = computePredictionEstimate(base);
  assert.ok(justAbove, "BMI just over 25 classifies as overweight and gets an estimate");
  const justBelow = computePredictionEstimate({ ...base, weightValue: 63.9 });
  assert.equal(justBelow, null, "BMI just under 25 is healthy → null");
});

// 120 cm, 40 kg, born 1936, sedentary → BMI ~27.8 (overweight) but
// TDEE = 1.2 × (655 + 9.6·40 + 1.8·120 − 4.7·age) ≈ 998 kcal, which sits BELOW
// the 1200 kcal female minimum-intake floor. (BMR only falls as the test ages,
// so the gate keeps holding on future run dates.)
function belowFloorProfile(): PredictionProfileInput {
  return {
    sex: "female",
    birthday: "1936-01-01",
    heightValue: 120,
    heightUnit: "cm",
    weightValue: 40,
    weightUnit: "kg",
    goalWeight: 36.5,
    activityLevel: 1,
  };
}

test("null when maintenance TDEE is at or below the minimum-intake floor", () => {
  // Exercises the `tdeeCBW <= minCaloriesValue` gate: no deficit is possible
  // when eating the safety floor already exceeds maintenance.
  assert.equal(computePredictionEstimate(belowFloorProfile()), null);
});

test("a positive exercise override escapes the minimum-intake-floor gate", () => {
  // extraBurnPerDay > 0 bypasses the gate: the walk's intake is pinned at the
  // 1200 floor (negative food deficit), but the added exercise burn outweighs
  // it, so the banked deficit still grows and the goal is reached.
  const est = computePredictionEstimate(belowFloorProfile(), { activityLevel: 4 });
  assert.ok(est, "extra exercise must make the below-floor profile converge");
  assert.ok(est!.days > 0 && est!.days <= 3650);
  assert.equal(est!.weightToLose, 3.5);
});

test("null when the goal is unreachable within the 10-year cap", () => {
  // Losing 99 kg down to 1 kg cannot be banked in 3650 days: once the
  // simulated weight leaves the overweight band the daily deficit collapses.
  const est = computePredictionEstimate({ ...obeseKgProfile(), goalWeight: 1 });
  assert.equal(est, null);
});

// ─── computePredictionEstimate: result shape and invariants ──────────────────

test("estimate echoes inputs and reports consistent derived fields", () => {
  const est = computePredictionEstimate(obeseKgProfile());
  assert.ok(est);
  assert.equal(est!.currentWeight, 100);
  assert.equal(est!.goalWeight, 60);
  assert.equal(est!.weightUnit, "kg");
  assert.equal(est!.weightToLose, 40); // 100 − 60 kg, one-decimal rounding exact here
  assert.ok(Number.isInteger(est!.days) && est!.days > 0, "days is a positive whole number");
  // weeklyGoal is the average pace: weightToLose / (days / 7), to 2 decimals.
  const expectedWeekly = 40 / (est!.days / 7);
  assert.ok(Math.abs(est!.weeklyGoal - expectedWeekly) < 0.005 + 1e-9,
    `weeklyGoal ${est!.weeklyGoal} should round from ${expectedWeekly}`);
  assert.ok(est!.weeklyGoal > 0);
});

test("goal override replaces the profile goal in the result", () => {
  const est = computePredictionEstimate(obeseKgProfile(), { goalWeight: 80 });
  assert.ok(est);
  assert.equal(est!.goalWeight, 80);
  assert.equal(est!.weightToLose, 20);
});

test("monotonic in goal: a deeper goal takes strictly more days and more weight", () => {
  const shallow = computePredictionEstimate(obeseKgProfile(), { goalWeight: 90 });
  const mid = computePredictionEstimate(obeseKgProfile(), { goalWeight: 75 });
  const deep = computePredictionEstimate(obeseKgProfile(), { goalWeight: 60 });
  assert.ok(shallow && mid && deep);
  assert.ok(shallow!.days < mid!.days && mid!.days < deep!.days,
    `days should grow with the goal depth: ${shallow!.days}, ${mid!.days}, ${deep!.days}`);
  assert.ok(shallow!.weightToLose < mid!.weightToLose && mid!.weightToLose < deep!.weightToLose);
});

test("activity override above the profile level shortens the ETA", () => {
  const base = computePredictionEstimate(obeseKgProfile());
  const boosted = computePredictionEstimate(obeseKgProfile(), { activityLevel: 4 });
  assert.ok(base && boosted);
  assert.ok(boosted!.days < base!.days,
    `extra exercise must shorten the estimate (${boosted!.days} vs ${base!.days})`);
  // Same journey length, faster → higher average weekly pace.
  assert.ok(boosted!.weeklyGoal > base!.weeklyGoal);
  assert.equal(boosted!.weightToLose, base!.weightToLose);
});

test("activity override below the profile level can make the goal unreachable → null", () => {
  // The intake schedule stays anchored to the profile's activity level, so a
  // lower override only subtracts burn (extraBurnPerDay < 0). Near the goal
  // the severity cap shrinks to ~0.5 lb/wk, the negative burn outweighs it,
  // and the banked deficit stops growing — the walk never converges.
  const reduced = computePredictionEstimate(obeseKgProfile(), { activityLevel: 1 });
  assert.equal(reduced, null);
});

test("activity override equal to the profile level is a no-op", () => {
  const base = computePredictionEstimate(obeseKgProfile());
  const same = computePredictionEstimate(obeseKgProfile(), { activityLevel: 2 });
  assert.deepEqual(same, base);
});

test("activity ordering: from the profile level up, more activity is strictly faster", () => {
  let prevDays = Infinity;
  for (const level of [2, 3, 4]) {
    const est = computePredictionEstimate(obeseKgProfile(), { activityLevel: level });
    assert.ok(est, `estimate should exist at activity level ${level}`);
    assert.ok(est!.days < prevDays,
      `days must fall with activity: level ${level} gave ${est!.days} after ${prevDays}`);
    prevDays = est!.days;
  }
});

// ─── Unit invariance ─────────────────────────────────────────────────────────

test("kg and lbs profiles describing the same body agree on the ETA", () => {
  const kgEst = computePredictionEstimate(obeseKgProfile());
  const lbsEst = computePredictionEstimate({
    sex: "female",
    birthday: "1994-01-01",
    heightValue: 160,
    heightUnit: "cm",
    weightValue: 100 / KG_PER_LB, // exactly 100 kg expressed in lbs
    weightUnit: "lbs",
    goalWeight: 60 / KG_PER_LB, // exactly 60 kg
    activityLevel: 2,
  });
  assert.ok(kgEst && lbsEst);
  assert.ok(Math.abs(kgEst!.days - lbsEst!.days) <= 1,
    `same body must give the same ETA: ${kgEst!.days} vs ${lbsEst!.days}`);
  assert.equal(lbsEst!.weightUnit, "lbs");
  // 40 kg to lose ≈ 88.2 lbs, reported in the profile's display unit.
  assert.ok(Math.abs(lbsEst!.weightToLose - kgToLbs(40)) < 0.05 + 1e-9);
  // Weekly pace converts by the same factor as the total.
  assert.ok(Math.abs(lbsEst!.weeklyGoal - kgToLbs(kgEst!.weeklyGoal)) < 0.03,
    `weekly pace should agree across units: ${lbsEst!.weeklyGoal} lbs vs ${kgEst!.weeklyGoal} kg`);
});

test("cm and inch heights describing the same body agree on the ETA", () => {
  const cmEst = computePredictionEstimate(obeseKgProfile());
  const inEst = computePredictionEstimate({ ...obeseKgProfile(), heightValue: 160 / 2.54, heightUnit: "in" });
  assert.ok(cmEst && inEst);
  assert.ok(Math.abs(cmEst!.days - inEst!.days) <= 1,
    `same height must give the same ETA: ${cmEst!.days} vs ${inEst!.days}`);
});

// ─── Sex-specific behavior ───────────────────────────────────────────────────

test("male profile with the same body metrics is never slower", () => {
  // The severity cap (maxDailyDeficit from BMI) sets the pace whenever the
  // minCal floor is not binding, so male and female ETAs tie on this body
  // even though male TDEE is higher. A male ETA must never be longer.
  const female = computePredictionEstimate(obeseKgProfile());
  const male = computePredictionEstimate({ ...obeseKgProfile(), sex: "male" });
  assert.ok(female && male);
  assert.ok(male!.days <= female!.days,
    `male TDEE is higher, so the journey cannot be longer (${male!.days} vs ${female!.days})`);
});
