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
