import test from "node:test";
import assert from "node:assert/strict";
import { splitKeptFoods, NO_KEPT_FOODS } from "./kept-foods";
import { proteinKind, builtOn, homeProteins, mainProteins } from "./dish-protein";

const g = (name: string, quantity: number, unit = "g") => ({ name, quantity, unit });
test("proteinKind: every kind in the design, and names that only sound like one", () => {
  const kinds: [string, string, string][] = [
    ["Salmon fillets", "salmon", "meat"], ["lean ground beef", "ground beef", "meat"], ["Large eggs", "egg", "egg"],
    ["Extra-firm tofu", "tofu", "plant"], ["tempeh", "tempeh", "plant"], ["Seitan strips", "seitan", "plant"],
    ["Red lentils", "lentil", "pulse"], ["Green lentils", "lentil", "pulse"], ["Garbanzo beans", "chickpea", "pulse"], ["chickpeas", "chickpea", "pulse"], ["Black beans", "bean", "pulse"],
    ["Plain Greek yogurt", "greek yogurt", "dairy"], ["greek yoghurt", "greek yogurt", "dairy"], ["Cottage cheese", "cottage cheese", "dairy"],
  ];
  for (const [name, key, cls] of kinds) assert.deepEqual(proteinKind(name), { key, cls }, name);
  for (const n of ["Chicken broth", "fish sauce", "Green beans", "bean sprouts", "black bean sauce", "Eggplant", "egg noodles", "soy milk", "chickpea flour", "plain yogurt", "Shredded cheddar", "peanut butter", "quinoa", "meatless chicken", "Spinach"])
    assert.equal(proteinKind(n), null, n);
});
test("builtOn: the protein ingredient giving the most protein, not the first or the at-home one", () => {
  assert.equal(builtOn([g("salmon fillet", 120), g("red lentils", 30), g("spinach", 60)])?.key, "salmon");
  assert.equal(builtOn([g("red lentils", 80), g("eggs", 1, ""), g("spinach", 60)])?.key, "lentil");
  assert.equal(builtOn([g("salmon fillet", 20), g("chickpeas", 90)])?.key, "chickpea"); // Review Focus 2
  assert.equal(builtOn([g("plain greek yogurt", 150), g("rolled oats", 40)])?.key, "greek yogurt");
  assert.equal(builtOn([g("rolled oats", 50), g("banana", 1, "whole")]), null);
  assert.equal(builtOn([g("all-purpose flour", 60), g("whole milk", 120, "ml"), g("eggs", 1, "")]), null); // 6.5 g < 8 g
  assert.equal(builtOn([g("eggs", 2, ""), g("spinach", 60)])?.key, "egg");
  assert.equal(builtOn([{ name: "tempeh", quantity: null, unit: "" }, { name: "seitan", quantity: null, unit: "" }])?.key, "tempeh");
});
test("homeProteins and mainProteins", () => {
  const row = (name: string, groupKey: string, atHome = true, favorite = false) => ({ name, groupKey, atHome, favorite });
  const kept = splitKeptFoods([row("Salmon fillets", "proteins", true, true), row("Ground beef", "proteins"), row("Large eggs", "dairy"), row("Plain Greek yogurt", "dairy"), row("Spinach", "produce"), row("Chicken thighs", "proteins", false, true)]);
  assert.deepEqual(homeProteins(kept), [
    { key: "salmon", cls: "meat", name: "Salmon fillets", favourite: true },
    { key: "ground beef", cls: "meat", name: "Ground beef", favourite: false },
    { key: "egg", cls: "egg", name: "Large eggs", favourite: false },
    { key: "greek yogurt", cls: "dairy", name: "Plain Greek yogurt", favourite: false },
  ]);
  assert.deepEqual(mainProteins(homeProteins(kept)).map((p) => p.key), ["salmon", "ground beef"]);
  // Review Focus 1: eggs carry mains only when nothing else can; dairy never does.
  const only = (name: string) => homeProteins(splitKeptFoods([row(name, "dairy")]));
  assert.deepEqual(mainProteins(only("Large eggs")).map((p) => p.key), ["egg"]);
  assert.deepEqual(mainProteins(only("Plain Greek yogurt")), []);
  assert.deepEqual(homeProteins(NO_KEPT_FOODS), []);
});
