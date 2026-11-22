import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISH_RULES, dishRulesFrom, keptUnderRules } from "./dish-rules";

test("all eight switches are on by default, and the default is frozen", () => {
  assert.deepEqual(DEFAULT_DISH_RULES, { cookFromHome: true, onlyHomeProteins: true, mainsOnProtein: true, sameProteinToday: true, sizeToCalories: true, followMacroSplit: true, steerByLevels: true, favourFavourites: true });
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
