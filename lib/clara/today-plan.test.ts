import { test } from "node:test";
import assert from "node:assert/strict";

// Same technique as lib/meal-plan.test.ts: a data stub on globalThis before the
// module loads, so the builder is a pure string function over fixture rows.
const db = { patient: { activePlanVersion: 3 } as unknown, menus: [] as unknown[] };
(globalThis as never as { prisma: unknown }).prisma = {
  patient: { findUnique: async () => db.patient },
  menu: { findMany: async () => db.menus },
};
const modPromise = import("./today-plan");

const menu = (mealType: string, over: Record<string, unknown> = {}) => ({
  mealType: { name: mealType },
  recipe: {
    name: "Ground Turkey Scramble, V1S- 1 bowl",
    steps: ["Heat the pan.", "Season with salt and pepper."],
    calories: 397,
    protein: 32, carbs: 38, fat: 12,
    prepTime: 12, cookTime: 18, servings: 1,
    ingredients: [
      { note: null, quantity: 150, unit: "g", ingredient: { name: "Ground turkey" } },
      { note: null, quantity: 1, unit: "teaspoon", ingredient: { name: "Salt" } },
      { note: "chopped", quantity: 90, unit: "g", ingredient: { name: "Carrots" } },
      { note: null, quantity: null, unit: null, ingredient: { name: "Water" } },
    ],
    ...over,
  },
});

// The defect this guards: asked to list a dish's ingredients with amounts,
// Clara answered "the recipe plan doesn't include specific quantities — just
// the ingredients themselves", while the app's dish panel printed every one.
// Her context genuinely had no amounts in it. She was accurate; we were wrong.
test("the plan text carries the amounts the app shows", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Breakfast")];
  const text = await buildTodaysPlanText("p1", "2026-09-24");

  assert.match(text, /150 g Ground turkey/);
  assert.match(text, /1 teaspoon Salt/);
  assert.match(text, /90 g Carrots \(chopped\)/);
  // An ingredient with no recorded amount is named without inventing one.
  assert.match(text, /Water/);
  assert.doesNotMatch(text, /null/);
  // And it says whose amounts they are, so a serving is not misread as a batch.
  assert.match(text, /per serving/);
});

test("macros, total time and calories all reach Clara", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Breakfast")];
  const text = await buildTodaysPlanText("p1", "2026-09-24");
  assert.match(text, /~397 kcal/);
  assert.match(text, /32g protein, 38g carbs, 12g fat/);
  assert.match(text, /30 min/); // 12 prep + 18 cook
});

// A wrong denial is worse than a wrong answer: it teaches the user the feature
// is broken. Observed twice in one session — "I don't have access to a recipe
// database or your meal plan details" and "I don't have a tool to see what's in
// your meal plan right now" — both while the plan sat in her system prompt.
test("the context tells Clara this IS the plan, and what to say about a dish that is not in it", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Lunch")];
  const text = await buildTodaysPlanText("p1", "2026-09-24");
  assert.match(text, /this IS the user's plan/i);
  assert.match(text, /never tell the user you cannot see their plan/i);
  assert.match(text, /not in their plan/i);
});

test("the portion-variant suffix never reaches Clara", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Dinner")];
  const text = await buildTodaysPlanText("p1", "2026-09-24");
  assert.match(text, /Ground Turkey Scramble\b/);
  assert.doesNotMatch(text, /V1S/);
});

test("no plan for the day yields no context rather than an empty heading", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [];
  assert.equal(await buildTodaysPlanText("p1", "2026-09-24"), "");
  // A malformed date is not a reason to guess at a day.
  db.menus = [menu("Breakfast")];
  assert.equal(await buildTodaysPlanText("p1", "not-a-date"), "");
});

test("meals are ordered breakfast → lunch → dinner → snack whatever the DB returns", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Snack"), menu("Dinner"), menu("Breakfast"), menu("Lunch")];
  const text = await buildTodaysPlanText("p1", "2026-09-24");
  const order = ["Breakfast", "Lunch", "Dinner", "Snack"].map((s) => text.indexOf(`- ${s}:`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i > 0));
});

// Given only the day's total, Clara did the per-dish arithmetic herself and got
// it wrong by 2.5×: asked about one breakfast she answered "0.15 teaspoon ×
// 5,800 mg = 870 mg of sodium", confusing the WEIGHT of a teaspoon of salt
// (~6,000 mg) with its sodium content (~2,325 mg). The correct answer was 349
// mg, and the day total she quoted in the same sentence was the app's own.
test("each dish carries its own sodium, so Clara never converts teaspoons", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [menu("Breakfast")]; // 1 teaspoon of salt
  const text = await buildTodaysPlanText("p1", "2026-09-24");

  assert.match(text, /Added salt in this dish: 2,325 mg of sodium/);
  assert.match(text, /ADDED SALT FOR THE DAY: 2,325 mg/);
  // And she is told the trap by name, because she fell into it.
  assert.match(text, /WEIGHS about 6,000 mg but contains about 2,325 mg of sodium/);
});

test("the per-dish figures sum to the day figure", async () => {
  const { buildTodaysPlanText } = await modPromise;
  db.menus = [
    menu("Breakfast", { ingredients: [{ note: null, quantity: 0.15, unit: "teaspoon", ingredient: { name: "Kosher salt" } }] }),
    menu("Lunch", { ingredients: [{ note: null, quantity: 0.25, unit: "teaspoon", ingredient: { name: "Salt" } }] }),
  ];
  const text = await buildTodaysPlanText("p1", "2026-09-24");
  // 0.15 tsp = 349 mg — the figure Clara reported as 870.
  assert.match(text, /Added salt in this dish: 349 mg/);
  assert.match(text, /Added salt in this dish: 581 mg/);
  assert.match(text, /ADDED SALT FOR THE DAY: 930 mg/);
});
