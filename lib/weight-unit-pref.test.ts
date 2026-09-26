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
