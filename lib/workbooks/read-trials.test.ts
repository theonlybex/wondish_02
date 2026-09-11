import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { readConditionSummary, readTrackingItems, readTriggerRules, readTriggerLinks } from "./read";

function wb(sheets: Record<string, Record<string, unknown>[]>) {
  const book = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), name);
  return book;
}

test("workbook 05 readers map summary and tracking items", () => {
  const book = wb({
    "Condition Journal Summary": [{ profile_factor_id: "10", profile_factor_name: "GERD", symptom_item_count: 6, test_or_follow_up_count: 0, has_trigger_trial_code: "YES", status_code: "ACTIVE" }],
    "Symptoms": [{ tracking_item_id: "JT-0267", profile_factor_id: "10", tracking_category_code: "JOURNAL_SYMPTOM", tracking_item_code: "HEARTBURN", input_source_code: "USER_REPORTED", status_code: "ACTIVE", journal_display_label: "Heartburn" }],
    "Tests and Follow Up": [{ tracking_item_id: "JT-0317", profile_factor_id: "7", tracking_category_code: "OBJECTIVE_MONITORING", tracking_item_code: "TTG_IGA", input_source_code: "LAB", status_code: "ACTIVE", journal_display_label: "tTG-IgA" }],
  });
  assert.deepEqual(readConditionSummary(book), [{ profileFactorId: 10, name: "GERD", symptomCount: 6, testCount: 0, hasTrial: true }]);
  const items = readTrackingItems(book);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { code: "JT-0267", profileFactorId: 10, category: "SYMPTOM", itemCode: "HEARTBURN", label: "Heartburn", inputSource: "USER_REPORTED", active: true });
  assert.equal(items[1].category, "OBJECTIVE");
});

test("workbook 04 readers map trigger rules and active links", () => {
  const book = wb({
    "Trigger Rules": [{ trigger_rule_id: "TR-001", profile_factor_id: "10", trigger_category_code: "ACIDIC_CITRUS", default_action_code: "TEMPORARY_ELIMINATION", baseline_days: 7, trial_duration_days: 28, reintroduction_days: 3, washout_days: 3, dose_dependent_code: "YES", example_ingredients_or_exposures: "Citrus", symptoms_to_monitor: "Heartburn", subtype_or_safety_note: "", source_url: "https://x" }],
    "Trial Journal Links": [{ trigger_rule_id: "TR-001", tracking_item_id: "JT-0267", status_code: "ACTIVE" }, { trigger_rule_id: "TR-001", tracking_item_id: "JT-0999", status_code: "RETIRED" }],
  });
  const rules = readTriggerRules(book);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].doseDependent, true);
  assert.equal(rules[0].safetyNote, null);
  assert.equal(rules[0].trialDays, 28);
  assert.deepEqual(readTriggerLinks(book), [{ ruleCode: "TR-001", trackingCode: "JT-0267" }]);
});
