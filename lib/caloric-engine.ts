// ─── Wondish Daily Caloric Requirement Engine ────────────────────────────────
// Pure-function calculation module – no database dependencies.
// Implements the full Wondish nutrition science model:
//   Height / Weight conversions, IBW, BMI variants, BMR (Harris-Benedict),
//   TDEE, WTL / WTG, and minimum calorie floors.
// ──────────────────────────────────────────────────────────────────────────────

export type Sex = "male" | "female";

export type CBMIClass = "underweight" | "healthy" | "overweight" | "obese";

// ─── Height Conversions ──────────────────────────────────────────────────────

export interface HeightMetrics {
  cm: number;
  m: number;
  m2: number;
  inches: number;
  inches2: number;
}

/**
 * Convert a height value from the given unit to all needed representations.
 * Supports "cm", "in" (inches), and "ftin" (object with {ft, in}).
 */
export function convertHeight(
  value: number,
  unit: "cm" | "in"
): HeightMetrics {
  let cm: number;
  if (unit === "in") {
    cm = value * 2.54;
  } else {
    cm = value;
  }
  const m = cm / 100;
  const inches = cm / 2.54;
  return { cm, m, m2: m * m, inches, inches2: inches * inches };
}

/**
 * Convert feet + inches to centimeters.
 * cm = ft * 30.48 + in * 2.54
 */
export function feetInchesToCm(ft: number, inches: number): number {
  return ft * 30.48 + inches * 2.54;
}

// ─── Weight Conversions ──────────────────────────────────────────────────────

export interface WeightMetrics {
  kg: number;
  lb: number;
}

/**
 * Convert a weight value from the given unit to both kg and lb.
 */
export function convertWeight(
  value: number,
  unit: "kg" | "lbs" | "lb"
): WeightMetrics {
  if (unit === "lbs" || unit === "lb") {
    const kg = value * 0.45359237;
    return { kg, lb: value };
  }
  return { kg: value, lb: value / 0.45359237 };
}

// ─── Age ─────────────────────────────────────────────────────────────────────

/**
 * Calculates age in whole years from a birthday, auto-updated on birthday.
 */
export function calcAge(birthday: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - birthday.getFullYear();
  const monthDiff = now.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthday.getDate())) {
    age--;
  }
  return age;
}

// ─── Ideal Body Weight (IBW) ─────────────────────────────────────────────────

/**
 * IBW in kg.
 * Females: height_cm - 108
 * Males:   height_cm - 105
 */
export function calcIBW(heightCm: number, sex: Sex): number {
  return sex === "female" ? heightCm - 108 : heightCm - 105;
}

// ─── BMI Calculations ────────────────────────────────────────────────────────

/**
 * CBMI (Current Body Mass Index) = CBW_kg / height_m²
 */
export function calcCBMI(weightKg: number, heightM2: number): number {
  if (heightM2 <= 0) return 0;
  return weightKg / heightM2;
}

/**
 * Classify a CBMI value.
 */
export function classifyCBMI(cbmi: number): CBMIClass {
  if (cbmi < 18.5) return "underweight";
  if (cbmi < 25) return "healthy";
  if (cbmi < 30) return "overweight";
  return "obese";
}

/**
 * IBMI (Ideal BMI) by age.
 * < 65  → 21.7
 * ≥ 65  → 25
 */
export function calcIBMI(age: number): number {
  return age < 65 ? 21.7 : 25;
}

/**
 * WTBMI (Wondish Target BMI) from the spec lookup tables.
 *
 * For age < 65:
 *   CBMI >30 & <35 → 24  |  >25 & <30 → 23  |  >21.7 & <25 → 21.7
 *   >18.5 & <21.7 → 21.7 |  <18.5 → 20
 *
 * For age ≥ 65:
 *   CBMI >30 & <35 → 28  |  >25 & <30 → 27  |  >21.7 & <25 → 27
 *   <18.5 → 25  |  (18.5–21.7 not in spec, defaults to 25 like underweight)
 */
export function calcWTBMI(cbmi: number, age: number): number {
  // Spec only covers CBMI up to 35 — cap input at 35
  const c = Math.min(cbmi, 35);

  if (age < 65) {
    if (c < 18.5) return 20;
    if (c < 21.7) return 21.7;   // 18.5 ≤ CBMI < 21.7
    if (c < 25)   return 21.7;   // 21.7 ≤ CBMI < 25
    if (c < 30)   return 23;     // 25 ≤ CBMI < 30
    return 24;                   // 30 ≤ CBMI ≤ 35
  } else {
    if (c < 18.5) return 25;
    if (c < 21.7) return 25;     // 18.5 ≤ CBMI < 21.7 (spec gap, default to IBMI)
    if (c < 25)   return 27;     // 21.7 ≤ CBMI < 25
    if (c < 30)   return 27;     // 25 ≤ CBMI < 30
    return 28;                   // 30 ≤ CBMI ≤ 35
  }
}

/**
 * UTBMI (User Target BMI) = UTBW_kg / height_m²
 */
export function calcUTBMI(utbwKg: number, heightM2: number): number {
  if (heightM2 <= 0) return 0;
  return utbwKg / heightM2;
}

// ─── Target Body Weight ──────────────────────────────────────────────────────

/**
 * WTBW (Wondish Target Body Weight) = (IBW_kg × WTBMI) / IBMI
 */
export function calcWTBW(ibwKg: number, wtbmi: number, ibmi: number): number {
  if (ibmi <= 0) return ibwKg;
  return (ibwKg * wtbmi) / ibmi;
}

/**
 * UTBW (User Target Body Weight) = (IBW_kg × UTBMI) / IBMI
 * Falls back to WTBW if no user target is provided.
 */
export function calcUTBW(
  ibwKg: number,
  utbmi: number,
  ibmi: number
): number {
  if (ibmi <= 0) return ibwKg;
  return (ibwKg * utbmi) / ibmi;
}

// ─── Healthy-Band Goal Clamp & Plan Direction ────────────────────────────────

// Healthy BMI band per classifyCBMI: [18.5, 25). 24.9 is the practical ceiling.
export const HEALTHY_BMI_FLOOR = 18.5;
export const HEALTHY_BMI_CEIL = 24.9;

/**
 * Clamp a target weight so plans never aim outside the healthy BMI band in
 * the unhealthy direction, while preserving intermediate goals that stop
 * short of the band (e.g. an obese user aiming for BMI 26 keeps that goal).
 *   - below the band and not an intermediate stop on the way up → BMI 18.5
 *   - above the band and not an intermediate stop on the way down → BMI 24.9
 * Also floors the default WTBW for short users, whose IBW-derived target can
 * land underweight.
 */
export function clampGoalToHealthyBand(goalKg: number, cbwKg: number, heightM2: number): number {
  if (heightM2 <= 0) return goalKg;
  const floorKg = HEALTHY_BMI_FLOOR * heightM2;
  const ceilKg = HEALTHY_BMI_CEIL * heightM2;
  if (goalKg < floorKg && goalKg <= cbwKg) return floorKg;
  if (goalKg > ceilKg && goalKg >= cbwKg) return ceilKg;
  return goalKg;
}

export type PlanDirection = "lose" | "gain" | "maintain";

/** Direction of travel from current weight to an (already clamped) target. */
export function planDirection(cbwKg: number, tbwKg: number): PlanDirection {
  if (cbwKg > tbwKg) return "lose";
  if (cbwKg < tbwKg) return "gain";
  return "maintain";
}

/**
 * Plan direction for a profile. A user-set goal decides the direction (its
 * clamped form, profile.tbwKg); without one the BMI class decides, so
 * goal-less healthy users keep maintaining instead of chasing the WTBW
 * default.
 */
export function resolvePlanDirection(profile: CaloricProfile): PlanDirection {
  if (profile.utbwKg != null) return planDirection(profile.cbwKg, profile.tbwKg);
  if (profile.cbmiClass === "overweight" || profile.cbmiClass === "obese") return "lose";
  if (profile.cbmiClass === "underweight") return "gain";
  return "maintain";
}

// ─── BMR (Harris-Benedict) ───────────────────────────────────────────────────

// Harris-Benedict weight coefficient (kcal of BMR per kg of body weight).
// Shared by calcBMR and tdeeSlopePerKg so the projection slope always matches
// the BMR model the plan is built from.
const BMR_WEIGHT_COEF: Record<Sex, number> = { male: 13.7, female: 9.6 };

/**
 * Harris-Benedict BMR equation.
 * Females: 655 + (9.6 × weight_kg) + (1.8 × height_cm) - (4.7 × age)
 * Males:   66  + (13.7 × weight_kg) + (5 × height_cm)  - (6.8 × age)
 */
export function calcBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: Sex
): number {
  if (sex === "female") {
    return 655 + BMR_WEIGHT_COEF.female * weightKg + 1.8 * heightCm - 4.7 * age;
  }
  return 66 + BMR_WEIGHT_COEF.male * weightKg + 5 * heightCm - 6.8 * age;
}

// ─── Body Fat Percentage (Deurenberg Formula) ────────────────────────────────

/**
 * Estimates body fat % using the Deurenberg formula:
 * BF% = (1.20 × BMI) + (0.23 × age) - (10.8 × sexFactor) - 5.4
 * sexFactor: male = 1, female = 0
 */
export function calcBodyFatPct(cbmi: number, age: number, sex: Sex): number {
  const sexFactor = sex === "male" ? 1 : 0;
  return 1.20 * cbmi + 0.23 * age - 10.8 * sexFactor - 5.4;
}

// ─── Activity Multiplier ────────────────────────────────────────────────────
// Per the Wondish spec, only 4 activity levels are supported.

const ACTIVITY_MULTIPLIERS: Record<number, number> = {
  1: 1.2,     // Sedentary
  2: 1.375,   // Low active
  3: 1.55,    // Active
  4: 1.725,   // Very active
};

/**
 * Maps a PhysicalActivity.level (1–4) to the corresponding multiplier.
 * Levels outside 1–4 default to Sedentary (1.2).
 */
export function getActivityMultiplier(level: number): number {
  return ACTIVITY_MULTIPLIERS[level] ?? 1.2;
}

// ─── TDEE ────────────────────────────────────────────────────────────────────

/**
 * TDEE (Total Daily Energy Expenditure) = BMR × Activity Multiplier
 */
export function calcTDEE(bmr: number, activityMultiplier: number): number {
  return bmr * activityMultiplier;
}

// ─── Weight Delta ────────────────────────────────────────────────────────────

/**
 * WTL (Weight to Lose) = CBW - TBW.  Positive if user needs to lose weight.
 */
export function calcWTL(cbwKg: number, tbwKg: number): number {
  return cbwKg - tbwKg;
}

/**
 * WTG (Weight to Gain) = TBW - CBW.  Positive if user needs to gain weight.
 */
export function calcWTG(tbwKg: number, cbwKg: number): number {
  return tbwKg - cbwKg;
}

// ─── Minimum Calorie Intake ──────────────────────────────────────────────────

/**
 * Safety floor applied to every computed calorie target (plans, schedules,
 * projections all clamp intake to at least this value).
 * Male:   1500 kcal
 * Female: 1200 kcal
 */
export function minCalories(sex: Sex): number {
  return sex === "male" ? 1500 : 1200;
}

/**
 * Maximum sustainable daily calorie deficit, scaled by how overweight the
 * patient is (their current BMI). Rate anchors: BMI 25 → 0.5 lb/wk (gentle),
 * BMI 35+ → 2.0 lb/wk (aggressive cap). This keeps barely-overweight plans
 * easy and reserves deep deficits for those with the most to lose, so the
 * weekly rate reflects severity instead of everyone bottoming out at minCal.
 * Intake is still separately floored at minCal by the caller.
 */
export function maxDailyDeficit(cbmi: number): number {
  const MIN_RATE_LB = 0.5, MAX_RATE_LB = 2.0;
  const LOW_BMI = 25, HIGH_BMI = 35;
  const t = Math.min(1, Math.max(0, (cbmi - LOW_BMI) / (HIGH_BMI - LOW_BMI)));
  const weeklyLb = MIN_RATE_LB + t * (MAX_RATE_LB - MIN_RATE_LB);
  return (weeklyLb * 0.453592 * 7700) / 7; // lb/wk → kcal/day
}

// ─── Full Caloric Profile ────────────────────────────────────────────────────

export interface CaloricProfileInput {
  sex: Sex;
  birthday: Date;
  heightValue: number;
  heightUnit: "cm" | "in";
  cbwValue: number;
  cbwUnit: "kg" | "lbs" | "lb";
  activityLevel: number;         // PhysicalActivity.level (1–4)
  utbwValue?: number | null;     // User's Target Body Weight from profile
  utbwUnit?: "kg" | "lbs" | "lb" | null;
}

export interface CaloricProfile {
  // Inputs (normalized)
  sex: Sex;
  age: number;
  heightCm: number;
  heightM: number;
  heightM2: number;
  cbwKg: number;
  cbwLb: number;

  // Body Weight calculations
  ibwKg: number;
  wtbwKg: number;
  utbwKg: number | null;    // null if no user target
  tbwKg: number;            // resolved: UTBW if set, else WTBW

  // BMI
  cbmi: number;
  cbmiClass: CBMIClass;
  ibmi: number;
  wtbmi: number;
  utbmi: number | null;

  // BMR (Harris-Benedict)
  bmrCBW: number;
  bmrIBW: number;
  bmrWTBW: number;
  bmrUTBW: number | null;

  // TDEE
  activityMultiplier: number;
  bodyFatPct: number;
  tdeeCBW: number;
  tdeeIBW: number;
  tdeeWTBW: number;
  tdeeUTBW: number | null;

  // Weight delta
  wtl: number | null;       // weight to lose (positive if overweight)
  wtg: number | null;       // weight to gain (positive if underweight)

  // Target calories
  dailyCalories: number;    // TDEE for CBW, floored to minCalories — active meal plan target
  targetCalories: number;   // TDEE for TBW, floored to minCalories — informational goal state
  minCaloriesValue: number;
}

/**
 * Master computation function — runs all formulas and returns a complete
 * CaloricProfile.
 */
export function computeAllMetrics(input: CaloricProfileInput): CaloricProfile {
  const { sex, birthday, heightValue, heightUnit, cbwValue, cbwUnit, activityLevel } = input;

  // 1. Age
  const age = calcAge(birthday);

  // 2. Height conversions
  const ht = convertHeight(heightValue, heightUnit);

  // 3. Weight conversions (CBW)
  const cbw = convertWeight(cbwValue, cbwUnit);

  // 4. IBW
  const ibwKg = calcIBW(ht.cm, sex);

  // 5. BMI
  const cbmi = calcCBMI(cbw.kg, ht.m2);
  const cbmiClass = classifyCBMI(cbmi);
  const ibmi = calcIBMI(age);
  const wtbmi = calcWTBMI(cbmi, age);

  // 6. WTBW
  const wtbwKg = calcWTBW(ibwKg, wtbmi, ibmi);

  // 7. UTBW (User Target Body Weight)
  let utbwKg: number | null = null;
  let utbmi: number | null = null;
  if (input.utbwValue != null && input.utbwValue > 0) {
    const utbw = convertWeight(input.utbwValue, input.utbwUnit ?? "kg");
    utbwKg = utbw.kg;
    utbmi = calcUTBMI(utbwKg, ht.m2);
  }

  // 8. Resolved TBW: use UTBW if set, otherwise WTBW — clamped so no plan
  // targets outside the healthy BMI band in the unhealthy direction (also
  // floors the WTBW default for short users, which can land underweight).
  const tbwKg = clampGoalToHealthyBand(utbwKg ?? wtbwKg, cbw.kg, ht.m2);

  // 9. BMR (Harris-Benedict) for each weight variant
  const bmrCBW = calcBMR(cbw.kg, ht.cm, age, sex);
  const bmrIBW = calcBMR(ibwKg, ht.cm, age, sex);
  const bmrWTBW = calcBMR(wtbwKg, ht.cm, age, sex);
  const bmrUTBW = utbwKg != null ? calcBMR(utbwKg, ht.cm, age, sex) : null;

  // 10. Activity Multiplier
  const am = getActivityMultiplier(activityLevel);

  // 10b. Body Fat %
  const bodyFatPct = calcBodyFatPct(cbmi, age, sex);

  // 11. TDEE
  const tdeeCBW = calcTDEE(bmrCBW, am);
  const tdeeIBW = calcTDEE(bmrIBW, am);
  const tdeeWTBW = calcTDEE(bmrWTBW, am);
  const tdeeUTBW = bmrUTBW != null ? calcTDEE(bmrUTBW, am) : null;

  // 12. Weight delta
  const weightDiff = cbw.kg - tbwKg;
  const wtl = weightDiff > 0 ? weightDiff : null;
  const wtg = weightDiff < 0 ? Math.abs(weightDiff) : null;

  // 13. Daily calorie target = TDEE for CBW (current weight), floored to minimum.
  // Per spec, the meal plan uses CBW-based calories each month; the deficit is
  // achieved progressively as CBW decreases month by month toward TBW.
  // targetCalories (TBW-based) is exposed for display and goal-tracking only.
  const minCal = minCalories(sex);
  // targetCalories follows the RESOLVED (clamped) target weight so the goal
  // state always matches the tbwKg the plans actually aim for.
  const tbwTDEE        = calcTDEE(calcBMR(tbwKg, ht.cm, age, sex), am);
  const dailyCalories  = Math.max(tdeeCBW, minCal);
  const targetCalories = Math.max(tbwTDEE, minCal);

  return {
    sex,
    age,
    heightCm: ht.cm,
    heightM: ht.m,
    heightM2: ht.m2,
    cbwKg: cbw.kg,
    cbwLb: cbw.lb,

    ibwKg,
    wtbwKg,
    utbwKg,
    tbwKg,

    cbmi,
    cbmiClass,
    ibmi,
    wtbmi,
    utbmi,

    bmrCBW,
    bmrIBW,
    bmrWTBW,
    bmrUTBW,

    activityMultiplier: am,
    bodyFatPct,
    tdeeCBW,
    tdeeIBW,
    tdeeWTBW,
    tdeeUTBW,

    wtl,
    wtg,

    dailyCalories,
    targetCalories,
    minCaloriesValue: minCal,
  };
}

// ─── Gradual Cumulative Deficit Schedule ──────────────────────────────────────
// Each week ramps the deficit linearly within the week, picking up where the
// previous week left off. Weeks 1–3 each add 300 kcal/day; week 4+ each add 400.
//
// Example (TDEE = 3000):
//   Day 1  → deficit ≈  43 kcal  →  ~2957 kcal
//   Day 7  → deficit = 300 kcal  →   2700 kcal
//   Day 8  → deficit ≈ 343 kcal  →  ~2657 kcal
//   Day 14 → deficit = 600 kcal  →   2400 kcal
//   Day 28 → deficit =1300 kcal  →   1700 kcal

/**
 * Raw deficit magnitude for a given 1-indexed plan day.
 * Grows linearly within each week, cumulating across weeks.
 */
export function gradualDailyDeficit(dayNumber: number): number {
  const weekIndex  = Math.floor((dayNumber - 1) / 7); // 0-based week
  const dayInWeek  = ((dayNumber - 1) % 7) + 1;       // 1–7

  const increment          = weekIndex < 3 ? 300 : 400;
  const deficitAtWeekStart = weekIndex < 3
    ? weekIndex * 300
    : 900 + (weekIndex - 3) * 400;

  return deficitAtWeekStart + (dayInWeek / 7) * increment;
}

/**
 * Daily calorie target using the gradual cumulative deficit schedule, keyed
 * by the PLAN DIRECTION (goal-driven; see resolvePlanDirection) rather than
 * BMI class, so a healthy-class user with a set goal still gets a real
 * deficit/surplus. The deficit ramps in gradually but is capped at
 * `maxDeficit` (a severity-scaled per-day ceiling from maxDailyDeficit) so
 * the sustained weekly rate matches severity instead of driving everyone to
 * the minimum. Intake is also floored at minCal for safety, and all
 * projections clamp at the goal weight so intake never overshoots.
 */
export function gradualDailyCals(
  tdeeCBW: number,
  dayNumber: number,
  direction: PlanDirection,
  minCal: number,
  maxDeficit: number,
): number {
  if (direction === "lose") {
    // Floor = the deeper of (min safe calories) and (maintenance − max deficit).
    const floor = Math.max(minCal, tdeeCBW - maxDeficit);
    return Math.max(Math.round(tdeeCBW - gradualDailyDeficit(dayNumber)), floor);
  }
  if (direction === "gain") {
    const ceiling = Math.round(tdeeCBW + maxDeficit);
    return Math.min(Math.round(tdeeCBW + gradualDailyDeficit(dayNumber)), ceiling);
  }
  return Math.round(tdeeCBW);
}

// ─── Weekly Target Projection ─────────────────────────────────────────────────
// Per-week weight target derived from the gradual deficit/surplus schedule.
// The hero "this week" target is recomputed from current weight (adapts to real
// progress); the progress curve is the planned glide path anchored to the plan's
// start weight + date. Pure — safe to import on the client.

export const KCAL_PER_KG = 7700;

export interface WeeklyTargetPoint {
  week: number;        // 1-based week index from plan start
  progressPct: number; // 0–100 planned progress toward goal at end of that week
}

export interface WeeklyTarget {
  direction: "lose" | "gain" | "maintain";
  hasPlan: boolean;
  currentWeightKg: number;
  thisWeekTargetKg: number;   // end-of-this-week projection, clamped at goal
  weeklyDeltaKg: number;      // signed: <0 losing, >0 gaining, 0 maintain
  goalWeightKg: number;
  anchorStartKg: number;      // mealPlanWeight (or current weight when no plan)
  progressPct: number;        // achieved progress now (anchor → current), 0–100
  weekIndex: number;          // current week number from plan start (>=1)
  totalWeeks: number;         // re-estimated from current weight (>= weekIndex)
  curve: WeeklyTargetPoint[]; // planned glide path, rising 0→100
  cbmiClass: CBMIClass;
}

// Clamp a projected weight so it never overshoots the goal (either direction).
function clampTowardGoal(w: number, startKg: number, goalKg: number): number {
  if (startKg > goalKg) return Math.min(Math.max(w, goalKg), startKg); // losing
  if (startKg < goalKg) return Math.max(Math.min(w, goalKg), startKg); // gaining
  return goalKg;
}

/**
 * How much TDEE changes per kg of body weight (Harris-Benedict weight
 * coefficient × activity multiplier). Lets projections adapt TDEE as the
 * simulated weight moves, mirroring how the real plan is rebuilt at the new
 * weight once it drifts.
 */
export function tdeeSlopePerKg(sex: Sex, activityMultiplier: number): number {
  return BMR_WEIGHT_COEF[sex] * activityMultiplier;
}

// Simulation anchor for the glide-path walks below. TDEE and the severity cap
// are re-derived each simulated day from the walked weight — a constant-TDEE
// walk overstates the deficit more the further the weight falls.
export interface GlideWalk {
  startKg: number;       // simulated starting weight
  tdeeAtStart: number;   // TDEE at that weight
  slopePerKg: number;    // see tdeeSlopePerKg
  heightM2: number;      // derives simulated BMI for the severity cap
  direction: PlanDirection;
  minCal: number;
}

/**
 * Deficit (>0, losing) or surplus (<0, gaining) for one simulated day, given
 * kcal already banked. Shared by the weekly-target walks and the prediction
 * ETA so every projection uses the same model.
 */
export function walkDay(walk: GlideWalk, planDay: number, bankedKcal: number): number {
  const kgMoved = bankedKcal / KCAL_PER_KG;
  const tdee = walk.tdeeAtStart - walk.slopePerKg * kgMoved;
  const w = walk.startKg - kgMoved;
  const maxDef = maxDailyDeficit(walk.heightM2 > 0 ? w / walk.heightM2 : 0);
  const intake = gradualDailyCals(tdee, planDay, walk.direction, walk.minCal, maxDef);
  return tdee - intake;
}

// Cumulative kcal deficit (>0) or surplus (<0) over plan days [fromDay+1 .. fromDay+days].
function cumulativeDeficitKcal(walk: GlideWalk, fromDay: number, days: number): number {
  let total = 0;
  for (let i = 1; i <= days; i++) {
    total += walkDay(walk, fromDay + i, total);
  }
  return total;
}

// Days for the walk to reach `goalKg`, starting from ramp day `fromDay+1`.
function daysToGoalWalk(walk: GlideWalk, goalKg: number, fromDay: number): number {
  const losing = walk.startKg > goalKg;
  const neededKcal = Math.abs(walk.startKg - goalKg) * KCAL_PER_KG;
  let total = 0;
  for (let d = 1; d <= 3650; d++) {
    total += walkDay(walk, fromDay + d, total);
    if ((losing ? total : -total) >= neededKcal) return d;
  }
  // Never reached (including a non lose/gain class) — return the 10-year cap.
  return 3650;
}

export function computeWeeklyTarget(args: {
  profile: CaloricProfile;
  anchorStartKg: number | null;
  planStartDate: Date | null;
  now?: Date;
}): WeeklyTarget {
  const { profile } = args;
  const now = args.now ?? new Date();
  const goalKg = profile.tbwKg;
  const currentKg = profile.cbwKg;
  const cbmiClass = profile.cbmiClass;
  const minCal = profile.minCaloriesValue;
  const tdee = profile.tdeeCBW;
  const slopePerKg = tdeeSlopePerKg(profile.sex, profile.activityMultiplier);
  const hasPlan = args.planStartDate != null;
  const anchorStartKg = args.anchorStartKg ?? currentKg;

  const planDay = args.planStartDate
    ? Math.max(0, Math.floor((now.getTime() - args.planStartDate.getTime()) / 86400000))
    : 0;
  const weekIndex = Math.floor(planDay / 7) + 1;

  // Goal-driven when the user set a goal; BMI class otherwise (item 7).
  const direction = resolvePlanDirection(profile);

  const span = anchorStartKg - goalKg;
  const progressPct = span === 0 ? 100
    : Math.min(100, Math.max(0, ((anchorStartKg - currentKg) / span) * 100));

  const reachedGoal =
    (direction === "lose" && currentKg <= goalKg) ||
    (direction === "gain" && currentKg >= goalKg);

  if (direction === "maintain" || reachedGoal) {
    return {
      direction,
      hasPlan,
      currentWeightKg: currentKg,
      thisWeekTargetKg: direction === "maintain" ? currentKg : goalKg,
      weeklyDeltaKg: 0,
      goalWeightKg: goalKg,
      anchorStartKg,
      progressPct: reachedGoal ? 100 : progressPct,
      weekIndex,
      totalWeeks: weekIndex,
      curve: [{ week: weekIndex, progressPct: reachedGoal ? 100 : progressPct }],
      cbmiClass,
    };
  }

  // Hero: end-of-this-week projection from current weight at the true ramp position.
  const currentWalk: GlideWalk = {
    startKg: currentKg, tdeeAtStart: tdee, slopePerKg,
    heightM2: profile.heightM2, direction, minCal,
  };
  const weekKcal = cumulativeDeficitKcal(currentWalk, planDay, 7);
  const weeklyDeltaKg = -weekKcal / KCAL_PER_KG; // <0 losing, >0 gaining
  const thisWeekTargetKg = clampTowardGoal(currentKg + weeklyDeltaKg, currentKg, goalKg);

  // Adaptive horizon from current weight.
  const daysRemaining = daysToGoalWalk(currentWalk, goalKg, planDay);
  const totalWeeks = Math.max(weekIndex, (weekIndex - 1) + Math.ceil(daysRemaining / 7));

  // Planned glide path from the anchor: progress% at the end of each week.
  // TDEE at the anchor weight follows the same slope the walk uses.
  const anchorWalk: GlideWalk = {
    startKg: anchorStartKg,
    tdeeAtStart: tdee - slopePerKg * (currentKg - anchorStartKg),
    slopePerKg, heightM2: profile.heightM2, direction, minCal,
  };
  // One linear walk with week-boundary snapshots (re-walking from day 1 per
  // week would be O(totalWeeks²) — ~1M walkDay calls at the 522-week cap).
  const anchorSpan = anchorStartKg - goalKg;
  const curve: WeeklyTargetPoint[] = [];
  let bankedKcal = 0;
  for (let d = 1; d <= totalWeeks * 7; d++) {
    bankedKcal += walkDay(anchorWalk, d, bankedKcal);
    if (d % 7 === 0) {
      const plannedKg = clampTowardGoal(anchorStartKg - bankedKcal / KCAL_PER_KG, anchorStartKg, goalKg);
      const pct = anchorSpan === 0 ? 100
        : Math.min(100, Math.max(0, ((anchorStartKg - plannedKg) / anchorSpan) * 100));
      curve.push({ week: d / 7, progressPct: pct });
    }
  }

  return {
    direction, hasPlan,
    currentWeightKg: currentKg,
    thisWeekTargetKg, weeklyDeltaKg,
    goalWeightKg: goalKg, anchorStartKg,
    progressPct, weekIndex, totalWeeks, curve, cbmiClass,
  };
}

// ─── Day-Level Calorie Budget ─────────────────────────────────────────────────

// Allowed overshoot of the day's calorie target. Per-meal search windows reach
// 135% of a meal's target, so without a day-level cap a "deficit" day could
// assemble to ~135% of its total and erase the planned deficit entirely.
export const DAY_CALORIE_TOLERANCE = 1.05;

/**
 * Clamp a recipe-search calorie window [calMin, calMax] to the day's remaining
 * budget (dayBudget − caloriesAlreadyPlanned). Returns null when the remaining
 * budget can't fit the window's minimum — the pick should be skipped.
 */
export function capWindowToDayBudget(
  calMin: number,
  calMax: number,
  dayBudget: number,
  caloriesAlreadyPlanned: number,
): { calMin: number; calMax: number } | null {
  const remaining = dayBudget - caloriesAlreadyPlanned;
  if (remaining <= 0 || remaining < calMin) return null;
  return { calMin, calMax: Math.min(calMax, remaining) };
}

// ─── Macro Profiles ───────────────────────────────────────────────────────────

export type MacroProfile = "balanced" | "diabetic" | "gain_muscle";

export interface MacroPercentages {
  protein: number;
  carbs:   number;
  fat:     number;
}

export interface MealMacros {
  calories: number;
  proteinG: number;
  carbsG:   number;
  fatG:     number;
}

export interface DailyMacroDistribution {
  profile:       MacroProfile;
  dailyCalories: number;
  totalProteinG: number;
  totalCarbsG:   number;
  totalFatG:     number;
  meals:         Record<string, MealMacros>;
}

const MACRO_PROFILES: Record<MacroProfile, MacroPercentages> = {
  balanced:    { protein: 0.30, carbs: 0.50, fat: 0.20 },
  diabetic:    { protein: 0.35, carbs: 0.45, fat: 0.20 },
  gain_muscle: { protein: 0.30, carbs: 0.40, fat: 0.30 },
};

// Lunch is the main meal (35 %), dinner is secondary (30 %).
const MEAL_CALORIE_FRACTIONS: Record<string, number> = {
  breakfast: 0.20,
  lunch:     0.35,
  dinner:    0.30,
  snack:     0.15,
};

/**
 * Determine the macro profile from a patient's health conditions and motivations.
 * Diabetic condition takes priority; muscle-gain motivation is next; balanced otherwise.
 */
export function resolveMacroProfile(
  healthConditionNames: string[],
  motivationNames: string[]
): MacroProfile {
  const conds = healthConditionNames.map((n) => n.toLowerCase());
  const mots  = motivationNames.map((n) => n.toLowerCase());
  if (conds.some((c) => c.includes("diabet"))) return "diabetic";
  if (mots.some((m) => m.includes("muscle") || m.includes("gain"))) return "gain_muscle";
  return "balanced";
}

export function getMacroPercentages(profile: MacroProfile): MacroPercentages {
  return MACRO_PROFILES[profile];
}

/**
 * Break a daily calorie total into per-meal calorie targets (kcal).
 */
export function computeMealCalories(dailyCalories: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(MEAL_CALORIE_FRACTIONS).map(([meal, frac]) => [meal, dailyCalories * frac])
  );
}

/**
 * Compute grams of protein, carbs, and fat for each meal given a daily calorie
 * total and the patient's macro profile.
 * Protein: 4 kcal/g  |  Carbs: 4 kcal/g  |  Fat: 9 kcal/g
 */
export function computeDailyMacros(
  dailyCalories: number,
  profile: MacroProfile
): DailyMacroDistribution {
  const pct    = MACRO_PROFILES[profile];
  const r1     = (n: number) => Math.round(n * 10) / 10;
  const mealCals = computeMealCalories(dailyCalories);
  const meals: Record<string, MealMacros> = {};

  for (const [meal, cal] of Object.entries(mealCals)) {
    meals[meal] = {
      calories: Math.round(cal),
      proteinG: r1((cal * pct.protein) / 4),
      carbsG:   r1((cal * pct.carbs)   / 4),
      fatG:     r1((cal * pct.fat)     / 9),
    };
  }

  return {
    profile,
    dailyCalories: Math.round(dailyCalories),
    totalProteinG: r1((dailyCalories * pct.protein) / 4),
    totalCarbsG:   r1((dailyCalories * pct.carbs)   / 4),
    totalFatG:     r1((dailyCalories * pct.fat)     / 9),
    meals,
  };
}
