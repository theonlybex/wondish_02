import { test } from "node:test";
import assert from "node:assert/strict";
import { KITCHEN_BASICS, staplesFor, validateMissingBasics } from "./kitchen-basics";
import { BASKET_STAPLES } from "./basket-coverage";

test("with nothing unticked, the staples are exactly the assumed list", () => {
  assert.deepEqual([...staplesFor([])].sort(), [...BASKET_STAPLES].sort());
});

test("unticking garlic powder removes it — and only it", () => {
  const s = staplesFor(["garlic-powder"]);
  assert.ok(!s.has("garlic powder"));
  assert.ok(s.has("onion powder") && s.has("salt") && s.has("olive oil"));
});

test("a basic with several spellings goes as a whole; water is always assumed", () => {
  const s = staplesFor(["salt", "olive-oil", "paprika"]);
  for (const n of ["salt", "kosher salt", "sea salt", "table salt", "olive oil", "extra virgin olive oil", "paprika", "smoked paprika"]) assert.ok(!s.has(n), n);
  assert.ok(s.has("water") && s.has("tap water"));
});

test("generic 'oil' / 'cooking oil' / sprays stay only while some oil is kept", () => {
  const someOil = staplesFor(["olive-oil"]);
  assert.ok(someOil.has("cooking oil") && someOil.has("oil"));
  const noOil = staplesFor(KITCHEN_BASICS.filter((b) => b.oil).map((b) => b.key));
  for (const n of ["oil", "cooking oil", "cooking spray", "nonstick cooking spray"]) assert.ok(!noOil.has(n), n);
});

test("every assumed staple belongs to a basic the user can untick (except water and generic oil)", () => {
  const covered = new Set(KITCHEN_BASICS.flatMap((b) => b.names));
  const uncovered = [...BASKET_STAPLES].filter((n) => !covered.has(n) && !/water/.test(n) && !["oil", "cooking oil", "cooking spray", "nonstick cooking spray"].includes(n));
  assert.deepEqual(uncovered, []);
});

test("saved keys are validated: unknown keys dropped, duplicates removed", () => {
  assert.deepEqual(validateMissingBasics(["garlic-powder", "nope", "garlic-powder", 3]), ["garlic-powder"]);
  assert.deepEqual(validateMissingBasics("garlic-powder"), []);
});
