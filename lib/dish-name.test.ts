import { test } from "node:test";
import assert from "node:assert/strict";
import { displayDishName } from "./dish-name";

test("strips import-sheet variant suffixes", () => {
  assert.equal(displayDishName("Scrambled Eggs, V1S- 1 egg"), "Scrambled Eggs");
  assert.equal(displayDishName("Scrambled Eggs, V1M- 2 eggs"), "Scrambled Eggs");
  assert.equal(displayDishName("Green Apple, V1"), "Green Apple");
  assert.equal(displayDishName("Almonds , V1- 1/4 cup"), "Almonds");
  assert.equal(displayDishName("Brown Rice , V1XL- 1 1/4 cup, cooked unsalted"), "Brown Rice");
  assert.equal(displayDishName("Dried Figs, V2"), "Dried Figs");
});

test("leaves real names alone", () => {
  assert.equal(displayDishName("Chicken and Vegetable Egg Scramble"), "Chicken and Vegetable Egg Scramble");
  assert.equal(displayDishName("Vitamin C Smoothie, Version 2"), "Vitamin C Smoothie, Version 2");
  assert.equal(displayDishName("Tacos, veggie"), "Tacos, veggie");
  assert.equal(displayDishName("  Pasta  "), "Pasta");
});
