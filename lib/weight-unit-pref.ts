/**
 * Which unit a person reads weights in, when they have not chosen one.
 *
 * Patient.weightUnit is the STORAGE unit ("lbs", always); the choice lives in
 * Patient.displayWeightUnit. Until they choose, a metric height means kg.
 */
export type WeightUnit = "kg" | "lbs";

export function defaultWeightUnit(heightUnit: string | null | undefined): WeightUnit {
  return heightUnit === "cm" ? "kg" : "lbs";
}

/** The unit a person reads weights in: their choice, else from their height. */
export function resolveWeightUnit(chosen: string | null | undefined, heightUnit: string | null | undefined): WeightUnit {
  return chosen === "kg" || chosen === "lbs" ? chosen : defaultWeightUnit(heightUnit);
}
