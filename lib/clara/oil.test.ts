import { test } from "node:test";
import assert from "node:assert/strict";
import { specifyCookingOil } from "./oil";

const dish = (over: Record<string, unknown> = {}) => ({
  name: "Chicken and Rice",
  description: "A simple bowl.",
  usesIngredients: ["chicken breast", "brown rice", "cooking oil"],
  missingIngredients: [] as string[],
  steps: ["Heat cooking oil in a pan.", "Cook the chicken.", "Serve over rice."],
  amounts: [{ name: "cooking oil", quantity: 1, unit: "tsp" }],
  ...over,
});

test("generic cooking oil becomes olive oil everywhere it is named", () => {
  const out = specifyCookingOil(dish());
  assert.deepEqual(out.usesIngredients, ["chicken breast", "brown rice", "olive oil"]);
  assert.equal(out.steps[0], "Heat olive oil in a pan.");
  assert.equal(out.amounts![0].name, "olive oil");
});

test("a high-heat method gets avocado oil", () => {
  const out = specifyCookingOil(dish({ name: "Beef Stir-Fry", steps: ["Stir-fry the beef in cooking oil over high heat."] }));
  assert.ok(out.usesIngredients.includes("avocado oil"));
  assert.equal(out.steps[0], "Stir-fry the beef in avocado oil over high heat.");
});

test("cooking spray becomes a spray of the chosen oil", () => {
  const out = specifyCookingOil(dish({ usesIngredients: ["eggs", "nonstick cooking spray"], steps: ["Coat a pan with a light spray of cooking spray.", "Mist with nonstick cooking spray."], amounts: undefined }));
  assert.deepEqual(out.usesIngredients, ["eggs", "olive oil"]);
  assert.deepEqual(out.steps, ["Coat a pan with a light spray of olive oil spray.", "Mist with olive oil spray."]);
});

test("a dish that already names a specific oil reuses it and does not list it twice", () => {
  const out = specifyCookingOil(dish({ usesIngredients: ["tofu", "toasted sesame oil", "cooking oil"], steps: ["Sear tofu in cooking oil.", "Finish with toasted sesame oil."] }));
  assert.deepEqual(out.usesIngredients, ["tofu", "toasted sesame oil"]);
  assert.equal(out.steps[0], "Sear tofu in toasted sesame oil.");
});

test("specific oils, vegetable oil and 'oil' inside other words are left alone", () => {
  const d = dish({ usesIngredients: ["salmon", "vegetable oil"], steps: ["Boil the potatoes, then toil happily with vegetable oil."], amounts: undefined });
  assert.deepEqual(specifyCookingOil(d), d);
});

test("a bare 'oil' ingredient is specified too", () => {
  const out = specifyCookingOil(dish({ usesIngredients: ["kale", "oil"], steps: ["Massage the kale with the oil."], amounts: undefined }));
  assert.deepEqual(out.usesIngredients, ["kale", "olive oil"]);
  assert.equal(out.steps[0], "Massage the kale with the oil."); // "the oil" refers back to the listed oil
});

test("medium-high heat and crisp-tender vegetables stay on olive oil", () => {
  const out = specifyCookingOil(dish({ name: "Chicken with Broccoli", steps: ["Heat cooking oil over medium-high heat.", "Cook broccoli until crisp-tender."] }));
  assert.ok(out.usesIngredients.includes("olive oil"));
});

test("the repair only picks an oil the diner may have — a disliked or banned oil is skipped", () => {
  const noOlive = (n: string) => !/olive/i.test(n);
  assert.ok(specifyCookingOil(dish(), noOlive).usesIngredients.includes("avocado oil"));
  const onlyCanola = (n: string) => n === "canola oil";
  assert.ok(specifyCookingOil(dish(), onlyCanola).usesIngredients.includes("canola oil"));
  // Nothing allowed: leave the dish alone rather than inject a banned oil.
  assert.deepEqual(specifyCookingOil(dish(), () => false), dish());
  // The dish's own oil is skipped too when it is not allowed.
  const own = dish({ usesIngredients: ["tofu", "toasted sesame oil", "cooking oil"] });
  assert.ok(specifyCookingOil(own, (n) => !/sesame/i.test(n)).usesIngredients.includes("olive oil"));
});
