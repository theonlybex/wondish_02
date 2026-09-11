import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_CONDITION_LIMITS, TRIGGER_CATEGORY_OPTIONS, customTriggerRuleData, sameLabel, symptomItemCode, validateCustomCondition } from "./custom-conditions";

test("validateCustomCondition: triggers must be known category codes, up to 8", () => {
  const ok = validateCustomCondition({ name: "Gout", triggers: ["alcohol", "ALCOHOL", "HIGH_FAT"] });
  assert.ok(ok.ok && ok.value.triggers.join(",") === "ALCOHOL,HIGH_FAT");
  const bad = validateCustomCondition({ name: "Gout", triggers: ["PIZZA"] });
  assert.ok(!bad.ok && bad.field === "triggers" && bad.error.includes("PIZZA"));
  const many = validateCustomCondition({ name: "Gout", triggers: TRIGGER_CATEGORY_OPTIONS.slice(0, 9).map((t) => t.code) });
  assert.ok(!many.ok && many.error.includes("Up to 8"));
  assert.equal(TRIGGER_CATEGORY_OPTIONS.length, 28);
  assert.equal(TRIGGER_CATEGORY_OPTIONS.find((t) => t.code === "ACIDIC_CITRUS")?.title, "Acidic citrus");
});

test("customTriggerRuleData: workbook schedule, category terms as examples, user symptoms monitored", () => {
  const r = customTriggerRuleData("ALCOHOL", ["Joint pain", "Fatigue"]);
  assert.equal(r.baselineDays + r.trialDays + r.reintroductionDays + r.washoutDays, 41);
  assert.equal(r.action, "TEMPORARY_ELIMINATION");
  assert.match(r.examples, /^Alcohol: /);
  assert.equal(r.symptomsToMonitor, "Joint pain; Fatigue");
  assert.equal(customTriggerRuleData("ALCOHOL", []).symptomsToMonitor, "The symptoms you log in your journal");
});

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
    triggers: [],
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
