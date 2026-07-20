import { test } from "node:test";
import assert from "node:assert/strict";
import { toKg, fromKg } from "./prediction-data";
import { normalizePredictionPatient, type PredictionPatientRow } from "./prediction-profile";

// normalizePredictionPatient is the pure post-query half of
// getPredictionProfileInput (lib/queries.ts): it turns the raw patient row
// (Prisma select shape) into a serializable PredictionProfileInput, or null
// when the profile is incomplete / the goal isn't below current weight.

const BIRTHDAY = new Date("1990-05-15T00:00:00.000Z");

function makeRow(overrides: Partial<PredictionPatientRow> = {}): PredictionPatientRow {
  return {
    weight: 90,
    weightUnit: "kg",
    goalWeight: 75,
    goalWeightUnit: "kg",
    height: 180,
    heightUnit: "cm",
    birthday: BIRTHDAY,
    sexAtBirth: "MALE",
    physicalActivity: { level: 2 },
    ...overrides,
  };
}

// ─── Complete row round-trips ────────────────────────────────────────────────

test("a complete metric row round-trips into a prediction input", () => {
  const input = normalizePredictionPatient(makeRow());
  assert.deepEqual(input, {
    sex: "male",
    birthday: BIRTHDAY.toISOString(),
    heightValue: 180,
    heightUnit: "cm",
    weightValue: 90,
    weightUnit: "kg",
    goalWeight: 75,
    activityLevel: 2,
  });
});

test("a complete imperial row keeps lbs/in units", () => {
  const input = normalizePredictionPatient(
    makeRow({
      weight: 200, weightUnit: "lbs",
      goalWeight: 165, goalWeightUnit: "lbs",
      height: 70, heightUnit: "in",
      sexAtBirth: "FEMALE",
    })
  );
  assert.deepEqual(input, {
    sex: "female",
    birthday: BIRTHDAY.toISOString(),
    heightValue: 70,
    heightUnit: "in",
    weightValue: 200,
    weightUnit: "lbs",
    goalWeight: 165,
    activityLevel: 2,
  });
});

// ─── Missing core fields → null ──────────────────────────────────────────────

test("null when weight is missing", () => {
  assert.equal(normalizePredictionPatient(makeRow({ weight: null })), null);
});

test("null when goalWeight is missing", () => {
  assert.equal(normalizePredictionPatient(makeRow({ goalWeight: null })), null);
});

test("null when height is missing", () => {
  assert.equal(normalizePredictionPatient(makeRow({ height: null })), null);
});

test("null when birthday is missing", () => {
  assert.equal(normalizePredictionPatient(makeRow({ birthday: null })), null);
});

// ─── Sex / activity gates ────────────────────────────────────────────────────

test("null when sexAtBirth does not resolve to male/female", () => {
  assert.equal(normalizePredictionPatient(makeRow({ sexAtBirth: null })), null);
  assert.equal(normalizePredictionPatient(makeRow({ sexAtBirth: "other" })), null);
});

test("null when the physical-activity relation is missing", () => {
  assert.equal(normalizePredictionPatient(makeRow({ physicalActivity: null })), null);
});

// ─── Unit fallbacks ──────────────────────────────────────────────────────────

test("goalWeightUnit null falls back to weightUnit (no conversion applied)", () => {
  const input = normalizePredictionPatient(
    makeRow({ weightUnit: "lbs", weight: 200, goalWeightUnit: null, goalWeight: 165 })
  );
  assert.ok(input);
  assert.equal(input.weightUnit, "lbs");
  assert.equal(input.goalWeight, 165);
});

test("unrecognized weight units default to kg and unrecognized height units to cm", () => {
  // heightUnit "ftin" exists in the schema but the prediction input only
  // understands cm/in — anything that isn't exactly "in" must read as cm,
  // and any weight unit that isn't exactly "lbs" must read as kg.
  const input = normalizePredictionPatient(
    makeRow({ weightUnit: "stone", goalWeightUnit: "stone", heightUnit: "ftin" })
  );
  assert.ok(input);
  assert.equal(input.weightUnit, "kg");
  assert.equal(input.heightUnit, "cm");
  // Both units collapsed to kg → same unit → the raw goal value passes through.
  assert.equal(input.goalWeight, 75);
});

// ─── Cross-unit goal conversion ──────────────────────────────────────────────

test("a lbs goal against a kg weight is converted through toKg/fromKg to 1 decimal", () => {
  const input = normalizePredictionPatient(
    makeRow({ weight: 90, weightUnit: "kg", goalWeight: 150, goalWeightUnit: "lbs" })
  );
  assert.ok(input);
  assert.equal(input.weightUnit, "kg");
  assert.equal(input.goalWeight, parseFloat(fromKg(toKg(150, "lbs"), "kg").toFixed(1)));
});

test("a kg goal against a lbs weight is converted into lbs to 1 decimal", () => {
  const input = normalizePredictionPatient(
    makeRow({ weight: 200, weightUnit: "lbs", goalWeight: 70, goalWeightUnit: "kg" })
  );
  assert.ok(input);
  assert.equal(input.weightUnit, "lbs");
  assert.equal(input.goalWeight, parseFloat(fromKg(toKg(70, "kg"), "lbs").toFixed(1)));
});

// ─── Goal must be below current weight ───────────────────────────────────────

test("null when goalWeight equals or exceeds current weight", () => {
  assert.equal(normalizePredictionPatient(makeRow({ goalWeight: 90 })), null);
  assert.equal(normalizePredictionPatient(makeRow({ goalWeight: 95 })), null);
});

test("the goal-below-weight gate compares AFTER unit conversion", () => {
  // 155 lbs ≈ 70.3 kg < 71 kg → passes even though 155 > 71 numerically.
  const passes = normalizePredictionPatient(
    makeRow({ weight: 71, weightUnit: "kg", goalWeight: 155, goalWeightUnit: "lbs" })
  );
  assert.ok(passes, "converted goal below weight must produce an input");
  // 160 lbs ≈ 72.6 kg >= 71 kg → null even though the profile is complete.
  const blocked = normalizePredictionPatient(
    makeRow({ weight: 71, weightUnit: "kg", goalWeight: 160, goalWeightUnit: "lbs" })
  );
  assert.equal(blocked, null, "converted goal at/above weight must be rejected");
});
