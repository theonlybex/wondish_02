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

// ─── BMR (Harris-Benedict) ───────────────────────────────────────────────────

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
    return 655 + 9.6 * weightKg + 1.8 * heightCm - 4.7 * age;
  }
  return 66 + 13.7 * weightKg + 5 * heightCm - 6.8 * age;
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
 * Once the user receives this value, retain it until they reach TBW.
 * Male:   1500 kcal
 * Female: 1200 kcal
 */
export function minCalories(sex: Sex): number {
  return sex === "male" ? 1500 : 1200;
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
  tdeeCBW: number;
  tdeeIBW: number;
  tdeeWTBW: number;
  tdeeUTBW: number | null;

  // Weight delta
  wtl: number | null;       // weight to lose (positive if overweight)
  wtg: number | null;       // weight to gain (positive if underweight)

  // Target calories
  dailyCalories: number;    // the TDEE for the target weight, floored to minCalories
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

  // 8. Resolved TBW: use UTBW if set, otherwise WTBW
  const tbwKg = utbwKg ?? wtbwKg;

  // 9. BMR (Harris-Benedict) for each weight variant
  const bmrCBW = calcBMR(cbw.kg, ht.cm, age, sex);
  const bmrIBW = calcBMR(ibwKg, ht.cm, age, sex);
  const bmrWTBW = calcBMR(wtbwKg, ht.cm, age, sex);
  const bmrUTBW = utbwKg != null ? calcBMR(utbwKg, ht.cm, age, sex) : null;

  // 10. Activity Multiplier
  const am = getActivityMultiplier(activityLevel);

  // 11. TDEE
  const tdeeCBW = calcTDEE(bmrCBW, am);
  const tdeeIBW = calcTDEE(bmrIBW, am);
  const tdeeWTBW = calcTDEE(bmrWTBW, am);
  const tdeeUTBW = bmrUTBW != null ? calcTDEE(bmrUTBW, am) : null;

  // 12. Weight delta
  const weightDiff = cbw.kg - tbwKg;
  const wtl = weightDiff > 0 ? weightDiff : null;
  const wtg = weightDiff < 0 ? Math.abs(weightDiff) : null;

  // 13. Daily calorie target = TDEE for the target weight, floored to minimum
  const minCal = minCalories(sex);
  const targetTDEE = utbwKg != null && tdeeUTBW != null ? tdeeUTBW : tdeeWTBW;
  const dailyCalories = Math.max(targetTDEE, minCal);

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
    tdeeCBW,
    tdeeIBW,
    tdeeWTBW,
    tdeeUTBW,

    wtl,
    wtg,

    dailyCalories,
    minCaloriesValue: minCal,
  };
}
