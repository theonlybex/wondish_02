// Pure post-query normalization for the weight-loss prediction profile.
// Extracted verbatim from getPredictionProfileInput (lib/queries.ts) so the
// logic is unit-testable — this module must never import anything that
// touches Prisma or the database.
import { resolveSex, toKg, fromKg, type PredictionProfileInput } from "./prediction-data";

// Mirrors the Prisma select in getPredictionProfileInput (lib/queries.ts):
// every scalar is nullable exactly as in the Patient schema.
export interface PredictionPatientRow {
  weight: number | null;
  weightUnit: string | null;
  goalWeight: number | null;
  goalWeightUnit: string | null;
  height: number | null;
  heightUnit: string | null;
  birthday: Date | null;
  sexAtBirth: string | null;
  physicalActivity: { level: number } | null;
}

// Normalizes a raw patient row into a serializable input for
// computePredictionEstimate(). Returns null when the profile is incomplete
// or the goal isn't below current weight.
export function normalizePredictionPatient(
  patient: PredictionPatientRow
): PredictionProfileInput | null {
  if (!patient.weight || !patient.goalWeight || !patient.height || !patient.birthday) return null;
  const sex = resolveSex(patient.sexAtBirth);
  const activityLevel = patient.physicalActivity?.level;
  if (!sex || !activityLevel) return null;

  const weightUnit: "kg" | "lbs" = patient.weightUnit === "lbs" ? "lbs" : "kg";
  const goalUnit: "kg" | "lbs" =
    (patient.goalWeightUnit ?? patient.weightUnit) === "lbs" ? "lbs" : "kg";
  const goalWeight =
    goalUnit === weightUnit
      ? patient.goalWeight
      : fromKg(toKg(patient.goalWeight, goalUnit), weightUnit);
  if (goalWeight >= patient.weight) return null;

  return {
    sex,
    birthday: patient.birthday.toISOString(),
    heightValue: patient.height,
    heightUnit: patient.heightUnit === "in" ? "in" : "cm",
    weightValue: patient.weight,
    weightUnit,
    goalWeight: parseFloat(goalWeight.toFixed(1)),
    activityLevel,
  };
}
