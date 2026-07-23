import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  PATIENT_DIET_INCLUDE,
  type PatientDietGraph,
} from "./diet-match";

// ─── fixtures ───────────────────────────────────────────────────────────────

function emptyPatient(): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

function peanutAllergyPatient(): PatientDietGraph {
  return {
    ...emptyPatient(),
    foodAllergies: [
      { food: { name: "Peanut", bannedIngredients: [{ name: "Peanut Butter" }] } },
    ],
  };
}

function eggAllergyPatient(): PatientDietGraph {
  return {
    ...emptyPatient(),
    foodAllergies: [{ food: { name: "Egg", bannedIngredients: [] } }],
  };
}

function multiSourcePatient(): PatientDietGraph {
  return {
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [] } }],
    foodToAvoid: [{ food: { name: "Red Meat" } }],
    healthConditions: [
      { condition: { bannedIngredients: [{ name: "Sugar" }] } },
    ],
    foodPreferences: [
      { food: { bannedIngredients: [{ name: "Gluten" }] } },
    ],
    motivations: [
      { motivation: { bannedIngredients: [{ name: "Alcohol" }] } },
    ],
  };
}

// ─── derivePatientBans: union + asymmetry ──────────────────────────────────

test("derivePatientBans: empty patient yields empty allergyNames and exactBanned", () => {
  const { allergyNames, exactBanned } = derivePatientBans(emptyPatient());
  assert.deepEqual(allergyNames, []);
  assert.deepEqual(exactBanned, []);
});

test("derivePatientBans: allergies contribute own food name AND bannedIngredients children", () => {
  const { allergyNames } = derivePatientBans(peanutAllergyPatient());
  assert.deepEqual(allergyNames.sort(), ["Peanut", "Peanut Butter"].sort());
});

test("derivePatientBans: foodToAvoid contributes only its own food name (exact source 'avoid')", () => {
  const patient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Red Meat" } }] };
  const { exactBanned } = derivePatientBans(patient);
  assert.deepEqual(exactBanned, [{ name: "Red Meat", source: "avoid" }]);
});

test("derivePatientBans: healthConditions contribute only bannedIngredients children (source 'condition')", () => {
  const patient = {
    ...emptyPatient(),
    healthConditions: [{ condition: { bannedIngredients: [{ name: "Sugar" }] } }],
  };
  const { exactBanned } = derivePatientBans(patient);
  assert.deepEqual(exactBanned, [{ name: "Sugar", source: "condition" }]);
});

test("derivePatientBans: foodPreferences contribute only bannedIngredients children (source 'preference')", () => {
  const patient = {
    ...emptyPatient(),
    foodPreferences: [{ food: { bannedIngredients: [{ name: "Gluten" }] } }],
  };
  const { exactBanned } = derivePatientBans(patient);
  assert.deepEqual(exactBanned, [{ name: "Gluten", source: "preference" }]);
});

test("derivePatientBans: motivations contribute only bannedIngredients children (source 'motivation')", () => {
  const patient = {
    ...emptyPatient(),
    motivations: [{ motivation: { bannedIngredients: [{ name: "Alcohol" }] } }],
  };
  const { exactBanned } = derivePatientBans(patient);
  assert.deepEqual(exactBanned, [{ name: "Alcohol", source: "motivation" }]);
});

test("derivePatientBans: full 5-source union pinned against fixture patient", () => {
  const { allergyNames, exactBanned } = derivePatientBans(multiSourcePatient());
  assert.deepEqual(allergyNames, ["Peanut"]);
  const bySource = Object.fromEntries(exactBanned.map((b) => [b.source, b.name]));
  assert.deepEqual(bySource, {
    avoid: "Red Meat",
    condition: "Sugar",
    preference: "Gluten",
    motivation: "Alcohol",
  });
  assert.equal(exactBanned.length, 4);
});

// ─── buildDietMatchers + evaluateDishAgainstProfile: allergy word-boundary ─

test("peanut allergy blocks 'Peanut Butter', 'peanuts', 'Peanut' (word-boundary + plural stemming)", () => {
  const { allergyNames, exactBanned } = derivePatientBans(peanutAllergyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  for (const ingredient of ["Peanut Butter", "peanuts", "Peanut", "Roasted Peanuts"]) {
    const { passed, violations } = evaluateDishAgainstProfile([ingredient], matchers);
    assert.equal(passed, false, `expected "${ingredient}" to violate`);
    assert.equal(violations.length >= 1, true);
    assert.equal(violations[0].source, "allergy");
  }
});

test("egg allergy does NOT block 'eggplant' (word-boundary rule forbids substring match)", () => {
  const { allergyNames, exactBanned } = derivePatientBans(eggAllergyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed, violations } = evaluateDishAgainstProfile(["Eggplant Parmesan"], matchers);
  assert.equal(passed, true);
  assert.deepEqual(violations, []);
});

test("egg allergy DOES block 'Egg' and 'Scrambled Eggs'", () => {
  const { allergyNames, exactBanned } = derivePatientBans(eggAllergyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  assert.equal(evaluateDishAgainstProfile(["Egg"], matchers).passed, false);
  assert.equal(evaluateDishAgainstProfile(["Scrambled Eggs"], matchers).passed, false);
});

// ─── exact-ban matching: case-insensitive exact-name, not substring ───────

test("exact-ban matching is case-insensitive exact-name, not substring", () => {
  const patient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Red Meat" } }] };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  // Case-insensitive exact match blocks.
  assert.equal(evaluateDishAgainstProfile(["red meat"], matchers).passed, false);
  assert.equal(evaluateDishAgainstProfile(["RED MEAT"], matchers).passed, false);
  assert.equal(evaluateDishAgainstProfile(["Red Meat"], matchers).passed, false);
});

test("exact-ban: substring containing the banned name does NOT match (not substring semantics)", () => {
  const patient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Meat" } }] };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  // "Meatball Sub" contains "meat" as a substring but is not exactly "meat".
  const { passed, violations } = evaluateDishAgainstProfile(["Meatball Sub"], matchers);
  assert.equal(passed, true);
  assert.deepEqual(violations, []);
});

// ─── multi-source violations ───────────────────────────────────────────────

test("multi-source violations: allergy + condition bans on the same dish both reported with correct sources", () => {
  const patient: PatientDietGraph = {
    ...emptyPatient(),
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [] } }],
    healthConditions: [{ condition: { bannedIngredients: [{ name: "Sugar" }] } }],
  };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  const { passed, violations } = evaluateDishAgainstProfile(["Peanut Brittle", "Sugar"], matchers);
  assert.equal(passed, false);
  const sources = violations.map((v) => v.source).sort();
  assert.deepEqual(sources, ["allergy", "condition"]);
});

// ─── multiple violating ingredients; term vs ingredient distinction ──────

test("multiple violating ingredients are all reported; term differs from ingredient", () => {
  const patient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "Sugar" } }, { food: { name: "Salt" } }] };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  const { passed, violations } = evaluateDishAgainstProfile(
    ["Sugar", "Salt", "Flour"],
    matchers
  );
  assert.equal(passed, false);
  assert.equal(violations.length, 2);
  const byIngredient = Object.fromEntries(violations.map((v) => [v.ingredient, v.term]));
  assert.deepEqual(byIngredient, { Sugar: "sugar", Salt: "salt" });
  // term is the lowercased ban name, ingredient preserves original casing —
  // demonstrating the two fields are distinct concepts, not aliases.
  for (const v of violations) {
    assert.equal(typeof v.ingredient, "string");
    assert.equal(typeof v.term, "string");
  }
});

test("allergy violation term reports the matched allergy stem, not the full ingredient text", () => {
  const { allergyNames, exactBanned } = derivePatientBans(peanutAllergyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { violations } = evaluateDishAgainstProfile(["Peanut Butter Cookies"], matchers);
  assert.equal(violations.length >= 1, true);
  const v = violations[0];
  assert.equal(v.ingredient, "Peanut Butter Cookies");
  assert.notEqual(v.term, v.ingredient);
});

// ─── empty profile / empty ingredient list ─────────────────────────────────

test("empty profile: everything passes regardless of ingredients", () => {
  const { allergyNames, exactBanned } = derivePatientBans(emptyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed, violations } = evaluateDishAgainstProfile(["Peanut Butter", "Sugar", "Anything"], matchers);
  assert.equal(passed, true);
  assert.deepEqual(violations, []);
});

test("empty ingredient list: passes even with a populated profile", () => {
  const { allergyNames, exactBanned } = derivePatientBans(multiSourcePatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed, violations } = evaluateDishAgainstProfile([], matchers);
  assert.equal(passed, true);
  assert.deepEqual(violations, []);
});

// ─── PATIENT_DIET_INCLUDE ───────────────────────────────────────────────────

test("PATIENT_DIET_INCLUDE: shape matches the 5-source graph (allergies/avoid/conditions/preferences/motivations)", () => {
  assert.deepEqual(PATIENT_DIET_INCLUDE, {
    foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
    foodToAvoid:      { include: { food: true } },
    healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
    foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
    motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
  });
});
