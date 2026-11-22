import test from "node:test";
import assert from "node:assert/strict";
import { buildDietMatchers, derivePatientBans } from "@/lib/diet-match";
import { DEFAULT_DISH_RULES, type DishRules } from "./dish-rules";
import { NO_KEPT_FOODS, splitKeptFoods } from "./kept-foods";
import { brainFrom, steerForAsk, NO_BRAIN_ROWS } from "./dish-brain";

const row = (name: string, groupKey = "proteins", favorite = false) => ({ name, groupKey, atHome: true, favorite });
const KEPT = splitKeptFoods([row("Salmon fillets", "proteins", true), row("Ground beef"), row("Spinach", "produce")]);
const TARGET = { calories: 2000, protein: 150, carbs: 225, fat: 55.6, profile: "balanced" as const, basis: "steady-state" as const };
const DAY = { localDate: "2026-11-12", meals: 2, calories: 900, protein: 60, carbs: 100, fibre: 14, sodium: 2000, saturatedFat: 8, addedSugar: 10 };
const PATIENT = { sexAtBirth: "FEMALE", birthday: new Date("1988-03-14"), usualEating: null, missingStaples: [], healthConditions: [], motivations: [{ motivation: { name: "Eat healthier" } }] };
const peanut = buildDietMatchers(derivePatientBans({ foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [{ name: "peanut" }] } }], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] } as any));
const ASK = { mealType: "dinner" as const, summary: { little: [] as string[], aLot: [] as string[] } };
const WHO = { patientId: "p1", today: "2026-11-12" };
const BARE = brainFrom({ kept: NO_KEPT_FOODS });

test("a person with no reads: no target, no levels, no basics, every switch on", () => {
  assert.deepEqual([BARE.dayCalories, BARE.week, BARE.picture, BARE.today, BARE.basics, BARE.favourites, BARE.usedToday, BARE.home], [null, [], null, null, [], [], [], []]);
  assert.deepEqual([BARE.rules, BARE.sodiumLimitMg], [DEFAULT_DISH_RULES, 2300]);
  const s = steerForAsk(BARE, ASK, WHO);
  assert.deepEqual([s.ruleOn, s.choice, s.target.calories, s.levels, s.ceilings.sodium], [false, null, null, [], 1035]);
  assert.equal(s.need, "push");
  assert.deepEqual(s.target.split, { protein: 0.30, carbs: 0.45, fat: 0.25 });
});
test("the full brain", () => {
  const rows = { week: { range: { fromDate: "2026-11-06", toDate: "2026-11-12" }, days: [DAY] }, dayTarget: TARGET, pills: [], todayDishes: ["Beef and Rice Skillet"],
    liked: [{ name: "Halloumi", allergenGroups: [] }, { name: "Satay sauce", allergenGroups: ["BIG9-PEANUT"] }, { name: "salmon fillets", allergenGroups: [] }] };
  const b = brainFrom({ kept: KEPT, rows, today: "2026-11-12", patient: PATIENT, matchers: peanut, sodiumLimitMg: 2300 });
  assert.deepEqual([b.dayCalories, b.today?.sodium, b.week.length, b.motivationNames], [2000, 2000, 21, ["Eat healthier"]]);
  assert.deepEqual(b.favourites, ["Salmon fillets", "Halloumi"]);
  assert.ok(b.basics.includes("olive oil") && b.basics.includes("salt"));
  const s = steerForAsk(b, ASK, WHO);
  assert.deepEqual(s.choice, { key: "ground beef", name: "Ground beef", why: "today" });
  // One salty day is not a week: no "used up today" line, and the ceiling is the unknown-week one.
  assert.deepEqual([s.ruleOn, s.target.calories, s.target.leanings, s.levels.map((l) => l.key), s.ceilings.sodium], [true, 600, ["fibre", "less fat"], [], 1035]);
  // what this chat already showed counts as used today, after the log
  assert.equal(steerForAsk(b, { ...ASK, avoid: ["Lemon Salmon with Spinach"] }, WHO).choice?.key, "salmon");
  const named = steerForAsk(b, { ...ASK, wants: "a chicken dish" }, WHO);
  assert.deepEqual([named.ruleOn, named.choice], [false, null]);
});
test("the claims the tool already makes reach the steer even with no reads", () => {
  const keys = (ask: object) => steerForAsk(BARE, { ...ASK, ...ask }, WHO).levels.map((l) => `${l.key}:${l.why}`);
  assert.deepEqual(keys({ summary: { little: ["fibre"], aLot: ["sodium"] } }), ["fibre:week", "sodium:week"]);
  assert.deepEqual(keys({ picture: { little: ["fibre"], aLot: [] } }), ["fibre:answers"]);
});
test("switches", () => {
  const off = (k: keyof DishRules) => brainFrom({ kept: KEPT, rules: { ...DEFAULT_DISH_RULES, [k]: false }, rows: { ...NO_BRAIN_ROWS, dayTarget: TARGET } });
  assert.deepEqual(off("cookFromHome").home, []);
  assert.equal(steerForAsk(off("cookFromHome"), ASK, WHO).ruleOn, false);
  assert.equal(steerForAsk(off("onlyHomeProteins"), ASK, WHO).ruleOn, false);
  assert.deepEqual(off("favourFavourites").favourites, []);
  assert.equal(steerForAsk(off("sizeToCalories"), ASK, WHO).target.calories, null);
  const noLevels = steerForAsk(off("steerByLevels"), { ...ASK, summary: { little: ["fibre"], aLot: [] } }, WHO);
  assert.deepEqual([noLevels.levels, noLevels.ceilings.sodium], [[], 1035]);
  assert.equal(steerForAsk(off("mainsOnProtein"), ASK, WHO).need, "free");
});
test("a failed pills read means no picture, not a wrong one", () => {
  const picture = (pills: [] | null) => brainFrom({ kept: NO_KEPT_FOODS, rows: { ...NO_BRAIN_ROWS, pills }, today: "2026-11-12", patient: { ...PATIENT, usualEating: { veg: 0, fruit: 0 } } }).picture;
  assert.equal(picture(null), null);
  assert.ok(picture([])?.little.includes("vitaminC"));
});
