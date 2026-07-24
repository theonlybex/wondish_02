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
  convertHeight,
  feetInchesToCm,
  convertWeight,
  calcAge,
  calcIBW,
  calcCBMI,
  classifyCBMI,
  calcIBMI,
  calcWTBMI,
  calcUTBMI,
  calcWTBW,
  calcUTBW,
  planDirection,
  resolvePlanDirection,
  calcBMR,
  calcBodyFatPct,
  getActivityMultiplier,
  calcTDEE,
  calcWTL,
  calcWTG,
  minCalories,
  maxDailyDeficit,
  gradualDailyDeficit,
  tdeeSlopePerKg,
  walkDay,
  resolveMacroProfile,
  getMacroPercentages,
  computeMealCalories,
  computeDailyMacros,
  KCAL_PER_KG,
  resolveDailyCalorieTarget,
  resolveDailyTargets,
  type CaloricProfile,
  type GlideWalk,
  resolveSex,
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

test("day budget: remaining exactly equal to calMin is still accepted", () => {
  // remaining = 300 == calMin → the strict `remaining < calMin` check passes,
  // and calMax collapses onto calMin.
  const w = capWindowToDayBudget(300, 900, 2100, 1800);
  assert.deepEqual(w, { calMin: 300, calMax: 300 });
  // remaining exactly 0 is rejected even when calMin is 0.
  assert.equal(capWindowToDayBudget(0, 500, 2100, 2100), null);
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

test("clamp: non-positive heightM2 disables the clamp entirely", () => {
  assert.equal(clampGoalToHealthyBand(40, 60, 0), 40);
  assert.equal(clampGoalToHealthyBand(40, 60, -1), 40);
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
  // Day 1 literal: 2500 - 300/7 = 2457.142857 → Math.round → 2457.
  assert.equal(gradualDailyCals(2500, 1, "lose", 1200, 400), 2457);
});

test("achieved progressPct: halfway from anchor to goal reads exactly 50", () => {
  // Anchor 80 kg → goal 60 kg (span 20); current 70 kg → 50% achieved.
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 80, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.goalWeightKg, 60);
  assert.equal(wt.progressPct, 50);
});

test("future planStartDate: planDay clamps to 0, so weekIndex is 1", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({
    profile: p, anchorStartKg: 70,
    planStartDate: new Date("2026-07-10"), // 10 days AFTER `now`
    now,
  });
  assert.equal(wt.weekIndex, 1);
  assert.equal(wt.hasPlan, true);
});

test("reachedGoal: defensive branch snaps to goal with a flat curve", () => {
  // Not constructible via computeAllMetrics (class-based direction always
  // points away from current weight), but computeWeeklyTarget must stay
  // defensive against an inconsistent stored profile: class says lose while
  // current weight already sits at/below the target.
  const p = {
    ...overweightProfile(),
    utbwKg: null, cbmiClass: "overweight" as const,
    cbwKg: 58, tbwKg: 60, // current already below the goal
  };
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 70, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "lose");
  assert.equal(wt.weeklyDeltaKg, 0);
  assert.equal(wt.thisWeekTargetKg, 60); // snapped to goalKg, not currentKg
  assert.equal(wt.progressPct, 100);
  assert.equal(wt.totalWeeks, wt.weekIndex);
  assert.deepEqual(wt.curve, [{ week: 3, progressPct: 100 }]);
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

// ═══ Unit conversions ═════════════════════════════════════════════════════════

test("convertHeight: cm passes through and derives m, m2, inches", () => {
  const h = convertHeight(180, "cm");
  assert.equal(h.cm, 180);
  assert.equal(h.m, 1.8);
  assert.ok(Math.abs(h.m2 - 3.24) < 1e-12);
  assert.ok(Math.abs(h.inches - 180 / 2.54) < 1e-12);
  assert.ok(Math.abs(h.inches2 - (180 / 2.54) ** 2) < 1e-9);
});

test("convertHeight: inches convert to cm at 2.54 and round-trip back", () => {
  const h = convertHeight(70, "in");
  assert.ok(Math.abs(h.cm - 177.8) < 1e-12);
  assert.ok(Math.abs(h.inches - 70) < 1e-12, "inches must round-trip");
  assert.ok(Math.abs(h.m - 1.778) < 1e-12);
});

test("convertHeight: zero height yields all-zero metrics", () => {
  const h = convertHeight(0, "cm");
  assert.deepEqual(h, { cm: 0, m: 0, m2: 0, inches: 0, inches2: 0 });
});

test("feetInchesToCm: known conversions", () => {
  assert.ok(Math.abs(feetInchesToCm(5, 10) - 177.8) < 1e-12); // 5'10"
  assert.ok(Math.abs(feetInchesToCm(6, 0) - 182.88) < 1e-12); // 6'0"
  assert.equal(feetInchesToCm(0, 0), 0);
  // 12 loose inches equal one foot
  assert.ok(Math.abs(feetInchesToCm(0, 12) - feetInchesToCm(1, 0)) < 1e-12);
});

test("convertWeight: kg passes through, lb derived at 0.45359237", () => {
  const w = convertWeight(70, "kg");
  assert.equal(w.kg, 70);
  assert.ok(Math.abs(w.lb - 70 / 0.45359237) < 1e-12); // ~154.32 lb
});

test("convertWeight: both 'lb' and 'lbs' convert to kg identically", () => {
  const a = convertWeight(154.32, "lb");
  const b = convertWeight(154.32, "lbs");
  assert.equal(a.kg, b.kg);
  assert.equal(a.lb, 154.32);
  assert.ok(Math.abs(a.kg - 154.32 * 0.45359237) < 1e-12); // ~69.998 kg
});

test("convertWeight: kg → lb → kg round-trips", () => {
  const once = convertWeight(80, "kg");
  const twice = convertWeight(once.lb, "lb");
  assert.ok(Math.abs(twice.kg - 80) < 1e-9);
});

// ═══ Age boundaries ═══════════════════════════════════════════════════════════

test("calcAge: day before, on, and after the birthday", () => {
  const bday = new Date("1990-06-15");
  assert.equal(calcAge(bday, new Date("2026-06-14")), 35); // day before → not yet
  assert.equal(calcAge(bday, new Date("2026-06-15")), 36); // on the birthday
  assert.equal(calcAge(bday, new Date("2026-06-16")), 36); // day after
});

test("calcAge: month boundary — earlier month means birthday passed", () => {
  const bday = new Date("1990-12-31");
  assert.equal(calcAge(bday, new Date("2026-01-01")), 35);
  assert.equal(calcAge(bday, new Date("2026-12-31")), 36);
});

test("calcAge: leap-day birthday ticks over on March 1 in non-leap years", () => {
  const bday = new Date("2000-02-29");
  assert.equal(calcAge(bday, new Date("2026-02-28")), 25); // Feb 28 < 29 → not yet
  assert.equal(calcAge(bday, new Date("2026-03-01")), 26);
});

test("calcAge: same-day birth is age 0; future birthday clamps to 0", () => {
  assert.equal(calcAge(new Date("2026-06-30"), new Date("2026-06-30")), 0);
  // A not-yet-born date is age 0, never negative.
  assert.equal(calcAge(new Date("2027-01-01"), new Date("2026-06-30")), 0);
});

// ═══ IBW / BMI family ═════════════════════════════════════════════════════════

test("calcIBW: sex-specific offsets from height", () => {
  assert.equal(calcIBW(160, "female"), 52); // 160 - 108
  assert.equal(calcIBW(160, "male"), 55);   // 160 - 105
  // Very short heights floor at 0 instead of going negative.
  assert.equal(calcIBW(100, "female"), 0);
});

test("calcCBMI: standard value and non-positive height guard", () => {
  assert.ok(Math.abs(calcCBMI(70, 1.6 * 1.6) - 27.34375) < 1e-9);
  assert.equal(calcCBMI(70, 0), 0);
  assert.equal(calcCBMI(70, -1), 0);
});

test("classifyCBMI: exact band edges", () => {
  assert.equal(classifyCBMI(18.499999), "underweight");
  assert.equal(classifyCBMI(18.5), "healthy");   // floor is inclusive
  assert.equal(classifyCBMI(24.999999), "healthy");
  assert.equal(classifyCBMI(25), "overweight");  // 25 is overweight
  assert.equal(classifyCBMI(29.999999), "overweight");
  assert.equal(classifyCBMI(30), "obese");       // 30 is obese
  assert.equal(classifyCBMI(0), "underweight");
  // Float error at a nominal boundary is absorbed: 64 kg at 1.60 m is BMI 25,
  // but 1.6 * 1.6 === 2.5600000000000005 computes it a hair under 25.
  assert.equal(classifyCBMI(64 / (1.6 * 1.6)), "overweight");
});

test("calcIBMI: switches at age 65 exactly", () => {
  assert.equal(calcIBMI(64), 21.7);
  assert.equal(calcIBMI(65), 25);
  assert.equal(calcIBMI(0), 21.7);
  assert.equal(calcIBMI(100), 25);
});

test("calcWTBMI: under-65 lookup bands and edges", () => {
  assert.equal(calcWTBMI(17, 40), 20);      // underweight
  assert.equal(calcWTBMI(18.5, 40), 21.7);  // edge: 18.5 leaves underweight band
  assert.equal(calcWTBMI(20, 40), 21.7);
  assert.equal(calcWTBMI(23, 40), 21.7);
  assert.equal(calcWTBMI(25, 40), 23);      // edge: 25 enters the 23 band
  assert.equal(calcWTBMI(29.9, 40), 23);
  assert.equal(calcWTBMI(30, 40), 24);      // edge: 30 enters the 24 band
  assert.equal(calcWTBMI(34.9, 40), 24);
});

test("calcWTBMI: 65+ lookup bands and edges", () => {
  assert.equal(calcWTBMI(17, 65), 25);      // underweight
  assert.equal(calcWTBMI(20, 65), 25);      // spec gap defaults to 25
  assert.equal(calcWTBMI(21.7, 65), 27);    // edge: 21.7 enters the 27 band
  assert.equal(calcWTBMI(24, 65), 27);
  assert.equal(calcWTBMI(27, 65), 27);
  assert.equal(calcWTBMI(30, 65), 28);      // edge: 30 enters the 28 band
});

test("calcWTBMI: CBMI above 35 is capped at the 35 band", () => {
  assert.equal(calcWTBMI(42, 40), calcWTBMI(35, 40));
  assert.equal(calcWTBMI(42, 40), 24);
  assert.equal(calcWTBMI(50, 70), 28);
});

test("calcUTBMI: value and non-positive height guard", () => {
  assert.ok(Math.abs(calcUTBMI(60, 1.65 * 1.65) - 60 / (1.65 * 1.65)) < 1e-12);
  assert.equal(calcUTBMI(60, 0), 0);
  assert.equal(calcUTBMI(60, -2), 0);
});

test("calcWTBW / calcUTBW: scale IBW by BMI ratio, fall back on ibmi <= 0", () => {
  assert.ok(Math.abs(calcWTBW(52, 23, 21.7) - (52 * 23) / 21.7) < 1e-12);
  assert.equal(calcWTBW(52, 23, 0), 52);   // guard returns IBW unchanged
  assert.ok(Math.abs(calcUTBW(52, 20, 21.7) - (52 * 20) / 21.7) < 1e-12);
  assert.equal(calcUTBW(52, 20, -1), 52);
});

// ═══ Plan direction ═══════════════════════════════════════════════════════════

test("planDirection: lose above, gain below, maintain at equal weight", () => {
  assert.equal(planDirection(70, 60), "lose");
  assert.equal(planDirection(55, 60), "gain");
  assert.equal(planDirection(60, 60), "maintain");
});

test("resolvePlanDirection: user goal wins over BMI class", () => {
  // Healthy-class user with a set goal below current → lose (not maintain).
  const withGoal = { utbwKg: 55, cbwKg: 60, tbwKg: 55, cbmiClass: "healthy" } as CaloricProfile;
  assert.equal(resolvePlanDirection(withGoal), "lose");
  const gainGoal = { utbwKg: 65, cbwKg: 60, tbwKg: 65, cbmiClass: "healthy" } as CaloricProfile;
  assert.equal(resolvePlanDirection(gainGoal), "gain");
});

test("resolvePlanDirection: without a goal the BMI class decides", () => {
  const base = { utbwKg: null, cbwKg: 70, tbwKg: 60 };
  assert.equal(resolvePlanDirection({ ...base, cbmiClass: "overweight" } as CaloricProfile), "lose");
  assert.equal(resolvePlanDirection({ ...base, cbmiClass: "obese" } as CaloricProfile), "lose");
  assert.equal(resolvePlanDirection({ ...base, cbmiClass: "underweight" } as CaloricProfile), "gain");
  // Healthy with no goal maintains even though tbwKg differs from cbwKg.
  assert.equal(resolvePlanDirection({ ...base, cbmiClass: "healthy" } as CaloricProfile), "maintain");
});

// ═══ BMR / body fat / TDEE ════════════════════════════════════════════════════

test("calcBMR: Harris-Benedict exact values for both sexes", () => {
  // Female: 655 + 9.6*60 + 1.8*165 - 4.7*30 = 1387
  assert.ok(Math.abs(calcBMR(60, 165, 30, "female") - 1387) < 1e-9);
  // Male: 66 + 13.7*80 + 5*180 - 6.8*40 = 1790
  assert.ok(Math.abs(calcBMR(80, 180, 40, "male") - 1790) < 1e-9);
});

test("calcBMR: zero inputs collapse to the constant term", () => {
  assert.equal(calcBMR(0, 0, 0, "female"), 655);
  assert.equal(calcBMR(0, 0, 0, "male"), 66);
});

test("calcBodyFatPct: Deurenberg formula with the male offset", () => {
  // Female: 1.2*25 + 0.23*30 - 0 - 5.4 = 31.5
  assert.ok(Math.abs(calcBodyFatPct(25, 30, "female") - 31.5) < 1e-9);
  // Male differs from female by exactly the 10.8 sex factor.
  assert.ok(Math.abs(calcBodyFatPct(25, 30, "female") - calcBodyFatPct(25, 30, "male") - 10.8) < 1e-9);
});

test("getActivityMultiplier: the four levels plus out-of-range defaults", () => {
  assert.equal(getActivityMultiplier(1), 1.2);
  assert.equal(getActivityMultiplier(2), 1.375);
  assert.equal(getActivityMultiplier(3), 1.55);
  assert.equal(getActivityMultiplier(4), 1.725);
  assert.equal(getActivityMultiplier(0), 1.2);   // below range → sedentary
  assert.equal(getActivityMultiplier(5), 1.2);   // above range → sedentary
  assert.equal(getActivityMultiplier(-3), 1.2);
  assert.equal(getActivityMultiplier(NaN), 1.2);
});

test("calcTDEE: plain product of BMR and multiplier", () => {
  assert.equal(calcTDEE(1500, 1.55), 2325);
  assert.equal(calcTDEE(0, 1.725), 0);
});

test("calcWTL / calcWTG: signed deltas mirror each other", () => {
  assert.equal(calcWTL(70, 60), 10);
  assert.equal(calcWTL(55, 60), -5);
  assert.equal(calcWTG(60, 70), -10);
  assert.equal(calcWTG(60, 55), 5);
  // WTL(cbw, tbw) and WTG(tbw, cbw) are exact negations of each other's roles.
  assert.equal(calcWTL(70, 60), -calcWTG(60, 70));
  assert.equal(calcWTL(70, 70), 0);
});

test("minCalories: sex-specific safety floors", () => {
  assert.equal(minCalories("male"), 1500);
  assert.equal(minCalories("female"), 1200);
});

// ═══ Deficit schedule and severity cap ════════════════════════════════════════

test("maxDailyDeficit: anchors at BMI 25 (0.5 lb/wk) and 35 (2.0 lb/wk)", () => {
  const kcalPerDay = (lbWk: number) => (lbWk * 0.453592 * 7700) / 7;
  assert.ok(Math.abs(maxDailyDeficit(25) - kcalPerDay(0.5)) < 1e-9);  // ~249.5
  assert.ok(Math.abs(maxDailyDeficit(35) - kcalPerDay(2.0)) < 1e-9);  // ~997.9
  assert.ok(Math.abs(maxDailyDeficit(30) - kcalPerDay(1.25)) < 1e-9); // midpoint
});

test("maxDailyDeficit: clamps outside the 25–35 range (incl. absurd inputs)", () => {
  assert.equal(maxDailyDeficit(18), maxDailyDeficit(25));
  assert.equal(maxDailyDeficit(0), maxDailyDeficit(25));
  assert.equal(maxDailyDeficit(-10), maxDailyDeficit(25));
  assert.equal(maxDailyDeficit(50), maxDailyDeficit(35));
  assert.equal(maxDailyDeficit(1000), maxDailyDeficit(35));
});

test("gradualDailyDeficit: documented ramp values", () => {
  assert.ok(Math.abs(gradualDailyDeficit(1) - 300 / 7) < 1e-9);       // ~42.9
  assert.equal(gradualDailyDeficit(7), 300);                          // week 1 end
  assert.ok(Math.abs(gradualDailyDeficit(8) - (300 + 300 / 7)) < 1e-9);
  assert.equal(gradualDailyDeficit(14), 600);                         // week 2 end
  assert.equal(gradualDailyDeficit(21), 900);                         // week 3 end
  assert.ok(Math.abs(gradualDailyDeficit(22) - (900 + 400 / 7)) < 1e-9); // week 4 uses 400
  assert.equal(gradualDailyDeficit(28), 1300);                        // 900 + 400
  assert.equal(gradualDailyDeficit(35), 1700);                        // 900 + 2*400
});

test("gradualDailyDeficit: strictly increasing across the first 10 weeks", () => {
  for (let d = 2; d <= 70; d++) {
    assert.ok(gradualDailyDeficit(d) > gradualDailyDeficit(d - 1),
      `deficit must grow at day ${d}`);
  }
});

test("gradualDailyCals: gain is capped at tdee + maxDeficit ceiling", () => {
  const tdee = 2200, minCal = 1200, maxDef = 350;
  // Deep into the plan the surplus would exceed the cap → clamped to ceiling.
  assert.equal(gradualDailyCals(tdee, 300, "gain", minCal, maxDef), tdee + maxDef);
  // Early in the plan the ramp is below the cap. Hard literal (not re-derived
  // from the helpers): 2200 + 3/7·300 = 2328.571 → round → 2329.
  const day3 = gradualDailyCals(tdee, 3, "gain", minCal, maxDef);
  assert.equal(day3, 2329);
  assert.ok(day3 < tdee + maxDef);
});

test("gradualDailyCals: minCal floor beats the maxDeficit floor when higher", () => {
  // tdee - maxDef = 1000, but minCal 1500 is the effective floor.
  assert.equal(gradualDailyCals(2000, 300, "lose", 1500, 1000), 1500);
  // With a low minCal the severity cap is the floor instead.
  assert.equal(gradualDailyCals(2000, 300, "lose", 1200, 600), 1400);
});

// ═══ Projection helpers ═══════════════════════════════════════════════════════

test("tdeeSlopePerKg: Harris-Benedict weight coefficient times multiplier", () => {
  assert.ok(Math.abs(tdeeSlopePerKg("male", 1.2) - 13.7 * 1.2) < 1e-12);
  assert.ok(Math.abs(tdeeSlopePerKg("female", 1.55) - 9.6 * 1.55) < 1e-12);
});

test("KCAL_PER_KG and DAY_CALORIE_TOLERANCE constants", () => {
  assert.equal(KCAL_PER_KG, 7700);
  assert.equal(DAY_CALORIE_TOLERANCE, 1.05);
});

test("walkDay: with nothing banked, deficit equals tdee minus scheduled intake", () => {
  const walk: GlideWalk = {
    startKg: 90, tdeeAtStart: 2400, slopePerKg: 9.6 * 1.375,
    heightM2: 1.6 * 1.6, direction: "lose", minCal: 1200,
  };
  // Hard literal, not re-derived: day-5 ramp deficit = 5/7·300 = 214.29,
  // intake = round(2400 − 214.29) = 2186 (above the BMI-35 cap floor of
  // 2400 − 997.90 = 1402.10), so the banked deficit is 2400 − 2186 = 214.
  assert.equal(walkDay(walk, 5, 0), 214);
  const cbmi = 90 / (1.6 * 1.6);
  const expectedIntake = gradualDailyCals(2400, 5, "lose", 1200, maxDailyDeficit(cbmi));
  assert.equal(walkDay(walk, 5, 0), 2400 - expectedIntake);
  assert.ok(walkDay(walk, 5, 0) > 0, "lose direction banks a positive deficit");
});

test("walkDay: banked kcal lowers the simulated TDEE via the slope", () => {
  const slope = 9.6 * 1.375;
  const walk: GlideWalk = {
    startKg: 90, tdeeAtStart: 2400, slopePerKg: slope,
    heightM2: 1.6 * 1.6, direction: "lose", minCal: 1200,
  };
  const banked = 2 * KCAL_PER_KG; // 2 kg already lost in simulation
  const simTdee = 2400 - slope * 2;
  const simCbmi = (90 - 2) / (1.6 * 1.6);
  const expectedIntake = gradualDailyCals(simTdee, 40, "lose", 1200, maxDailyDeficit(simCbmi));
  assert.equal(walkDay(walk, 40, banked), simTdee - expectedIntake);
  // Hard literal: at 88 kg the walked BMI is 34.375, so the cap floor binds
  // and the day's deficit IS the cap: 1.90625 lb/wk → 951.13 kcal/day.
  // A walk that (wrongly) kept using the START weight's BMI (35.16 → capped
  // at 35 → 997.90) would fail this assertion.
  assert.ok(Math.abs(walkDay(walk, 40, banked) - 951.1257) < 1e-3);
});

test("walkDay: gain direction returns a negative value (surplus)", () => {
  const walk: GlideWalk = {
    startKg: 45, tdeeAtStart: 1800, slopePerKg: 9.6 * 1.375,
    heightM2: 1.7 * 1.7, direction: "gain", minCal: 1200,
  };
  assert.ok(walkDay(walk, 10, 0) < 0);
});

test("walkDay: zero heightM2 falls back to BMI 0 for the severity cap", () => {
  const walk: GlideWalk = {
    startKg: 90, tdeeAtStart: 2400, slopePerKg: 13.7 * 1.2,
    heightM2: 0, direction: "lose", minCal: 1200,
  };
  // BMI 0 → gentlest cap (same as BMI 25): 0.5 lb/wk → 249.48 kcal/day, and
  // deep into the ramp (day 60) that cap is exactly the banked deficit.
  const expectedIntake = gradualDailyCals(2400, 60, "lose", 1200, maxDailyDeficit(0));
  assert.equal(walkDay(walk, 60, 0), 2400 - expectedIntake);
  assert.ok(Math.abs(walkDay(walk, 60, 0) - 249.4756) < 1e-3);
});

// ═══ Macro profiles ═══════════════════════════════════════════════════════════

test("resolveMacroProfile: diabetic condition takes priority over muscle goals", () => {
  assert.equal(resolveMacroProfile(["Type 2 Diabetes"], ["Gain muscle"]), "diabetic");
  assert.equal(resolveMacroProfile(["Prediabetic tendencies"], []), "diabetic");
});

test("resolveMacroProfile: muscle/gain motivations map to gain_muscle", () => {
  assert.equal(resolveMacroProfile([], ["Build Muscle"]), "gain_muscle");
  assert.equal(resolveMacroProfile([], ["Weight gain"]), "gain_muscle");
  assert.equal(resolveMacroProfile(["Hypertension"], ["gain strength"]), "gain_muscle");
});

test("resolveMacroProfile: defaults to balanced (case-insensitive matching)", () => {
  assert.equal(resolveMacroProfile([], []), "balanced");
  assert.equal(resolveMacroProfile(["Hypertension"], ["Lose weight"]), "balanced");
  assert.equal(resolveMacroProfile(["DIABETES"], []), "diabetic"); // upper-case still matches
});

test("getMacroPercentages: each profile's splits sum to 100%", () => {
  assert.deepEqual(getMacroPercentages("balanced"), { protein: 0.30, carbs: 0.50, fat: 0.20 });
  assert.deepEqual(getMacroPercentages("diabetic"), { protein: 0.35, carbs: 0.45, fat: 0.20 });
  assert.deepEqual(getMacroPercentages("gain_muscle"), { protein: 0.30, carbs: 0.40, fat: 0.30 });
  for (const p of ["balanced", "diabetic", "gain_muscle"] as const) {
    const { protein, carbs, fat } = getMacroPercentages(p);
    assert.ok(Math.abs(protein + carbs + fat - 1) < 1e-12, `${p} must sum to 1`);
  }
});

test("computeMealCalories: lunch is the main meal and fractions sum to the total", () => {
  const meals = computeMealCalories(2000);
  assert.equal(meals.breakfast, 400); // 20%
  assert.equal(meals.lunch, 700);     // 35%
  assert.equal(meals.dinner, 600);    // 30%
  assert.equal(meals.snack, 300);     // 15%
  const sum = Object.values(meals).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 2000) < 1e-9);
});

test("computeMealCalories: zero calories yields zero everywhere", () => {
  assert.deepEqual(computeMealCalories(0), { breakfast: 0, lunch: 0, dinner: 0, snack: 0 });
});

test("computeDailyMacros: balanced 2000 kcal gram math (4/4/9 kcal per g)", () => {
  const d = computeDailyMacros(2000, "balanced");
  assert.equal(d.dailyCalories, 2000);
  assert.equal(d.totalProteinG, 150);  // 2000*0.30/4
  assert.equal(d.totalCarbsG, 250);    // 2000*0.50/4
  assert.equal(d.totalFatG, 44.4);     // 2000*0.20/9, rounded to 0.1
  // Breakfast = 400 kcal → 30 g protein, 50 g carbs, 8.9 g fat.
  assert.deepEqual(d.meals.breakfast, { calories: 400, proteinG: 30, carbsG: 50, fatG: 8.9 });
});

test("computeDailyMacros: per-meal calories sum back to the daily total", () => {
  const d = computeDailyMacros(1847, "diabetic");
  const mealSum = Object.values(d.meals).reduce((a, m) => a + m.calories, 0);
  assert.ok(Math.abs(mealSum - 1847) <= 2, "rounding drift stays within 2 kcal");
  assert.equal(d.profile, "diabetic");
  assert.equal(Object.keys(d.meals).length, 4);
});

test("computeDailyMacros: gain_muscle shifts calories from carbs to fat", () => {
  const balanced = computeDailyMacros(2400, "balanced");
  const muscle = computeDailyMacros(2400, "gain_muscle");
  assert.ok(muscle.totalCarbsG < balanced.totalCarbsG);
  assert.ok(muscle.totalFatG > balanced.totalFatG);
  assert.equal(muscle.totalProteinG, balanced.totalProteinG); // both 30% protein
});

// ═══ computeAllMetrics — input-unit and edge branches ═════════════════════════

test("computeAllMetrics: imperial inputs normalize to the same profile as metric", () => {
  const metric = computeAllMetrics({
    sex: "male", birthday,
    heightValue: feetInchesToCm(5, 10), heightUnit: "cm",
    cbwValue: 176.37 * 0.45359237, cbwUnit: "kg",
    activityLevel: 3,
  });
  const imperial = computeAllMetrics({
    sex: "male", birthday,
    heightValue: 70, heightUnit: "in",     // 5'10"
    cbwValue: 176.37, cbwUnit: "lbs",      // ~80 kg
    activityLevel: 3,
  });
  assert.ok(Math.abs(imperial.heightCm - 177.8) < 1e-9);
  assert.ok(Math.abs(imperial.cbwKg - metric.cbwKg) < 1e-9);
  assert.ok(Math.abs(imperial.cbmi - metric.cbmi) < 1e-9);
  assert.ok(Math.abs(imperial.bmrCBW - metric.bmrCBW) < 1e-9);
  assert.ok(Math.abs(imperial.cbwLb - 176.37) < 1e-9);
});

test("computeAllMetrics: utbw in lbs is converted; utbwUnit defaults to kg", () => {
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 70, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 132.28, utbwUnit: "lbs", // ~60 kg
  });
  assert.ok(p.utbwKg !== null && Math.abs(p.utbwKg - 132.28 * 0.45359237) < 1e-9);
  assert.ok(p.utbmi !== null && Math.abs(p.utbmi - p.utbwKg! / p.heightM2) < 1e-12);

  const defaultUnit = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 70, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: null, // null unit → treated as kg
  });
  assert.equal(defaultUnit.utbwKg, 60);
});

test("computeAllMetrics: zero or negative utbwValue is ignored (no user target)", () => {
  for (const utbwValue of [0, -5]) {
    const p = computeAllMetrics({
      sex: "female", birthday,
      heightValue: 165, heightUnit: "cm",
      cbwValue: 70, cbwUnit: "kg",
      activityLevel: 2,
      utbwValue,
    });
    assert.equal(p.utbwKg, null);
    assert.equal(p.utbmi, null);
    assert.equal(p.bmrUTBW, null);
    assert.equal(p.tdeeUTBW, null);
  }
});

test("computeAllMetrics: wtl and wtg are mutually exclusive and match the delta", () => {
  const losing = overweightProfile(); // 70 kg → 60 kg goal
  assert.ok(losing.wtl !== null && losing.wtl > 0);
  assert.equal(losing.wtg, null);
  assert.ok(Math.abs(losing.wtl! - (losing.cbwKg - losing.tbwKg)) < 1e-9);

  const gaining = underweightProfile();
  assert.ok(gaining.wtg !== null && gaining.wtg > 0);
  assert.equal(gaining.wtl, null);
  assert.ok(Math.abs(gaining.wtg! - (gaining.tbwKg - gaining.cbwKg)) < 1e-9);
});

test("computeAllMetrics: maintain at goal weight sets both wtl and wtg to null", () => {
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: "kg", // goal == current, inside healthy band
  });
  assert.equal(p.wtl, null);
  assert.equal(p.wtg, null);
});

test("computeAllMetrics: calorie targets are floored at the sex-specific minimum", () => {
  // Tiny sedentary profile whose TDEE lands under the 1200 kcal female floor.
  const p = computeAllMetrics({
    sex: "female", birthday: new Date("1946-01-01"),
    heightValue: 140, heightUnit: "cm",
    cbwValue: 35, cbwUnit: "kg",
    activityLevel: 1,
  });
  assert.equal(p.minCaloriesValue, 1200);
  assert.ok(p.tdeeCBW < 1200, "sanity: raw TDEE must be below the floor for this test");
  assert.equal(p.dailyCalories, 1200);
  assert.equal(p.targetCalories, 1200);

  const male = computeAllMetrics({
    sex: "male", birthday,
    heightValue: 180, heightUnit: "cm",
    cbwValue: 80, cbwUnit: "kg",
    activityLevel: 2,
  });
  assert.equal(male.minCaloriesValue, 1500);
  assert.ok(male.dailyCalories >= 1500);
});

test("computeAllMetrics: activity level outside 1-4 falls back to sedentary", () => {
  const base = {
    sex: "female" as const, birthday,
    heightValue: 165, heightUnit: "cm" as const,
    cbwValue: 60, cbwUnit: "kg" as const,
  };
  const bogus = computeAllMetrics({ ...base, activityLevel: 99 });
  const sedentary = computeAllMetrics({ ...base, activityLevel: 1 });
  assert.equal(bogus.activityMultiplier, 1.2);
  assert.equal(bogus.tdeeCBW, sedentary.tdeeCBW);
});

test("computeAllMetrics: zero height degrades without crashing", () => {
  const p = computeAllMetrics({
    sex: "female", birthday,
    heightValue: 0, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
  });
  assert.equal(p.cbmi, 0);                    // calcCBMI guard
  assert.equal(p.cbmiClass, "underweight");   // BMI 0 classifies underweight
  assert.equal(p.ibwKg, 0);                   // IBW floors at 0
  assert.ok(Number.isFinite(p.dailyCalories));
  assert.ok(p.dailyCalories >= p.minCaloriesValue);
});

test("computeAllMetrics: injectable clock computes age as of the provided date", () => {
  const p = computeAllMetrics({
    sex: "female", birthday: new Date("1994-06-15"),
    heightValue: 165, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
  }, new Date("2030-01-01"));
  // Born 1994-06-15: turned 35 on 2029-06-15 and not 36 until 2030-06-15.
  assert.equal(p.age, 35);
});

// ─── resolveDailyCalorieTarget / resolveDailyTargets (tracking) ────────────

test("resolveDailyCalorieTarget: deficit lowers below maintenance, value-parity with the old inline formula", () => {
  const tdeeCBW = 2200;
  const weeklyDeltaKg = -0.5; // losing 0.5kg/week
  const expected = Math.max(0, Math.round(tdeeCBW + weeklyDeltaKg * (KCAL_PER_KG / 7)));
  assert.equal(resolveDailyCalorieTarget({ tdeeCBW, weeklyTarget: { weeklyDeltaKg } }), expected);
  assert.ok(expected < tdeeCBW);
});

test("resolveDailyCalorieTarget: surplus raises above maintenance", () => {
  const tdeeCBW = 2200;
  const target = resolveDailyCalorieTarget({ tdeeCBW, weeklyTarget: { weeklyDeltaKg: 0.25 } });
  assert.ok(target > tdeeCBW);
});

test("resolveDailyCalorieTarget: no weeklyTarget (or null) is maintenance, rounded", () => {
  assert.equal(resolveDailyCalorieTarget({ tdeeCBW: 2200.4, weeklyTarget: null }), 2200);
  assert.equal(resolveDailyCalorieTarget({ tdeeCBW: 2200.4 }), 2200);
});

test("resolveDailyCalorieTarget: floors at 0", () => {
  assert.equal(resolveDailyCalorieTarget({ tdeeCBW: 100, weeklyTarget: { weeklyDeltaKg: -5 } }), 0);
});

test("resolveDailyTargets: steady-state fallback when no planDayCalories given", () => {
  const profile = { tdeeCBW: 2000, weeklyTarget: { weeklyDeltaKg: 0 } };
  const targets = resolveDailyTargets(profile, [], []);
  assert.ok(targets);
  assert.equal(targets!.basis, "steady-state");
  assert.equal(targets!.calories, 2000);
  assert.equal(targets!.profile, "balanced");
});

test("resolveDailyTargets: planDayCalories wins and sets basis 'plan-ramp'", () => {
  const profile = { tdeeCBW: 2000, weeklyTarget: { weeklyDeltaKg: -1 } };
  const targets = resolveDailyTargets(profile, [], [], 1750);
  assert.ok(targets);
  assert.equal(targets!.basis, "plan-ramp");
  assert.equal(targets!.calories, 1750);
});

test("resolveDailyTargets: diabetic/gain_muscle profile wiring matches resolveMacroProfile", () => {
  const profile = { tdeeCBW: 2200 };
  const diabetic = resolveDailyTargets(profile, ["Type 2 Diabetes"], [], 2000)!;
  assert.equal(diabetic.profile, "diabetic");
  const gain = resolveDailyTargets(profile, [], ["Build muscle"], 2000)!;
  assert.equal(gain.profile, "gain_muscle");
});

test("resolveDailyTargets: non-positive calories returns null (never a 0 target)", () => {
  assert.equal(resolveDailyTargets({ tdeeCBW: 0, weeklyTarget: null }, [], []), null);
  assert.equal(resolveDailyTargets({ tdeeCBW: 2000 }, [], [], 0), null);
  assert.equal(resolveDailyTargets({ tdeeCBW: 2000 }, [], [], -5), null);
});

// ─── 2026-07-24 logic-audit Task 16: canonical sex resolution ───────────────
//
// The gender-name fallback existed only in lib/meal-plan.ts; caloric-profile
// (422), prediction (silently unavailable), meal-log targets, and the
// meal-plan SSR page were sexAtBirth-only — a feature-availability split for
// gender-only patients. One exported resolver, used everywhere.

test("resolveSex: parity table — sexAtBirth, gender fallback, both, neither", () => {
  assert.equal(resolveSex("Male", null), "male");
  assert.equal(resolveSex(null, "Female"), "female");
  assert.equal(resolveSex("female", "Male"), "female"); // sexAtBirth wins
  assert.equal(resolveSex(null, null), null);
  assert.equal(resolveSex(undefined, "Non-binary"), null);
  assert.equal(resolveSex("", "male"), "male");
});
