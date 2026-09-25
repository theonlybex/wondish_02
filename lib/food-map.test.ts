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
  assert.match(text, /the app avoids these where they appear/);
  assert.match(text, /Sugar/);
  assert.doesNotMatch(text, /Restricted from conditions/);
});

test("buildFoodMapText: a goal's foods are attributed to the goal, not stated as a restriction", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    motivations: [{ motivation: { name: "Sobriety", bannedIngredients: [{ name: "Alcohol" }] } }],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Goals: Sobriety/);
  assert.match(text, /GOALS steer away from/);
  assert.match(text, /Alcohol/);
  // The old wording was "Restricted from goals: …", and it went into Clara's
  // prompt under "respect every line" — so she told a tester whose foodToAvoid
  // was empty that "your profile does avoid white rice", about a plan the app
  // had just built from rice the tester chose (QA 2026-09-24).
  assert.doesNotMatch(text, /Restricted from goals/);
});

test("buildFoodMapText: a goal's food list is deduplicated across goals", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    motivations: [
      { motivation: { name: "Eat healthier", bannedIngredients: [{ name: "white rice" }, { name: "candy" }] } },
      { motivation: { name: "Improve energy", bannedIngredients: [{ name: "white rice" }, { name: "candy" }] } },
    ],
  };
  const text = buildFoodMapText(p);
  assert.equal(text.match(/white rice/g)?.length, 1, "the same food listed once per goal padded the prompt");
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

test("buildFoodMapText: avoid children and condition guidance reach the prompt", () => {
  const patient: FoodMapPatient = {
    foodAllergies: [],
    foodToAvoid: [{ food: { name: "Red meat", bannedIngredients: [{ name: "beef" }, { name: "lamb" }] } }],
    foodPreferences: [],
    healthConditions: [{ condition: { name: "Hypertension", bannedIngredients: [{ name: "soy sauce" }] } }],
    motivations: [],
  };
  const text = buildFoodMapText(patient);
  assert.match(text, /Restricted from foods to avoid: beef, lamb/);
  assert.match(text, /Condition guidance: keep sodium low/);
  assert.match(text, /the app avoids these where they appear[^\n]*soy sauce/);
});

test("buildFoodMapText: trial lines for elimination, reintroduction and a likely-trigger result", () => {
  const rule = { category: "ACIDIC_CITRUS", baselineDays: 7, trialDays: 28, reintroductionDays: 3, washoutDays: 3 };
  const base: FoodMapPatient = { foodAllergies: [], foodToAvoid: [], foodPreferences: [], healthConditions: [], motivations: [] };
  const daysAgo = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  assert.match(buildFoodMapText({ ...base, triggerTrials: [{ status: "ACTIVE", startDate: daysAgo(4), classification: null, rule }] }), /Trigger trial: eliminating Acidic citrus \(day 5 of 28\) — never include: orange, /);
  assert.match(buildFoodMapText({ ...base, triggerTrials: [{ status: "ACTIVE", startDate: daysAgo(29), classification: null, rule }] }), /reintroducing Acidic citrus — include one normal portion/);
  assert.match(buildFoodMapText({ ...base, triggerTrials: [{ status: "COMPLETED", startDate: daysAgo(60), classification: "LIKELY_TRIGGER", rule }] }), /likely trigger — never include: orange/);
  assert.doesNotMatch(buildFoodMapText({ ...base, triggerTrials: [{ status: "STOPPED", startDate: daysAgo(4), classification: null, rule }] }), /Trigger trial/);
});

// ─── custom conditions: the DB guidance column beats the code map ───────────

test("buildFoodMapText: a condition's own guidance is quoted as the diner's note; built-ins fall back to the code map", () => {
  const p: FoodMapPatient = {
    ...emptyPatient(),
    healthConditions: [
      { condition: { name: "Gout", guidance: "no beer, small portions of red meat", bannedIngredients: [{ name: "anchovies" }] } },
      { condition: { name: "Hypertension", guidance: null, bannedIngredients: [] } },
    ],
  };
  const text = buildFoodMapText(p);
  assert.match(text, /Health conditions: Gout, Hypertension/);
  assert.match(text, /the app avoids these where they appear[^\n]*anchovies/);
  assert.match(text, /Gout \(the diner's own note\): "no beer, small portions of red meat"/);
  assert.match(text, /keep sodium low — season with herbs/);
});
