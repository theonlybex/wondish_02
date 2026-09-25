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
