// Plausibility bounds for body metrics — one source of truth for
// /api/patient/profile, the onboarding wizard, the settings form and the
// journal weigh-in. Stored units are lbs and cm; messages render in the unit
// the user is typing in. Pure, safe to import on the client.
//
// Before 2026-09-11 the server accepted 0–1500 lbs and 0–300 cm with no
// cross-check, so "1000 lbs" or "10 cm" produced an 8,300-kcal plan, 170 %
// body fat and a BMI of 8,000 without a word to the user.
export const LBS_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;

export const WEIGHT_LBS = { min: 50, max: 700 } as const;    // ≈ 23–318 kg
export const HEIGHT_CM = { min: 90, max: 250 } as const;     // ≈ 2'11"–8'2"
export const BMI_PLAUSIBLE = { min: 10, max: 100 } as const; // height and weight must agree
export const GOAL_BMI = { min: 15, max: 60 } as const;       // a target outside this is not a diet goal

export type WeightUnit = "kg" | "lbs";
export type HeightUnit = "cm" | "in" | "ftin";

export const lbsToKg = (lbs: number) => lbs / LBS_PER_KG;
export const kgToLbs = (kg: number) => kg * LBS_PER_KG;

const round1 = (n: number) => Math.round(n * 10) / 10;
const ftIn = (cm: number) => {
  const totalIn = Math.round(cm / CM_PER_IN);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
};
const fmtWeight = (lbs: number, unit: WeightUnit) => (unit === "kg" ? `${Math.round(lbsToKg(lbs))} kg` : `${Math.round(lbs)} lbs`);

export function weightRangeText(unit: WeightUnit): string {
  return unit === "kg"
    ? `${Math.round(lbsToKg(WEIGHT_LBS.min))} and ${Math.round(lbsToKg(WEIGHT_LBS.max))} kg`
    : `${WEIGHT_LBS.min} and ${WEIGHT_LBS.max} lbs`;
}

export function heightRangeText(unit: HeightUnit): string {
  if (unit === "cm") return `${HEIGHT_CM.min} and ${HEIGHT_CM.max} cm`;
  if (unit === "in") return `${Math.round(HEIGHT_CM.min / CM_PER_IN)} and ${Math.round(HEIGHT_CM.max / CM_PER_IN)} in`;
  return `${ftIn(HEIGHT_CM.min)} and ${ftIn(HEIGHT_CM.max)}`;
}

export const bmiOf = (weightLbs: number, heightCm: number) => lbsToKg(weightLbs) / (heightCm / 100) ** 2;

export interface BodyMetricsInput {
  // Stored units. null / undefined / 0 means "not provided" and is skipped —
  // whether a field is required is the caller's decision.
  weightLbs?: number | null;
  heightCm?: number | null;
  goalWeightLbs?: number | null;
}
export interface BodyMetricsUnits {
  weight: WeightUnit;
  height: HeightUnit;
}
export interface BodyMetricsErrors {
  weight?: string;
  height?: string;
  goalWeight?: string;
}

// A field is "not provided" only when it is null/undefined. Zero used to count
// as absent, which meant a weight of 0 skipped every check in this module —
// client and server alike, since both call it — and saved: the profile form
// answered "Profile saved successfully.", stored weight 0 and bmi 0, and the
// dashboard then degraded to "Incomplete profile. Please fill in weight,
// height, birthday…" with the calorie numbers gone (QA 2026-09-24). An empty
// input must reach here as null; 0 is a number the user typed, and 0 lbs is
// out of bounds like any other impossible value.
const provided = (v: number | null | undefined): v is number => v != null;

export function checkBodyMetrics(input: BodyMetricsInput, units: BodyMetricsUnits): BodyMetricsErrors {
  const errs: BodyMetricsErrors = {};
  const { weightLbs, heightCm, goalWeightLbs } = input;

  if (provided(weightLbs)) {
    if (!Number.isFinite(weightLbs)) errs.weight = "Weight must be a number.";
    else if (weightLbs < WEIGHT_LBS.min || weightLbs > WEIGHT_LBS.max) errs.weight = `Weight must be between ${weightRangeText(units.weight)}.`;
  }
  if (provided(heightCm)) {
    if (!Number.isFinite(heightCm)) errs.height = "Height must be a number.";
    else if (heightCm < HEIGHT_CM.min || heightCm > HEIGHT_CM.max) errs.height = `Height must be between ${heightRangeText(units.height)}.`;
  }
  const weightOk = provided(weightLbs) && !errs.weight;
  const heightOk = provided(heightCm) && !errs.height;
  if (weightOk && heightOk) {
    const bmi = bmiOf(weightLbs, heightCm);
    if (bmi < BMI_PLAUSIBLE.min || bmi > BMI_PLAUSIBLE.max) errs.weight = "Height and weight don't add up — please check both.";
  }

  if (provided(goalWeightLbs)) {
    if (!Number.isFinite(goalWeightLbs)) errs.goalWeight = "Goal weight must be a number.";
    else if (goalWeightLbs < WEIGHT_LBS.min || goalWeightLbs > WEIGHT_LBS.max) errs.goalWeight = `Goal weight must be between ${weightRangeText(units.weight)}.`;
    else if (heightOk) {
      const m2 = (heightCm / 100) ** 2;
      const lo = Math.max(WEIGHT_LBS.min, kgToLbs(GOAL_BMI.min * m2));
      const hi = Math.min(WEIGHT_LBS.max, kgToLbs(GOAL_BMI.max * m2));
      if (goalWeightLbs < lo || goalWeightLbs > hi) {
        errs.goalWeight = `For your height, a safe goal is between ${fmtWeight(lo, units.weight)} and ${fmtWeight(hi, units.weight)}.`;
      }
    }
  }
  return errs;
}

export const firstBodyMetricsError = (errs: BodyMetricsErrors): { field: keyof BodyMetricsErrors; message: string } | null => {
  for (const field of ["weight", "height", "goalWeight"] as const) {
    if (errs[field]) return { field, message: errs[field]! };
  }
  return null;
};

export { round1 as roundToTenth };
