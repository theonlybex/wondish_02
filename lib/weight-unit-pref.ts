/**
 * Which unit a person reads weights in.
 *
 * Patient.weightUnit is the STORAGE unit, not a preference: /api/patient/profile
 * writes "lbs" on every save, and every reader converts from it. Cycle 15 made
 * the profile toggle send its choice in that field, the server overwrote it,
 * and the choice silently reverted on reload — while /overview picked kg from
 * the height unit, so one account read 80.0 kg on one screen and 176 lbs on
 * the next (cycle 19).
 *
 * Until a real preference column exists (a migration), the rule is: a metric
 * height means kg, unless the person toggled otherwise on THIS device. The
 * profile page says the choice is kept on the device, not the account.
 */
export type WeightUnit = "kg" | "lbs";

const KEY = "wondish:weightUnit";

export function defaultWeightUnit(heightUnit: string | null | undefined): WeightUnit {
  return heightUnit === "cm" ? "kg" : "lbs";
}

export function readWeightUnitPref(): WeightUnit | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "kg" || v === "lbs" ? v : null;
  } catch {
    return null;
  }
}

export function writeWeightUnitPref(unit: WeightUnit): void {
  try {
    window.localStorage.setItem(KEY, unit);
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}
