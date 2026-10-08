import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCustomPlan, CUSTOM_PLAN_LIMITS } from "./custom-plans";

test("a custom plan is a name, the foods it excludes and an optional note — normalised like a condition", () => {
  const ok = validateCustomPlan({ name: "  My  low-histamine week ", avoid: ["Aged cheese", "aged cheese", "Wine"], guidance: "simple, fresh food" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.value, { name: "My low-histamine week", avoid: ["Aged cheese", "Wine"], guidance: "simple, fresh food" });
});

test("plan errors speak about plans, not conditions", () => {
  const bad = validateCustomPlan({ name: "x", avoid: [] });
  assert.ok(!bad.ok && bad.field === "name" && /plan/.test(bad.error) && !/condition/.test(bad.error));
  const tooMany = validateCustomPlan({ name: "Big", avoid: Array.from({ length: 41 }, (_, i) => `food ${i}`) });
  assert.ok(!tooMany.ok && tooMany.field === "avoid" && /plan/.test(tooMany.error));
});

test("a plan needs something to do: foods to exclude or a note", () => {
  const empty = validateCustomPlan({ name: "Nothing", avoid: [] });
  assert.ok(!empty.ok && empty.field === "avoid");
  assert.ok(validateCustomPlan({ name: "Note only", avoid: [], guidance: "small portions" }).ok);
  assert.equal(CUSTOM_PLAN_LIMITS.perPatient, 5);
});

// Profile save replaces built-in links only. If it deletes every diet or
// condition link, each "Save Profile" silently wipes the user's own plans
// and conditions; if it trusts submitted ids, a forged request can attach
// another user's private plan or condition.
import { readFileSync } from "node:fs";
test("profile save keeps the user's own plans and conditions, and only links built-in ids", () => {
  const src = readFileSync("app/api/patient/profile/route.ts", "utf8");
  assert.match(src, /patientFoodPreference\.deleteMany\(\{ where: \{ patientId: patient\.id, food: \{ ownerPatientId: null \} \} \}\)/);
  assert.match(src, /patientHealthCondition\.deleteMany\(\{ where: \{ patientId: patient\.id, condition: \{ ownerPatientId: null \} \} \}\)/);
  assert.match(src, /builtIn\("healthCondition", idList\("healthConditionIds"/);
  assert.match(src, /builtIn\("foodPreference", idList\("foodPreferenceIds"/);
  assert.doesNotMatch(src, /patientFoodPreference\.deleteMany\(\{ where: \{ patientId: patient\.id \} \}\)/);
});
