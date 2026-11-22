import test from "node:test";
import assert from "node:assert/strict";
import { splitKeptFoods, NO_KEPT_FOODS } from "./kept-foods";
import { homeProteins, type DishIngredient, type HomeProtein } from "./dish-protein";
import { DEFAULT_DISH_RULES } from "./dish-rules";
import type { MealType } from "../local-date";
import {
  requestedProtein, proteinRuleApplies, proteinRuleBreak, rotationWheel, chooseProtein, fromHomeLine, proteinNeed,
} from "./protein-rule";

const g = (name: string, quantity: number, unit = "g") => ({ name, quantity, unit });
const row = (name: string, groupKey = "proteins", favorite = false) => ({ name, groupKey, atHome: true, favorite });
const KEPT = splitKeptFoods([row("Salmon fillets"), row("Ground beef"), row("Large eggs", "dairy"), row("Spinach", "produce"), row("Jasmine rice", "grains")]);
const HOME = homeProteins(KEPT);
const homeOf = (...rows: ReturnType<typeof row>[]) => homeProteins(splitKeptFoods(rows));
const brk = (mealType: MealType, ingredients: DishIngredient[], over: object = {}) =>
  proteinRuleBreak({ mealType, ingredients, home: HOME, rules: DEFAULT_DISH_RULES, ...over });
const RICE = g("jasmine rice", 60);

test("the rule is on as soon as a protein is marked; dairy alone, or a named protein that is not at home, leaves it off", () => {
  for (const wants of [undefined, "pancakes", "salmon tacos"]) assert.equal(proteinRuleApplies(HOME, wants), true, String(wants));
  assert.equal(proteinRuleApplies(HOME, "a chicken dish"), false);
  assert.deepEqual([requestedProtein("a chicken dish"), requestedProtein("something quick")], ["chicken", null]);
  assert.equal(requestedProtein("tofu stir-fry"), "tofu");
  assert.equal(proteinRuleApplies(homeOf(row("Extra-firm tofu")), undefined), true);
  assert.equal(proteinRuleApplies(homeOf(row("Plain Greek yogurt", "dairy")), undefined), false);
  assert.equal(proteinRuleApplies([], undefined), false);
});
test("proteinRuleBreak: what is out, and what is not", () => {
  assert.equal(brk("dinner", [g("salmon fillet", 150), RICE, g("eggs", 1, ""), g("chicken broth", 100, "ml")]), null);
  assert.equal(brk("dinner", [g("ground chicken", 120), RICE]), "meat-not-at-home");
  assert.equal(brk("dinner", [g("salmon fillet", 20), g("chickpeas", 90)]), "built-on-not-at-home");
  // Owner, 2026-11-22: a main needs no protein at its centre (a salad, cooked potatoes), and eggs they have may carry one.
  assert.equal(brk("dinner", [g("spinach", 120), RICE]), null);
  assert.equal(brk("dinner", [g("potatoes", 400)]), null);
  assert.equal(brk("lunch", [g("eggs", 3, ""), g("spinach", 60)]), null);
  assert.equal(brk("breakfast", [g("rolled oats", 50), g("banana", 1, "whole")]), null);
  assert.equal(brk("breakfast", [g("eggs", 2, ""), g("spinach", 40)]), null);
  assert.equal(brk("breakfast", [g("plain greek yogurt", 150), g("rolled oats", 40)]), "built-on-not-at-home");
  assert.equal(brk("snack", [g("all-purpose flour", 60), g("eggs", 1, "")]), null);
  assert.equal(brk("dinner", [g("all-purpose flour", 60), g("whole milk", 120, "ml")], { wants: "pancakes" }), null);
  assert.equal(brk("dinner", [g("extra-firm tofu", 150), RICE], { wants: "a stir-fry" }), "built-on-not-at-home");
  assert.equal(brk("dinner", [g("chicken breast", 150), RICE], { wants: "a chicken dish" }), null);
});
test("proteinRuleBreak: the switches, eggs when eggs are all there is, and nothing marked", () => {
  assert.equal(brk("dinner", [g("eggs", 3, ""), g("spinach", 60)], { home: homeOf(row("Large eggs", "dairy")) }), null);
  const anyProtein = { ...DEFAULT_DISH_RULES, onlyHomeProteins: false };
  assert.equal(brk("dinner", [g("ground chicken", 120), RICE], { rules: anyProtein }), null);
  assert.equal(brk("dinner", [g("spinach", 120), RICE], { rules: anyProtein }), null);
  assert.equal(brk("dinner", [g("spinach", 120), RICE], { rules: { ...DEFAULT_DISH_RULES, mainsOnProtein: false } }), null);
  assert.equal(brk("dinner", [g("ground chicken", 120)], { home: [] }), null);
});
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
const pick = (today: string, home: HomeProtein[], over: object = {}) =>
  chooseProtein({ mealType: "dinner", home, usedToday: [], patientId: "p1", today, rules: DEFAULT_DISH_RULES, ...over });
test("rotation: by person and day, both proteins inside a week, a favourite twice as many days", () => {
  const two = homeOf(row("Salmon fillets"), row("Ground beef"), row("Large eggs", "dairy"));
  const week = days(7).map((d) => pick(d, two)!.key);
  assert.deepEqual([...new Set(week)].sort(), ["ground beef", "salmon"]);
  for (let i = 0; i < 6; i++) assert.notEqual(week[i], week[i + 1]);
  assert.equal(pick("2026-11-03", two)!.why, "rotation");
  assert.deepEqual(pick("2026-11-03", two), pick("2026-11-03", two, { mealType: "lunch" }));
  const fav = homeOf(row("Salmon fillets", "proteins", true), row("Ground beef"));
  assert.deepEqual(rotationWheel(fav, true).map((p) => p.key), ["ground beef", "salmon", "salmon"]);
  assert.equal(days(6).filter((d) => pick(d, fav)!.key === "salmon").length, 4);
  assert.equal(days(6).filter((d) => pick(d, fav, { rules: { ...DEFAULT_DISH_RULES, favourFavourites: false } })!.key === "salmon").length, 3);
});
test("same day, same protein: today's log first, then what this chat showed; never for breakfast, a snack or a request", () => {
  const two = homeOf(row("Salmon fillets"), row("Ground beef"));
  for (const d of days(4)) {
    assert.deepEqual(pick(d, two, { usedToday: ["Beef and Rice Skillet"] }), { key: "ground beef", name: "Ground beef", why: "today" });
    assert.equal(pick(d, two, { usedToday: ["Beef and Rice Skillet", "Lemon Salmon with Spinach"] })!.key, "salmon");
    assert.equal(pick(d, two, { usedToday: ["Chicken Soup", "Scrambled Eggs on Toast"] })!.why, "rotation");
    assert.equal(pick(d, two, { usedToday: ["Beef and Rice Skillet"], rules: { ...DEFAULT_DISH_RULES, sameProteinToday: false } })!.why, "rotation");
  }
  for (const over of [{ mealType: "breakfast" }, { mealType: "snack" }, { wants: "a stir-fry" }]) assert.equal(pick("2026-11-01", two, over), null);
  assert.equal(pick("2026-11-01", []), null);
});
test("fromHomeLine", () => {
  assert.deepEqual(fromHomeLine(["salmon fillet", "baby spinach", "jasmine rice", "olive oil"], KEPT, { key: "salmon", cls: "meat", name: "salmon fillet" }),
    { text: "From your kitchen: Salmon fillets, Spinach, Jasmine rice.", foods: ["Salmon fillets", "Spinach", "Jasmine rice"] });
  assert.deepEqual(fromHomeLine(["chicken breast", "jasmine rice"], KEPT, { key: "chicken", cls: "meat", name: "chicken breast" }),
    { text: "Chicken breast is not on your at-home list. From your kitchen: Jasmine rice.", foods: ["Jasmine rice"], proteinNotAtHome: "chicken breast" });
  assert.deepEqual(fromHomeLine(["rolled oats", "banana"], KEPT, null), { text: "Nothing from your at-home list.", foods: [] });
  assert.equal(fromHomeLine(["salmon fillet"], NO_KEPT_FOODS, null), null);
});

// Owner, 2026-11-22: eggs as the only protein at home do not force an egg dish at every lunch and dinner.
test("an eggs-only kitchen: a main may be built on any meat-free protein, never on meat or fish", () => {
  const eggs = { home: homeOf(row("Large eggs", "dairy"), row("Plain Greek yogurt", "dairy")) };
  assert.equal(brk("dinner", [g("eggs", 3, ""), g("spinach", 60)], eggs), null);
  assert.equal(brk("dinner", [g("red lentils", 80), RICE], eggs), null);
  assert.equal(brk("lunch", [g("extra-firm tofu", 150), RICE], eggs), null);
  assert.equal(brk("dinner", [g("extra-firm tofu", 150), RICE], { ...eggs, wants: "a stir-fry" }), null);
  assert.equal(brk("dinner", [g("ground chicken", 120), RICE], eggs), "meat-not-at-home");
  assert.equal(brk("dinner", [g("salmon fillet", 150), RICE], eggs), "meat-not-at-home");
  assert.equal(brk("dinner", [g("spinach", 120), RICE], eggs), null);
  // Breakfast and a snack keep the at-home rule.
  assert.equal(brk("breakfast", [g("red lentils", 80), RICE], eggs), "built-on-not-at-home");
  // No protein is chosen in code, at any meal or day.
  for (const d of days(7)) assert.equal(pick(d, eggs.home), null);
  // Another main protein at home: the strict rule, as before.
  const withTofu = { home: homeOf(row("Large eggs", "dairy"), row("Extra-firm tofu")) };
  assert.equal(brk("dinner", [g("red lentils", 80), RICE], withTofu), "built-on-not-at-home");
  assert.equal(brk("dinner", [g("eggs", 3, ""), g("spinach", 60)], withTofu), null);
  assert.equal(pick("2026-11-03", withTofu.home)!.key, "tofu");
});

test("proteinNeed: pushed when behind, unknown or building muscle; free when the week is on track; held for a kidney condition", () => {
  const need = (over: object = {}) => proteinNeed({ conditionNames: [], motivationNames: [], weekWord: null, behindToday: false, ...over });
  assert.equal(need(), "push");
  assert.equal(need({ weekWord: "little" }), "push");
  assert.equal(need({ weekWord: "on track" }), "free");
  assert.equal(need({ weekWord: "on track", behindToday: true }), "push");
  assert.equal(need({ weekWord: "on track", motivationNames: ["Build muscle"] }), "push");
  assert.equal(need({ weekWord: "little", conditionNames: ["Chronic kidney disease"] }), "hold");
});
