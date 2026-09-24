import { test } from "node:test";
import assert from "node:assert/strict";
import { findBasketMatch, ingredientTokens } from "./basket-match";

const basket = [
  "Boneless chicken breasts", "Extra virgin olive oil", "Yellow onions", "Sliced bread", "Canned tuna",
  "Large eggs", "Brown rice", "Bell peppers", "Garlic", "Salmon fillets", "Ground turkey", "spinach",
];

test("paraphrased model names resolve to their basket entry", () => {
  assert.equal(findBasketMatch("chicken breast", basket), "Boneless chicken breasts");
  assert.equal(findBasketMatch("olive oil", basket), "Extra virgin olive oil");
  assert.equal(findBasketMatch("onion", basket), "Yellow onions");
  assert.equal(findBasketMatch("whole grain bread", basket), "Sliced bread");
  assert.equal(findBasketMatch("tuna", basket), "Canned tuna");
  assert.equal(findBasketMatch("eggs", basket), "Large eggs");
  assert.equal(findBasketMatch("bell pepper", basket), "Bell peppers");
  assert.equal(findBasketMatch("garlic cloves", basket), "Garlic");
  assert.equal(findBasketMatch("salmon fillet", basket), "Salmon fillets");
  assert.equal(findBasketMatch("Spinach", basket), "spinach");
});

test("exact names win, staples are free, and foreign ingredients or other cuts are rejected", () => {
  assert.equal(findBasketMatch("Brown rice", basket), "Brown rice");
  assert.equal(findBasketMatch("salt", basket), "");
  assert.equal(findBasketMatch("lemon", basket), null);
  assert.equal(findBasketMatch("chicken thighs", basket), null);
  assert.equal(findBasketMatch("turkey breast", basket), null);
  assert.equal(findBasketMatch("white rice", basket), null);
  assert.equal(findBasketMatch("", basket), null);
});

test("ingredientTokens drops descriptors and singularises", () => {
  assert.deepEqual([...ingredientTokens("Boneless skinless chicken breasts")], ["chicken", "breast"]);
  assert.deepEqual([...ingredientTokens("extra-virgin olive oil")], ["olive", "oil"]);
});

// ── A staple must not be swallowed by a look-alike basket entry ─────────────
// Regression, 2026-09-24: moving the basket check ahead of the staple list
// (so a user who owns olive oil gets credited for it) made "pepper" resolve
// to the basket entry "Bell peppers", because {pepper} ⊆ {bell, pepper}.
// Two QA runs found it independently: 10 of 29 and 16 of 24 dishes listed
// "Bell peppers · 0.1 teaspoon" where the steps said "season with pepper",
// and Clara read it back as an ingredient. A staple may only be claimed by a
// basket entry meaning the SAME thing — equal token sets, not overlapping.

test("a staple is not swallowed by a look-alike basket entry", () => {
  const withBellPeppers = ["Bell peppers", "Boneless chicken breasts", "Brown rice"];
  // The seasoning stays a free staple...
  assert.equal(findBasketMatch("pepper", withBellPeppers), "");
  assert.equal(findBasketMatch("black pepper", withBellPeppers), "");
  assert.equal(findBasketMatch("freshly ground black pepper", withBellPeppers), "");
  // ...while the vegetable still resolves to the basket.
  assert.equal(findBasketMatch("bell pepper", withBellPeppers), "Bell peppers");
  assert.equal(findBasketMatch("bell peppers", withBellPeppers), "Bell peppers");
});

test("a staple the user actually owns is still credited to their basket entry", () => {
  // Equal token sets, so the basket wins: it must count for coverage and must
  // not be dropped from What-to-buy as if it were free.
  assert.equal(findBasketMatch("olive oil", ["Extra virgin olive oil"]), "Extra virgin olive oil");
  assert.equal(findBasketMatch("extra-virgin olive oil", ["Extra virgin olive oil"]), "Extra virgin olive oil");
  // With no oil in the basket it falls through to the staple list.
  assert.equal(findBasketMatch("olive oil", ["Brown rice"]), "");
});
