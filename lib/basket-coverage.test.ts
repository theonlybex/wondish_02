import { test } from "node:test";
import assert from "node:assert/strict";
import { isCoveredByBasket } from "./basket-coverage";

const basket = new Set(["chicken", "rice", "broccoli"]);

test("covered when every ingredient is in the basket (case-insensitive)", () => {
  assert.equal(isCoveredByBasket(["Chicken", "RICE"], basket), true);
});

test("staples are free and don't need to be in the basket", () => {
  assert.equal(isCoveredByBasket(["chicken", "salt", "water"], basket), true);
});

test("not covered when any ingredient is missing from the basket", () => {
  assert.equal(isCoveredByBasket(["chicken", "beef"], basket), false);
});

test("an empty ingredient list is trivially covered", () => {
  assert.equal(isCoveredByBasket([], basket), true);
});

test("isCoveredByBasket normalises the basket, not just the dish", () => {
  // Catalog casing on both sides. This returned false before 2026-09-25 and
  // silently reduced the dish pool to what staples alone can build.
  const basket = new Set(["Large eggs", "Roma tomatoes", "  Sliced Bread "]);
  assert.equal(isCoveredByBasket(["Large eggs", "Roma tomatoes"], basket), true);
  assert.equal(isCoveredByBasket(["large eggs", "sliced bread"], basket), true);
  assert.equal(isCoveredByBasket(["Large eggs", "Salmon fillets"], basket), false);
  // Staples stay free regardless of casing.
  assert.equal(isCoveredByBasket(["Large eggs", "Olive Oil", "SALT"], basket), true);
});

test("the basket covers the same food spelled another way, but not a different food", () => {
  // 34 groups of catalog rows are one food under several spellings, with more
  // than one spelling in live use. "eggs" sits on 14 recipes and "Large eggs" on
  // 288; a diner who stocked eggs could cook none of the 288 and was told nothing.
  const basket = new Set(["eggs", "bell pepper", "cucumber", "Lemon"]);
  assert.equal(isCoveredByBasket(["Large eggs"], basket), true);
  assert.equal(isCoveredByBasket(["Bell peppers"], basket), true);
  assert.equal(isCoveredByBasket(["Cucumbers"], basket), true);
  assert.equal(isCoveredByBasket(["Lemons"], basket), true);
  // Equal token sets, never subset: owning the seasoning does not stock the
  // vegetable, which is the conflation this codebase has paid for twice.
  assert.equal(isCoveredByBasket(["Bell peppers"], new Set(["pepper"])), false);
  assert.equal(isCoveredByBasket(["Salmon fillets"], basket), false);
  // A narrower basket entry must not claim a broader ingredient either.
  assert.equal(isCoveredByBasket(["Boneless chicken breasts"], new Set(["chicken"])), false);
});
