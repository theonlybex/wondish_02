import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRecipeRows, splitSteps, parseComponents, matchVariant, type RecipeRow } from "./normalize";

const row = (o: Partial<RecipeRow>): RecipeRow => ({
  sourceRow: 0, recipeName: null, servings: null, quantity: null, unit: "", formId: "", ingredientName: "",
  instructions: "", calories: null, sodium: null, saturatedFat: null, sugars: null, addedSugars: null, ...o,
});

test("groupRecipeRows: a named row starts a recipe, blank-name rows attach to it", () => {
  const recipes = groupRecipeRows([
    row({ sourceRow: 3, recipeName: "2-Step Chicken", servings: 1, quantity: 0.5, unit: "tablespoon", formId: "2022929", ingredientName: "Avocado oil", instructions: "1. Heat oil.\r\n2. Add chicken.", calories: 214, sodium: 300 }),
    row({ sourceRow: 4, quantity: 4, unit: "oz", formId: "2110156", ingredientName: "Boneless skinless chicken breast" }),
    row({ sourceRow: 8, recipeName: "2-Step Chicken", servings: 1, quantity: 0.5, unit: "tablespoon", formId: "2022929", ingredientName: "Avocado oil", instructions: "1. Heat oil.", calories: 265 }),
  ]);
  assert.equal(recipes.length, 2);
  assert.deepEqual(recipes[0].ingredients.map((i) => i.formId), ["2022929", "2110156"]);
  assert.deepEqual(recipes[0].steps, ["Heat oil.", "Add chicken."]);
  assert.equal(recipes[0].sodium, 300);
  assert.equal(recipes[1].calories, 265); // same name, different portion variant
});

test("splitSteps strips numbering and CRLF; parseComponents splits ' - '", () => {
  assert.deepEqual(splitSteps("1. Heat oil in a skillet.\r\n2) Add chicken.\n\n3. Serve."), ["Heat oil in a skillet.", "Add chicken.", "Serve."]);
  assert.deepEqual(parseComponents("milk - casein -whey - Milk"), ["milk", "casein", "whey"]);
  assert.deepEqual(parseComponents(""), []);
});

test("matchVariant picks the DB portion variant with the closest calories", () => {
  const db = [
    { id: "a", name: "Scrambled Eggs, V1S- 1 egg", calories: 102, servings: 1 },
    { id: "b", name: "Scrambled Eggs, V1M- 2 eggs", calories: 163, servings: 1 },
    { id: "c", name: "Green Apple", calories: 115, servings: 1 },
  ];
  const rec = { name: "Scrambled Eggs", sourceRow: 1, servings: 1, calories: 160, sodium: null, saturatedFat: null, sugars: null, addedSugars: null, steps: [], ingredients: [] };
  assert.equal(matchVariant(db, rec), "b");
  assert.equal(matchVariant(db, { ...rec, calories: 500 }), null); // >35% off every variant
  assert.equal(matchVariant(db, { ...rec, name: "Nope" }), null);
});
