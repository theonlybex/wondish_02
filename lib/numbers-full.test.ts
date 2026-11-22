import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFullNumbers,
  convertUnit,
  roundAmount,
  validateGoalsBody,
  validateTrackedBody,
  rowsToMaterialize,
  type FullDay,
  type FullNumbersInput,
} from "./numbers-full";
import { fullDaysFromRows, levelDaysFromRows } from "./level-summary";
import { summarizeLevels } from "./levels";

const range = { fromDate: "2026-11-05", toDate: "2026-11-11" };
const person = { sexAtBirth: null, age: 30 } as const;
const day = (i: number, over: Partial<FullDay> = {}): FullDay => ({
  localDate: `2026-11-0${i}`, meals: 2, calories: 1800, protein: 60, carbs: 200, fibre: 15,
  sodium: 2000, saturatedFat: 10, addedSugar: 20, ...over,
});
const base = (over: Partial<FullNumbersInput> = {}): FullNumbersInput => ({
  days: [], range, macroTargets: null, person: { ...person }, conditionNames: [], pills: [],
  trackedRows: [], picture: null, weight: null, ...over,
});
const lv = (out: ReturnType<typeof buildFullNumbers>, key: string) => out.levels.find((l) => l.key === key)!;

test("zero days, no picture: source none, amounts null", () => {
  const out = buildFullNumbers(base());
  assert.equal(out.source, "none");
  assert.equal(out.startingPicture, null);
  assert.equal(out.summary.daysCounted, 0);
  assert.deepEqual(out.calories, { amount: null, target: null });
  for (const l of out.levels) assert.equal(l.amount, null);
  assert.equal(out.levels.length, 21);
});

test("pills only: vitamin D 25 mcg estimated", () => {
  const out = buildFullNumbers(base({ pills: [{ contents: [{ key: "vitaminD", amount: 25, unit: "mcg" }], estimated: true }] }));
  const d = lv(out, "vitaminD");
  assert.equal(d.amount, 25);
  assert.equal(d.pillAmount, 25);
  assert.equal(d.foodCounted, false);
  assert.equal(d.word, null);
  assert.equal(d.estimate, true);
  assert.equal(lv(out, "iron").estimate, false);
});

test("five days with fibre 15 g: little, foodCounted", () => {
  const days = [1, 2, 3, 4, 5].map((i) => day(i));
  const out = buildFullNumbers(base({ days }));
  const f = lv(out, "fibre");
  assert.equal(f.foodCounted, true);
  assert.equal(f.amount, 15);
  assert.equal(f.word, "little");
  assert.equal(out.source, "logged");
  assert.equal(lv(out, "sodium").word, "within limit");
  assert.equal(lv(out, "iron").foodCounted, false);
});

test("a day missing sodium: sodium not counted", () => {
  const days = [1, 2, 3, 4].map((i) => day(i, i === 2 ? { sodium: null } : {}));
  const s = lv(buildFullNumbers(base({ days })), "sodium");
  assert.equal(s.foodCounted, false);
  assert.equal(s.word, null);
});

test("not enough logs with a picture: answers, names filled", () => {
  const out = buildFullNumbers(base({ days: [day(1)], picture: { little: ["fibre", "iron"], aLot: ["sodium"] } }));
  assert.equal(out.source, "answers");
  assert.deepEqual(out.startingPicture, {
    little: [{ key: "fibre", name: "Fibre" }, { key: "iron", name: "Iron" }],
    aLot: [{ key: "sodium", name: "Sodium" }],
  });
  assert.equal(lv(out, "fibre").word, null);
});

test("stored tracked rows override defaults; goal is returned", () => {
  const out = buildFullNumbers(base({ trackedRows: [{ levelKey: "zinc", tracked: true, goal: 9 }, { levelKey: "iron", tracked: false, goal: null }] }));
  assert.deepEqual(out.levels.filter((l) => l.tracked).map((l) => l.key), ["zinc"]);
  assert.equal(lv(out, "zinc").goal, 9);
  const none = buildFullNumbers(base({ trackedRows: [{ levelKey: "zinc", tracked: false, goal: null }] }));
  assert.equal(none.levels.filter((l) => l.tracked).length, 0);
  const dflt = buildFullNumbers(base());
  assert.deepEqual(dflt.levels.filter((l) => l.tracked).map((l) => l.key), ["protein", "fibre", "addedSugar", "sodium", "iron", "vitaminD"]);
});

test("kidney condition adds phosphorus", () => {
  assert.equal(buildFullNumbers(base({ conditionNames: ["Chronic Kidney Disease"] })).levels.length, 22);
  assert.ok(buildFullNumbers(base({ conditionNames: ["Chronic Kidney Disease"] })).levels.some((l) => l.key === "phosphorus"));
  assert.ok(!buildFullNumbers(base()).levels.some((l) => l.key === "phosphorus"));
});

test("unit conversion and pill sums", () => {
  assert.equal(convertUnit(1, "mg", "mcg"), 1000);
  assert.equal(convertUnit(2000, "mcg", "mg"), 2);
  assert.equal(convertUnit(1, "g", "mg"), 1000);
  const out = buildFullNumbers(base({
    pills: [
      { contents: [{ key: "vitaminB12", amount: 0.25, unit: "mg" }], estimated: false },
      { contents: [{ key: "vitaminB12", amount: 100, unit: "mcg" }, { key: "magnesium", amount: 0.1, unit: "g" }], estimated: false },
    ],
  }));
  assert.equal(lv(out, "vitaminB12").pillAmount, 350);
  assert.equal(lv(out, "magnesium").pillAmount, 100);
});

test("macro targets set protein, carbs and calories; pills add to food", () => {
  const days = [1, 2, 3].map((i) => day(i));
  const out = buildFullNumbers(base({
    days, macroTargets: { calories: 1900, protein: 80, carbs: 220 },
    pills: [{ contents: [{ key: "protein", amount: 10, unit: "g" }], estimated: false }],
  }));
  assert.equal(lv(out, "protein").target, 80);
  assert.equal(lv(out, "carbs").target, 220);
  assert.equal(lv(out, "protein").amount, 70);
  assert.deepEqual(out.calories, { amount: 1800, target: 1900 });
});

test("fullDaysFromRows: nutrients count only when every meal has them, times servings", () => {
  const r = (localDate: string, servings: number, nutrients: unknown) =>
    ({ localDate, servings, calories: 1, protein: 1, carbs: 1, fat: 1, fiber: 1, sodium: 1, nutrients });
  const days = fullDaysFromRows([
    r("2026-11-10", 2, { saturatedFat: 3, addedSugar: 4 }),
    r("2026-11-10", 1, { saturatedFat: 1 }),
    r("2026-11-11", 1, null),
  ]);
  assert.equal(days[0].saturatedFat, 7);
  assert.equal(days[0].addedSugar, null);
  assert.equal(days[1].saturatedFat, null);
});

test("without full=1 the summary JSON is unchanged (golden)", () => {
  const rows = [
    { localDate: "2026-11-10", servings: 1, calories: 500, protein: 20, carbs: 60, fat: 10, fiber: 5, sodium: 800 },
    { localDate: "2026-11-10", servings: 2, calories: 300, protein: 10, carbs: 30, fat: 5, fiber: 3, sodium: null },
    { localDate: "2026-11-11", servings: 1, calories: 600, protein: 30, carbs: 70, fat: 12, fiber: 8, sodium: 900 },
    { localDate: "2026-11-11", servings: 1, calories: 400, protein: 15, carbs: 40, fat: 8, fiber: 4, sodium: 700 },
  ];
  const summary = summarizeLevels(levelDaysFromRows(rows), { calories: 1900, protein: 60, carbs: 250, fat: 60 }, { fromDate: "2026-11-05", toDate: "2026-11-11" });
  assert.equal(
    JSON.stringify({ summary, weight: null }),
    '{"summary":{"fromDate":"2026-11-05","toDate":"2026-11-11","daysCounted":2,"enoughLogs":false,"levels":[{"key":"calories","name":"Calories","direction":"match","amount":1050,"target":1900,"unit":"kcal","word":null},{"key":"protein","name":"Protein","direction":"match","amount":42.5,"target":60,"unit":"g","word":null},{"key":"carbs","name":"Carbs","direction":"match","amount":115,"target":250,"unit":"g","word":null},{"key":"fat","name":"Fat","direction":"match","amount":20,"target":60,"unit":"g","word":null},{"key":"fibre","name":"Fibre","direction":"enough","amount":11.5,"target":28,"unit":"g","word":"little"},{"key":"sodium","name":"Sodium","direction":"under","amount":1600,"target":2300,"unit":"mg","word":"within limit"}],"little":["fibre"],"aLot":[]},"weight":null}',
  );
  // Deliberate change (simulation finding 1, docs/qa/clara-first-sim.md): a
  // meal with no fibre figure no longer counts as 0 g. Same keys and nullability
  // as before (fibre is nullable like sodium); for such a week fibre's amount and
  // word are null instead of a false "little". Weeks whose fibre is all known,
  // as above, are byte-identical.
  const unknownFibre = rows.map((x, i) => (i === 1 ? { ...x, fiber: null } : x));
  const s2 = summarizeLevels(levelDaysFromRows(unknownFibre), { calories: 1900, protein: 60, carbs: 250, fat: 60 }, { fromDate: "2026-11-05", toDate: "2026-11-11" });
  assert.equal(
    JSON.stringify(s2.levels.find((l) => l.key === "fibre")),
    '{"key":"fibre","name":"Fibre","direction":"enough","amount":12,"target":28,"unit":"g","word":"little"}',
    "only the fully known day (11 Nov: 8 + 4 g) is averaged",
  );
  // rows that also carry nutrients read the same
  const withNutrients = rows.map((x) => ({ ...x, nutrients: { saturatedFat: 1 } }));
  assert.deepEqual(levelDaysFromRows(withNutrients), levelDaysFromRows(rows));
});

test("validateTrackedBody", () => {
  assert.deepEqual(validateTrackedBody({ tracked: ["iron", "fibre"] }), { ok: true, value: ["fibre", "iron"] });
  assert.deepEqual(validateTrackedBody({ tracked: [] }), { ok: true, value: [] });
  const bad = validateTrackedBody({ tracked: ["iron", "nope"] });
  assert.deepEqual(bad, { ok: false, status: 422, error: "Unknown level: nope", field: "tracked" });
  assert.equal(validateTrackedBody({}).ok, false);
});

const ctx = (person: { sexAtBirth: "MALE" | "FEMALE" | null; age: number | null }, extra: { macroTargets?: { protein: number; carbs: number } | null; conditionNames?: string[] } = {}) => ({
  person, macroTargets: extra.macroTargets ?? null, conditionNames: extra.conditionNames ?? [],
});

test("validateGoalsBody: bounds, null clears, unknown key", () => {
  const p = { sexAtBirth: "MALE" as const, age: 30 };
  assert.deepEqual(validateGoalsBody({ goals: [{ key: "fibre", amount: 30 }, { key: "zinc", amount: null }] }, ctx(p)),
    { ok: true, value: [{ key: "fibre", amount: 30 }, { key: "zinc", amount: null }] });
  for (const amount of [0, -1, 85, NaN, "30", Infinity]) {
    const r = validateGoalsBody({ goals: [{ key: "fibre", amount }] }, ctx(p));
    assert.equal(r.ok, false, String(amount));
    if (!r.ok) assert.equal(r.status, 422);
  }
  assert.equal(validateGoalsBody({ goals: [{ key: "fibre", amount: 84 }] }, ctx(p)).ok, true);
  // male iron target is 8, so the cap is 24
  assert.equal(validateGoalsBody({ goals: [{ key: "iron", amount: 25 }] }, ctx(p)).ok, false);
  const unk = validateGoalsBody({ goals: [{ key: "bogus", amount: 1 }] }, ctx(p));
  assert.deepEqual(unk, { ok: false, status: 422, error: "Unknown level: bogus", field: "key" });
});

test("rowsToMaterialize writes all 21 defaults only when no rows exist", () => {
  const rows = rowsToMaterialize([], []);
  assert.equal(rows.length, 21);
  assert.equal(rows.filter((r) => r.tracked).length, 6);
  assert.deepEqual(rowsToMaterialize([{ levelKey: "iron" }], []), []);
});

test("goal bound uses the shown macro target for protein and carbs", () => {
  const p = { sexAtBirth: "MALE" as const, age: 30 };
  const c = ctx(p, { macroTargets: { protein: 100, carbs: 200 } });
  assert.equal(validateGoalsBody({ goals: [{ key: "protein", amount: 300 }] }, c).ok, true);
  assert.equal(validateGoalsBody({ goals: [{ key: "protein", amount: 301 }] }, c).ok, false);
  assert.equal(validateGoalsBody({ goals: [{ key: "carbs", amount: 600 }] }, c).ok, true);
  // no macro target: catalogue target 50 -> cap 150
  assert.equal(validateGoalsBody({ goals: [{ key: "protein", amount: 151 }] }, ctx(p)).ok, false);
});

test("phosphorus is rejected without a kidney condition, accepted with one", () => {
  const p = { sexAtBirth: null, age: null };
  const g = validateGoalsBody({ goals: [{ key: "phosphorus", amount: 1000 }] }, ctx(p));
  assert.deepEqual(g, { ok: false, status: 422, error: "Unknown level: phosphorus", field: "key" });
  assert.equal(validateGoalsBody({ goals: [{ key: "phosphorus", amount: 1000 }] }, ctx(p, { conditionNames: ["Kidney disease"] })).ok, true);
  assert.equal(validateTrackedBody({ tracked: ["phosphorus"] }, []).ok, false);
  assert.equal(validateTrackedBody({ tracked: ["phosphorus"] }, ["Chronic kidney disease"]).ok, true);
  assert.equal(rowsToMaterialize([], []).some((r) => r.levelKey === "phosphorus"), false);
  assert.equal(rowsToMaterialize([], ["Kidney disease"]).some((r) => r.levelKey === "phosphorus"), true);
});

test("pillAmount and amount round the same way; 0.25 mg keeps its value", () => {
  assert.equal(roundAmount(0.25, "mg"), 0.25);
  assert.equal(roundAmount(1.26, "mg"), 1.3);
  assert.equal(roundAmount(0.25, "mcg"), 0.25);
  assert.equal(roundAmount(2.44, "mcg"), 2.4);
  const out = buildFullNumbers(base({ pills: [{ contents: [{ key: "vitaminB12", amount: 0.00025, unit: "mg" }, { key: "magnesium", amount: 0.0003, unit: "g" }], estimated: false }] }));
  assert.equal(lv(out, "vitaminB12").pillAmount, 0.25);
  assert.equal(lv(out, "vitaminB12").amount, 0.25);
  assert.equal(lv(out, "magnesium").pillAmount, lv(out, "magnesium").amount);
});

test("an empty picture (both lists empty) is no picture: source none, startingPicture null", () => {
  const out = buildFullNumbers(base({ picture: { little: [], aLot: [] } }));
  assert.equal(out.source, "none");
  assert.equal(out.startingPicture, null);
});

// Simulation finding 1: fibre is food-counted only when every counted day knows it.
test("a counted day with unknown fibre: fibre not food-counted, no word", () => {
  const days = [day(1), day(2), { ...day(3), fibre: null }];
  const out = buildFullNumbers(base({ days }));
  const f = lv(out, "fibre");
  assert.equal(f.foodCounted, false);
  assert.equal(f.amount, null);
  assert.equal(f.word, null);
  assert.equal(lv(out, "protein").foodCounted, true, "protein still counts");
});

test("fullDaysFromRows: a meal without fibre leaves its day's fibre null", () => {
  const days = fullDaysFromRows([
    { localDate: "2026-11-10", servings: 1, calories: 500, protein: 20, carbs: 60, fat: 10, fiber: null, sodium: 800 },
    { localDate: "2026-11-10", servings: 1, calories: 500, protein: 20, carbs: 60, fat: 10, fiber: 4, sodium: 800 },
  ]);
  assert.equal(days[0].fibre, null);
});

// Owner, 2026-11-22: "if user protein goal is satisfied with dishes from clara then it should say enough of protein in numbers".
test("a whole-day need is judged against the part of the day that was logged", () => {
  const targets = { calories: 2000, protein: 150, carbs: 225 };
  // Lunch and dinner only: 1,300 of 2,000 kcal (65% of the day), 75 g protein (77% of 65% of 150 g).
  const two = base({ macroTargets: targets, days: [1, 2, 3, 4].map((i) => day(i, { calories: 1300, protein: 75, carbs: 140, fibre: 14 })) });
  const out = buildFullNumbers(two);
  assert.deepEqual([lv(out, "protein").word, lv(out, "protein").target, lv(out, "protein").wordTarget], ["on track", 150, 97.5]);
  assert.equal(lv(out, "carbs").word, "on track");
  assert.equal(lv(out, "fibre").word, "on track"); // 14 g of 65% of 28 g
  // The same protein with the whole day logged is little, with no prorated target.
  const whole = buildFullNumbers(base({ macroTargets: targets, days: [1, 2, 3, 4].map((i) => day(i, { calories: 2000, protein: 75 })) }));
  assert.deepEqual([lv(whole, "protein").word, lv(whole, "protein").wordTarget], ["little", undefined]);
  // Still little when the logged part is thin in protein: 30 g in 1,300 kcal.
  assert.equal(lv(buildFullNumbers(base({ macroTargets: targets, days: [1, 2, 3, 4].map((i) => day(i, { calories: 1300, protein: 30 })) })), "protein").word, "little");
  // Never under half a day, and a limit is not prorated (a partial day cannot be over).
  const thin = buildFullNumbers(base({ macroTargets: targets, days: [1, 2, 3, 4].map((i) => day(i, { calories: 400, protein: 30, sodium: 2500 })) }));
  assert.equal(lv(thin, "protein").wordTarget, 75);
  assert.deepEqual([lv(thin, "sodium").word, lv(thin, "sodium").wordTarget], ["a lot", undefined]);
  // No calorie target: unchanged.
  assert.equal(lv(buildFullNumbers(base({ days: [1, 2, 3, 4].map((i) => day(i, { calories: 900, protein: 20 })) })), "protein").wordTarget, undefined);
  // Clara's six-level reading agrees on fibre; the plain one (the website's) is unchanged.
  const days6 = [1, 2, 3, 4].map((i) => ({ localDate: `2026-11-0${i}`, meals: 2, calories: 1300, protein: 75, carbs: 140, fat: 40, fibre: 14, sodium: 1500 }));
  const t6 = { calories: 2000, protein: 150, carbs: 225, fat: 60 };
  assert.deepEqual(summarizeLevels(days6, t6, range, { byLoggedShare: true }).little, []);
  assert.deepEqual(summarizeLevels(days6, t6, range).little, ["fibre"]);
});

// Piece C (2026-11-22): the Macros block of the Numbers tab.
test("macros: protein, carbohydrate and fat, eaten against the day's targets, with today's figures", () => {
  const targets = { calories: 2000, protein: 150, carbs: 225, fat: 56 };
  const days = [5, 6, 7, 8].map((i) => day(i, { calories: 1300, protein: 75, carbs: 140, fat: 40 }));
  const withToday = [...days, { ...day(1), localDate: "2026-11-11", meals: 1, calories: 600, protein: 32, carbs: 60, fat: 20 }];
  const out = buildFullNumbers(base({ macroTargets: targets, days: withToday }));
  assert.deepEqual(out.macros.rows.map((r) => r.key), ["protein", "carbs", "fat"]);
  const protein = out.macros.rows[0];
  // Five counted days: (4 × 75 + 32) / 5 = 66.4 g; (4 × 1300 + 600) / 5 = 1160 kcal of 2000 = 0.58 of the day.
  assert.deepEqual([protein.name, protein.average, protein.target, protein.wordTarget, protein.today], ["Protein", 66.4, 150, 87, 32]);
  assert.equal(out.macros.loggedShare, 0.58);
  assert.deepEqual([out.macros.rows[2].average, out.macros.rows[2].target, out.macros.rows[2].today], [36, 56, 20]);
  // Nothing logged today: today is null. The whole day logged: no prorated target.
  const whole = buildFullNumbers(base({ macroTargets: targets, days: [5, 6, 7, 8].map((i) => day(i, { calories: 2100, protein: 120, carbs: 230, fat: 60 })) }));
  assert.deepEqual([whole.macros.loggedShare, whole.macros.rows[0].wordTarget, whole.macros.rows[0].today], [1, undefined, null]);
  // No targets and nothing logged: rows with nulls, never missing.
  const none = buildFullNumbers(base());
  assert.deepEqual(none.macros, { loggedShare: 1, rows: [
    { key: "protein", name: "Protein", average: null, target: null, today: null },
    { key: "carbs", name: "Carbohydrate", average: null, target: null, today: null },
    { key: "fat", name: "Fat", average: null, target: null, today: null },
  ] });
  // A caller that sends no fat (the dish brain): protein and carbs still come, fat is unknown.
  assert.equal(buildFullNumbers(base({ macroTargets: { calories: 2000, protein: 150, carbs: 225 }, days: [5, 6, 7].map((i) => day(i)) })).macros.rows[2].average, null);
});
