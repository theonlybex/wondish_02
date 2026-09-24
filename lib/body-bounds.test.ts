import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBodyMetrics, firstBodyMetricsError, heightRangeText, weightRangeText } from "./body-bounds";

const both = { weight: "lbs", height: "cm" } as const;

test("checkBodyMetrics: a normal profile has no errors", () => {
  assert.deepEqual(checkBodyMetrics({ weightLbs: 176, heightCm: 175, goalWeightLbs: 165 }, both), {});
});

test("checkBodyMetrics: 1000 lbs is rejected, in the unit the user typed", () => {
  assert.equal(checkBodyMetrics({ weightLbs: 1000 }, both).weight, "Weight must be between 50 and 700 lbs.");
  assert.equal(checkBodyMetrics({ weightLbs: 1000 }, { weight: "kg", height: "cm" }).weight, "Weight must be between 23 and 318 kg.");
  assert.equal(checkBodyMetrics({ weightLbs: 20 }, both).weight, "Weight must be between 50 and 700 lbs.");
  assert.equal(checkBodyMetrics({ weightLbs: NaN }, both).weight, "Weight must be a number.");
  assert.equal(checkBodyMetrics({ weightLbs: Infinity }, both).weight, "Weight must be a number.");
});

test("checkBodyMetrics: 10 cm and 300 cm are rejected; ft/in message uses feet", () => {
  assert.equal(checkBodyMetrics({ heightCm: 10 }, both).height, "Height must be between 90 and 250 cm.");
  assert.equal(checkBodyMetrics({ heightCm: 300 }, both).height, "Height must be between 90 and 250 cm.");
  assert.equal(checkBodyMetrics({ heightCm: 10 }, { weight: "lbs", height: "ftin" }).height, `Height must be between 2'11" and 8'2".`);
  assert.equal(heightRangeText("in"), "35 and 98 in");
  assert.equal(weightRangeText("lbs"), "50 and 700 lbs");
});

test("checkBodyMetrics: height and weight that give an implausible BMI are rejected together", () => {
  // 700 lbs at 90 cm → BMI ≈ 392; 50 lbs at 250 cm → BMI ≈ 3.6
  assert.equal(checkBodyMetrics({ weightLbs: 700, heightCm: 90 }, both).weight, "Height and weight don't add up — please check both.");
  assert.equal(checkBodyMetrics({ weightLbs: 50, heightCm: 250 }, both).weight, "Height and weight don't add up — please check both.");
  // In range individually and together.
  assert.deepEqual(checkBodyMetrics({ weightLbs: 700, heightCm: 250 }, both), {});
});

test("checkBodyMetrics: goal weight must be a safe target for the height", () => {
  // 175 cm: BMI 15 ≈ 101 lbs, BMI 60 ≈ 405 lbs
  assert.equal(checkBodyMetrics({ heightCm: 175, goalWeightLbs: 60 }, both).goalWeight, "For your height, a safe goal is between 101 lbs and 405 lbs.");
  assert.equal(checkBodyMetrics({ heightCm: 175, goalWeightLbs: 500 }, { weight: "kg", height: "cm" }).goalWeight, "For your height, a safe goal is between 46 kg and 184 kg.");
  assert.equal(checkBodyMetrics({ heightCm: 175, goalWeightLbs: 1000 }, both).goalWeight, "Goal weight must be between 50 and 700 lbs.");
  assert.deepEqual(checkBodyMetrics({ heightCm: 175, goalWeightLbs: 150 }, both), {});
  // Without a height only the absolute range applies.
  assert.deepEqual(checkBodyMetrics({ goalWeightLbs: 60 }, both), {});
});

test("checkBodyMetrics: absent fields are skipped; firstBodyMetricsError orders weight → height → goal", () => {
  assert.deepEqual(checkBodyMetrics({}, both), {});
  // heightCm: 0 used to be "absent" here. That expectation was the defect —
  // see the zero test below; a typed 0 is out of bounds, not unset.
  assert.match(checkBodyMetrics({ weightLbs: null, heightCm: 0 }, both).height ?? "", /Height must be between/);
  const errs = checkBodyMetrics({ weightLbs: 1000, heightCm: 10, goalWeightLbs: 5 }, both);
  assert.deepEqual(firstBodyMetricsError(errs), { field: "weight", message: "Weight must be between 50 and 700 lbs." });
  assert.equal(firstBodyMetricsError({}), null);
});

test("zero is a value the user typed, not an absent field", () => {
  // It skipped every check on both sides of the wire and saved: weight 0,
  // bmi 0, "Profile saved successfully.", and a dashboard that then called
  // the profile incomplete.
  const lbsCm = { weight: "lbs" as const, height: "cm" as const };
  assert.match(
    checkBodyMetrics({ weightLbs: 0, heightCm: 170, goalWeightLbs: null }, lbsCm).weight ?? "",
    /Weight must be between/
  );
  assert.match(
    checkBodyMetrics({ weightLbs: 165, heightCm: 0, goalWeightLbs: null }, lbsCm).height ?? "",
    /Height must be between/
  );
  assert.match(
    checkBodyMetrics({ weightLbs: 165, heightCm: 170, goalWeightLbs: 0 }, lbsCm).goalWeight ?? "",
    /Goal weight must be between/
  );
  // An untouched field still reaches here as null and is still not an error.
  assert.deepEqual(checkBodyMetrics({ weightLbs: null, heightCm: null, goalWeightLbs: null }, lbsCm), {});
});
