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
