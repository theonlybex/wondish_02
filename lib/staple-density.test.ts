import { test } from "node:test";
import assert from "node:assert/strict";
import { gramsOf, macroFloor, priceDish } from "./staple-density";

// The long tail added 2026-09-25 to stop 301 null-macro dishes being refused
// over an ingredient that could not have changed their nutrition.
test("the seasoning tail prices as seasoning, and a vegetable pepper stays a vegetable", () => {
  // The conflation this table has now got wrong twice, in both directions.
  assert.equal(gramsOf("Green peppers", 110, "g"), 110);
  const greenPepper = macroFloor([{ name: "Green peppers", quantity: 200, unit: "g" }], null);
  const groundPepper = macroFloor([{ name: "Black peppercorns", quantity: 200, unit: "g" }], null);
  assert.ok(
    greenPepper.carbs < groundPepper.carbs / 4,
    `a vegetable pepper must not be priced as the seasoning: ${greenPepper.carbs} vs ${groundPepper.carbs}`
  );
});

test("garnish units price instead of taking the whole dish out of pricing", () => {
  assert.equal(gramsOf("Garlic", 2, "clove"), 6);
  assert.equal(gramsOf("Fresh basil", 6, "leaves"), 3);
  assert.equal(gramsOf("Fresh thyme", 2, "sprig"), 2);
  assert.equal(gramsOf("celery", 1, "stalk"), 40);
  assert.equal(gramsOf("Asparagus", 6, "spear"), 90);
  assert.equal(gramsOf("Kosher salt", 1, "pinch"), 0.3);
});

test("seasoning and water are skipped entirely, so they never cost a dish its coverage", () => {
  // A dish of nothing but seasoning has nothing to price — null is correct, and
  // is why these names never counted against coverage in the first place.
  assert.equal(priceDish([{ name: "tap water", quantity: 1.5, unit: "cup" }], null), null);
  assert.equal(priceDish([{ name: "Kosher salt", quantity: 0.25, unit: "teaspoon" }], null), null);
  // And a real dish keeps full coverage however much seasoning it carries.
  const dish = priceDish(
    [
      { name: "Boneless chicken breasts", quantity: 150, unit: "g" },
      { name: "Kosher salt", quantity: 0.25, unit: "teaspoon" },
      { name: "Black peppercorns", quantity: 0.1, unit: "teaspoon" },
      { name: "tap water", quantity: 1.5, unit: "cup" },
      { name: "Garlic", quantity: 2, unit: "clove" },
    ],
    null
  );
  assert.ok(dish);
  assert.equal(dish.coverage, 1);
  assert.ok(dish.protein > 30 && dish.protein < 40, `150 g chicken is ~35 g protein, got ${dish.protein}`);
});

test("mayonnaise is priced as the fat it is, not waved through as a condiment", () => {
  // A tablespoon is ~100 kcal of almost pure fat, which is why the tail lists
  // real values for the few entries that carry calories.
  const mayo = priceDish(
    [{ name: "Boneless chicken breasts", quantity: 100, unit: "g" }, { name: "Mayonnaise", quantity: 1, unit: "tablespoon" }],
    null
  );
  assert.ok(mayo);
  assert.ok(mayo.fat > 10, `expected the mayonnaise fat to land, got ${mayo.fat} g`);
});

// ── A net for the plural trap ────────────────────────────────────────────────
//
// A singular-only pattern that silently fails to match the catalog's own
// spelling has cost this project four separate bugs: \begg\b against "eggs"
// (egg dishes rejected as "not breakfast food"), \bberries\b against
// "strawberries", \bpeppers?\b catching "Bell peppers" (a vegetable priced as
// the seasoning), and \bcucumber\b against "Cucumbers" (74 recipe rows
// unpriceable, and the dishes simply never appeared in a plan).
//
// Every one was found by measuring the live database, never by a test. These are
// the real names, copied from the catalog, of the foods it uses most. If a
// pattern is ever written singular-only again, one of these stops pricing and
// this test says which — before it costs another cycle.
const CATALOG_NAMES = [
  "Large eggs", "Sliced bread", "Boneless chicken breasts", "Chicken thighs", "Ground beef",
  "Ground turkey", "Salmon fillets", "Canned tuna", "Catfish fillets", "rainbow trout filets",
  "Bell peppers", "green peppers", "Roma tomatoes", "Yellow onions", "Cucumbers", "Carrots",
  "Avocados", "Russet potatoes", "Sweet potatoes", "Green cabbage", "romaine lettuce",
  "Asparagus", "Brussels sprouts", "Mushrooms", "Garbanzo beans", "Frozen Lima beans",
  "Green lentils", "Black beans", "jasmine rice", "Brown rice", "Wild rice", "Spaghetti",
  "Rolled oats", "Quinoa", "Plain Greek yogurt", "Feta cheese", "Sour cream", "Heavy cream",
  "unsweetened soymilk", "Almonds", "Unsalted pistachios", "pecans", "Peanut butter",
  "Apples", "Bananas", "Strawberries", "Blueberries", "Peaches", "raw apricot", "Lemons",
  "Olives", "Capers", "raisins", "Pitted prunes", "Gluten-free rice buns",
  "Potato & tapioca gluten-free crackers", "Gluten-free granola", "Cornstarch", "Mayonnaise",
  "Ground flaxseed", "Cocoa powder", "meatless chicken", "Extra virgin olive oil",
];

test("every food the catalog actually uses can be weighed, singular or plural", () => {
  const unweighable = CATALOG_NAMES.filter((n) => gramsOf(n, 1, "cup") == null);
  assert.deepEqual(unweighable, [], `the density table cannot weigh: ${unweighable.join(", ")}`);
});

test("a plural name weighs the same as its singular", () => {
  // The trap in one assertion: if a pattern lost its s?, these diverge.
  for (const [one, many] of [
    ["Cucumber", "Cucumbers"], ["Avocado", "Avocados"], ["Large egg", "Large eggs"],
    ["Bell pepper", "Bell peppers"], ["Lemon", "Lemons"], ["Peach", "Peaches"],
    ["Carrot", "Carrots"], ["Olive", "Olives"], ["Caper", "Capers"], ["pecan", "pecans"],
  ]) {
    assert.equal(gramsOf(one, 1, "cup"), gramsOf(many, 1, "cup"), `${one} vs ${many}`);
  }
});

// ── QA's hand arithmetic, as a test ─────────────────────────────────────────
//
// A QA pass priced these three dishes against real composition and found the
// table wrong in both directions: every vegetable went through ONE flat row
// (6 g carbs, 2 g protein, 0 g fat per 100 g, 120 g a cup), so a plate of
// tomatoes declared 3 g of protein over food holding 1.4, a mixed vegetable side
// declared 7 g over 3.9, and roasted broccoli declared 109 kcal against 127.
// 120 g a cup is also badly wrong for leaves — "Spinach 2 cup" priced as 240 g
// when two cups of raw spinach is about 60.
//
// The numbers on the right are QA's, computed independently of this table.
test("vegetable pricing lands within 10% of real composition", () => {
  const cases: [string, { name: string; quantity: number; unit: string }[], { kcal: number; protein: number; carbs: number }][] = [
    ["sliced tomatoes with oil",
      [{ name: "Roma tomatoes", quantity: 150, unit: "g" }, { name: "Extra virgin olive oil", quantity: 5, unit: "g" }],
      { kcal: 76, protein: 1.4, carbs: 5.9 }],
    ["mixed vegetable side",
      [{ name: "zucchini", quantity: 200, unit: "g" }, { name: "Roma tomatoes", quantity: 120, unit: "g" },
       { name: "carrots", quantity: 50, unit: "g" }, { name: "Extra virgin olive oil", quantity: 5, unit: "g" }],
      { kcal: 132, protein: 3.9, carbs: 15.7 }],
    ["roasted broccoli",
      [{ name: "broccoli", quantity: 200, unit: "g" }, { name: "Extra virgin olive oil", quantity: 5, unit: "g" }],
      { kcal: 127, protein: 5.6, carbs: 13.2 }],
  ];
  for (const [label, rows, real] of cases) {
    const p = priceDish(rows, null);
    assert.ok(p, label);
    assert.ok(Math.abs(p.calories - real.kcal) / real.kcal < 0.10, `${label} kcal: ${p.calories} vs ${real.kcal}`);
    assert.ok(Math.abs(p.carbs - real.carbs) / real.carbs < 0.10, `${label} carbs: ${p.carbs} vs ${real.carbs}`);
    // Protein within half a gram: percentages are meaningless on a 1.4 g base.
    assert.ok(Math.abs(p.protein - real.protein) < 0.6, `${label} protein: ${p.protein} vs ${real.protein}`);
  }
});

test("a cup of leaves is not a cup of carrots", () => {
  assert.equal(gramsOf("spinach", 2, "cup"), 60, "two cups of raw spinach is ~60 g, not 240");
  assert.equal(gramsOf("arugula", 1, "cup"), 30);
  assert.equal(gramsOf("carrots", 1, "cup"), 120);
  assert.equal(gramsOf("broccoli", 1, "cup"), 100);
});

test("priced macros carry a tenth of a gram, not a whole one", () => {
  // Rounding to integers is what made a 1.4 g protein read as 2 and the error
  // read as +43%.
  const p = priceDish([{ name: "Roma tomatoes", quantity: 150, unit: "g" }], null);
  assert.ok(p);
  assert.ok(p.protein % 1 !== 0 || p.protein === 0, `expected a fractional gram, got ${p.protein}`);
});

// ── Sodium ──────────────────────────────────────────────────────────────────
//
// The meal plan's rail counted ADDED SALT and compared it to 2,300 mg — the FDA
// guideline for TOTAL dietary sodium. QA priced a day at ~3,300 mg of real
// sodium while the rail printed "2,034/2,300mg" in green, and Clara repeated
// the reassurance. The numerator and the denominator were measuring different
// things, and the gap is not small: bread is ~490 mg per 100 g, cheese ~700.
test("a dish's sodium counts the salt AND the food", () => {
  // Two slices of bread and two eggs, no salt at all.
  const unsalted = priceDish(
    [{ name: "Sliced bread", quantity: 2, unit: "slice" }, { name: "Large eggs", quantity: 2, unit: "egg" }],
    null
  );
  assert.ok(unsalted);
  // 60 g bread at 490 mg/100 g = 294; 100 g egg at 142 = 142. ~436 mg, and
  // certainly not the zero a salt-only count would report.
  assert.ok(unsalted.sodiumMg > 350 && unsalted.sodiumMg < 520, `expected ~436 mg, got ${unsalted.sodiumMg}`);

  // And the salt is still counted, on top.
  const salted = priceDish(
    [
      { name: "Sliced bread", quantity: 2, unit: "slice" },
      { name: "Large eggs", quantity: 2, unit: "egg" },
      { name: "Kosher salt", quantity: 0.25, unit: "teaspoon" },
    ],
    null
  );
  assert.ok(salted);
  assert.equal(salted.sodiumMg - unsalted.sodiumMg, 581, "0.25 tsp of salt is 581 mg of sodium");
});

test("plain vegetables carry no sodium worth counting", () => {
  const veg = priceDish(
    [{ name: "broccoli", quantity: 200, unit: "g" }, { name: "Roma tomatoes", quantity: 150, unit: "g" }],
    null
  );
  assert.ok(veg);
  assert.equal(veg.sodiumMg, 0, "a tomato at 5 mg/100 g cannot change a verdict; it is not listed");
});

test("a seasoning's sodium counts even though its calories do not", () => {
  // soy sauce, stock, mustard, hot sauce, olives and capers are all on the
  // NEGLIGIBLE list — correctly, for CALORIES. Skipping them for sodium too
  // would have lost the saltiest things in the kitchen: a tablespoon of soy
  // sauce is ~870 mg, a third of a day's guideline.
  const plain = priceDish([{ name: "jasmine rice", quantity: 60, unit: "g" }], null);
  const withSoy = priceDish(
    [{ name: "jasmine rice", quantity: 60, unit: "g" }, { name: "soy sauce", quantity: 1, unit: "tablespoon" }],
    null
  );
  assert.ok(plain && withSoy);
  assert.ok(withSoy.sodiumMg - plain.sodiumMg > 600, `the soy sauce should add ~870 mg, added ${withSoy.sodiumMg - plain.sodiumMg}`);
  // …and it still contributes no calories, so the macro arithmetic is untouched.
  assert.equal(withSoy.calories, plain.calories);

  const cheese = priceDish([{ name: "Feta cheese", quantity: 50, unit: "g" }], null);
  assert.ok(cheese && cheese.sodiumMg > 250, `50 g of cheese is ~350 mg, got ${cheese?.sodiumMg}`);
});

test("plural per-item breads price, and corn tortillas are tortillas not corn", () => {
  const one = gramsOf("tortilla", 1, null);
  assert.ok(one != null && one > 0);
  assert.equal(gramsOf("corn tortillas", 2, null), 2 * (one as number));
  for (const n of ["bagels", "muffins", "pitas", "english muffins", "whole wheat tortillas"]) {
    assert.notEqual(gramsOf(n, 2, null), null, n);
  }
});

test("canned beans are priced as cooked, dry ones as dry, canned tuna untouched", () => {
  const kcal = (name: string) => Math.round(priceDish([{ name, quantity: 100, unit: "g" }] as never, null)?.calories ?? -1);
  assert.equal(kcal("Chickpeas"), 354);
  assert.equal(kcal("Canned chickpeas"), kcal("Cooked lentils"));
  assert.equal(kcal("Black beans, drained"), kcal("Cooked lentils"));
  assert.ok(kcal("Canned chickpeas") < 140);
});

test("a row that says 'cooked' is shrunk only when it is a grain or a pulse", () => {
  const kcal = (name: string) => priceDish([{ name, quantity: 150, unit: "g" }])!.calories;
  assert.equal(kcal("Cooked chicken breast, shredded"), kcal("Chicken breast"));
  assert.equal(kcal("Cooked salmon"), kcal("Salmon"));
  assert.ok(kcal("Cooked brown rice") < kcal("Brown rice") * 0.4);
  assert.ok(kcal("Cooked quinoa") < kcal("Quinoa") * 0.4);
});

// 2026-11-27: the same name faults in recipe rows that made logged meals too low.
const one = (name: string, quantity: number, unit: string) => priceDish([{ name, quantity, unit }], ["Cook the rice in boiling water."]);

test("a recipe row that only CONTAINS a seasoning word is still priced as its food", () => {
  assert.ok(one("Garlic bread", 80, "g")!.calories > 150);
  assert.ok(one("Basil pesto", 30, "g")!.calories > 100);
  assert.ok(one("Tuna, canned in water", 100, "g")!.protein > 15);
  assert.ok(one("Protein powder", 1, "scoop")!.protein > 15);
  assert.ok(one("Garlic mayo", 2, "tbsp")!.fat > 15);
  const olives = one("Olives", 40, "g")!;
  assert.ok(olives.calories > 35 && olives.calories < 60, `olives ${olives.calories}`);
  assert.equal(one("Kalamata olives", 10, "")!.coverage, 1);
});

test("seasonings stay out of the calories, whatever word sits beside them", () => {
  for (const [name, q, unit] of [["Onion powder", 1, "tsp"], ["Beef broth", 1, "cup"], ["Rice vinegar", 1, "tbsp"], ["Apple cider vinegar", 1, "tbsp"], ["Celery salt", 1, "tsp"], ["Fresh parsley", 10, "g"], ["Kosher salt", 1, "tsp"], ["Black peppercorns", 1, "tsp"], ["vanilla extract", 1, "tsp"], ["fresh ginger", 10, "g"], ["lemon pepper seasoning blend", 1, "tsp"]] as const) {
    assert.equal(one(name, q, unit), null, name);
  }
  // Celery salt is still salt for the sodium count.
  const dish = priceDish([{ name: "Chicken breast", quantity: 150, unit: "g" }, { name: "Celery salt", quantity: 1, unit: "tsp" }])!;
  assert.ok(dish.sodiumMg > 2000, `sodium ${dish.sodiumMg}`);
});

test("the row that accounts for the whole name wins over an earlier partial match", () => {
  const pb = one("Peanut butter", 100, "g")!;
  assert.ok(pb.fat < 60 && pb.protein > 20, `peanut butter ${pb.fat} fat ${pb.protein} protein`);
  assert.ok(one("Almond milk", 1, "cup")!.calories < 120);
  assert.ok(one("Butter beans", 100, "g")!.calories < 200);
  assert.ok(one("Pumpkin seeds", 30, "g")!.calories > 120);
  assert.equal(one("Olive oil", 14, "g")!.calories, 126);
  assert.equal(one("Peanut oil", 14, "g")!.calories, 126);
  assert.ok(one("Egg whites", 100, "g")!.calories < 70);
  assert.ok(one("Cottage cheese", 100, "g")!.calories < 130);
});

test("a prepared food is not priced as the raw food in its name: the row is left unpriced", () => {
  for (const name of ["Coconut milk", "Condensed milk", "Chocolate milk", "Potato cakes", "Rice pudding pie"]) {
    assert.equal(one(name, 50, "g")!.coverage, 0, name);
  }
  // The common prepared foods have rows of their own, priced as eaten.
  assert.ok(one("Potato chips", 50, "g")!.calories > 230);
  assert.ok(one("Milk chocolate", 50, "g")!.calories > 230);
  assert.ok(one("Carrot cake", 100, "g")!.calories > 300);
  // The plain foods are untouched.
  assert.equal(one("Potatoes", 200, "g")!.coverage, 1);
  assert.equal(one("Whole milk", 200, "g")!.coverage, 1);
  assert.equal(one("Rice cakes", 2, "")!.coverage, 1);
  // Sun-dried tomatoes have their own row: a tablespoon is a few grams at ~260 kcal per 100 g.
  const sdt = one("Sun-dried tomatoes", 2, "tablespoon")!;
  assert.ok(sdt.coverage === 1 && sdt.calories > 10 && sdt.calories < 30, `sun-dried ${sdt.calories}`);
});

test("a bell pepper is a vegetable, whatever its colour; the pepper grinder and pepper flakes are still seasonings", () => {
  const kcal = (name: string) => one(name, 100, "g")?.calories ?? null;
  for (const name of ["bell pepper", "red bell pepper", "green bell pepper", "Bell peppers", "yellow pepper"]) {
    assert.ok(kcal(name)! > 25 && kcal(name)! < 50, `${name}: ${kcal(name)}`);
  }
  assert.equal(kcal("green bell pepper"), kcal("red bell pepper"));
  for (const name of ["black pepper", "Black peppercorns", "pepper", "Crushed red pepper flakes"]) assert.equal(one(name, 1, "tsp"), null, name);
  // "green" no longer reads as salad greens.
  assert.ok(one("mixed greens", 60, "g")!.calories < 25);
});
