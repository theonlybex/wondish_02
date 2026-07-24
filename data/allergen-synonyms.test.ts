import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLERGEN_SYNONYMS } from "./allergen-synonyms";
import {
  buildDietMatchers,
  normalizeBannedIngredientName,
} from "../lib/diet-match";

// Guard against the audit's "inert ban" class: every curated synonym must
// (a) survive the admin write-side validation and (b) build a matcher that
// actually fires on its own text — a synonym failing either would save fine
// and silently never match.

test("every allergen synonym passes write-side validation", () => {
  for (const [allergy, synonyms] of Object.entries(ALLERGEN_SYNONYMS)) {
    for (const syn of synonyms) {
      assert.notEqual(
        normalizeBannedIngredientName(syn),
        null,
        `${allergy} ← "${syn}" fails normalizeBannedIngredientName`
      );
    }
  }
});

test("every allergen synonym builds a matcher that fires on itself in context", () => {
  for (const [allergy, synonyms] of Object.entries(ALLERGEN_SYNONYMS)) {
    const { allergyMatchers } = buildDietMatchers({
      allergyNames: synonyms,
      exactBanned: [],
    });
    for (const syn of synonyms) {
      assert.equal(
        allergyMatchers.some((re) => re.test(`grilled ${syn} platter`)),
        true,
        `${allergy} ← "${syn}" produces no firing matcher`
      );
    }
  }
});

test("headline audit scenarios: shellfish→shrimp, fish→tuna, tree nuts→walnuts, wheat/gluten→flour", () => {
  const cases: Array<[string, string]> = [
    ["Shellfish", "Shrimp"],
    ["Fish", "Tuna"],
    ["Tree nuts", "Walnuts"],
    ["Wheat / Gluten", "Wheat flour wrapper"],
  ];
  for (const [allergy, ingredient] of cases) {
    const { allergyMatchers } = buildDietMatchers({
      allergyNames: [allergy, ...ALLERGEN_SYNONYMS[allergy]],
      exactBanned: [],
    });
    assert.equal(
      allergyMatchers.some((re) => re.test(ingredient)),
      true,
      `${allergy} must flag "${ingredient}"`
    );
  }
});
