import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWeightUnit } from "./weight-unit-pref";

// Patient.weightUnit is the storage unit and always "lbs"; the choice lives in
// displayWeightUnit (cycle 21). One account read 80.0 kg on /overview and
// 176 lbs on /profile before there was one rule for both.
test("the person's choice wins; a metric height stands in until they make one", () => {
  assert.equal(resolveWeightUnit("kg", "ftin"), "kg");
  assert.equal(resolveWeightUnit("lbs", "cm"), "lbs");
  assert.equal(resolveWeightUnit(null, "cm"), "kg");
  assert.equal(resolveWeightUnit(undefined, "ftin"), "lbs");
  assert.equal(resolveWeightUnit("stone", "in"), "lbs");
});

import { weightInDisplayUnit, lbsToKg, profileWeightRow } from "./weight-unit-pref";

test("weightInDisplayUnit: lbs passes the stored numbers through as before", () => {
  assert.deepEqual(weightInDisplayUnit(180.4, 182.1, "lbs"), { value: 180.4, unit: "lbs", change: -1.7 });
  assert.deepEqual(weightInDisplayUnit(180.4, null, "lbs"), { value: 180.4, unit: "lbs", change: null });
});

test("weightInDisplayUnit: kg converts both weigh-ins first; change is the rounded difference", () => {
  const r = weightInDisplayUnit(180, 182, "kg");
  assert.equal(r.unit, "kg");
  assert.equal(r.value, 81.6);
  assert.equal(r.change, -0.9); // 2 lbs = 0.907 kg; not 81.6 - 82.6 from rounded values
  assert.equal(weightInDisplayUnit(150, null, "kg").change, null);
  assert.equal(lbsToKg(165), 74.8);
});

test("profileWeightRow: profile weight with change null, in either unit; null without a weight", () => {
  assert.deepEqual(profileWeightRow(165, "lbs"), { value: 165, unit: "lbs", change: null });
  assert.deepEqual(profileWeightRow(165, "kg"), { value: 74.8, unit: "kg", change: null });
  assert.equal(profileWeightRow(null, "kg"), null);
  assert.equal(profileWeightRow(undefined, "lbs"), null);
});
