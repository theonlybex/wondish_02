// A guard on the food table itself (2026-11-27).
//
// The other tests check how pricing behaves; none of them said what a food is worth. So "cooked chicken breast"
// could price at a third of its calories, "potato chips" as raw potato and "cinnamon roll" as nothing, with every
// test green. Each row here is an everyday food, an amount, and about what that amount really carries. A logged
// food must either be priced close to it or be left to Clara's own estimate ("unknown"): never priced far off.
//
// The reference figures are rounded textbook values for the food as eaten. They are a tripwire, not a database:
// when a table edit trips one, check the edit before touching the number here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceFoodRow } from "./food-grams";
import { priceDish } from "@/lib/staple-density";

/** Within a quarter of the reference, or within 25 kcal for small amounts. */
const TOLERANCE = 0.25;
const SMALL_KCAL = 25;

// [food as logged, grams as served, about how many kcal, tolerance override]
const AS_SERVED: [string, number, number, number?][] = [
  ["white rice", 180, 234],
  ["brown rice", 180, 220],
  ["pasta", 200, 314],
  ["quinoa", 150, 180],
  ["chicken breast", 150, 248],
  ["cooked chicken breast", 150, 248],
  ["grilled chicken breast", 150, 248],
  ["chicken thighs", 150, 310],
  ["salmon", 150, 309],
  ["cooked salmon", 150, 309],
  ["steak", 200, 500],
  ["ground beef", 120, 300],
  ["scrambled eggs", 120, 180],
  ["boiled eggs", 100, 155],
  ["tofu", 150, 180, 0.35],
  ["olive oil", 14, 124],
  ["butter", 10, 72],
  ["mayonnaise", 15, 100],
  ["peanut butter", 20, 118],
  ["almonds", 30, 174],
  ["avocado", 100, 160],
  ["cheddar cheese", 40, 161],
  ["cottage cheese", 150, 147],
  ["bread", 60, 159],
  ["whole milk", 250, 153],
  ["Greek yogurt", 170, 125, 0.35],
  ["hummus", 50, 120],
  ["olives", 40, 46],
  ["protein powder", 30, 120],
  ["potatoes", 200, 160],
  ["sweet potato", 200, 172],
  ["broccoli", 100, 34],
  ["green beans", 100, 31],
  ["tomatoes", 150, 27],
  ["apple", 180, 94],
  ["salt", 3, 0],
  ["black pepper", 2, 5],
  ["garlic", 6, 9],
  ["mustard", 15, 10],
  ["soy sauce", 15, 8],
  // Prepared and calorie-dense foods: the table must not price these as the raw food in their name.
  ["potato chips", 50, 268],
  ["french fries", 150, 470],
  ["sweet potato fries", 150, 390],
  ["roast potatoes", 200, 300],
  ["fried rice", 250, 430],
  ["mushroom risotto", 300, 420],
  ["milk chocolate", 50, 268],
  ["carrot cake", 100, 400],
  ["cinnamon roll", 100, 370],
  ["garlic bread", 80, 280],
  ["lemon cake", 100, 380],
  ["lemon chicken", 200, 330],
  ["apple pie", 120, 285],
  ["onion rings", 100, 410],
  ["corn flakes", 40, 143],
  ["mint chocolate ice cream", 100, 240],
  ["ginger biscuits", 30, 135],
  ["coconut milk", 100, 197],
  ["basil pesto", 30, 140],
  ["pizza", 200, 530],
  ["bacon", 30, 160],
  ["banana", 120, 107],
  ["almond milk", 250, 40],
  ["cauliflower rice", 150, 38],
  ["zucchini noodles", 150, 26],
  // Known to be off; pinned so it cannot drift further. Porridge takes up more water than the cooked-grain factor
  // allows, so it prices high. Left that way on purpose: "oats 40 g" logged as served may well mean dry oats, and a
  // smaller factor would price those at a fraction of what they are.
  ["oatmeal", 250, 178, 0.9],
];

test("a logged food is priced close to what it is worth, or left to Clara's estimate", () => {
  const off: string[] = [];
  for (const [name, grams, real, tolerance] of AS_SERVED) {
    const kcal = priceFoodRow({ name, grams, asServed: true }).calories;
    if (kcal === null) continue; // unknown: Clara's own figure is used
    const gap = Math.abs(kcal - real);
    if (gap <= SMALL_KCAL && tolerance === undefined) continue;
    if (gap > real * (tolerance ?? TOLERANCE)) off.push(`${name} ${grams} g: priced ${kcal} kcal, about ${real} expected`);
  }
  assert.deepEqual(off, []);
});

// Recipe rows are written as bought: grains dry, meat raw. [row, quantity, unit, about how many kcal]
const AS_BOUGHT: [string, number, string, number][] = [
  ["Chicken breast", 150, "g", 180],
  ["Chicken thighs", 150, "g", 265],
  ["Ground beef", 120, "g", 260],
  ["Salmon", 150, "g", 310],
  ["Basmati rice", 75, "g", 265],
  ["Spaghetti", 80, "g", 285],
  ["Rolled oats", 50, "g", 190],
  ["Dried lentils", 60, "g", 210],
  ["Canned chickpeas", 150, "g", 190],
  ["Olive oil", 1, "tbsp", 120],
  ["Butter", 1, "tbsp", 102],
  ["Large eggs", 2, "", 145],
  ["Sliced bread", 2, "slices", 160],
  ["Cheddar cheese", 30, "g", 120],
  ["Peanut butter", 2, "tbsp", 190],
  ["Almond butter", 1, "tbsp", 98],
  ["Greek yogurt", 1, "cup", 220],
  ["Whole milk", 1, "cup", 150],
  ["Cottage cheese", 0.5, "cup", 110],
  ["Egg whites", 100, "g", 52],
  ["Olives", 40, "g", 46],
  ["Basil pesto", 2, "tbsp", 140],
  ["Garlic mayo", 1, "tbsp", 95],
  ["Broccoli", 150, "g", 51],
  ["Green peas", 80, "g", 65],
  ["Potatoes", 200, "g", 154],
  ["Avocados", 0.5, "cup", 120],
  ["Pumpkin seeds", 30, "g", 168],
  ["Bacon", 2, "slices", 233],
  ["Bananas", 1, "", 105],
  ["Almond milk", 1, "cup", 40],
  ["Cauliflower rice", 150, "g", 38],
  ["Zucchini noodles", 1, "cup", 20],
  ["Cooked pasta", 200, "g", 314],
];

test("a recipe row is priced close to what the food is worth", () => {
  const off: string[] = [];
  for (const [name, quantity, unit, real] of AS_BOUGHT) {
    const priced = priceDish([{ name, quantity, unit }], ["Cook the rice in boiling water."]);
    if (!priced || priced.coverage < 1) {
      off.push(`${name}: not priced`);
      continue;
    }
    const gap = Math.abs(priced.calories - real);
    if (gap > SMALL_KCAL && gap > real * TOLERANCE) off.push(`${name} ${quantity} ${unit}: priced ${priced.calories} kcal, about ${real} expected`);
  }
  assert.deepEqual(off, []);
});

test("seasonings and prepared foods are never priced as food in a recipe", () => {
  for (const [name, quantity, unit] of [["Kosher salt", 1, "tsp"], ["Onion powder", 1, "tsp"], ["Beef broth", 1, "cup"], ["Rice vinegar", 1, "tbsp"], ["Fresh parsley", 10, "g"]] as const) {
    assert.equal(priceDish([{ name, quantity, unit }]), null, name);
  }
  for (const name of ["Coconut milk", "Condensed milk", "Chocolate milk"]) {
    assert.equal(priceDish([{ name, quantity: 50, unit: "g" }])!.coverage, 0, name);
  }
});
