import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_CONDITION_LIMITS, sameLabel, symptomItemCode, validateCustomCondition } from "./custom-conditions";

test("validateCustomCondition: a full input is normalised and deduplicated", () => {
  const r = validateCustomCondition({
    name: "  Histamine   intolerance ",
    avoid: ["Aged cheese", "aged cheese", " red wine ", "sauerkraut"],
    guidance: "prefer fresh food,\n avoid leftovers ",
    symptoms: ["Flushing", "flushing", "Headache"],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    name: "Histamine intolerance",
    avoid: ["Aged cheese", "red wine", "sauerkraut"],
    guidance: "prefer fresh food, avoid leftovers",
    symptoms: ["Flushing", "Headache"],
  });
});

test("validateCustomCondition: name rules", () => {
  assert.deepEqual(validateCustomCondition({ name: "" }), { ok: false, field: "name", error: "Give the condition a name (at least 2 letters)." });
  assert.equal(validateCustomCondition({ name: "12" }).ok, false);
  assert.equal(validateCustomCondition({ name: "x".repeat(61) }).ok, false);
  assert.equal(validateCustomCondition({ name: "Gout" }).ok, true);
});

test("validateCustomCondition: avoid list rules", () => {
  assert.equal(validateCustomCondition({ name: "Gout", avoid: "beer" }).ok, false);
  const bad = validateCustomCondition({ name: "Gout", avoid: ["a"] });
  assert.ok(!bad.ok && bad.field === "avoid");
  const many = validateCustomCondition({ name: "Gout", avoid: Array.from({ length: 41 }, (_, i) => `food ${i}`) });
  assert.ok(!many.ok && many.error.includes("Up to 40"));
  const empty = validateCustomCondition({ name: "Gout" });
  assert.ok(empty.ok && empty.value.avoid.length === 0 && empty.value.symptoms.length === 0 && empty.value.guidance === null);
});

test("validateCustomCondition: guidance and symptom limits", () => {
  const g = validateCustomCondition({ name: "Gout", guidance: "g".repeat(CUSTOM_CONDITION_LIMITS.guidanceMax + 1) });
  assert.ok(!g.ok && g.field === "guidance");
  assert.equal(validateCustomCondition({ name: "Gout", guidance: "   " }).ok && true, true);
  const s = validateCustomCondition({ name: "Gout", symptoms: Array.from({ length: 11 }, (_, i) => `symptom ${i}`) });
  assert.ok(!s.ok && s.field === "symptoms");
  const short = validateCustomCondition({ name: "Gout", symptoms: ["!"] });
  assert.ok(!short.ok && short.field === "symptoms");
});

test("symptomItemCode and sameLabel", () => {
  assert.equal(symptomItemCode("Brain fog"), "BRAIN_FOG");
  assert.equal(symptomItemCode("  joint pain (big toe) "), "JOINT_PAIN_BIG_TOE");
  assert.equal(symptomItemCode("Náusea"), "NAUSEA");
  assert.equal(symptomItemCode("!!!"), "SYMPTOM");
  assert.equal(sameLabel("Brain  fog", "brain fog"), true);
  assert.equal(sameLabel("Brain fog", "Brainfog"), false);
});
