import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISH_RULES } from "./dish-rules";
import type { MealType } from "@/lib/local-date";
import { mealTarget, sizeProblem, proteinShareLow, targetLines, MAIN_PROTEIN_LINE } from "./meal-target";

const t = (mealType: MealType, over: object = {}) => mealTarget({ mealType, dayCalories: 2000, conditionNames: [], motivationNames: [], rules: DEFAULT_DISH_RULES, ...over });
test("20 / 35 / 30 / 15 % of the day, and the band for mains only", () => {
  assert.deepEqual((["breakfast", "lunch", "dinner", "snack"] as const).map((m) => t(m).calories), [400, 700, 600, 300]);
  assert.deepEqual([t("lunch").band, t("dinner").band, t("breakfast").band, t("snack").band], [{ min: 385, max: 875 }, { min: 330, max: 750 }, null, null]);
});
test("no calorie target, or the switch off: no size at all (Review Focus 3)", () => {
  for (const x of [t("dinner", { dayCalories: null }), t("dinner", { rules: { ...DEFAULT_DISH_RULES, sizeToCalories: false } })]) {
    assert.deepEqual([x.calories, x.band], [null, null]);
    assert.ok(!targetLines(x, "dinner", true).some((l) => /kcal|NaN|null/.test(l)));
  }
  assert.equal(sizeProblem("dinner", 2000, null), null);
});
test("macro split by profile, and motivation leanings", () => {
  assert.deepEqual(t("dinner").split, { protein: 0.30, carbs: 0.45, fat: 0.25 });
  assert.deepEqual(t("dinner", { conditionNames: ["Type 2 Diabetes"] }).split, { protein: 0.35, carbs: 0.45, fat: 0.20 });
  assert.deepEqual(t("dinner", { motivationNames: ["Build muscle"] }).split, { protein: 0.30, carbs: 0.40, fat: 0.30 });
  assert.equal(t("dinner", { rules: { ...DEFAULT_DISH_RULES, followMacroSplit: false } }).split, null);
  const lean = (...motivationNames: string[]) => t("dinner", { motivationNames }).leanings;
  assert.deepEqual([lean(), lean("Build muscle"), lean("More energy"), lean("Eat healthier")], [[], ["protein"], ["fibre"], ["fibre", "less fat"]]);
  assert.deepEqual(lean("Eat healthier", "More energy", "Build muscle"), ["protein", "fibre", "less fat"]);
});
test("sizeProblem and proteinShareLow: the edges", () => {
  assert.deepEqual([329, 330, 750, 751].map((kcal) => sizeProblem("dinner", kcal, 600)), ["too-small", null, null, "too-large"]);
  assert.deepEqual([sizeProblem("lunch", 385, 700), sizeProblem("breakfast", 900, 400), sizeProblem("snack", 20, 300)], [null, null, null]);
  assert.equal(proteinShareLow("dinner", 600, 22), true);
  assert.equal(proteinShareLow("lunch", 600, 22.5), false);
  assert.deepEqual([proteinShareLow("snack", 200, 1), proteinShareLow("dinner", 0, 0)], [false, false]);
});
test("targetLines: exact wording", () => {
  assert.deepEqual(targetLines(t("dinner", { motivationNames: ["Eat healthier"] }), "dinner", true), [
    "- Size: this Dinner should be about 600 kcal per serving (their day is 2000 kcal); choose the portions to land there. It must be between 330 and 750 kcal.",
    "- Macro split to aim for, by calories: ~30% protein, ~45% carbs, ~25% fat.",
    MAIN_PROTEIN_LINE,
    "- Their goal: lean towards fibre, less fat.",
  ]);
  assert.deepEqual(targetLines(t("breakfast"), "breakfast", true), [
    "- Size: this Breakfast should be about 400 kcal per serving (their day is 2000 kcal); choose the portions to land there.",
    "- Macro split to aim for, by calories: ~30% protein, ~45% carbs, ~25% fat.",
  ]);
  assert.ok(!targetLines(t("dinner"), "dinner", false).includes(MAIN_PROTEIN_LINE));
});
