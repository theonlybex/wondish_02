import { test } from "node:test";
import assert from "node:assert/strict";
import { INGREDIENT_CATALOG, catalogItemNames } from "./ingredient-catalog";
import { classifyIngredient } from "./ingredient-categories";

test("catalog item names are unique", () => {
  const names = catalogItemNames();
  assert.equal(names.length, new Set(names.map((n) => n.toLowerCase())).size);
});

// The readiness gate keys off protein/carb/vegetable, so every item in those
// levels must classify into its own category — otherwise selecting e.g. Tilapia
// wouldn't count as a protein. (fruit/dairy/fat don't gate readiness.)
for (const key of ["protein", "carb", "vegetable"] as const) {
  test(`every ${key}-level catalog item classifies as ${key}`, () => {
    const level = INGREDIENT_CATALOG.find((l) => l.key === key);
    assert.ok(level, `missing ${key} level`);
    for (const g of level!.groups) {
      for (const item of g.items) {
        assert.equal(classifyIngredient(item), key, `"${item}" should classify as ${key}`);
      }
    }
  });
}
