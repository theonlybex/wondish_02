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
import { cleanRuleText, userRulesFrom, storedRulesFrom, ruleFood, DISH_RULE_COPY, DISH_RULE_KEYS, MAX_USER_RULES } from "./dish-rules";

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
    ["without bell peppers", "bell peppers"], ["I don't eat lamb", "lamb"], ["I hate blue cheese", "blue cheese"], ["no any olives", "olives"],
  ];
  for (const [text, food] of yes) assert.equal(ruleFood(text), food, text);
  for (const text of ["No cooking over 30 minutes on weekdays", "Vegetarian on Fridays", "No spicy dishes", "never more than 2 pans", "Keep dinners light", "no fried food after 8"]) {
    assert.equal(ruleFood(text), null, text);
  }
});
