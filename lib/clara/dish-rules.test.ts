import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISH_RULES, dishRulesFrom, keptUnderRules } from "./dish-rules";

test("all ten switches are on by default, and the default is frozen", () => {
  assert.deepEqual(DEFAULT_DISH_RULES, { cookFromHome: true, onlyHomeProteins: true, mainsOnProtein: true, sameProteinToday: true, sizeToCalories: true, followMacroSplit: true, steerByLevels: true, favourFavourites: true, keepWeekVaried: true, proteinFreeLunches: true });
  assert.ok(Object.isFrozen(DEFAULT_DISH_RULES));
});
test("dishRulesFrom keeps the default for anything that is not a boolean under a known key", () => {
  for (const raw of [undefined, null, "off", []]) assert.deepEqual(dishRulesFrom(raw), DEFAULT_DISH_RULES);
  assert.deepEqual(dishRulesFrom({ sizeToCalories: false, steerByLevels: "no", allergies: false }), { ...DEFAULT_DISH_RULES, sizeToCalories: false });
});
test("keptUnderRules", () => {
  const kept = { proteinKeys: ["salmon"], proteinNames: ["Salmon fillets"], atHome: ["Spinach"], favorites: ["Spinach"] };
  assert.deepEqual(keptUnderRules(kept, DEFAULT_DISH_RULES), kept);
  assert.deepEqual(keptUnderRules(kept, { ...DEFAULT_DISH_RULES, cookFromHome: false }), { proteinKeys: [], proteinNames: [], atHome: [], favorites: ["Spinach"] });
  assert.deepEqual(keptUnderRules(kept, { ...DEFAULT_DISH_RULES, favourFavourites: false }).favorites, []);
});

// Piece D (2026-11-22): the person's own rules and the stored value.
import { cleanRuleText, userRulesFrom, storedRulesFrom, ruleFood, ruleFoodMatches, DISH_RULE_COPY, DISH_RULE_KEYS, MAX_USER_RULES } from "./dish-rules";

test("stored rules: switches and the person's own rules, anything malformed is the default", () => {
  assert.deepEqual(storedRulesFrom(null), { switches: { ...DEFAULT_DISH_RULES }, mine: [] });
  const s = storedRulesFrom({ switches: { keepWeekVaried: false, nonsense: false, sizeToCalories: "no" }, mine: [
    { id: "r1", text: "  No   mushrooms ", on: true }, { id: "r2", text: "No cooking over 30 minutes on weekdays", on: false },
    { id: "r1", text: "a duplicate id" }, { id: "bad id!", text: "x" }, { id: "r3", text: "" }, { id: "r4", text: "x".repeat(121) }, "nope",
  ] });
  assert.equal(s.switches.keepWeekVaried, false);
  assert.equal(s.switches.sizeToCalories, true);
  assert.deepEqual(s.mine, [{ id: "r1", text: "No mushrooms", on: true }, { id: "r2", text: "No cooking over 30 minutes on weekdays", on: false }]);
  assert.equal(userRulesFrom(Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, text: `rule ${i}` }))).length, MAX_USER_RULES);
  assert.equal(cleanRuleText('say "hi"\nthen stop'), "say hi then stop");
  assert.equal(cleanRuleText(12), null);
  // Every switch has its words for the app.
  for (const k of DISH_RULE_KEYS) assert.ok(DISH_RULE_COPY[k].title.length > 0 && DISH_RULE_COPY[k].detail.length > 0, k);
  assert.equal(DISH_RULE_KEYS.length, Object.keys(DEFAULT_DISH_RULES).length);
});

test("ruleFood: a rule that is just 'no such food' names it; anything else is an instruction only", () => {
  const yes: [string, string][] = [
    ["No mushrooms", "mushrooms"], ["never put cilantro in my dishes", "cilantro"], ["Don't use pork.", "pork"],
    ["without bell peppers", "bell peppers"], ["I hate feta cheese", "feta cheese"], ["no any spinach", "spinach"],
    ["No cilantro please", "cilantro"], ["no mushrooms, ever", "mushrooms"], ["avoid mushrooms", "mushrooms"], ["skip the rice", "rice"],
    ["Never put spinach in my dishes", "spinach"], ["no sweet potatoes", "sweet potatoes"], ["no olive oil", "olive oil"], ["I can't stand olives", "olives"],
  ];
  for (const [text, food] of yes) assert.equal(ruleFood(text), food, text);
  // Not held in code: a sentence, a list, a kind of food, an essential, a time, an allergy, a word that is no catalog food.
  for (const text of [
    "No cooking over 30 minutes on weekdays", "Vegetarian on Fridays", "No spicy dishes", "never more than 2 pans", "Keep dinners light", "no fried food after 8",
    "no onions or garlic", "no pork and beef", "no red meat", "no dairy", "no nuts", "no fish", "no meat", "no seafood", "no carbs", "no gluten",
    "no oil", "no salt", "no extra salt", "less salt", "no water", "no black pepper",
    "no salmon this week", "no peanuts (allergy)", "I'm allergic to peanuts", "no leftovers", "no microwave", "no desserts", "no lamb",
  ]) assert.equal(ruleFood(text), null, text);
});

test("ruleFoodMatches: the ingredient is that food, not a food made from it or one that shares a word", () => {
  const hit: [string, string][] = [["mushrooms", "cremini mushrooms"], ["rice", "jasmine rice"], ["spinach", "Baby spinach"], ["sweet potatoes", "sweet potato"], ["eggs", "large eggs"], ["olive oil", "extra virgin olive oil"], ["bell peppers", "red bell pepper"]];
  for (const [food, ing] of hit) assert.equal(ruleFoodMatches(food, ing), true, `${food} / ${ing}`);
  const miss: [string, string][] = [["rice", "rice vinegar"], ["rice", "rice noodles"], ["eggs", "egg noodles"], ["sweet potatoes", "russet potatoes"], ["tomatoes", "tomato paste"], ["mushrooms", "mushroom broth"], ["spinach", "kale"], ["bell peppers", "black pepper"], ["olives", "olive oil"], ["olives", "extra virgin olive oil"]];
  assert.equal(ruleFoodMatches("olives", "kalamata olives"), true);
  for (const [food, ing] of miss) assert.equal(ruleFoodMatches(food, ing), false, `${food} / ${ing}`);
});
