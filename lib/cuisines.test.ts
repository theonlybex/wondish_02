import { test } from "node:test";
import assert from "node:assert/strict";
import { CUISINES, normalizeCuisine } from "./cuisines";

test("normalizeCuisine: a real cuisine name resolves to itself", () => {
  assert.equal(normalizeCuisine("Italian"), "Italian");
  assert.equal(normalizeCuisine("Mexican"), "Mexican");
});

test("normalizeCuisine: case- and whitespace-insensitive", () => {
  assert.equal(normalizeCuisine("italian"), "Italian");
  assert.equal(normalizeCuisine("  THAI  "), "Thai");
  assert.equal(normalizeCuisine("mIdDlE eAsTeRn"), "Middle Eastern");
});

test("normalizeCuisine: 'Surprise me' means no constraint (null)", () => {
  assert.equal(normalizeCuisine("Surprise me"), null);
  assert.equal(normalizeCuisine("surprise me"), null);
});

test("normalizeCuisine: unknown / empty / non-string → null (no constraint)", () => {
  assert.equal(normalizeCuisine("Klingon"), null);
  assert.equal(normalizeCuisine(""), null);
  assert.equal(normalizeCuisine("   "), null);
  assert.equal(normalizeCuisine(undefined), null);
  assert.equal(normalizeCuisine(null), null);
  assert.equal(normalizeCuisine(42), null);
  assert.equal(normalizeCuisine({}), null);
});

test("CUISINES: includes the opt-out and a stable set of real cuisines", () => {
  assert.ok(CUISINES.includes("Surprise me"));
  // Every non-opt-out entry must round-trip through normalizeCuisine.
  for (const c of CUISINES) {
    if (c === "Surprise me") continue;
    assert.equal(normalizeCuisine(c), c, `${c} should normalize to itself`);
  }
});
