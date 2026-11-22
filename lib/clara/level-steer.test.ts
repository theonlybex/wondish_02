import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import type { MealType } from "@/lib/local-date";
import { FIBRE_RICH_EXAMPLES } from "@/lib/dish-reasons";
import { steerLevels, steerLines, levelCeilings, RICH_FOODS, type SteerRow, type TodayTotals, type LevelSteer } from "./level-steer";

const NONE = { little: [], aLot: [], source: "week" as const };
const TODAY: TodayTotals = { meals: 2, calories: 900, protein: 60, carbs: 100, fibre: 14, sodium: 900, saturatedFat: 8, addedSugar: 10 };
const wk = (key: string, word: SteerRow["word"], amount: number, target: number): SteerRow =>
  ({ key: key as FullLevelKey, name: key, direction: "enough", target, amount, word });
const steer = (over: object = {}) => steerLevels({ mealType: "dinner", claims: NONE, week: [], picture: null, today: null, sodiumLimitMg: 2300, ...over }).map((x) => `${x.key}:${x.direction}:${x.why}`);

test("nothing known: no steer; the tool's own claims keep working with no week rows", () => {
  assert.deepEqual(steer(), []);
  assert.deepEqual(steer({ claims: { little: ["fibre"], aLot: ["sodium"], source: "week" } }), ["fibre:more:week", "sodium:less:week"]);
  assert.deepEqual(steer({ claims: { little: ["fibre"], aLot: [], source: "answers" } }), ["fibre:more:answers"]);
});
test("this week: little → more, a lot → less, on track → nothing; the further out of line comes first", () => {
  const week = [wk("protein", "on track", 95, 100), wk("fibre", "little", 10, 28), wk("saturatedFat", "a lot", 26, 20), wk("addedSugar", "within limit", 30, 50)];
  assert.deepEqual(steer({ week }), ["fibre:more:week", "saturatedFat:less:week"]); // 1.64 before 1.30
});
test("limits are paced by the week, not the day: today's totals never mark a limit as used up", () => {
  assert.deepEqual(steer({ today: { ...TODAY, sodium: 2000 } }), []);
  assert.deepEqual(steer({ today: { ...TODAY, saturatedFat: 17, addedSugar: 45 } }), []);
  assert.deepEqual(steer({ today: { ...TODAY, sodium: 2000 }, week: [wk("sodium", "a lot", 2600, 2300)] }), ["sodium:less:week"]);
});
test("so far today: far behind for the meal asked for is favoured; never at breakfast, never with nothing logged", () => {
  const week = [wk("protein", "on track", 95, 100)];
  assert.deepEqual(steer({ week, today: { ...TODAY, protein: 20 } }), ["protein:more:today"]); // 20 < half of 55
  assert.deepEqual(steer({ week, today: { ...TODAY, protein: 30 } }), []);
  assert.deepEqual(steer({ week, today: { ...TODAY, protein: 5 }, mealType: "lunch" }), ["protein:more:today"]); // 5 < half of 20
  assert.deepEqual(steer({ week, today: { ...TODAY, protein: 0 }, mealType: "breakfast" }), []);
  assert.deepEqual(steer({ week, today: { ...TODAY, meals: 0, protein: 0, fibre: 0 } }), []);
});
test("answers steer the levels the logs cannot measure, after anything measured; at most four", () => {
  const picture = { little: ["iron", "potassium", "fibre", "notALevel"], aLot: ["saturatedFat"] };
  assert.deepEqual(steer({ picture, week: [wk("fibre", "little", 10, 28)] }), ["fibre:more:week", "saturatedFat:less:answers", "potassium:more:answers", "iron:more:answers"]);
  const five = { little: ["iron", "potassium", "calcium", "zinc", "folate"], aLot: [] };
  const s = steer({ picture: five, week: [wk("sodium", "a lot", 5000, 2300), wk("fibre", "little", 5, 28)] });
  assert.equal(s.length, 4);
  assert.deepEqual(s.slice(0, 2), ["sodium:less:week", "fibre:more:week"]);
});
test("levelCeilings: every limit gets the meal's share, paced by how the week is going", () => {
  const near = (x: number | undefined, y: number) => assert.ok(x !== undefined && Math.abs(x - y) < 1e-6, `${x} vs ${y}`);
  const c = (mealType: MealType, weekSodium: number | null, sodiumLimitMg = 2300) =>
    levelCeilings({ mealType, sodiumLimitMg, week: weekSodium === null ? [] : [wk("sodium", weekSodium > sodiumLimitMg ? "a lot" : "within limit", weekSodium, sodiumLimitMg)] }).sodium;
  near(c("dinner", null), 1035);      // nothing logged: one and a half shares
  near(c("dinner", 1500), 1380);      // well under this week: two shares
  near(c("dinner", 2100), 1035);      // near the limit
  near(c("dinner", 2600), 690);       // over this week: the plain share
  near(c("snack", 2600), 350);        // never under the "low sodium" figure
  near(c("dinner", 1600, 1500), 450);
  // Not enough logs for a word: unknown, not "well under".
  near(levelCeilings({ mealType: "dinner", sodiumLimitMg: 2300, week: [wk("sodium", null, 900, 2300)] }).sodium, 1035);
  const all = levelCeilings({ mealType: "dinner", sodiumLimitMg: 2300, week: [wk("saturatedFat", "a lot", 26, 20)] });
  near(all.saturatedFat, 6); near(all.addedSugar, 22.5); near(all.iron, 20.25); near(all.calcium, 1125); near(all.folate, 450);
  assert.deepEqual([all.potassium, all.fibre, all.protein, all.phosphorus], [undefined, undefined, undefined, undefined]);
  near(levelCeilings({ mealType: "lunch", sodiumLimitMg: 2300, week: [wk("phosphorus", "within limit", 1200, 1250)] }).phosphorus, 1250 * 0.35 * 1.5);
});
// Owner, 2026-11-22: every nutrient on the Numbers list reaches Clara, boosted or controlled.
test("every level on the Numbers list is steered: 'enough' ones boosted when little, 'under' ones controlled when over", () => {
  for (const l of LEVELS) {
    if (l.direction !== "under") {
      const s = steerLevels({ mealType: "dinner", claims: NONE, week: [wk(l.key, "little", l.target * 0.3, l.target)], picture: null, today: null, sodiumLimitMg: 2300 });
      assert.deepEqual(s.map((x) => `${x.key}:${x.direction}`), [`${l.key}:more`], l.key);
      assert.equal(steerLines(s).length, 1, l.key);
      assert.match(steerLines(s)[0], /build (the|every) dish/, l.key);
    }
    if (l.direction !== "enough" || l.upperLimit !== null) {
      const word = l.direction === "enough" ? "more than needed" : "a lot";
      const s = steerLevels({ mealType: "dinner", claims: NONE, week: [wk(l.key, word, l.target * 1.6, l.target)], picture: null, today: null, sodiumLimitMg: 2300 });
      assert.deepEqual(s.map((x) => `${x.key}:${x.direction}`), [`${l.key}:less`], l.key);
      assert.match(steerLines(s)[0], /keep (it low|every serving)/, l.key);
    }
    // And from the first-run answers, when the logs cannot count it.
    const fromAnswers = steerLevels({ mealType: "dinner", claims: NONE, week: [], picture: l.direction === "under" ? { little: [], aLot: [l.key] } : { little: [l.key], aLot: [] }, today: null, sodiumLimitMg: 2300 });
    assert.equal(fromAnswers.length, 1, l.key);
    assert.equal(fromAnswers[0].direction, l.direction === "under" ? "less" : "more", l.key);
    assert.ok(RICH_FOODS[l.key].length > 0, l.key);
  }
});
test("steerLines: today's two sentences unchanged, and no number for a level the database cannot count", () => {
  const line = (key: string, direction: "more" | "less", why: LevelSteer["why"]) => steerLines([{ key: key as FullLevelKey, name: key === "saturatedFat" ? "saturated fat" : key, direction, why, score: 1 }])[0];
  assert.equal(line("fibre", "more", "week"), `- They have had little fibre this week: build every dish around a fibre-rich ingredient (${FIBRE_RICH_EXAMPLES}).`);
  assert.equal(line("sodium", "less", "answers"), "- From their answers they probably get a lot of sodium: keep every serving at or under 350 mg of sodium — no soy sauce, stock cubes, bouillon, cured meats, salted cheese or pickles, and little or no added salt.");
  assert.match(line("sodium", "less", "today"), /^- Today's meals have already used most of the day's sodium: keep this serving at or under 350 mg/);
  assert.equal(line("iron", "more", "answers"), "- From their answers they probably get little iron: build the dish on foods rich in it (lentils, beans, chickpeas, spinach, beef, tofu).");
  assert.equal(line("potassium", "more", "week"), `- They have had little potassium this week: build the dish on foods rich in it (${RICH_FOODS.potassium}).`);
  assert.equal(line("saturatedFat", "less", "today"), `- Today's meals have already used most of the day's saturated fat: keep it low in this dish; go easy on ${RICH_FOODS.saturatedFat}.`);
  assert.match(line("protein", "more", "today"), /^- So far today they are well behind on protein: /);
  for (const l of LEVELS) if (l.key !== "sodium" && l.key !== "fibre") for (const d of ["more", "less"] as const) assert.doesNotMatch(line(l.key, d, "week").split(l.key).join(""), /\d/, l.key); // the name itself (omega3, vitamin B12) may carry a digit
  assert.deepEqual(Object.keys(RICH_FOODS).sort(), LEVELS.map((l) => l.key).sort());
});
test("steerLines options: at-home examples are preferred, a dropped example never shows, fibre can be added rather than built on", () => {
  const lv = (key: string, why: LevelSteer["why"] = "week"): LevelSteer => ({ key: key as FullLevelKey, name: key, direction: "more", why, score: 1 });
  // Empty options: today's wording.
  assert.deepEqual(steerLines([lv("iron"), lv("fibre")], {}), steerLines([lv("iron"), lv("fibre")]));
  const noBeef = (f: string) => f !== "beef";
  // No example at home: the plain form, never "preferring any they have at home".
  assert.deepEqual(steerLines([lv("iron")], { atHome: ["Ground beef"], keepExample: noBeef }), [
    "- They have had little iron this week: include one food rich in it (lentils, beans, chickpeas, spinach, tofu); one is enough.",
  ]);
  // No example survives: the line without a list.
  assert.deepEqual(steerLines([lv("iron")], { keepExample: () => false }), ["- They have had little iron this week: build the dish on foods rich in it."]);
  assert.deepEqual(steerLines([lv("iron")], { atHome: ["Black beans", "Spinach"] }), [
    "- They have had little iron this week: include one food rich in it, preferring any they have at home (beans, spinach).",
  ]);
  assert.equal(steerLines([lv("fibre", "answers")], { fibreAdded: true })[0], `- From their answers they probably get little fibre: include a fibre-rich ingredient in every dish (${FIBRE_RICH_EXAMPLES}).`);
  // "Less" lines are untouched by the options.
  const less: LevelSteer = { key: "saturatedFat" as FullLevelKey, name: "saturated fat", direction: "less", why: "week", score: 1 };
  assert.deepEqual(steerLines([less], { atHome: ["Unsalted butter"], keepExample: () => false }), steerLines([less]));
});

test("exampleAllergenGroups: every example food that carries a big-nine allergen", async () => {
  const { exampleAllergenGroups, RICH_FOODS } = await import("./level-steer");
  const of = (f: string) => exampleAllergenGroups(f).sort();
  assert.deepEqual(of("salmon"), ["BIG9-FISH"]);
  assert.deepEqual(of("white fish"), ["BIG9-FISH"]);
  assert.deepEqual(of("shrimp"), ["BIG9-CRUSTACEAN"]);
  assert.deepEqual(of("Greek yogurt"), ["BIG9-COW-MILK"]);
  assert.deepEqual(of("processed cheese"), ["BIG9-COW-MILK"]);
  assert.deepEqual(of("coconut milk"), []);
  assert.deepEqual(of("soy sauce"), ["BIG9-SOY", "BIG9-WHEAT"]);
  assert.deepEqual(of("whole-wheat bread or pasta"), ["BIG9-WHEAT"]);
  assert.deepEqual(of("walnuts"), ["BIG9-TREE-NUT"]);
  assert.deepEqual(of("eggs"), ["BIG9-EGG"]);
  for (const f of ["spinach", "lentils", "oats", "beef", "chia or flax seeds", "pumpkin seeds"]) assert.deepEqual(of(f), []);
  // Every list still splits into single foods the table can read.
  for (const list of Object.values(RICH_FOODS)) for (const f of list.split(", ")) assert.ok(Array.isArray(exampleAllergenGroups(f)));
});
