import { test } from "node:test";
import assert from "node:assert/strict";
import { TRIGGER_CATEGORY_TERMS, termsForCategory, categoryTitle } from "./category-terms";

// Every trigger_category_code in workbook 04's 55 rules.
const WORKBOOK_CATEGORIES = [
  "ACIDIC_CITRUS", "ACIDIC_TOMATO", "ALCOHOL", "CHOCOLATE", "CAFFEINE", "HIGH_FAT", "MINT", "SPICY",
  "COFFEE_CAFFEINE", "CARBONATED", "HIGH_FAT_GREASY",
  "FODMAP_FRUCTANS", "FODMAP_GOS", "FODMAP_LACTOSE", "FODMAP_EXCESS_FRUCTOSE", "FODMAP_POLYOLS", "HIGH_FAT_FRIED",
  "CAFFEINE_INSTABILITY", "CURED_PROCESSED_MEAT", "AGED_CHEESE", "MSG", "ARTIFICIAL_SWEETENERS", "HISTAMINE_TYRAMINE_RICH", "CHOCOLATE_UNCERTAIN",
  "HIGH_GLYCEMIC_PATTERN", "COW_MILK", "WHEY_PROTEIN", "HIGH_SUGAR_DAIRY",
];

test("every workbook-04 trigger category has terms, and none uses a bare word known to over-match", () => {
  assert.equal(WORKBOOK_CATEGORIES.length, 28);
  for (const c of WORKBOOK_CATEGORIES) {
    assert.ok(TRIGGER_CATEGORY_TERMS[c]?.terms.length, `${c} has no terms`);
  }
  const bare = new Set(["sugar", "butter", "beans", "nuts", "yogurt", "kidney", "chips", "flour", "gluten"]);
  for (const [c, v] of Object.entries(TRIGGER_CATEGORY_TERMS)) {
    for (const t of v.terms) assert.ok(!bare.has(t), `${c} uses over-broad term "${t}"`);
    assert.equal(new Set(v.terms).size, v.terms.length, `${c} has duplicate terms`);
  }
  assert.deepEqual(TRIGGER_CATEGORY_TERMS.FODMAP_FRUCTANS.groups, ["BIG9-WHEAT"]);
  assert.deepEqual(termsForCategory("NOPE"), { terms: [] });
});

test("categoryTitle humanises codes and keeps acronyms", () => {
  assert.equal(categoryTitle("ACIDIC_CITRUS"), "Acidic citrus");
  assert.equal(categoryTitle("FODMAP_GOS"), "FODMAP GOS");
  assert.equal(categoryTitle("MSG"), "MSG");
});
