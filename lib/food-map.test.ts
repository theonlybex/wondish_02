import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoodMapText, collectBannedTerms, PATIENT_FOOD_MAP_INCLUDE, type FoodMapPatient } from "./food-map";
import { PATIENT_DIET_INCLUDE } from "./diet-match";

// ─── fixtures ───────────────────────────────────────────────────────────────

function emptyPatient(): FoodMapPatient {
  return {
    mealType: null,
    foodAllergies: [],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

// ─── PATIENT_FOOD_MAP_INCLUDE ───────────────────────────────────────────────

test("PATIENT_FOOD_MAP_INCLUDE composes PATIENT_DIET_INCLUDE + mealType: true", () => {
  assert.equal(PATIENT_FOOD_MAP_INCLUDE.mealType, true);
  assert.deepEqual(PATIENT_FOOD_MAP_INCLUDE.foodAllergies, PATIENT_DIET_INCLUDE.foodAllergies);
  assert.deepEqual(PATIENT_FOOD_MAP_INCLUDE.foodToAvoid, PATIENT_DIET_INCLUDE.foodToAvoid);
  assert.deepEqual(PATIENT_FOOD_MAP_INCLUDE.healthConditions, PATIENT_DIET_INCLUDE.healthConditions);
  assert.deepEqual(PATIENT_FOOD_MAP_INCLUDE.foodPreferences, PATIENT_DIET_INCLUDE.foodPreferences);
  assert.deepEqual(PATIENT_FOOD_MAP_INCLUDE.motivations, PATIENT_DIET_INCLUDE.motivations);
});

// ─── buildFoodMapText ───────────────────────────────────────────────────────

test("buildFoodMapText: empty patient -> default 'no restrictions' string", () => {
  assert.equal(buildFoodMapText(emptyPatient()), "No specific dietary restrictions on file.");
});

test("buildFoodMapText: null/undefined patient -> default string", () => {
  assert.equal(buildFoodMapText(null), "No specific dietary restrictions on file.");
  assert.equal(buildFoodMapText(undefined), "No specific dietary restrictions on file.");
});

test("buildFoodMapText: mealType renders a 'Dietary pattern' line", () => {
  const p = { ...emptyPatient(), mealType: { name: "Mediterranean" } };
  const text = buildFoodMapText(p);
  assert.match(text, /Dietary pattern: Mediterranean/);
});

test("buildFoodMapText: allergies render names + banned-ingredients line", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [{ name: "Peanut Butter" }] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Allergies: Peanut/);
  assert.match(text, /Restricted from allergies: Peanut Butter/);
});

test("buildFoodMapText: allergies with no bannedIngredients omit the 'Restricted from allergies' line", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    foodAllergies: [{ food: { name: "Egg", bannedIngredients: [] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Allergies: Egg/);
  assert.doesNotMatch(text, /Restricted from allergies/);
});

test("buildFoodMapText: foodToAvoid renders a 'Foods to avoid' line", () => {
  const p: FoodMapPatient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Red Meat" } }] };
  assert.match(buildFoodMapText(p), /Foods to avoid: Red Meat/);
});

test("buildFoodMapText: foodPreferences render names + banned-ingredients line", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    foodPreferences: [{ food: { name: "Vegan", bannedIngredients: [{ name: "Gluten" }] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Food preferences: Vegan/);
  assert.match(text, /Restricted from preferences: Gluten/);
});

test("buildFoodMapText: healthConditions render names + banned-ingredients line", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    healthConditions: [{ condition: { name: "Diabetes", bannedIngredients: [{ name: "Sugar" }] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Health conditions: Diabetes/);
  assert.match(text, /Restricted from conditions: Sugar/);
});

test("buildFoodMapText: motivations render names + banned-ingredients line", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    motivations: [{ motivation: { name: "Sobriety", bannedIngredients: [{ name: "Alcohol" }] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Goals: Sobriety/);
  assert.match(text, /Restricted from goals: Alcohol/);
});

test("buildFoodMapText: empty sections are omitted (only populated sections render)", () => {
  const p: FoodMapPatient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Shellfish" } }] };
  const text = buildFoodMapText(p);
  const lines = text.split("\n");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "Foods to avoid: Shellfish");
});

// ─── collectBannedTerms ─────────────────────────────────────────────────────

test("collectBannedTerms: empty patient -> []", () => {
  assert.deepEqual(collectBannedTerms(emptyPatient()), []);
});

test("collectBannedTerms: union of allergen names + all bannedIngredients + foodToAvoid names, lowercased/deduped", () => {
  const p: FoodMapPatient = {
    mealType: null,
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [{ name: "Peanut Butter" }] } }],
    foodToAvoid: [{ food: { name: "Red Meat" } }],
    healthConditions: [{ condition: { name: "Diabetes", bannedIngredients: [{ name: "Sugar" }] } }],
    foodPreferences: [{ food: { name: "Vegan", bannedIngredients: [{ name: "Gluten" }] } }],
    motivations: [{ motivation: { name: "Sobriety", bannedIngredients: [{ name: "Alcohol" }] } }],
  };
  const terms = collectBannedTerms(p);
  assert.deepEqual(
    [...terms].sort(),
    ["alcohol", "gluten", "peanut", "peanut butter", "red meat", "sugar"].sort()
  );
});

test("collectBannedTerms: dedupes case-insensitively", () => {
  const p: FoodMapPatient = {
    mealType: null,
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [{ name: "peanut" }] } }],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
  assert.deepEqual(collectBannedTerms(p), ["peanut"]);
});
