import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleRules, mayStart } from "./eligibility";

const rules = [
  { id: "r1", code: "TR-001", category: "ACIDIC_CITRUS", conditionName: "GERD", active: true },
  { id: "r2", code: "TR-003", category: "ALCOHOL", conditionName: "GERD", active: true },
  { id: "r3", code: "TR-010", category: "ALCOHOL", conditionName: "Gastritis", active: true },
  { id: "r4", code: "TR-020", category: "MSG", conditionName: "Migraine", active: true },
  { id: "r5", code: "TR-099", category: "MINT", conditionName: "GERD", active: false },
];

test("eligibleRules: profile conditions only, one rule per category, blocked by active or likely-trigger trials", () => {
  assert.deepEqual(eligibleRules(["GERD", "gastritis"], rules, []).map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(eligibleRules(["Migraine"], rules, []).map((r) => r.id), ["r4"]);
  assert.deepEqual(eligibleRules(["GERD"], rules, [{ ruleId: "r1", category: "ACIDIC_CITRUS", status: "ACTIVE", classification: null }]).map((r) => r.id), ["r2"]);
  assert.deepEqual(eligibleRules(["GERD"], rules, [{ ruleId: "r1", category: "ACIDIC_CITRUS", status: "COMPLETED", classification: "LIKELY_TRIGGER" }]).map((r) => r.id), ["r2"]);
  assert.deepEqual(eligibleRules(["GERD"], rules, [{ ruleId: "r1", category: "ACIDIC_CITRUS", status: "COMPLETED", classification: "TOLERATED" }]).map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(eligibleRules([], rules, []), []);
});

test("mayStart requires the rule's condition on the profile and an active rule", () => {
  assert.equal(mayStart(["GERD"], rules[0]), true);
  assert.equal(mayStart(["Migraine"], rules[0]), false);
  assert.equal(mayStart(["GERD"], rules[4]), false);
});
