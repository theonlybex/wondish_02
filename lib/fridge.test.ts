import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIngredients,
  parseFridgeRecipes,
  applyAllergenFilter,
  buildFridgePrompt,
  FRIDGE_SYSTEM_PROMPT,
  SUGGEST_RECIPES_SCHEMA,
  MAX_INGREDIENTS,
  type FridgeRecipe,
} from "./fridge";
import { derivePatientBans, buildDietMatchers, type PatientDietGraph } from "./diet-match";
import { MAX_MACRO, MAX_SERVINGS, MAX_NAME } from "./meal-log";

// ─── normalizeIngredients ───────────────────────────────────────────────────

test("normalizeIngredients: trims, lowercase-dedupes, drops empties, stable order", () => {
  const out = normalizeIngredients([" Spinach ", "spinach", "", "  ", "Chickpeas"]);
  assert.deepEqual(out, ["Spinach", "Chickpeas"]);
});

test("normalizeIngredients: caps count at MAX_INGREDIENTS (30)", () => {
  const many = Array.from({ length: 40 }, (_, i) => `item${i}`);
  const out = normalizeIngredients(many);
  assert.equal(out.length, MAX_INGREDIENTS);
  assert.equal(out.length, 30);
  assert.deepEqual(out, many.slice(0, 30));
});

test("normalizeIngredients: caps item length at 80 chars", () => {
  const long = "x".repeat(120);
  const out = normalizeIngredients([long]);
  assert.equal(out[0].length, 80);
});

test("normalizeIngredients: non-array/undefined input -> []", () => {
  assert.deepEqual(normalizeIngredients(undefined), []);
  assert.deepEqual(normalizeIngredients(null), []);
  assert.deepEqual(normalizeIngredients("spinach"), []);
  assert.deepEqual(normalizeIngredients(42), []);
  assert.deepEqual(normalizeIngredients({}), []);
});

// ─── parseFridgeRecipes ──────────────────────────────────────────────────────

function validRecipeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Chickpea & Spinach Skillet",
    description: "One-pan, ready in 20 min.",
    emoji: "🍳",
    usesIngredients: ["chickpeas", "spinach"],
    missingIngredients: ["cumin"],
    steps: ["Saute onion & garlic.", "Add chickpeas."],
    mealType: "dinner",
    servings: 1,
    perServing: { calories: 420, protein: 22, carbs: 48, fat: 15, fiber: 9 },
    fitsPlan: true,
    conflicts: [],
    ...overrides,
  };
}

test("parseFridgeRecipes: null only for non-array/unusable raw", () => {
  assert.equal(parseFridgeRecipes(undefined, 3), null);
  assert.equal(parseFridgeRecipes(null, 3), null);
  assert.equal(parseFridgeRecipes("not an array", 3), null);
  assert.equal(parseFridgeRecipes({ recipes: [] }, 3), null);
});

test("parseFridgeRecipes: a valid array with zero survivors returns [] (NOT null)", () => {
  const out = parseFridgeRecipes([{ description: "no name or steps" }], 3);
  assert.deepEqual(out, []);
});

test("parseFridgeRecipes: valid tool payload -> typed array with frg_-prefixed minted ids", () => {
  const out = parseFridgeRecipes([validRecipeInput()], 3)!;
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^frg_[0-9a-f-]{36}$/);
  assert.equal(out[0].name, "Chickpea & Spinach Skillet");
});

test("parseFridgeRecipes: a recipe missing name is dropped", () => {
  const out = parseFridgeRecipes([validRecipeInput({ name: undefined }), validRecipeInput()], 3)!;
  assert.equal(out.length, 1);
});

test("parseFridgeRecipes: a recipe missing steps is dropped", () => {
  const out = parseFridgeRecipes([validRecipeInput({ steps: undefined }), validRecipeInput()], 3)!;
  assert.equal(out.length, 1);
});

test("parseFridgeRecipes: a 4th recipe is dropped when maxRecipes=3", () => {
  const four = [validRecipeInput(), validRecipeInput(), validRecipeInput(), validRecipeInput()];
  const out = parseFridgeRecipes(four, 3)!;
  assert.equal(out.length, 3);
});

test("parseFridgeRecipes: maxRecipes arg 7 behaves as 5 (clamped into [1,5])", () => {
  const six = Array.from({ length: 6 }, () => validRecipeInput());
  const out = parseFridgeRecipes(six, 7)!;
  assert.equal(out.length, 5);
});

test("parseFridgeRecipes: maxRecipes arg 0 clamps up to 1", () => {
  const two = [validRecipeInput(), validRecipeInput()];
  const out = parseFridgeRecipes(two, 0)!;
  assert.equal(out.length, 1);
});

test("parseFridgeRecipes: clamps out-of-range macros to [0, MAX_MACRO]", () => {
  const out = parseFridgeRecipes(
    [validRecipeInput({ perServing: { calories: MAX_MACRO + 5000, protein: -10, carbs: 20, fat: 10, fiber: 5 } })],
    3
  )!;
  assert.equal(out[0].perServing.calories <= MAX_MACRO, true);
  assert.equal(out[0].perServing.protein, 0);
});

test("parseFridgeRecipes: clamps servings into (0, MAX_SERVINGS]", () => {
  const out = parseFridgeRecipes(
    [validRecipeInput({ servings: MAX_SERVINGS + 100 }), validRecipeInput({ servings: -5 })],
    3
  )!;
  assert.equal(out[0].servings, MAX_SERVINGS);
  assert.equal(out[1].servings > 0, true);
  assert.equal(out[1].servings <= MAX_SERVINGS, true);
});

test("parseFridgeRecipes: F-D8 plausibility — implausible calories normalized toward the macro-derived estimate", () => {
  const out = parseFridgeRecipes(
    [validRecipeInput({ perServing: { calories: 9999, protein: 5, carbs: 5, fat: 5, fiber: 0 } })],
    3
  )!;
  // 4*5 + 4*5 + 9*5 = 85
  assert.equal(out[0].perServing.calories, 85);
});

test("parseFridgeRecipes: plausible calories within tolerance are left alone", () => {
  const out = parseFridgeRecipes(
    [validRecipeInput({ perServing: { calories: 420, protein: 22, carbs: 48, fat: 15, fiber: 9 } })],
    3
  )!;
  // derived = 4*22+4*48+9*15 = 415; |420-415|=5, well within tolerance
  assert.equal(out[0].perServing.calories, 420);
});

test("parseFridgeRecipes: coerces missing missingIngredients/conflicts/usesIngredients to []", () => {
  const out = parseFridgeRecipes(
    [validRecipeInput({ missingIngredients: undefined, conflicts: undefined, usesIngredients: undefined })],
    3
  )!;
  assert.deepEqual(out[0].missingIngredients, []);
  assert.deepEqual(out[0].conflicts, []);
  assert.deepEqual(out[0].usesIngredients, []);
});

test("parseFridgeRecipes: clamps an over-length name to MAX_NAME (meal-log's 120-char bound) so it stays loggable", () => {
  const longName = "x".repeat(200);
  const out = parseFridgeRecipes([validRecipeInput({ name: longName })], 3)!;
  assert.equal(out[0].name.length, MAX_NAME);
  assert.equal(out[0].name.length, 120);
});

// ─── applyAllergenFilter (F-D7, word-boundary via diet-match) ──────────────

function peanutAllergyPatient(): PatientDietGraph {
  return {
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [] } }],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

function butterAllergyPatient(): PatientDietGraph {
  return {
    foodAllergies: [{ food: { name: "Butter", bannedIngredients: [] } }],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

test("applyAllergenFilter: drops a recipe naming a banned term in its name", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const recipes = parseFridgeRecipes([validRecipeInput({ name: "Peanut Noodles" })], 3)!;
  assert.deepEqual(applyAllergenFilter(recipes, matchers), []);
});

test("applyAllergenFilter: drops a recipe naming a banned term in usesIngredients/missingIngredients/steps", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const inUses = parseFridgeRecipes([validRecipeInput({ usesIngredients: ["peanut oil"] })], 3)!;
  const inMissing = parseFridgeRecipes([validRecipeInput({ missingIngredients: ["peanuts"] })], 3)!;
  const inSteps = parseFridgeRecipes([validRecipeInput({ steps: ["Add crushed peanuts on top."] })], 3)!;
  assert.deepEqual(applyAllergenFilter(inUses, matchers), []);
  assert.deepEqual(applyAllergenFilter(inMissing, matchers), []);
  assert.deepEqual(applyAllergenFilter(inSteps, matchers), []);
});

test("applyAllergenFilter: a clean recipe survives", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const recipes = parseFridgeRecipes([validRecipeInput({ name: "Chickpea Skillet" })], 3)!;
  const out = applyAllergenFilter(recipes, matchers);
  assert.equal(out.length, 1);
});

test("applyAllergenFilter: word-boundary — 'butter' must NOT ban 'butternut squash'", () => {
  const matchers = buildDietMatchers(derivePatientBans(butterAllergyPatient()));
  const recipes = parseFridgeRecipes(
    [validRecipeInput({ name: "Roasted Butternut Squash", usesIngredients: ["butternut squash"] })],
    3
  )!;
  const out = applyAllergenFilter(recipes, matchers);
  assert.equal(out.length, 1);
});

test("applyAllergenFilter: 'butter' DOES ban a recipe actually using butter", () => {
  const matchers = buildDietMatchers(derivePatientBans(butterAllergyPatient()));
  const recipes = parseFridgeRecipes([validRecipeInput({ usesIngredients: ["2 tbsp butter"] })], 3)!;
  const out = applyAllergenFilter(recipes, matchers);
  assert.deepEqual(out, []);
});

test("applyAllergenFilter: empty matchers -> passthrough", () => {
  const matchers = buildDietMatchers(derivePatientBans({
    foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [],
  }));
  const recipes = parseFridgeRecipes([validRecipeInput()], 3)!;
  assert.deepEqual(applyAllergenFilter(recipes, matchers), recipes);
});

test("applyAllergenFilter: all recipes dropped -> []", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const recipes = parseFridgeRecipes(
    [validRecipeInput({ name: "Peanut A" }), validRecipeInput({ name: "Peanut B" })],
    3
  )!;
  assert.deepEqual(applyAllergenFilter(recipes, matchers), []);
});

// ─── applyAllergenFilter: exactBanned phrase branch (foodToAvoid -> source "avoid") ───

function cilantroAvoidPatient(): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [{ food: { name: "cilantro" } }],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

function redMeatAvoidPatient(): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [{ food: { name: "red meat" } }],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

function emptyNameAvoidPatient(): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [{ food: { name: "   " } }],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

test("applyAllergenFilter: exactBanned single-word phrase ('cilantro') drops a recipe listing it, a clean recipe survives", () => {
  const matchers = buildDietMatchers(derivePatientBans(cilantroAvoidPatient()));
  const withCilantro = parseFridgeRecipes([validRecipeInput({ usesIngredients: ["fresh cilantro", "lime"] })], 3)!;
  const withoutCilantro = parseFridgeRecipes([validRecipeInput({ usesIngredients: ["parsley", "lime"] })], 3)!;
  assert.deepEqual(applyAllergenFilter(withCilantro, matchers), []);
  const survivors = applyAllergenFilter(withoutCilantro, matchers);
  assert.equal(survivors.length, 1);
});

test("applyAllergenFilter: exactBanned multi-word phrase ('red meat') matches only the full phrase, not 'meat' or 'red' alone", () => {
  const matchers = buildDietMatchers(derivePatientBans(redMeatAvoidPatient()));
  const withRedMeat = parseFridgeRecipes([validRecipeInput({ steps: ["Sear the red meat until browned."] })], 3)!;
  const withMeatOnly = parseFridgeRecipes([validRecipeInput({ steps: ["Braise the meat for two hours."] })], 3)!;
  const withRedOnly = parseFridgeRecipes([validRecipeInput({ steps: ["Roast the red peppers."] })], 3)!;
  assert.deepEqual(applyAllergenFilter(withRedMeat, matchers), []);
  assert.equal(applyAllergenFilter(withMeatOnly, matchers).length, 1);
  assert.equal(applyAllergenFilter(withRedOnly, matchers).length, 1);
});

test("applyAllergenFilter: exactBanned entry with an empty/whitespace name is ignored (guard) and drops nothing", () => {
  const matchers = buildDietMatchers(derivePatientBans(emptyNameAvoidPatient()));
  const recipes = parseFridgeRecipes(
    [validRecipeInput({ name: "Chickpea Skillet" }), validRecipeInput({ name: "Roasted Butternut Squash" })],
    3
  )!;
  const out = applyAllergenFilter(recipes, matchers);
  assert.equal(out.length, recipes.length);
});

// ─── buildFridgePrompt ───────────────────────────────────────────────────────

test("buildFridgePrompt: contains the ingredient list, meal-type hint, and strict tool-use instruction", () => {
  const text = buildFridgePrompt(["spinach", "chickpeas"], "dinner");
  assert.match(text, /spinach/i);
  assert.match(text, /chickpeas/i);
  assert.match(text, /dinner/i);
  assert.match(text, /suggest_recipes/i);
});

test("buildFridgePrompt: meal-type hint is optional", () => {
  const text = buildFridgePrompt(["spinach"], undefined);
  assert.match(text, /spinach/i);
});

// ─── FRIDGE_SYSTEM_PROMPT ───────────────────────────────────────────────────

test("FRIDGE_SYSTEM_PROMPT: injects the foodMapText constraint block verbatim", () => {
  const foodMapText = "Allergies: Peanut\nRestricted from allergies: Peanut Butter";
  const prompt = FRIDGE_SYSTEM_PROMPT(foodMapText, 3);
  assert.ok(prompt.includes(foodMapText));
});

test("FRIDGE_SYSTEM_PROMPT: instructs the no-unlisted-staples rule", () => {
  const prompt = FRIDGE_SYSTEM_PROMPT("No specific dietary restrictions on file.", 3);
  assert.match(prompt, /staple/i);
  assert.match(prompt, /usesIngredients|missingIngredients/);
});

// ─── SUGGEST_RECIPES_SCHEMA ─────────────────────────────────────────────────

test("SUGGEST_RECIPES_SCHEMA: is a valid tool input_schema shape", () => {
  assert.equal(SUGGEST_RECIPES_SCHEMA.type, "object");
  assert.ok(SUGGEST_RECIPES_SCHEMA.properties);
});

// ─── 2026-07-24 logic-audit Task 2: punctuation-edged exact bans ────────────

test("audit-T2: exact ban with punctuation edges ('Nuts (tree)') blocks matching free text", () => {
  const patient: PatientDietGraph = {
    foodAllergies: [],
    foodToAvoid: [{ food: { name: "Nuts (tree)" } }],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
  const matchers = buildDietMatchers(derivePatientBans(patient));
  const recipes = parseFridgeRecipes([validRecipeInput({ steps: ["Top with nuts (tree) mix."] })], 3)!;
  assert.deepEqual(applyAllergenFilter(recipes, matchers), []);
});
