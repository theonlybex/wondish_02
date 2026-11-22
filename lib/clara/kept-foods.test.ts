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
  visibleRows,
} from "./kept-foods";
import { INGREDIENT_CATALOG, catalogItemNames } from "../ingredient-catalog";
import { buildDietMatchers, derivePatientBans } from "../diet-match";

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

test("proteinKey: generic words and more named meats and fish", () => {
  assert.equal(proteinKey("white fish fillets"), "fish");
  assert.equal(proteinKey("ground meat"), "ground meat");
  assert.equal(proteinKey("mixed seafood"), "seafood");
  assert.equal(proteinKey("meatballs"), "meat");
  assert.equal(proteinKey("fish sauce"), null);
  assert.equal(proteinKey("hamburger buns"), null);
  const named: [string, string][] = [
    ["codfish", "cod"], ["hot dogs", "hot dog"], ["pancetta", "pancetta"],
    ["bratwurst", "bratwurst"], ["kielbasa", "kielbasa"], ["pork ribs", "pork"], ["short ribs", "ribs"],
    ["rabbit", "rabbit"], ["goose", "goose"], ["quail", "quail"], ["crayfish", "crayfish"],
    ["grouper", "grouper"], ["monkfish", "monkfish"], ["oxtail", "oxtail"],
  ];
  for (const [n, k] of named) assert.equal(proteinKey(n), k, n);
});

test("generic meat or fish breaks the rule unless marked that exact way", () => {
  const kept = splitKeptFoods([{ name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false }]);
  for (const n of ["white fish fillets", "ground meat", "mixed seafood", "meatballs", "pancetta", "hot dogs"])
    assert.equal(breaksProteinRule([n], kept), true, n);
  assert.equal(breaksProteinRule(["salmon"], kept), false);
});

// ── visibleRows: catalog x marks, minus what the profile bans ───────────────
const emptyProfile = { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] };
const idsFor = () => new Map(catalogItemNames().map((n, i) => [n, `id-${i}`]));

test("the catalog's Proteins group holds Ground chicken", () => {
  assert.ok(INGREDIENT_CATALOG.find((c) => c.key === "proteins")!.items.includes("Ground chicken"));
});

test("visibleRows with no bans keeps catalog order and sets marks from the id sets", () => {
  const idByName = idsFor();
  const rows = visibleRows({
    idByName,
    groupsById: new Map(),
    matchers: buildDietMatchers(derivePatientBans(emptyProfile)),
    atHomeIds: new Set([idByName.get("Ground beef")!]),
    likedIds: new Set([idByName.get("Bacon")!]),
  });
  assert.equal(rows[0].groupKey, "proteins");
  assert.deepEqual(rows.map((r) => r.name), catalogItemNames());
  assert.equal(rows.find((r) => r.name === "Ground beef")!.atHome, true);
  assert.equal(rows.find((r) => r.name === "Ground beef")!.favorite, false);
  assert.equal(rows.find((r) => r.name === "Bacon")!.favorite, true);
});

test("visibleRows drops a banned food, so an at-home salmon cannot set the protein rule", () => {
  const idByName = idsFor();
  const matchers = buildDietMatchers(derivePatientBans({
    ...emptyProfile,
    foodAllergies: [{ food: { name: "Fish", bannedIngredients: ["salmon", "tuna", "tilapia", "catfish", "shrimp"].map((name) => ({ name })) } }],
  }));
  const rows = visibleRows({
    idByName,
    groupsById: new Map(),
    matchers,
    atHomeIds: new Set([idByName.get("Salmon fillets")!, idByName.get("Ground beef")!]),
    likedIds: new Set(),
  });
  assert.ok(!rows.some((r) => r.name === "Salmon fillets"));
  const kept = splitKeptFoods(rows);
  assert.ok(!kept.proteinKeys.includes("salmon"));
  assert.ok(kept.proteinKeys.includes("ground beef"));
});

test("proteinKey: dairy, eggs, plants and bread named after an animal are not meat", () => {
  for (const n of [
    "goat cheese", "goat milk", "duck eggs", "quail eggs", "chicken eggs", "celery ribs", "celery rib",
    "oyster mushrooms", "crab apples", "lamb's lettuce", "hamburger buns", "burger buns",
  ]) assert.equal(proteinKey(n), null, n);
  const kept = splitKeptFoods([{ name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false }]);
  for (const n of ["goat cheese", "duck eggs", "celery ribs", "oyster mushrooms", "lamb's lettuce"])
    assert.equal(breaksProteinRule([n], kept), false, n);
});

test("proteinKey: the context word must directly follow the animal, so combined names keep the meat", () => {
  assert.equal(proteinKey("bacon and eggs"), "bacon");
  assert.equal(proteinKey("bacon egg sandwich"), "bacon");
  assert.equal(proteinKey("chicken and egg fried rice"), "chicken");
  assert.equal(proteinKey("cream of chicken soup"), "chicken");
  assert.equal(proteinKey("butter chicken"), "chicken");
  assert.equal(proteinKey("goat cheese and salmon"), "salmon");
  assert.equal(proteinKey("pork ribs"), "pork");
});

test("proteinKey and requestNamesProtein: plant-based and imitation products are not the animal", () => {
  for (const n of ["meat-free burger", "meat free sausage", "meat substitute", "vegetarian meatballs", "vegan sausage", "imitation crab", "veggie burger", "mock duck", "faux bacon"])
    assert.equal(proteinKey(n), null, n);
  for (const w of ["meat-free lasagne", "something vegetarian", "a vegan burger", "plant-based chicken"])
    assert.equal(requestNamesProtein(w), false, w);
  assert.equal(requestNamesProtein("goat cheese salad"), false);
  assert.equal(requestNamesProtein("a hamburger"), true);
});

test("proteinKey: more meats and fish", () => {
  const more: [string, string][] = [
    ["hamburger", "beef"], ["pastrami", "pastrami"], ["frankfurters", "frankfurter"],
    ["gammon steak", "gammon"], ["lardons", "lardons"], ["hake fillet", "hake"], ["plaice", "plaice"],
    ["sea bream", "bream"], ["langoustines", "langoustine"], ["calf liver", "liver"], ["lox", "salmon"],
  ];
  for (const [n, k] of more) assert.equal(proteinKey(n), k, n);
});

test("visibleRows drops a food whose stored allergen group is banned even when its name passes", () => {
  const idByName = idsFor();
  const matchers = buildDietMatchers(derivePatientBans({ ...emptyProfile, foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [] } }] }));
  const beefId = idByName.get("Ground beef")!;
  const args = { idByName, matchers, atHomeIds: new Set<string>(), likedIds: new Set<string>() };
  const tagged = visibleRows({ ...args, groupsById: new Map([[beefId, ["BIG9-PEANUT"]]]) });
  assert.ok(!tagged.some((r) => r.name === "Ground beef"));
  assert.ok(tagged.some((r) => r.name === "Bacon"));
  const untagged = visibleRows({ ...args, groupsById: new Map([[beefId, ["BIG9-FISH"]]]) });
  assert.ok(untagged.some((r) => r.name === "Ground beef"));
});

test("a bare burger or patty is not a meat; an animal word or hamburger makes it one", () => {
  for (const n of ["bean burger", "black bean burger", "lentil burgers", "chickpea patties", "vegetable patty", "patty pan squash", "halloumi burger", "mushroom burger", "burger patty", "burger rolls", "hamburger buns"])
    assert.equal(proteinKey(n), null, n);
  const keyed: [string, string][] = [["beef burger", "beef"], ["turkey burgers", "turkey"], ["chicken patty", "chicken"], ["salmon burger", "salmon"], ["hamburger", "beef"]];
  for (const [n, k] of keyed) assert.equal(proteinKey(n), k, n);
  assert.equal(requestNamesProtein("a black bean burger"), false);
  assert.equal(requestNamesProtein("a beef burger"), true);
  const kept = splitKeptFoods([{ name: "Salmon fillets", groupKey: "proteins", atHome: true, favorite: false }]);
  assert.equal(breaksProteinRule(["black bean burger"], kept), false);
});
