import { test } from "node:test";
import assert from "node:assert/strict";
import {
  singularize,
  normalizeBannedIngredientName,
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

// ─── E2 call-site pins (restaurants-e2-brief.md) ───────────────────────────
//
// alternatives/route.ts, swap/route.ts and taste/dishes/route.ts previously
// derived their own banned-name set and matched it via case-insensitive
// EXACT-NAME comparison only (a Prisma `in`/`mode: insensitive` DB filter, or
// an in-memory `Set.has()` — never a word-boundary regex). That is the
// "old divergent behavior" this task retires: after the refactor, all three
// sites call `evaluateDishAgainstProfile`, so an allergy now blocks by word
// boundary everywhere. These tests pin the divergence itself — reproducing
// each site's old exact-name check inline — so the behavior change (and not
// just the engine's pre-existing capability) is documented and protected.

function oldExactNameCheck(banNames: string[], ingredientNames: string[]): boolean {
  const banned = new Set(banNames.map((n) => n.toLowerCase()));
  return ingredientNames.some((i) => banned.has(i.toLowerCase()));
}

test("E2 pin (alternatives/swap/taste): old exact-name check misses 'Roasted Peanuts' for a 'Peanut' allergy — the exact divergence being closed", () => {
  const oldBlocked = oldExactNameCheck(["Peanut", "Peanut Butter"], ["Roasted Peanuts"]);
  assert.equal(oldBlocked, false, "old exact-name matching did NOT catch this — that was the safety gap");
});

test("E2 pin (alternatives/swap/taste): new engine (word-boundary) blocks 'Roasted Peanuts' for the same 'Peanut' allergy", () => {
  const { allergyNames, exactBanned } = derivePatientBans(peanutAllergyPatient());
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed } = evaluateDishAgainstProfile(["Roasted Peanuts"], matchers);
  assert.equal(passed, false, "engine must block via word-boundary now that all three sites delegate to it");
});

test("E2 pin — Adjudication 1 (taste/dishes): motivation-sourced banned ingredient now excludes a dish (previously omitted from the union)", () => {
  const patient: PatientDietGraph = {
    ...emptyPatient(),
    motivations: [{ motivation: { bannedIngredients: [{ name: "Alcohol" }] } }],
  };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  // Old behavior at taste/dishes/route.ts: motivations were never fetched or
  // unioned, so a motivation-only ban like "Alcohol" was invisible there.
  const oldTasteUnion: string[] = []; // taste/dishes' old union excluded motivations entirely
  assert.equal(oldExactNameCheck(oldTasteUnion, ["Alcohol"]), false);

  // New behavior: full 5-source union via the engine catches it.
  const { passed, violations } = evaluateDishAgainstProfile(["Alcohol"], matchers);
  assert.equal(passed, false);
  assert.equal(violations[0]?.source, "motivation");
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

// ─── build-side trim symmetry (Adjudication 2, E2 brief) ──────────────────
//
// evaluateDishAgainstProfile trims the ingredient before exact-ban comparison
// (match-time). Build time must trim the ban name too, or a fixture/profile
// name with stray whitespace silently fails to match.

test("exact-ban: a whitespace-padded ban name still matches (build-time trim symmetry)", () => {
  const patient = { ...emptyPatient(), foodToAvoid: [{ food: { name: "  Red Meat  " } }] };
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed, violations } = evaluateDishAgainstProfile(["Red Meat"], matchers);
  assert.equal(passed, false);
  assert.equal(violations[0]?.source, "avoid");
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

// ─── 2026-07-24 logic-audit Task 1: plural-aware stemming ───────────────────
//
// Defect: `replace(/(?<!s)s$/, "")` mis-stems -ies/-oes plurals ("Strawberries"
// → "strawberrie"), so the matcher never hits the singular form recipe
// ingredients actually use. Matchers must hit both the stored name and its
// singular/plural counterparts.

test("audit-T1: singularize handles -ies/-oes/-es classes and plain -s", () => {
  assert.equal(singularize("strawberries"), "strawberry");
  assert.equal(singularize("tomatoes"), "tomato");
  assert.equal(singularize("anchovies"), "anchovy");
  assert.equal(singularize("dishes"), "dish");
  assert.equal(singularize("peanuts"), "peanut");
  assert.equal(singularize("egg"), "egg");
  // pre-existing behavior preserved: trailing "ss" words are kept whole
  assert.equal(singularize("swiss"), "swiss");
});

test("audit-T1: 'Strawberries' allergy matches 'strawberry compote' AND 'strawberries'", () => {
  const m = buildDietMatchers({ allergyNames: ["Strawberries"], exactBanned: [] });
  assert.equal(m.allergyMatchers.some((re) => re.test("strawberry compote")), true);
  assert.equal(m.allergyMatchers.some((re) => re.test("Fresh Strawberries")), true);
});

test("audit-T1: 'Tomatoes' allergy matches 'tomato' and 'Anchovies' matches 'anchovy paste'", () => {
  const tom = buildDietMatchers({ allergyNames: ["Tomatoes"], exactBanned: [] });
  assert.equal(tom.allergyMatchers.some((re) => re.test("diced tomato")), true);
  assert.equal(tom.allergyMatchers.some((re) => re.test("tomatoes")), true);
  const anch = buildDietMatchers({ allergyNames: ["Anchovies"], exactBanned: [] });
  assert.equal(anch.allergyMatchers.some((re) => re.test("anchovy paste")), true);
});

test("audit-T1: regressions hold — peanut↔peanuts, egg ∤ eggplant", () => {
  const p = buildDietMatchers({ allergyNames: ["peanut"], exactBanned: [] });
  assert.equal(p.allergyMatchers.some((re) => re.test("roasted peanuts")), true);
  const e = buildDietMatchers({ allergyNames: ["egg"], exactBanned: [] });
  assert.equal(e.allergyMatchers.some((re) => re.test("eggplant")), false);
  assert.equal(e.allergyMatchers.some((re) => re.test("scrambled eggs")), true);
});

// ─── 2026-07-24 logic-audit Task 2: unicode/punctuation boundaries ──────────
//
// Defect: JS \b is ASCII-\w-based, so ban terms starting/ending with
// punctuation or accented letters build unsatisfiable regexes and are
// silently inert; slash-compound names ("Wheat / Gluten") stem as one
// unmatchable phrase.

test("audit-T2: accented-edge allergy name matches (unicode-safe boundaries)", () => {
  const m = buildDietMatchers({ allergyNames: ["œufs"], exactBanned: [] });
  assert.equal(m.allergyMatchers.some((re) => re.test("œufs brouillés")), true);
});

test("audit-T2: slash-compound allergy name matches each part", () => {
  const m = buildDietMatchers({ allergyNames: ["Wheat / Gluten"], exactBanned: [] });
  assert.equal(m.allergyMatchers.some((re) => re.test("Wheat flour wrapper")), true);
  assert.equal(m.allergyMatchers.some((re) => re.test("Bun (gluten)")), true);
});

test("audit-T2: punctuation-wrapped allergy name matches its bare form", () => {
  const m = buildDietMatchers({ allergyNames: ["(Shellfish)"], exactBanned: [] });
  assert.equal(m.allergyMatchers.some((re) => re.test("shellfish stock")), true);
});

test("audit-T2: boundary regressions — butter ∤ butternut, egg ∤ eggplant still hold", () => {
  const b = buildDietMatchers({ allergyNames: ["butter"], exactBanned: [] });
  assert.equal(b.allergyMatchers.some((re) => re.test("butternut squash")), false);
  assert.equal(b.allergyMatchers.some((re) => re.test("peanut butter")), true);
  const e = buildDietMatchers({ allergyNames: ["egg"], exactBanned: [] });
  assert.equal(e.allergyMatchers.some((re) => re.test("eggplant parmesan")), false);
});

test("audit-T2: normalizeBannedIngredientName accepts real names, rejects junk", () => {
  assert.equal(normalizeBannedIngredientName("  Ground   peanuts "), "Ground peanuts");
  assert.equal(normalizeBannedIngredientName("Nuts (tree)"), "Nuts (tree)");
  assert.equal(normalizeBannedIngredientName("("), null);
  assert.equal(normalizeBannedIngredientName("x"), null);
  assert.equal(normalizeBannedIngredientName("   "), null);
  assert.equal(normalizeBannedIngredientName(42), null);
});

// ─── 2026-07-24 logic-audit Task 4: exact-ban phrase matching ───────────────
//
// Defect: exact bans (avoid/condition/preference/motivation) used whole-string
// equality against ingredient names, so condition-ban "sugar" passed "brown
// sugar" on every DB surface while fridge phrase-blocked the same term.
// Over-block is the safe direction for health-condition bans.

function conditionBan(name: string): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [],
    healthConditions: [{ condition: { bannedIngredients: [{ name }] } }],
    foodPreferences: [],
    motivations: [],
  };
}

test("audit-T4: condition-ban 'sugar' flags ingredient 'brown sugar' (phrase, not equality)", () => {
  const matchers = buildDietMatchers(derivePatientBans(conditionBan("sugar")));
  const { passed, violations } = evaluateDishAgainstProfile(["brown sugar"], matchers);
  assert.equal(passed, false);
  assert.deepEqual(violations, [{ ingredient: "brown sugar", term: "sugar", source: "condition" }]);
});

test("audit-T4: avoid-ban 'egg' flags plural ingredient 'eggs'", () => {
  const patient: PatientDietGraph = {
    ...conditionBan("unused"),
    healthConditions: [],
    foodToAvoid: [{ food: { name: "egg" } }],
  };
  const matchers = buildDietMatchers(derivePatientBans(patient));
  assert.equal(evaluateDishAgainstProfile(["eggs"], matchers).passed, false);
  // boundary still holds: "egg" must not flag "eggplant"
  assert.equal(evaluateDishAgainstProfile(["eggplant"], matchers).passed, true);
});

test("audit-T4: exact-ban boundary regression — 'corn' does not flag 'acorn squash'", () => {
  const matchers = buildDietMatchers(derivePatientBans(conditionBan("corn")));
  assert.equal(evaluateDishAgainstProfile(["acorn squash"], matchers).passed, true);
  assert.equal(evaluateDishAgainstProfile(["corn tortilla"], matchers).passed, false);
});

test("audit-T4: multi-word exact ban still phrase-matches ('red meat' in 'ground red meat')", () => {
  const matchers = buildDietMatchers(derivePatientBans(conditionBan("red meat")));
  assert.equal(evaluateDishAgainstProfile(["ground red meat"], matchers).passed, false);
});
