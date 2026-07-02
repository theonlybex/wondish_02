import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAllMetrics,
  computeWeeklyTarget,
  capWindowToDayBudget,
  DAY_CALORIE_TOLERANCE,
} from "./caloric-engine";

const birthday = new Date("1994-01-01"); // ~age 32 at test time

function overweightProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 160, heightUnit: "cm",
    cbwValue: 70, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: "kg",
  });
}

function underweightProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 170, heightUnit: "cm",
    cbwValue: 45, cbwUnit: "kg",
    activityLevel: 2,
  });
}

function healthyProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
  });
}

const now = new Date("2026-06-30");
const twoWeeksAgo = new Date("2026-06-16"); // planDay = 14 -> weekIndex 3

test("lose: target is below current, delta negative, week index from plan start", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 70, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "lose");
  assert.equal(wt.weekIndex, 3);
  assert.ok(wt.thisWeekTargetKg < wt.currentWeightKg, "target should be below current");
  assert.ok(wt.weeklyDeltaKg < 0, "delta should be negative for loss");
  assert.ok(wt.thisWeekTargetKg >= wt.goalWeightKg, "target never below goal");
});

test("lose: progress curve is monotonic non-decreasing and bounded 0..100", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 70, planStartDate: twoWeeksAgo, now });
  assert.ok(wt.curve.length >= 1);
  for (const pt of wt.curve) {
    assert.ok(pt.progressPct >= 0 && pt.progressPct <= 100);
  }
  for (let i = 1; i < wt.curve.length; i++) {
    assert.ok(wt.curve[i].progressPct >= wt.curve[i - 1].progressPct - 1e-6, "curve must rise");
  }
  assert.ok(wt.totalWeeks >= wt.weekIndex);
});

test("gain: underweight projects upward toward goal", () => {
  const p = underweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 45, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "gain");
  assert.ok(wt.thisWeekTargetKg > wt.currentWeightKg, "target should be above current");
  assert.ok(wt.weeklyDeltaKg > 0, "delta should be positive for gain");
  assert.ok(wt.thisWeekTargetKg <= wt.goalWeightKg, "target never above goal");
  assert.ok(wt.curve.length >= 1, "gain curve should have points");
  for (const pt of wt.curve) {
    assert.ok(pt.progressPct >= 0 && pt.progressPct <= 100, "gain curve bounded 0..100");
  }
  for (let i = 1; i < wt.curve.length; i++) {
    assert.ok(wt.curve[i].progressPct >= wt.curve[i - 1].progressPct - 1e-6, "gain curve must rise");
  }
});

test("maintain: healthy BMI has no weekly change", () => {
  const p = healthyProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 60, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "maintain");
  assert.equal(wt.weeklyDeltaKg, 0);
});

// Heavily obese profile with a long journey: BMI 39 → 23.4. As simulated
// weight falls, TDEE and the severity cap must fall with it.
function obeseLongJourneyProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 160, heightUnit: "cm",
    cbwValue: 100, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: "kg",
  });
}

test("adaptive: planned weekly progress tapers as severity drops along the journey", () => {
  const p = obeseLongJourneyProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 100, planStartDate: twoWeeksAgo, now });

  // Weekly progress increments, skipping the ramp-in and the clamped tail.
  const inc: number[] = [];
  for (let i = 1; i < wt.curve.length; i++) {
    inc.push(wt.curve[i].progressPct - wt.curve[i - 1].progressPct);
  }
  let lastActive = inc.length - 1;
  while (lastActive > 0 && wt.curve[lastActive + 1].progressPct > 99.9) lastActive--;
  const early = (inc[4] + inc[5] + inc[6] + inc[7]) / 4;          // weeks 6–9 (post-ramp)
  const late  = (inc[lastActive - 3] + inc[lastActive - 2] + inc[lastActive - 1] + inc[lastActive]) / 4;

  // At BMI 39 the pace is ~2 lb/wk; near goal (BMI ~25) it must approach
  // ~0.5 lb/wk. A constant-TDEE model keeps them equal.
  assert.ok(late < early * 0.7, `late weekly progress (${late.toFixed(2)}%) should taper well below early (${early.toFixed(2)}%)`);
});

test("day budget: window untouched when it fits the remaining budget", () => {
  // Day target 2000 → budget 2100; 800 already planned → 1300 remaining.
  const w = capWindowToDayBudget(300, 900, 2000 * DAY_CALORIE_TOLERANCE, 800);
  assert.deepEqual(w, { calMin: 300, calMax: 900 });
});

test("day budget: calMax is clamped to the remaining budget", () => {
  // Budget 2100; 1800 already planned → only 300 left, so max 500 → 300.
  const w = capWindowToDayBudget(100, 500, 2100, 1800);
  assert.deepEqual(w, { calMin: 100, calMax: 300 });
});

test("day budget: pick is skipped when remaining budget is below the window minimum", () => {
  // Budget 2100; 1800 planned → 300 left, but the step needs at least 400.
  const w = capWindowToDayBudget(400, 700, 2100, 1800);
  assert.equal(w, null);
});

test("day budget: pick is skipped when the budget is already exhausted", () => {
  const w = capWindowToDayBudget(0, 500, 2100, 2200);
  assert.equal(w, null);
});

test("no plan: falls back to current as anchor, weekIndex 1, hasPlan false", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: null, planStartDate: null, now });
  assert.equal(wt.hasPlan, false);
  assert.equal(wt.weekIndex, 1);
  assert.equal(wt.anchorStartKg, wt.currentWeightKg);
  assert.ok(wt.weeklyDeltaKg < 0, "no-plan overweight still projects a loss");
  assert.ok(wt.thisWeekTargetKg < wt.currentWeightKg, "no-plan target below current");
});
