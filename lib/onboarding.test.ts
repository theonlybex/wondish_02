import { test } from "node:test";
import assert from "node:assert/strict";
import { isProfileComplete, type ProfileCompletionInput } from "./onboarding";

// A fully complete profile using the metric height column.
function completeMetricProfile(): ProfileCompletionInput {
  return {
    birthday: new Date("1994-01-01"),
    height: 165,
    weight: 60,
    physicalActivityId: "activity-2",
  };
}

// A fully complete profile using the imperial ft/in columns instead of `height`.
function completeImperialProfile(): ProfileCompletionInput {
  return {
    birthday: new Date("1994-01-01"),
    heightFt: 5,
    heightIn: 5,
    weight: 60,
    physicalActivityId: "activity-2",
  };
}

test("null, undefined and empty patients are incomplete", () => {
  assert.equal(isProfileComplete(null), false);
  assert.equal(isProfileComplete(undefined), false);
  assert.equal(isProfileComplete({}), false);
});

test("complete profile with metric height is complete", () => {
  assert.equal(isProfileComplete(completeMetricProfile()), true);
});

test("complete profile with imperial ft/in height is complete", () => {
  assert.equal(isProfileComplete(completeImperialProfile()), true);
});

test("birthday may be a non-empty string (DB rows often serialize dates)", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: "1994-01-01" }),
    true
  );
});

test("missing or null birthday is incomplete", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: null }),
    false
  );
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: undefined }),
    false
  );
});

test("empty-string birthday is treated as missing (falsy check)", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: "" }),
    false
  );
});

test("missing height in both unit systems is incomplete", () => {
  const p = completeMetricProfile()!;
  assert.equal(isProfileComplete({ ...p, height: null }), false);
  assert.equal(
    isProfileComplete({ ...p, height: null, heightFt: null, heightIn: null }),
    false
  );
});

test("imperial height requires BOTH ft and in — a lone ft or lone in is incomplete", () => {
  const base = completeImperialProfile()!;
  assert.equal(isProfileComplete({ ...base, heightIn: null }), false);
  assert.equal(isProfileComplete({ ...base, heightFt: null }), false);
});

test("heightIn of 0 counts as present (exactly N feet tall)", () => {
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), heightIn: 0 }),
    true
  );
});

test("heightFt of 0 counts as present (`!= null` check, not truthiness)", () => {
  // Symmetric boundary to heightIn: 0 — a 0ft value is nonsensical upstream,
  // but this check only asks "is the column filled in".
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), heightFt: 0 }),
    true
  );
});

test("either unit system alone satisfies the height requirement", () => {
  // Metric only, imperial columns null.
  assert.equal(
    isProfileComplete({
      ...completeMetricProfile(),
      heightFt: null,
      heightIn: null,
    }),
    true
  );
  // Imperial only, metric column null.
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), height: null }),
    true
  );
});

test("missing or null weight is incomplete", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: null }),
    false
  );
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: undefined }),
    false
  );
});

test("weight of 0 counts as present (`!= null` check, not truthiness)", () => {
  // Documents current behavior: 0 passes the null-check even though a zero
  // weight is not physically meaningful. Validation lives upstream.
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: 0 }),
    true
  );
});

test("height of 0 counts as present (`!= null` check, not truthiness)", () => {
  // Same current-behavior note as weight: 0 is "present" to this check.
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), height: 0 }),
    true
  );
});

test("an Invalid Date birthday still counts as present (truthiness check)", () => {
  // Documents current behavior: `patient.birthday && ...` only tests
  // truthiness, and an Invalid Date object is truthy. Date VALIDITY is not
  // this function's job — it only checks that the field was filled in.
  assert.equal(
    isProfileComplete({
      ...completeMetricProfile(),
      birthday: new Date("not-a-date"),
    }),
    true
  );
});

test("missing, null or empty physicalActivityId is incomplete", () => {
  const p = completeMetricProfile()!;
  assert.equal(isProfileComplete({ ...p, physicalActivityId: null }), false);
  assert.equal(
    isProfileComplete({ ...p, physicalActivityId: undefined }),
    false
  );
  // Empty string is falsy, so it reads as missing.
  assert.equal(isProfileComplete({ ...p, physicalActivityId: "" }), false);
});

test("return value is a real boolean, never a truthy/falsy leak", () => {
  assert.equal(typeof isProfileComplete(completeMetricProfile()), "boolean");
  assert.equal(typeof isProfileComplete({}), "boolean");
});
