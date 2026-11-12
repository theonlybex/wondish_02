import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeLevels, type LevelDayInput } from "./levels";

const RANGE = { fromDate: "2026-11-06", toDate: "2026-11-12" };
const TARGETS = { calories: 2000, protein: 100, carbs: 250, fat: 70 };

function day(over: Partial<LevelDayInput> = {}): LevelDayInput {
  return {
    localDate: "2026-11-06",
    meals: 2,
    calories: 2000,
    protein: 100,
    carbs: 250,
    fat: 70,
    fibre: 28,
    sodium: 2000,
    ...over,
  };
}

function row(s: ReturnType<typeof summarizeLevels>, key: string) {
  const r = s.levels.find((l) => l.key === key);
  assert.ok(r, `row ${key}`);
  return r;
}

test("averages only days that have a logged meal", () => {
  const days = [
    day({ localDate: "2026-11-06", meals: 2, fibre: 10 }),
    day({ localDate: "2026-11-07", meals: 1, fibre: 20 }),
    ...[8, 9, 10, 11, 12].map((d) =>
      day({ localDate: `2026-11-${String(d).padStart(2, "0")}`, meals: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sodium: null }),
    ),
  ];
  const s = summarizeLevels(days, TARGETS, RANGE);
  assert.equal(s.daysCounted, 2);
  assert.equal(row(s, "fibre").amount, 15);
  assert.equal(s.fromDate, RANGE.fromDate);
  assert.equal(s.toDate, RANGE.toDate);
});

test("a day needs 2+ meals to count toward enoughLogs", () => {
  const days = [1, 2, 3].map((n) => day({ localDate: `2026-11-0${n}`, meals: 1 }));
  assert.equal(summarizeLevels(days, TARGETS, RANGE).enoughLogs, false);
});

test("3 days of 2 meals is enough", () => {
  const days = [1, 2, 3].map((n) => day({ localDate: `2026-11-0${n}`, meals: 2 }));
  assert.equal(summarizeLevels(days, TARGETS, RANGE).enoughLogs, true);
});

test("fibre under 70% of 28 g is 'little'", () => {
  const low = summarizeLevels([day({ fibre: 19 })], TARGETS, RANGE);
  assert.equal(row(low, "fibre").word, "little");
  assert.deepEqual(low.little, ["fibre"]);
  const ok = summarizeLevels([day({ fibre: 20 })], TARGETS, RANGE);
  assert.equal(row(ok, "fibre").word, "on track");
  assert.deepEqual(ok.little, []);
  assert.equal(row(ok, "fibre").target, 28);
  assert.equal(row(ok, "fibre").direction, "enough");
});

test("sodium over 2300 mg is 'a lot', at 2300 'within limit'", () => {
  const over = summarizeLevels([day({ sodium: 2301 })], TARGETS, RANGE);
  assert.equal(row(over, "sodium").word, "a lot");
  assert.deepEqual(over.aLot, ["sodium"]);
  const at = summarizeLevels([day({ sodium: 2300 })], TARGETS, RANGE);
  assert.equal(row(at, "sodium").word, "within limit");
  assert.deepEqual(at.aLot, []);
  assert.equal(row(at, "sodium").target, 2300);
  assert.equal(row(at, "sodium").direction, "under");
});

test("sodium averages only counted days where sodium is not null", () => {
  const s = summarizeLevels(
    [day({ sodium: 1000 }), day({ sodium: null }), day({ sodium: 3000 })],
    TARGETS,
    RANGE,
  );
  assert.equal(row(s, "sodium").amount, 2000);
});

test("sodium null on every day gives amount null and word null", () => {
  const s = summarizeLevels([day({ sodium: null }), day({ sodium: null })], TARGETS, RANGE);
  assert.equal(row(s, "sodium").amount, null);
  assert.equal(row(s, "sodium").word, null);
  assert.deepEqual(s.aLot, []);
});

test("no days at all: every amount null, little and aLot empty, enoughLogs false", () => {
  const s = summarizeLevels([], TARGETS, RANGE);
  assert.equal(s.daysCounted, 0);
  assert.equal(s.enoughLogs, false);
  assert.equal(s.levels.length, 6);
  for (const l of s.levels) {
    assert.equal(l.amount, null);
    assert.equal(l.word, null);
  }
  assert.deepEqual(s.little, []);
  assert.deepEqual(s.aLot, []);
});

test("null targets: calories/protein/carbs/fat rows keep amount, target null", () => {
  const s = summarizeLevels([day({ calories: 1800 })], null, RANGE);
  for (const k of ["calories", "protein", "carbs", "fat"]) {
    assert.equal(row(s, k).target, null);
    assert.equal(row(s, k).word, null);
    assert.equal(row(s, k).direction, "match");
  }
  assert.equal(row(s, "calories").amount, 1800);
});

test("rows come in order with display names and units", () => {
  const s = summarizeLevels([day()], TARGETS, RANGE);
  assert.deepEqual(s.levels.map((l) => [l.key, l.name, l.unit]), [
    ["calories", "Calories", "kcal"],
    ["protein", "Protein", "g"],
    ["carbs", "Carbs", "g"],
    ["fat", "Fat", "g"],
    ["fibre", "Fibre", "g"],
    ["sodium", "Sodium", "mg"],
  ]);
  assert.equal(row(s, "protein").target, 100);
});

// Simulation finding 2: Clara's "little / a lot" claims must match what Numbers
// says (full=1), which counts fibre and sodium only when EVERY counted day knows them.
import { claimsAsNumbersSays } from "./levels";

test("claimsAsNumbersSays: no fibre / sodium claim when a counted day lacks it, or logs are not enough", () => {
  const full = [day({ localDate: "2026-11-10", fibre: 5, sodium: 4000 }), day({ localDate: "2026-11-11", fibre: 5, sodium: 4000 }), day({ localDate: "2026-11-12", fibre: 5, sodium: 4000 })];
  const s = summarizeLevels(full, TARGETS, RANGE);
  assert.deepEqual([claimsAsNumbersSays(s, full).little, claimsAsNumbersSays(s, full).aLot], [["fibre"], ["sodium"]]);
  const gap = [...full.slice(0, 2), day({ localDate: "2026-11-12", fibre: null, sodium: null })];
  const g = claimsAsNumbersSays(summarizeLevels(gap, TARGETS, RANGE), gap);
  assert.deepEqual([g.little, g.aLot], [[], []]);
  const few = full.slice(0, 1);
  const f = claimsAsNumbersSays(summarizeLevels(few, TARGETS, RANGE), few);
  assert.deepEqual([f.little, f.aLot], [[], []]);
});
