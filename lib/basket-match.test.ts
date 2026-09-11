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
