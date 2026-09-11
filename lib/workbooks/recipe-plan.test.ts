import { test } from "node:test";
import assert from "node:assert/strict";
import { planRecipeUpdates } from "./recipe-plan";

const wb = { name: "Scrambled Eggs", sourceRow: 40, servings: 1, calories: 160, sodium: 210, saturatedFat: 3.1, sugars: 0.5, addedSugars: 0, steps: ["Whisk eggs.", "Cook 3 min."], ingredients: [{ formId: "E1", name: "Large eggs", quantity: 2, unit: "count" }] };

test("matches the closest variant, fills quantities by formId, replaces steps only with ≥2 author steps, never touches clara rows", () => {
  const plan = planRecipeUpdates({
    recipes: [wb, { ...wb, steps: ["Just one line."], calories: 102 }],
    dbRecipes: [
      { id: "m", name: "Scrambled Eggs, V1M- 2 eggs", calories: 163, servings: 1, tags: [], steps: ["clara step"], ingredients: [{ ingredientId: "eggs", formId: "E1" }] },
      { id: "s", name: "Scrambled Eggs, V1S- 1 egg", calories: 102, servings: 1, tags: [], steps: ["clara step"], ingredients: [{ ingredientId: "eggs", formId: "E1" }] },
      { id: "c", name: "Scrambled Eggs", calories: 160, servings: 1, tags: ["clara"], steps: ["x", "y"], ingredients: [] },
    ],
  });
  const m = plan.update.find((u) => u.recipeId === "m")!;
  assert.deepEqual(m.steps, ["Whisk eggs.", "Cook 3 min."]);
  assert.equal(m.stepsSource, "author");
  assert.equal(m.sodium, 210);
  assert.deepEqual(m.quantities, [{ ingredientId: "eggs", quantity: 2, unit: "count" }]);
  const s = plan.update.find((u) => u.recipeId === "s")!;
  assert.equal(s.steps, null); // one author line → keep existing
  assert.equal(plan.skippedClara, 1);
  assert.equal(plan.unmatched.length, 0);
});

test("a workbook recipe with no DB variant is reported, not invented", () => {
  const plan = planRecipeUpdates({ recipes: [{ ...wb, name: "Chicken Brunswick Stew & Brown Rice" }], dbRecipes: [] });
  assert.deepEqual(plan.unmatched, ["Chicken Brunswick Stew & Brown Rice (row 40)"]);
});
