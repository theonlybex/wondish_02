import { test } from "node:test";
import assert from "node:assert/strict";
import { displayDishName, formatAmount } from "./dish-name";

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

test("every suffix shape the import sheet uses is stripped", () => {
  // The dot forms reached /pantry cards intact, and one code carries a comma of
  // its own ("V2,5M"), which stopped the match before the label (QA cycle 8).
  const cases: [string, string][] = [
    ["Black coffee, V1. Plain", "Black coffee"],
    ["Black coffee, V6. Decaf", "Black coffee"],
    ["Plain Cocoa, V11", "Plain Cocoa"],
    ["Black Tea, V1-Plain", "Black Tea"],
    ["Wild Rice , V1M- 3/4 cup, cooked unsalted", "Wild Rice"],
    ["Vegan Bean Chili , V2,5M- 4 oz plant-based ground beef.", "Vegan Bean Chili"],
    ["Scrambled Eggs, V1S- 1 egg", "Scrambled Eggs"],
  ];
  for (const [raw, want] of cases) assert.equal(displayDishName(raw), want, raw);
  // A name that merely contains a comma is left alone.
  assert.equal(displayDishName("Chicken, Rice and Broccoli"), "Chicken, Rice and Broccoli");
});

// The stored unit is singular — it is a unit, not a phrase — so cards read
// "2 slice", "2 egg", "2 cup" and "1 whole" on about 25 rows (QA 2026-09-25).
test("an amount reads the way a person would write it", () => {
  assert.equal(formatAmount(2, "slice"), "2 slices");
  assert.equal(formatAmount(2, "egg"), "2 eggs");
  assert.equal(formatAmount(2, "cup"), "2 cups");
  assert.equal(formatAmount(1, "slice"), "1 slice", "one of anything stays singular");
  assert.equal(formatAmount(2, "pinch"), "2 pinches");
  assert.equal(formatAmount(3, "teaspoon"), "3 teaspoons");
  // Abbreviations are never pluralised.
  assert.equal(formatAmount(150, "g"), "150 g");
  assert.equal(formatAmount(2, "tbsp"), "2 tbsp");
  assert.equal(formatAmount(5, "oz"), "5 oz");
  // "whole" stands in for the food and reads better as a bare count.
  assert.equal(formatAmount(2, "whole"), "2");
  assert.equal(formatAmount(1, "unit"), "1");
  // Already plural, and no unit at all.
  assert.equal(formatAmount(2, "slices"), "2 slices");
  assert.equal(formatAmount(2, null), "2");
  assert.equal(formatAmount(null, "g"), "");
});
