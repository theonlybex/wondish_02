import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_KEPT_FOODS,
  breaksProteinRule,
  foodMatches,
  proteinKey,
  proteinRuleOn,
  requestNamesProtein,
  splitKeptFoods,
} from "./kept-foods";

test("proteinKey: kinds, ground, and things that only sound like meat", () => {
  assert.equal(proteinKey("Salmon fillets"), "salmon");
  assert.equal(proteinKey("lean ground beef"), "ground beef");
  assert.equal(proteinKey("Minced chicken"), "ground chicken");
  assert.equal(proteinKey("Boneless chicken breasts"), "chicken");
  assert.equal(proteinKey("Sirloin steak"), "beef");
  assert.equal(proteinKey("cod"), "cod");
  for (const n of ["Chicken broth", "fish sauce", "oyster sauce", "beef bouillon", "meatless chicken", "Extra-firm tofu", "Large eggs", "Green lentils", "Plain Greek yogurt"])
    assert.equal(proteinKey(n), null, n);
});

test("proteinKey matches whole words only", () => {
  assert.equal(proteinKey("Graham crackers"), null);
  assert.equal(proteinKey("Champagne vinegar"), null);
  assert.equal(proteinKey("Coddled eggs"), null);
  assert.equal(proteinKey("Smoked ham"), "ham");
  assert.equal(proteinKey("Tuna steaks"), "tuna");
  assert.equal(proteinKey("Large shrimp"), "shrimp");
  assert.equal(proteinKey("Ground cumin"), null);
});

test("breaksProteinRule: only unmarked meat and fish break it", () => {
  const kept = splitKeptFoods([
    { name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: true },
    { name: "Ground beef", groupKey: "proteins", atHome: true, favorite: false },
    { name: "Spinach", groupKey: "produce", atHome: true, favorite: false },
    { name: "Ground chicken", groupKey: "proteins", atHome: false, favorite: false },
  ]);
  assert.deepEqual(kept.proteinKeys.sort(), ["ground beef", "salmon"]);
  assert.deepEqual(kept.proteinNames, ["Salmon fillets", "Ground beef"]);
  assert.deepEqual(kept.atHome, ["Spinach"]);
  assert.deepEqual(kept.favorites, ["Salmon fillets"]);
  assert.equal(breaksProteinRule(["ground chicken", "rice"], kept), true);
  assert.equal(breaksProteinRule(["chicken breast"], kept), true);
  assert.equal(breaksProteinRule(["lamb shoulder"], kept), true);
  assert.equal(breaksProteinRule(["salmon", "chicken broth", "eggs", "red lentils"], kept), false);
  assert.equal(breaksProteinRule(["rolled oats", "banana"], kept), false);
});

test("splitKeptFoods: favourites include foods not at home; keys come from any group, deduped", () => {
  const kept = splitKeptFoods([
    { name: "Shrimp", groupKey: "seafood", atHome: true, favorite: false },
    { name: "Frozen shrimp", groupKey: "proteins", atHome: true, favorite: false },
    { name: "Lamb", groupKey: "proteins", atHome: false, favorite: true },
  ]);
  assert.deepEqual(kept.proteinKeys, ["shrimp"]);
  assert.deepEqual(kept.proteinNames, ["Frozen shrimp"]);
  assert.deepEqual(kept.atHome, ["Shrimp"]);
  assert.deepEqual(kept.favorites, ["Lamb"]);
});

test("the rule is off with no meat or fish marked", () => {
  const tofuOnly = splitKeptFoods([{ name: "Extra-firm tofu", groupKey: "proteins", atHome: true, favorite: false }]);
  assert.deepEqual(tofuOnly.proteinKeys, []);
  assert.equal(breaksProteinRule(["chicken breast"], tofuOnly), false);
  assert.equal(proteinRuleOn(tofuOnly, undefined), false);
  assert.equal(breaksProteinRule(["chicken breast"], NO_KEPT_FOODS), false);
});

test("only a request that names a meat or fish lifts the rule", () => {
  const kept = splitKeptFoods([{ name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false }]);
  assert.equal(requestNamesProtein("a chicken dish"), true);
  assert.equal(requestNamesProtein("a stir-fry"), false);
  for (const w of ["some meat", "fish tacos", "seafood pasta", "poultry", "a steak"]) assert.equal(requestNamesProtein(w), true, w);
  assert.equal(requestNamesProtein("a graham cracker crust"), false);
  assert.equal(proteinRuleOn(kept, "a chicken dish"), false);
  assert.equal(proteinRuleOn(kept, "pancakes"), true);
  assert.equal(proteinRuleOn(kept, undefined), true);
  assert.equal(proteinRuleOn(kept, "  "), true);
});

test("foodMatches", () => {
  assert.equal(foodMatches("Salmon fillets", "salmon"), true);
  assert.equal(foodMatches("Spinach", "baby spinach"), true);
  assert.equal(foodMatches("Large eggs", "egg"), true);
  assert.equal(foodMatches("Ground beef", "beef broth"), false);
  assert.equal(foodMatches("Roma tomatoes", "cherry tomatoes"), false);
});
