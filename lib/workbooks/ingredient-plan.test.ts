import { test } from "node:test";
import assert from "node:assert/strict";
import { planIngredientUpdates } from "./ingredient-plan";

const forms = [
  { formId: "1", canonicalId: "1", canonicalName: "Boneless skinless chicken breast", groceryCategory: "MEAT & POULTRY", components: ["chicken"] },
  { formId: "2", canonicalId: "2", canonicalName: "2 % low fat milk", groceryCategory: "DAIRY & EGGS", components: ["milk", "casein", "whey"] },
  { formId: "3", canonicalId: "3", canonicalName: "Cream of chicken soup", groceryCategory: "CANNED", components: ["chicken", "wheat", "milk"] },
  { formId: "4", canonicalId: "4", canonicalName: "Olive oil", groceryCategory: "OILS", components: ["olive"] },
];
const rr = (formId: string, ingredientName: string) => ({ sourceRow: 1, recipeName: null, servings: null, quantity: 1, unit: "cup", formId, ingredientName, instructions: "", calories: null, sodium: null, saturatedFat: null, sugars: null, addedSugars: null });

test("resolves by alias target, then the workbook name, then canonical; creates the rest; never overwrites a different formId", () => {
  const plan = planIngredientUpdates({
    forms,
    recipeRows: [rr("1", "boneless skinless chicken breast"), rr("2", "2 % low fat milk"), rr("3", "cream of chicken soup")],
    big9: [{ formId: "2", allergenGroup: "BIG9-COW-MILK", action: "STRICT_AVOID", status: "ACTIVE" }, { formId: "3", allergenGroup: "BIG9-WHEAT", action: "STRICT_AVOID", status: "ACTIVE" }],
    conversions: [{ formId: "2", unit: "cup", baseQuantity: 236.588, baseUnit: "mL", confidence: "HIGH" }, { formId: "9", unit: "cup", baseQuantity: 1, baseUnit: "g", confidence: "LOW" }],
    dbIngredients: [{ id: "chk", name: "Boneless chicken breasts", formId: null, uses: 40 }, { id: "milk", name: "Whole milk", formId: "OTHER", uses: 5 }],
    aliases: { "boneless skinless chicken breast": "Boneless chicken breasts", "2 % low fat milk": "Whole milk" },
  });
  assert.deepEqual(plan.attach.map((a) => [a.ingredientId, a.formId, a.allergenGroups]), [["chk", "1", []]]);
  assert.deepEqual(plan.conflicts, [{ formId: "2", reason: "Whole milk already has formId OTHER" }]);
  assert.deepEqual(plan.create.map((c) => [c.name, c.formId, c.allergenGroups]), [["Cream of chicken soup", "3", ["BIG9-WHEAT"]]]);
  assert.deepEqual(plan.conversions, [{ formId: "2", unit: "cup", baseQuantity: 236.588, baseUnit: "mL", confidence: "HIGH" }]);
});

test("prefers the row recipes use over an orphan with the same name, and moves a form off an unused orphan", () => {
  // First run: "olive oil" (orphan, 0 uses) and "Extra virgin olive oil" (catalog, 195 uses) both resolve.
  const first = planIngredientUpdates({
    forms, recipeRows: [rr("4", "Olive oil")], big9: [], conversions: [],
    dbIngredients: [{ id: "orphan", name: "olive oil", formId: null, uses: 0 }, { id: "cat", name: "Extra virgin olive oil", formId: null, uses: 195 }],
    aliases: { "olive oil": "Extra virgin olive oil" },
  });
  assert.deepEqual(first.attach.map((a) => a.ingredientId), ["cat"]);
  // Repair run: the form already sits on the orphan → move it to the used row.
  const repair = planIngredientUpdates({
    forms, recipeRows: [rr("4", "Olive oil")], big9: [], conversions: [],
    dbIngredients: [{ id: "orphan", name: "olive oil", formId: "4", uses: 0 }, { id: "cat", name: "Extra virgin olive oil", formId: null, uses: 195 }],
    aliases: { "olive oil": "Extra virgin olive oil" },
  });
  assert.deepEqual(repair.move.map((m) => [m.fromIngredientId, m.ingredientId]), [["orphan", "cat"]]);
  assert.equal(repair.attach.length, 0);
});

test("a second run is a no-op: rows that already carry the same formId are neither attached nor conflicts", () => {
  const plan = planIngredientUpdates({
    forms, recipeRows: [rr("1", "Boneless chicken breasts")], big9: [], conversions: [],
    dbIngredients: [{ id: "chk", name: "Boneless chicken breasts", formId: "1", uses: 3 }], aliases: {},
  });
  assert.equal(plan.attach.length, 0); assert.equal(plan.move.length, 0); assert.equal(plan.create.length, 0); assert.equal(plan.conflicts.length, 0);
});
