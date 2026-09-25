import { test } from "node:test";
import assert from "node:assert/strict";
import { stepRinsesRawProtein, withoutRawProteinRinse } from "./dish-plausibility";

// ── "Rinse the chicken breast and pat dry" ───────────────────────────────────
//
// USDA/FSIS: do not rinse raw poultry, meat or fish. Running water spreads what
// is on the surface around the sink; the cooking was going to kill it anyway.
// QA found one instance in 18 meat dishes; the catalog holds 22.
//
// Every string below is a real step from the live catalog on 2026-09-25 — both
// the ones that must change and, more importantly, the ones that must not.

test("the object decides, not the verb", () => {
  // Must NOT flag. The first version of this rule matched any step containing
  // both a rinse word and a meat word, and condemned 14 steps like these, where
  // washing vegetables is exactly the right instruction.
  for (const step of [
    "While the fish bakes, wash the celery, mushrooms, and bell peppers, then chop them into small bite-sized pieces.",
    "While salmon and potatoes bake, wash the asparagus and trim the woody ends by snapping them where they naturally break.",
    "Rinse the quinoa thoroughly under cold water until the water runs clear.",
    "Rinse and drain the canned chickpeas.",
  ]) {
    assert.equal(stepRinsesRawProtein(step), false, `should not flag: ${step}`);
    assert.equal(withoutRawProteinRinse(step), null, `should not rewrite: ${step}`);
  }
});

test("the rinse goes, the pat-dry stays", () => {
  const cases: [string, string][] = [
    [
      "Rinse the salmon fillet and pat it dry with a paper towel.",
      "Pat the salmon fillet dry with a paper towel.",
    ],
    [
      "Rinse the boneless chicken breast under cold water and pat dry with paper towels.",
      "Pat the boneless chicken breast dry with paper towels.",
    ],
    [
      "Rinse and pat dry the chicken breast, then cut it into small dice pieces.",
      "Pat dry the chicken breast, then cut it into small dice pieces.",
    ],
    [
      "Wash and pat dry the 4 oz boneless chicken breast, then cut into bite-sized pieces.",
      "Pat dry the 4 oz boneless chicken breast, then cut into bite-sized pieces.",
    ],
    [
      "Rinse the chicken breast and pat dry; season with salt, pepper, and garlic powder.",
      "Pat the chicken breast dry; season with salt, pepper, and garlic powder.",
    ],
    [
      "Meanwhile, rinse salmon fillet and pat dry. Heat 1 tablespoon olive oil in a skillet over medium-high heat.",
      "Meanwhile, pat salmon fillet dry. Heat 1 tablespoon olive oil in a skillet over medium-high heat.",
    ],
  ];
  for (const [before, after] of cases) {
    assert.equal(stepRinsesRawProtein(before), true, `should flag: ${before}`);
    assert.equal(withoutRawProteinRinse(before), after);
  }
});

test("a rinse with no pat-dry still ends up dry", () => {
  // Drying is not decoration: a wet surface steams instead of browning, so the
  // step that loses its rinse gains the instruction it was missing.
  assert.equal(
    withoutRawProteinRinse("Rinse the boneless chicken breast and cut it into 4 oz of small bite-sized pieces."),
    "Pat the boneless chicken breast dry and cut it into 4 oz of small bite-sized pieces."
  );
  assert.equal(
    withoutRawProteinRinse("Wash the 4 oz boneless chicken breast and pat it dry with paper towels."),
    "Pat the 4 oz boneless chicken breast dry with paper towels."
  );
});

test("a rewritten step never still says to rinse the meat", () => {
  const all = [
    "Rinse the fish and pat dry; rub with olive oil, rosemary, and salt, and squeeze ½ lime over.",
    "Rinse the 3 oz boneless chicken breast and cut it into bite-sized cubes.",
    "Wash the salmon filet and pat it dry with paper towels.",
    "Rinse the turkey breast and pat dry, then season generously with salt, pepper, and dried herbs.",
    "Rinse the chicken thigh and pat dry with paper towel. Season both sides with salt, pepper, garlic powder, and paprika.",
  ];
  for (const step of all) {
    const fixed = withoutRawProteinRinse(step);
    assert.ok(fixed, `${step} should have been rewritten`);
    assert.equal(stepRinsesRawProtein(fixed!), false, `still rinses raw protein: ${fixed}`);
    // And the repair is a fixpoint — running it twice changes nothing more.
    assert.equal(withoutRawProteinRinse(fixed!), null, `not idempotent: ${fixed}`);
  }
});

// ── A title that is a grocery line ───────────────────────────────────────────

import { nameFromCookedForm } from "./dish-plausibility";

test("a grading word becomes the method the steps describe", () => {
  assert.equal(
    nameFromCookedForm("Large Eggs with Spinach and Yellow Onions", [
      "Crack eggs into a bowl and whisk with a fork.",
      "Pour whisked eggs over vegetables and scramble gently for 4-5 minutes until eggs are set.",
    ]),
    "Scrambled Eggs with Spinach and Yellow Onions"
  );
  assert.equal(
    nameFromCookedForm("Large Eggs with Roma Tomatoes", [
      "Whisk the eggs and pour into the pan, lifting the edges to form an omelette.",
    ]),
    "Omelette with Roma Tomatoes"
  );
  assert.equal(nameFromCookedForm("Large Eggs", ["Poach the eggs in barely simmering water for 3 minutes."]), "Poached Eggs");
});

test("it leaves alone what it cannot name", () => {
  // Steps that never say what happens to the eggs: a dull title beats a wrong
  // one.
  assert.equal(nameFromCookedForm("Large Eggs with Spinach", ["Cook everything together and serve."]), null);
  // And titles that were never a grocery line.
  assert.equal(nameFromCookedForm("Ground Beef with Rice and Broccoli", ["Brown the beef."]), null);
  assert.equal(nameFromCookedForm("Spinach and Feta Scramble", ["Scramble the eggs."]), null);
});
