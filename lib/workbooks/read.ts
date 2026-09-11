// The only file that touches xlsx. Workbooks are gitignored and referenced by
// path prefix in the project root.
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { parseComponents, type FormRow, type RecipeRow } from "./normalize";

export type Big9Row = { formId: string; allergenGroup: string; action: string; status: string };
export type ConversionRow = { formId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string };

export type WorkbookPrefix = "Wondish_01" | "Wondish_02" | "Wondish_03" | "Wondish_04" | "Wondish_05" | "Wondish_06";
export function findWorkbook(prefix: WorkbookPrefix, dir = process.cwd()): string {
  const f = fs.readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith(".xlsx"));
  if (!f) throw new Error(`${prefix}*.xlsx not found in ${dir}`);
  return path.join(dir, f);
}

// A path, or an in-memory workbook (tests build one with XLSX.utils.book_new()).
export type WorkbookSource = string | XLSX.WorkBook;
const rows = (file: WorkbookSource, sheet: string) => {
  const wb = typeof file === "string" ? XLSX.readFile(file) : file;
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`sheet "${sheet}" not found in ${typeof file === "string" ? path.basename(file) : "workbook"}`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
};
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(x) ? x : null; };

export const readForms = (file: string): FormRow[] =>
  rows(file, "Ingredient Form Master")
    .map((r) => ({ formId: s(r.ingredient_form_id), canonicalId: s(r.canonical_id), canonicalName: s(r.canonical_name), groceryCategory: s(r.grocery_category), components: parseComponents(s(r.restriction_relevant_components)) }))
    .filter((r) => r.formId);

export const readRecipeRows = (file: string): RecipeRow[] =>
  rows(file, "Recipe Ingredient Rows").map((r) => ({
    sourceRow: Number(r.source_row_number) || 0, recipeName: s(r["Recipe Name"]) || null, servings: n(r["Number of Servings"]),
    quantity: n(r.Quantity), unit: s(r.Unit), formId: s(r["Ingredient Form ID"]), ingredientName: s(r["Ingredient Name"]),
    instructions: s(r["Instructions to cook at home"]), calories: n(r["Calories per serving"]), sodium: n(r["Sodium/ mg"]),
    saturatedFat: n(r["Saturated Fat/ g"]), sugars: n(r["Total sugars/g"]), addedSugars: n(r["Added sugars included/g"]),
  }));

export const readBig9 = (file: string): Big9Row[] =>
  rows(file, "Allergy Rules Big 9")
    .map((r) => ({ formId: s(r.ingredient_form_id), allergenGroup: s(r.allergen_group_code), action: s(r.action_code), status: s(r.status_code) }))
    .filter((r) => r.formId && r.status === "ACTIVE");

export const readConversions = (file: string): ConversionRow[] =>
  rows(file, "Ingredient Unit Conversions")
    .map((r) => ({ formId: s(r.ingredient_form_id), unit: s(r.recipe_unit).toLowerCase(), baseQuantity: n(r.base_quantity_per_recipe_unit) ?? 0, baseUnit: s(r.base_unit), confidence: s(r.confidence_code) }))
    .filter((r) => r.formId && r.unit && r.baseQuantity > 0);

// ── Workbook 05 (Symptom Journal) and 04 (Trigger Trial Process) ────────────

export type ConditionSummaryRow = { profileFactorId: number; name: string; symptomCount: number; testCount: number; hasTrial: boolean };
export type TrackingItemRow = { code: string; profileFactorId: number; category: "SYMPTOM" | "OBJECTIVE"; itemCode: string; label: string; inputSource: string; active: boolean };
export type TriggerRuleRow = {
  code: string; profileFactorId: number; category: string; action: string;
  baselineDays: number; trialDays: number; reintroductionDays: number; washoutDays: number; doseDependent: boolean;
  examples: string; symptomsToMonitor: string; safetyNote: string | null; sourceUrl: string | null;
};
export type TriggerLinkRow = { ruleCode: string; trackingCode: string };

const yes = (v: unknown) => s(v).toUpperCase() === "YES";
const int = (v: unknown, fallback: number) => { const x = n(v); return x === null ? fallback : Math.round(x); };

export const readConditionSummary = (file: WorkbookSource): ConditionSummaryRow[] =>
  rows(file, "Condition Journal Summary")
    .map((r) => ({ profileFactorId: int(r.profile_factor_id, -1), name: s(r.profile_factor_name), symptomCount: int(r.symptom_item_count, 0), testCount: int(r.test_or_follow_up_count, 0), hasTrial: yes(r.has_trigger_trial_code) }))
    .filter((r) => r.profileFactorId >= 0 && r.name);

const trackingRows = (file: WorkbookSource, sheet: string): TrackingItemRow[] =>
  rows(file, sheet)
    .map((r) => ({
      code: s(r.tracking_item_id), profileFactorId: int(r.profile_factor_id, -1),
      category: (s(r.tracking_category_code) === "OBJECTIVE_MONITORING" ? "OBJECTIVE" : "SYMPTOM") as "SYMPTOM" | "OBJECTIVE",
      itemCode: s(r.tracking_item_code), label: s(r.journal_display_label), inputSource: s(r.input_source_code), active: s(r.status_code).toUpperCase() === "ACTIVE",
    }))
    .filter((r) => r.code && r.profileFactorId >= 0 && r.label);

export const readTrackingItems = (file: WorkbookSource): TrackingItemRow[] => [...trackingRows(file, "Symptoms"), ...trackingRows(file, "Tests and Follow Up")];

export const readTriggerRules = (file: WorkbookSource): TriggerRuleRow[] =>
  rows(file, "Trigger Rules")
    .map((r) => ({
      code: s(r.trigger_rule_id), profileFactorId: int(r.profile_factor_id, -1), category: s(r.trigger_category_code), action: s(r.default_action_code),
      baselineDays: int(r.baseline_days, 7), trialDays: int(r.trial_duration_days, 28), reintroductionDays: int(r.reintroduction_days, 3), washoutDays: int(r.washout_days, 3),
      doseDependent: yes(r.dose_dependent_code), examples: s(r.example_ingredients_or_exposures), symptomsToMonitor: s(r.symptoms_to_monitor),
      safetyNote: s(r.subtype_or_safety_note) || null, sourceUrl: s(r.source_url) || null,
    }))
    .filter((r) => r.code && r.profileFactorId >= 0 && r.category);

export const readTriggerLinks = (file: WorkbookSource): TriggerLinkRow[] =>
  rows(file, "Trial Journal Links")
    .filter((r) => s(r.status_code).toUpperCase() === "ACTIVE")
    .map((r) => ({ ruleCode: s(r.trigger_rule_id), trackingCode: s(r.tracking_item_id) }))
    .filter((r) => r.ruleCode && r.trackingCode);
