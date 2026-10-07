import { test } from "node:test";
import assert from "node:assert/strict";
import { ingredientBanCheck } from "./ingredient-bans";
import type { PatientDietGraph } from "./diet-match";

const empty = (): PatientDietGraph => ({
  foodAllergies: [],
  foodToAvoid: [],
  healthConditions: [],
  foodPreferences: [],
  motivations: [],
});

const vegetarian = (): PatientDietGraph => ({
  ...empty(),
  foodPreferences: [
    { food: { name: "Vegetarian", bannedIngredients: ["chicken", "beef", "pork", "bacon", "fish", "salmon", "sirloin", "chicken broth"].map((name) => ({ name })) } },
  ],
});

test("vegetarian: meat and fish catalog items are banned, plants are not", () => {
  const check = ingredientBanCheck(vegetarian());
  for (const meat of ["Boneless chicken breasts", "Sirloin steak", "Bacon", "Salmon fillets", "Chicken broth", "chicken", "beef"]) {
    assert.deepEqual(check.reasonsFor(meat), ["Vegetarian"], meat);
  }
  for (const ok of ["Extra-firm tofu", "Broccoli", "Vegetable broth", "Black beans"]) {
    assert.deepEqual(check.reasonsFor(ok), [], ok);
  }
});

test("no profile rules: nothing is banned and there are no rules", () => {
  const check = ingredientBanCheck(empty());
  assert.equal(check.rules.length, 0);
  assert.deepEqual(check.reasonsFor("Bacon"), []);
});

test("every profile dimension becomes a labelled rule", () => {
  const check = ingredientBanCheck({
    foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [{ name: "peanut butter" }] } }],
    foodToAvoid: [{ food: { name: "Red meat", bannedIngredients: [{ name: "beef" }] } }],
    healthConditions: [{ condition: { name: "Celiac disease", bannedIngredients: [{ name: "gluten" }] } }],
    foodPreferences: [{ food: { name: "Vegan", bannedIngredients: [{ name: "honey" }] } }],
    motivations: [{ motivation: { name: "Lower sugar", bannedIngredients: [{ name: "sugar" }] } }],
  });
  assert.deepEqual(
    check.rules.map((r) => [r.kind, r.label]),
    [["allergy", "Peanuts"], ["avoid", "Red meat"], ["condition", "Celiac disease"], ["diet", "Vegan"], ["goal", "Lower sugar"]]
  );
  assert.deepEqual(check.rules[0].terms, ["Peanuts", "peanut butter"]);
  assert.deepEqual(check.reasonsFor("Ground beef"), ["Red meat"]);
  assert.deepEqual(check.reasonsFor("Brown sugar"), ["Lower sugar"]);
  assert.deepEqual(check.reasonsFor("Honey"), ["Vegan"]);
});

test("allergen group tags ban by component, not just by name", () => {
  const check = ingredientBanCheck({ ...empty(), foodAllergies: [{ food: { name: "Milk", bannedIngredients: [] } }] });
  // "Shredded mozzarella" never says milk; its BIG9-COW-MILK tag does.
  assert.deepEqual(check.reasonsFor("Shredded mozzarella", ["BIG9-COW-MILK"]), ["Milk"]);
  assert.deepEqual(check.reasonsFor("Shredded mozzarella"), []);
  assert.deepEqual(check.rules[0].groups, ["BIG9-COW-MILK"]);
});

test("an ingredient banned by two rules lists both", () => {
  const check = ingredientBanCheck({
    ...empty(),
    foodToAvoid: [{ food: { name: "Pork", bannedIngredients: [{ name: "bacon" }] } }],
    foodPreferences: [{ food: { name: "Vegetarian", bannedIngredients: [{ name: "bacon" }] } }],
  });
  assert.deepEqual(check.reasonsFor("Bacon"), ["Pork", "Vegetarian"]);
});

test("rules with no terms or groups are left out of the list", () => {
  const check = ingredientBanCheck({ ...empty(), motivations: [{ motivation: { name: "Energy", bannedIngredients: [] } }] });
  assert.equal(check.rules.length, 0);
});

test("reasonsForMany matches reasonsFor item by item", () => {
  const check = ingredientBanCheck(vegetarian());
  const items = [{ name: "Bacon" }, { name: "Broccoli" }, { name: "Shredded mozzarella", allergenGroups: ["BIG9-COW-MILK"] }, { name: "Chicken broth" }];
  assert.deepEqual(check.reasonsForMany(items), items.map((i) => check.reasonsFor(i.name, i.allergenGroups)));
  assert.deepEqual(check.reasonsForMany(items), [["Vegetarian"], [], [], ["Vegetarian"]]);
});
