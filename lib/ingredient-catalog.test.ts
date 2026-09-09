import { test } from "node:test";
import assert from "node:assert/strict";
import { INGREDIENT_CATALOG, catalogItemNames, tasteLevels } from "./ingredient-catalog";
import { classifyIngredient } from "./ingredient-categories";

test("catalog item names are unique", () => {
  const names = catalogItemNames();
  assert.equal(names.length, new Set(names.map((n) => n.toLowerCase())).size);
});

test("taste levels are the favorite-able groups, proteins first", () => {
  const keys = tasteLevels().map((l) => l.key);
  assert.equal(keys[0], "proteins");
  assert.ok(keys.every((k) => INGREDIENT_CATALOG.find((c) => c.key === k)?.taste));
});

// The readiness gate keys off protein/carb, so those catalog categories must
// classify consistently (or picking Salmon wouldn't count as a protein).
test("every 'proteins' item classifies as protein", () => {
  const cat = INGREDIENT_CATALOG.find((c) => c.key === "proteins")!;
  for (const item of cat.items) assert.equal(classifyIngredient(item), "protein", `"${item}"`);
});

test("every 'grains' item classifies as carb", () => {
  const cat = INGREDIENT_CATALOG.find((c) => c.key === "grains")!;
  for (const item of cat.items) assert.equal(classifyIngredient(item), "carb", `"${item}"`);
});
