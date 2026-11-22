import test from "node:test";
import assert from "node:assert/strict";
import { splitKeptFoods } from "./kept-foods";
import { homeProteins } from "./dish-protein";
import { DEFAULT_DISH_RULES, type DishRules } from "./dish-rules";
import { judgeDish, dishShape, sameDish, starchesIn, keepWayOfCooking, namedAfterOwnIngredient, type JudgeInput } from "./dish-judge";

const g = (name: string, quantity: number, unit = "g") => ({ name, quantity, unit });
const HOME = homeProteins(splitKeptFoods([
  { name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false },
  { name: "Ground beef", groupKey: "proteins", atHome: true, favorite: false },
]));
const BASE: JudgeInput = {
  mealType: "dinner", name: "Pan-Seared Salmon with Rice and Spinach",
  ingredients: [g("salmon fillet", 150), g("jasmine rice", 60), g("spinach", 60), g("olive oil", 1, "teaspoon")],
  steps: ["Sear the salmon fillet for 4 minutes on each side.", "Simmer the jasmine rice for 15 minutes.", "Wilt the spinach in the olive oil."],
  calories: 600, proteinG: 38, known: {}, home: HOME, rules: DEFAULT_DISH_RULES, targetCalories: 600, ceilings: { sodium: 690, iron: 45 },
};
const j = (over: Partial<JudgeInput> = {}) => judgeDish({ ...BASE, ...over });

test("a sound dish passes, and says what it is built on", () => assert.deepEqual(j(), { level: "pass", reasons: [], builtOn: "salmon" }));
test("size and protein share only relax the dish", () => {
  assert.deepEqual(j({ calories: 900 }), { level: "relaxed", reasons: ["size:too-large"], builtOn: "salmon" });
  assert.deepEqual(j({ calories: 320 }).reasons, ["size:too-small"]);
  // Owner, 2026-11-22: the 15% protein floor is off.
  assert.deepEqual(j({ proteinG: 20 }), { level: "pass", reasons: [], builtOn: "salmon" });
  assert.deepEqual(j({ calories: 900, proteinG: 20 }).reasons, ["size:too-large"]);
});
test("the protein rule, honesty and limits are never relaxed", () => {
  const chicken = [g("ground chicken", 150), g("jasmine rice", 60)];
  assert.deepEqual(j({ ingredients: chicken }), { level: "fail", reasons: ["protein:meat-not-at-home"], builtOn: "ground chicken" });
  assert.deepEqual(j({ ingredients: chicken, calories: 900 }).reasons, ["protein:meat-not-at-home", "size:too-large"]);
  assert.equal(j({ ingredients: chicken, calories: 900 }).level, "fail");
  // A main with no protein at its centre passes (owner, 2026-11-22).
  assert.deepEqual(j({ name: "Spinach Rice", ingredients: [g("spinach", 120), g("jasmine rice", 60)], proteinG: 6 }), { level: "pass", reasons: [], builtOn: null });
  assert.deepEqual(j({ name: "Salmon Fillet" }).reasons, ["honest:named-after-ingredient"]);
  assert.equal(j({ name: "Salmon Fillet" }).level, "fail");
  assert.deepEqual(j({ known: { sodium: 900 } }), { level: "fail", reasons: ["limit:sodium"], builtOn: "salmon" });
  assert.deepEqual(j({ known: { iron: 50 } }).reasons, ["limit:iron"]);
});
test("an unknown amount is never a breach (Review Focus 4)", () => {
  assert.equal(j({ known: {} }).level, "pass");
  assert.equal(j({ known: { sodium: 690 } }).level, "pass");
  assert.equal(j({ known: { potassium: 9000 } }).level, "pass"); // no ceiling for potassium
});
test("switches and missing targets", () => {
  assert.equal(j({ calories: 900, rules: { ...DEFAULT_DISH_RULES, sizeToCalories: false } }).level, "pass");
  assert.equal(j({ proteinG: 5, rules: { ...DEFAULT_DISH_RULES, mainsOnProtein: false } }).level, "pass");
  assert.equal(j({ calories: 1300, proteinG: 60, targetCalories: null }).level, "pass");
  assert.equal(j({ mealType: "breakfast", calories: 900, targetCalories: 400, proteinG: 5, ingredients: [g("rolled oats", 80), g("banana", 1, "whole")], name: "Banana Oat Porridge" }).level, "pass");
  assert.equal(j({ ingredients: [g("ground chicken", 150), g("jasmine rice", 60)], home: [] }).level, "pass"); // nothing marked
  const allOff = Object.fromEntries(Object.keys(DEFAULT_DISH_RULES).map((k) => [k, false])) as unknown as DishRules;
  assert.deepEqual(j({ known: { sodium: 900 }, rules: allOff }).reasons, ["limit:sodium"]); // limits have no switch
});
test("foods to buy are not counted (the hook is off)", () => {
  const many = [g("salmon fillet", 150), ...["leek", "fennel", "capers", "dill", "creme fraiche", "new potatoes", "shallot", "white wine"].map((n) => g(n, 20))];
  assert.deepEqual(j({ ingredients: many }).reasons, []);
});
test("namedAfterOwnIngredient", () => {
  assert.equal(namedAfterOwnIngredient("Wild Rice", ["wild rice", "water", "salt"]), true);
  assert.equal(namedAfterOwnIngredient("Ground Beef", ["lean ground beef", "yellow onion"]), true);
  assert.equal(namedAfterOwnIngredient("Greek Yogurt", ["plain greek yogurt", "honey"]), true);
  assert.equal(namedAfterOwnIngredient("Scrambled Eggs", ["eggs", "butter"]), false);
  assert.equal(namedAfterOwnIngredient("Ground Beef with Bell Peppers and Brown Rice", ["ground beef", "bell peppers", "brown rice"]), false);
});

// Live run, 2026-11-22: a lunch came back at dinner with its name reworded.
test("a dish that is one they just had, reworded, is only relaxed; a different one passes; a request is never judged on it", () => {
  const lunch = "Salmon and Jasmine Rice Bowl with Sautéed Spinach";
  assert.deepEqual(j({ name: "Salmon Jasmine Rice Bowl with Lemon Garlic Spinach", notLike: [lunch] }), { level: "relaxed", reasons: ["repeat"], builtOn: "salmon" });
  assert.equal(j({ name: "Baked Salmon with Roasted Potatoes and Spinach", notLike: [lunch] }).level, "pass");
  assert.equal(j({ name: lunch, notLike: [lunch], wants: "a salmon bowl" }).level, "pass");
  assert.equal(j({ notLike: [] }).level, "pass");
});

// Live run 4, 2026-11-22: with five foods at home shared words neither caught a lunch reworded at dinner nor spared a different dish.
test("a repeat is the same protein, starch and way of cooking; one starch per dish; both only relax", () => {
  assert.deepEqual(dishShape("Ground Beef and Spinach Jasmine Rice Stir-Fry with Egg"), { protein: "beef", starch: "rice", way: "pan" });
  assert.deepEqual(dishShape("Salmon and Spinach Jasmine Rice Curry"), { protein: "salmon", starch: "rice", way: "wet" });
  assert.deepEqual(dishShape("Ground Beef and Spinach Stuffed Russet Potatoes"), { protein: "beef", starch: "potato", way: "oven" });
  // The run's own pairs.
  assert.equal(sameDish("Ground Beef and Spinach Jasmine Rice Stir-Fry with Egg", "Ground Beef and Spinach Jasmine Rice Bowl"), true);
  assert.equal(sameDish("Salmon and Spinach Jasmine Rice Bowl with Lemon", "Pan-Seared Salmon with Spinach and Jasmine Rice"), true);
  assert.equal(sameDish("Ground Beef and Spinach Jasmine Rice Stuffed Peppers", "Ground Beef and Spinach Jasmine Rice Bowl"), false);
  assert.equal(sameDish("Ground Beef and Spinach Potato Soup", "Ground Beef and Spinach Jasmine Rice Bowl"), false);
  assert.equal(sameDish("Salmon and Spinach Jasmine Rice Curry", "Salmon and Spinach Jasmine Rice Bowl with Lemon"), false);
  // Nothing to go by: mostly the same words.
  assert.equal(sameDish("Spinach and Mushroom Omelette", "Mushroom and Spinach Omelette"), true);
  assert.equal(sameDish("Spinach and Mushroom Omelette", "Tomato and Cucumber Salad"), false);
  assert.deepEqual(j({ name: "Salmon Jasmine Rice Skillet with Spinach", notLike: ["Pan-Seared Salmon with Spinach and Jasmine Rice"] }).reasons, ["repeat"]);
  // Two starches.
  assert.deepEqual(starchesIn(["russet potatoes", "jasmine rice", "rice vinegar", "bread crumbs", "spinach"]), ["potato", "rice"]);
  assert.deepEqual(j({ ingredients: [...BASE.ingredients, g("russet potatoes", 150)] }), { level: "relaxed", reasons: ["starches"], builtOn: "salmon" });
  assert.equal(j({ ingredients: [...BASE.ingredients, g("russet potatoes", 150)], wants: "salmon with rice and potatoes" }).level, "pass");
});

// Live run 5, 2026-11-22: a name rebuilt from the ingredients lost the potatoes and the oven, and a repeat got through.
test("the candidate is judged by what it is built on and the starch in it, and a rebuilt name keeps the way of cooking", () => {
  const beefPotato = [g("ground beef", 150), g("russet potatoes", 200), g("spinach", 60)];
  const home = homeProteins(splitKeptFoods([{ name: "Ground beef", groupKey: "proteins", atHome: true, favorite: false }]));
  // The rebuilt name says neither "potato" nor "bake"; the ingredients and the kept word do.
  const v = j({ name: "Ground Beef with Eggs and Spinach Bake", ingredients: beefPotato, home, notLike: ["Baked Ground Beef and Spinach Stuffed Potato"] });
  assert.deepEqual(v.reasons, ["repeat"]);
  assert.equal(j({ name: "Ground Beef with Eggs and Spinach Bake", ingredients: beefPotato, home, notLike: ["Ground Beef and Spinach Skillet with Jasmine Rice"] }).level, "pass");
  assert.equal(keepWayOfCooking("Ground Beef and Spinach Sheet-Pan Roast with Russet Potatoes", "Ground Beef with Russet Potatoes and Spinach"), "Ground Beef with Russet Potatoes and Spinach Roast");
  assert.equal(keepWayOfCooking("Cumin Spiced Ground Beef and Spinach Quinoa Bake", "Ground Beef with Eggs and Spinach"), "Ground Beef with Eggs and Spinach Bake");
  assert.equal(keepWayOfCooking("Salmon and Lentil Soup", "Salmon with Carrots and Spinach"), "Salmon with Carrots and Spinach Soup");
  // Unchanged names, pan dishes and names that already say it are left alone.
  assert.equal(keepWayOfCooking("Beef Rice Bowl", "Beef Rice Bowl"), "Beef Rice Bowl");
  assert.equal(keepWayOfCooking("Beef and Pepper Stir-Fry", "Ground Beef with Jasmine Rice"), "Ground Beef with Jasmine Rice");
  assert.equal(keepWayOfCooking("Beef and Pea Stew", "Beef and Potato Stew"), "Beef and Potato Stew");
});

test("a rebuilt name keeps 'Salad' always and 'Wrap' only with the bread in the dish; a congee is a pot dish", () => {
  assert.equal(keepWayOfCooking("Salmon and Spinach Wrap with Lemon Yogurt Sauce", "Salmon with Spinach and Whole-wheat Tortilla", ["salmon fillets", "spinach", "whole-wheat tortilla"]), "Salmon with Spinach and Whole-wheat Tortilla Wrap");
  assert.equal(keepWayOfCooking("Salmon and Spinach Wrap with Lemon Yogurt Sauce", "Salmon with Spinach and Jasmine Rice", ["salmon fillets", "spinach", "jasmine rice"]), "Salmon with Spinach and Jasmine Rice");
  assert.equal(keepWayOfCooking("Warm Salmon and Pea Salad", "Salmon with Spinach and Jasmine Rice"), "Salmon with Spinach and Jasmine Rice Salad");
  assert.equal(dishShape("Salmon and Spinach Jasmine Rice Congee").way, "wet");
});

// Live swap run 2, 2026-11-22: beef for salmon in a potato skillet came back as a seared fillet on rice.
test("an exchange must still be the dish: two thirds of its other foods, and its size", () => {
  // As the product calls it for an exchange: sized against the original, not the meal.
  const j = (over: Partial<JudgeInput> = {}) => judgeDish({ ...BASE, targetCalories: null, ...over });
  const mustKeep = { names: ["jasmine rice", "spinach", "olive oil"], calories: 600, band: { min: 0.8, max: 1.25 } };
  assert.equal(j({ mustKeep, wants: "salmon fillets" }).level, "pass");
  // One of three dropped is still two thirds.
  assert.equal(j({ mustKeep, wants: "salmon fillets", ingredients: BASE.ingredients.filter((i) => i.name !== "spinach") }).level, "pass");
  const other = j({ mustKeep, wants: "salmon fillets", ingredients: [g("salmon fillet", 150), g("russet potatoes", 200)] });
  assert.deepEqual([other.level, other.reasons], ["fail", ["exchange:another-dish"]]);
  assert.deepEqual(j({ mustKeep, wants: "salmon fillets", calories: 400 }).reasons, ["exchange:size"]);
  assert.deepEqual(j({ mustKeep, wants: "salmon fillets", calories: 760 }).reasons, ["exchange:size"]);
  assert.equal(j({ mustKeep, wants: "salmon fillets", calories: 490 }).level, "pass");
});

// Live run 4, 2026-11-22: an egg on four beef dishes in six.
test("one protein to a main: meat with eggs, or two meats, is only served when nothing else passes", () => {
  const withEgg = [...BASE.ingredients, g("eggs", 1, "")];
  assert.deepEqual(j({ ingredients: withEgg }), { level: "relaxed", reasons: ["proteins"], builtOn: "salmon" });
  assert.deepEqual(j({ ingredients: [...BASE.ingredients, g("ground beef", 60)], home: homeProteins(splitKeptFoods([{ name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false }, { name: "Ground beef", groupKey: "proteins", atHome: true, favorite: false }])) }).reasons, ["proteins"]);
  // Eggs alone, meat with beans, a breakfast, and a request are not judged on it.
  assert.equal(j({ ingredients: [g("eggs", 3, ""), g("spinach", 60)], name: "Spinach Omelette", home: homeProteins(splitKeptFoods([{ name: "Large eggs", groupKey: "dairy", atHome: true, favorite: false }])) }).reasons.includes("proteins"), false);
  assert.equal(j({ ingredients: withEgg, mealType: "breakfast" }).reasons.includes("proteins"), false);
  assert.equal(j({ ingredients: withEgg, wants: "salmon with a fried egg" }).level, "pass");
  // A lunch asked to go without: any meat, fish or egg in it.
  assert.deepEqual(j({ mealType: "lunch", skipProtein: true, targetCalories: null }).reasons, ["proteins"]);
  assert.equal(j({ mealType: "lunch", skipProtein: true, targetCalories: null, name: "Spinach Rice", ingredients: [g("spinach", 120), g("jasmine rice", 60)] }).level, "pass");
});
