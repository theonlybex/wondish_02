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
  const s = (sexAtBirth ?? "").trim().toLowerCase();
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
 * Whether a prediction applies at all (the overweight/obese gate) is always
 * judged on the PROFILE's own activity level. An activity-level override
 * feeds the walk a profile recomputed at the overridden level, exactly as if
 * the user actually lived at that level: a higher level raises TDEE (bigger
 * daily deficit, shorter ETA — until the severity cap binds), a lower level
 * lowers TDEE (smaller deficit, longer but still finite ETA while the goal
 * stays reachable; null only when TDEE falls to the minimum-intake floor or
 * the 10-year cap is exceeded). Both the /prediction page and the Journey
 * what-if card call this same function, so their estimates always agree.
 */
export function computePredictionEstimate(
  input: PredictionProfileInput,
  overrides?: { goalWeight?: number; activityLevel?: number },
): PredictionEstimate | null {
  const goalWeight = overrides?.goalWeight ?? input.goalWeight;
  if (goalWeight >= input.weightValue) return null;

  const deriveProfile = (activityLevel: number) =>
    computeAllMetrics({
      sex: input.sex,
      birthday: new Date(input.birthday),
      heightValue: input.heightValue,
      heightUnit: input.heightUnit,
      cbwValue: input.weightValue,
      cbwUnit: input.weightUnit,
      activityLevel,
      utbwValue: goalWeight,
      utbwUnit: input.weightUnit,
    });

  // Eligibility is judged on the real profile — a what-if activity change
  // never alters whether a weight-loss prediction applies.
  const baseProfile = deriveProfile(input.activityLevel);
  if (baseProfile.cbmiClass !== "overweight" && baseProfile.cbmiClass !== "obese") return null;

  // The walk itself runs on the (possibly overridden) activity level.
  const activityLevel = overrides?.activityLevel ?? input.activityLevel;
  const profile = activityLevel === input.activityLevel ? baseProfile : deriveProfile(activityLevel);

  const weightToLoseKg =
    toKg(input.weightValue, input.weightUnit) - toKg(goalWeight, input.weightUnit);

  // A deficit is only possible if maintenance is above the minimum safe intake.
  if (profile.tdeeCBW <= profile.minCaloriesValue) return null;

  // Day-by-day walk of the same adaptive schedule the engine uses (walkDay:
  // TDEE + severity cap re-derived from the simulated weight as it falls).
  const walk: GlideWalk = {
    startKg: toKg(input.weightValue, input.weightUnit),
    tdeeAtStart: profile.tdeeCBW,
    slopePerKg: tdeeSlopePerKg(input.sex, getActivityMultiplier(activityLevel)),
    heightM2: profile.heightM2,
    direction: "lose", // prediction is loss-only (gated on overweight/obese above)
    minCal: profile.minCaloriesValue,
  };
  const totalKcalNeeded = weightToLoseKg * KCAL_PER_KG;
  let days = 0;
  let totalDeficit = 0;
  for (let day = 1; day <= 3650; day++) {
    totalDeficit += walkDay(walk, day, totalDeficit);
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
