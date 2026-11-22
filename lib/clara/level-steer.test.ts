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
test("so far today: a level nearly used up is kept low, and comes first", () => {
  assert.deepEqual(steer({ today: { ...TODAY, sodium: 2000 } }), ["sodium:less:today"]);
  assert.deepEqual(steer({ today: { ...TODAY, sodium: 1800 } }), []); // 78% of 2300
  assert.deepEqual(steer({ today: { ...TODAY, sodium: 1300 }, sodiumLimitMg: 1500 }), ["sodium:less:today"]);
  assert.deepEqual(steer({ today: { ...TODAY, saturatedFat: 17, addedSugar: 45 } }), ["addedSugar:less:today", "saturatedFat:less:today"]);
  assert.deepEqual(steer({ today: { ...TODAY, sodium: null, saturatedFat: null, addedSugar: null } }), []); // unknown is not "used up"
  assert.equal(steer({ today: { ...TODAY, sodium: 2000 }, week: [wk("fibre", "little", 10, 28)] })[0], "sodium:less:today");
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
  const s = steer({ picture: five, today: { ...TODAY, sodium: 2200 }, week: [wk("fibre", "little", 5, 28)] });
  assert.equal(s.length, 4);
  assert.deepEqual(s.slice(0, 2), ["sodium:less:today", "fibre:more:week"]);
});
test("levelCeilings: sodium is held to what is left, never below the meal's share; unknown is the day's limit (Review Focus 4)", () => {
  const c = (mealType: MealType, sodium: number | null, sodiumLimitMg = 2300) => levelCeilings({ mealType, sodiumLimitMg, today: { ...TODAY, sodium } }).sodium;
  assert.deepEqual([c("dinner", 1000), c("dinner", 2000), c("dinner", 2600), c("snack", 2600), c("dinner", 1600, 1500), c("dinner", null)], [1300, 690, 690, 345, 450, 2300]);
  const all = levelCeilings({ mealType: "dinner", sodiumLimitMg: 2300, today: null });
  assert.deepEqual([all.sodium, all.iron, all.calcium, all.vitaminA, all.folate, all.potassium, all.fibre], [2300, 45, 2500, 3000, 1000, undefined, undefined]);
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
    "- They have had little iron this week: build the dish on foods rich in it (lentils, beans, chickpeas, spinach, tofu).",
  ]);
  // No example survives: the line without a list.
  assert.deepEqual(steerLines([lv("iron")], { keepExample: () => false }), ["- They have had little iron this week: build the dish on foods rich in it."]);
  assert.deepEqual(steerLines([lv("iron")], { atHome: ["Black beans", "Spinach"] }), [
    "- They have had little iron this week: build the dish on foods rich in it, preferring any they have at home (beans, spinach).",
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
