import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAllMetrics,
  computeWeeklyTarget,
  capWindowToDayBudget,
  clampGoalToHealthyBand,
  gradualDailyCals,
  DAY_CALORIE_TOLERANCE,
  HEALTHY_BMI_FLOOR,
  HEALTHY_BMI_CEIL,
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

// ─── Goal-driven direction + healthy-band clamp (items 6 & 7) ────────────────

test("clamp: goal below healthy floor is raised to BMI 18.5", () => {
  const m2 = 1.65 * 1.65;
  const floorKg = HEALTHY_BMI_FLOOR * m2;
  // Healthy 60kg user aiming for BMI ~17 → clamped up to the floor.
  assert.equal(clampGoalToHealthyBand(17 * m2, 60, m2), floorKg);
  // Underweight user aiming even lower → clamped to the floor (direction flips to gain).
  assert.equal(clampGoalToHealthyBand(15 * m2, 17 * m2, m2), floorKg);
});

test("clamp: goal above healthy ceiling is lowered unless it is an intermediate stop", () => {
  const m2 = 1.65 * 1.65;
  const ceilKg = HEALTHY_BMI_CEIL * m2;
  // Healthy user aiming for BMI 28 (gain away from band) → clamped to ceiling.
  assert.equal(clampGoalToHealthyBand(28 * m2, 22 * m2, m2), ceilKg);
  // Overweight (BMI 27) user aiming above current → clamped to ceiling (flips to lose).
  assert.equal(clampGoalToHealthyBand(29 * m2, 27 * m2, m2), ceilKg);
  // Obese (BMI 32) user aiming for BMI 26 — intermediate stop toward the band → kept.
  assert.equal(clampGoalToHealthyBand(26 * m2, 32 * m2, m2), 26 * m2);
});

test("clamp: goals inside the healthy band pass through untouched", () => {
  const m2 = 1.65 * 1.65;
  assert.equal(clampGoalToHealthyBand(21 * m2, 60, m2), 21 * m2);
  // Underweight user gaining toward (but stopping short of) the band → kept.
  assert.equal(clampGoalToHealthyBand(18 * m2, 16 * m2, m2), 18 * m2);
});

test("item 6: short user's default WTBW is floored at healthy BMI", () => {
  // 145 cm female: IBW = 37 kg → WTBW would be underweight (BMI ~17.6).
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 145, heightUnit: "cm",
    cbwValue: 50, cbwUnit: "kg",
    activityLevel: 2,
  });
  const bmiOfTarget = p.tbwKg / p.heightM2;
  assert.ok(bmiOfTarget >= HEALTHY_BMI_FLOOR - 1e-9,
    `default target BMI (${bmiOfTarget.toFixed(2)}) must not be underweight`);
});

test("item 7: healthy user with a set goal below current gets a real lose plan", () => {
  // BMI 22 (healthy class) with a goal 5 kg down — previously forced to "maintain".
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 55, utbwUnit: "kg",
  });
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 60, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "lose");
  assert.ok(wt.weeklyDeltaKg < 0, "healthy-class lose plan must produce a deficit");
  assert.ok(wt.totalWeeks < 520, "goal must be reachable, not the 10-year cap");
  assert.ok(wt.thisWeekTargetKg < 60 && wt.thisWeekTargetKg >= 55);
});

test("item 7: healthy user with no set goal still maintains", () => {
  const p = healthyProfile(); // no utbw
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 60, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "maintain");
  assert.equal(wt.weeklyDeltaKg, 0);
});

test("item 7: overweight user with a gain goal is clamped to the band ceiling and loses", () => {
  // 165 cm, 75 kg (BMI 27.5) asking to gain to 80 kg → effective goal BMI 24.9, lose.
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 75, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 80, utbwUnit: "kg",
  });
  assert.ok(Math.abs(p.tbwKg - HEALTHY_BMI_CEIL * p.heightM2) < 1e-9);
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 75, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "lose");
});

test("gradualDailyCals: direction-keyed — lose ramps down, gain ramps up, maintain flat", () => {
  const tdee = 2500, minCal = 1200, maxDef = 400;
  assert.ok(gradualDailyCals(tdee, 14, "lose", minCal, maxDef) < tdee);
  assert.ok(gradualDailyCals(tdee, 14, "gain", minCal, maxDef) > tdee);
  assert.equal(gradualDailyCals(tdee, 14, "maintain", minCal, maxDef), tdee);
  // Deficit is capped at maxDeficit and floored at minCal.
  assert.equal(gradualDailyCals(tdee, 300, "lose", minCal, maxDef), tdee - maxDef);
  assert.equal(gradualDailyCals(2000, 300, "lose", 1800, maxDef), 1800);
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
