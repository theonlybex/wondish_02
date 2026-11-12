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

const KG_PER_LB = 0.45359237;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pounds (the storage unit) to kilograms, 1 decimal. */
export function lbsToKg(lbs: number): number {
  return round1(lbs * KG_PER_LB);
}

/**
 * The Numbers weight row in the unit the person reads. Weights are stored in
 * lbs. For kg the latest and the comparison weigh-in are converted FIRST, the
 * value is rounded to 1 decimal, and the change is the rounded difference of
 * the converted values. For lbs the stored numbers pass through unchanged.
 */
export function weightInDisplayUnit(
  latestLbs: number,
  comparisonLbs: number | null,
  display: WeightUnit,
): { value: number; unit: WeightUnit; change: number | null } {
  if (display === "lbs") {
    return {
      value: latestLbs,
      unit: "lbs",
      change: comparisonLbs != null ? round1(latestLbs - comparisonLbs) : null,
    };
  }
  const latest = latestLbs * KG_PER_LB;
  return {
    value: round1(latest),
    unit: "kg",
    change: comparisonLbs != null ? round1(latest - comparisonLbs * KG_PER_LB) : null,
  };
}
