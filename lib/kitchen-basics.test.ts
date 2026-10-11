import { test } from "node:test";
import assert from "node:assert/strict";
import { KITCHEN_BASICS, staplesFor, validateMissingBasics } from "./kitchen-basics";
import { BASKET_STAPLES } from "./basket-coverage";

test("with nothing unticked and no basket, the staples are exactly the assumed list", () => {
  assert.deepEqual([...staplesFor([])].sort(), [...BASKET_STAPLES].sort());
});

test("unticking onion powder removes it — and only it", () => {
  const s = staplesFor(["onion-powder"]);
  assert.ok(!s.has("onion powder"));
  assert.ok(s.has("paprika") && s.has("salt") && s.has("olive oil"));
});

// Product call 2026-10-08: garlic and pepper are "not for everybody" — they are
// never assumed; a diner has them only by listing them in What I have.
test("garlic powder and black pepper are never assumed, and are not tickable basics", () => {
  const s = staplesFor([]);
  for (const n of ["garlic powder", "pepper", "black pepper", "black peppercorns", "ground black pepper", "white pepper"]) assert.ok(!s.has(n), n);
  assert.ok(!KITCHEN_BASICS.some((b) => b.key === "garlic-powder" || b.key === "black-pepper"));
});

test("owning any spelling of pepper covers every spelling; garlic powder likewise", () => {
  const s = staplesFor([], ["Black peppercorns", "Chicken breast"]);
  for (const n of ["pepper", "black pepper", "black peppercorns", "ground black pepper"]) assert.ok(s.has(n), n);
  assert.ok(!s.has("garlic powder") && !s.has("white pepper"));
  assert.ok(staplesFor([], ["Garlic powder"]).has("garlic powder"));
  // A bell pepper is not pepper.
  assert.ok(!staplesFor([], ["Bell peppers"]).has("black pepper"));
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
  assert.deepEqual(validateMissingBasics(["paprika", "nope", "paprika", 3, "garlic-powder"]), ["paprika"]);
  assert.deepEqual(validateMissingBasics("paprika"), []);
});
