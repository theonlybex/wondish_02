// Shared weight-loss prediction math used by /prediction and the Journey
// what-if card. Pure functions only — safe to import from client components.
import {
  computeAllMetrics,
  getActivityMultiplier,
  tdeeSlopePerKg,
  walkDay,
  KCAL_PER_KG,
  type GlideWalk,
  type Sex,
} from "./caloric-engine";

export type { Sex };

export interface PredictionProfileInput {
  sex: Sex;
  birthday: string; // ISO string so it can cross the server/client boundary
  heightValue: number;
  heightUnit: "cm" | "in";
  weightValue: number; // current body weight, in weightUnit
  weightUnit: "kg" | "lbs"; // also the display unit
  goalWeight: number; // normalized into weightUnit
  activityLevel: number; // PhysicalActivity.level (1–4)
}

export interface PredictionEstimate {
  days: number;
  currentWeight: number;
  goalWeight: number;
  weightToLose: number; // in weightUnit
  weeklyGoal: number; // average loss per week, in weightUnit
  weightUnit: "kg" | "lbs";
}

// Same factor convertWeight() uses, so simulated weights and engine metrics
// never disagree on the conversion.
const KG_PER_LB = 0.45359237;
export const toKg = (v: number, unit: "kg" | "lbs") => (unit === "lbs" ? v * KG_PER_LB : v);
export const fromKg = (v: number, unit: "kg" | "lbs") => (unit === "lbs" ? v / KG_PER_LB : v);

// Display helper: convert an internal kg value (e.g. caloric-engine outputs that
// only exist in kg) into lbs for the UI. Clients always see lbs.
export const kgToLbs = (v: number) => v / KG_PER_LB;

export function resolveSex(sexAtBirth: string | null | undefined): Sex | null {
  const s = (sexAtBirth ?? "").toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  return null;
}

/**
 * Runs the caloric engine for the given profile, optionally overriding the
 * goal weight (in the profile's weight unit) and activity level. Returns null
 * when no weight-loss prediction applies (healthy/underweight BMI, goal not
 * below current weight, or no achievable deficit).
 *
 * The intake schedule (gradual deficit ramp + severity-scaled cap) is always
 * anchored to the PROFILE's activity level — that's what the meal plan is
 * generated from. An activity-level override only changes the burn side:
 * extra exercise adds BMR × Δmultiplier of daily deficit on top. Both the
 * /prediction page and the Journey what-if card call this same function, so
 * their estimates always agree.
 */
export function computePredictionEstimate(
  input: PredictionProfileInput,
  overrides?: { goalWeight?: number; activityLevel?: number },
): PredictionEstimate | null {
  const goalWeight = overrides?.goalWeight ?? input.goalWeight;
  if (goalWeight >= input.weightValue) return null;

  const profile = computeAllMetrics({
    sex: input.sex,
    birthday: new Date(input.birthday),
    heightValue: input.heightValue,
    heightUnit: input.heightUnit,
    cbwValue: input.weightValue,
    cbwUnit: input.weightUnit,
    activityLevel: input.activityLevel,
    utbwValue: goalWeight,
    utbwUnit: input.weightUnit,
  });

  if (profile.cbmiClass !== "overweight" && profile.cbmiClass !== "obese") return null;

  const extraBurnPerDay =
    overrides?.activityLevel != null && overrides.activityLevel !== input.activityLevel
      ? profile.bmrCBW *
        (getActivityMultiplier(overrides.activityLevel) - getActivityMultiplier(input.activityLevel))
      : 0;

  const weightToLoseKg =
    toKg(input.weightValue, input.weightUnit) - toKg(goalWeight, input.weightUnit);

  // A deficit is only possible if maintenance is above the minimum safe intake.
  const effectiveFloor = profile.minCaloriesValue;
  if (extraBurnPerDay <= 0 && profile.tdeeCBW <= effectiveFloor) return null;

  // Day-by-day walk of the same adaptive schedule the engine uses (walkDay:
  // TDEE + severity cap re-derived from the simulated weight as it falls),
  // with the exercise delta added to each day's burn. The banked total feeds
  // back into the walk, so extra exercise also lowers the simulated weight.
  const walk: GlideWalk = {
    startKg: toKg(input.weightValue, input.weightUnit),
    tdeeAtStart: profile.tdeeCBW,
    slopePerKg: tdeeSlopePerKg(input.sex, getActivityMultiplier(input.activityLevel)),
    heightM2: profile.heightM2,
    cbmiClass: profile.cbmiClass,
    minCal: profile.minCaloriesValue,
  };
  const totalKcalNeeded = weightToLoseKg * KCAL_PER_KG;
  let days = 0;
  let totalDeficit = 0;
  for (let day = 1; day <= 3650; day++) {
    totalDeficit += walkDay(walk, day, totalDeficit) + extraBurnPerDay;
    if (totalDeficit >= totalKcalNeeded) {
      days = day;
      break;
    }
  }
  if (days <= 0) return null; // not reachable within 10 years

  const weeklyLossKg = weightToLoseKg / (days / 7);

  return {
    days,
    currentWeight: input.weightValue,
    goalWeight,
    weightToLose: parseFloat(fromKg(weightToLoseKg, input.weightUnit).toFixed(1)),
    weeklyGoal: parseFloat(fromKg(weeklyLossKg, input.weightUnit).toFixed(2)),
    weightUnit: input.weightUnit,
  };
}
