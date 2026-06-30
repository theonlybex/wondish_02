import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAllMetrics, computeWeeklyTarget } from "./caloric-engine";

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
});

test("maintain: healthy BMI has no weekly change", () => {
  const p = healthyProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 60, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "maintain");
  assert.equal(wt.weeklyDeltaKg, 0);
});

test("no plan: falls back to current as anchor, weekIndex 1, hasPlan false", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: null, planStartDate: null, now });
  assert.equal(wt.hasPlan, false);
  assert.equal(wt.weekIndex, 1);
  assert.equal(wt.anchorStartKg, wt.currentWeightKg);
});
