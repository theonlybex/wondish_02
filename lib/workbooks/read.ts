// The only file that touches xlsx. Workbooks are gitignored and referenced by
// path prefix in the project root.
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { parseComponents, type FormRow, type RecipeRow } from "./normalize";

export type Big9Row = { formId: string; allergenGroup: string; action: string; status: string };
export type ConversionRow = { formId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string };

export function findWorkbook(prefix: "Wondish_01" | "Wondish_02" | "Wondish_03" | "Wondish_06", dir = process.cwd()): string {
  const f = fs.readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith(".xlsx"));
  if (!f) throw new Error(`${prefix}*.xlsx not found in ${dir}`);
  return path.join(dir, f);
}

const rows = (file: string, sheet: string) => {
  const ws = XLSX.readFile(file).Sheets[sheet];
  if (!ws) throw new Error(`sheet "${sheet}" not found in ${path.basename(file)}`);
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
