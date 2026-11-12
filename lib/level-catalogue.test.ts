import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, AREAS, TYPICAL_PILLS, targetFor, wordFor, defaultTracked } from "./level-catalogue";

const byKey = (k: string) => LEVELS.find((l) => l.key === k)!;

test("22 unique keys in order", () => {
  const keys = LEVELS.map((l) => l.key);
  assert.equal(keys.length, 22);
  assert.equal(new Set(keys).size, 22);
  assert.deepEqual(keys, [
    "protein", "carbs", "fibre", "addedSugar", "saturatedFat", "sodium", "omega3", "potassium",
    "calcium", "iron", "magnesium", "zinc", "iodine", "vitaminA", "vitaminB6", "vitaminB12",
    "vitaminC", "vitaminD", "vitaminE", "vitaminK", "folate", "phosphorus",
  ]);
});

test("wordFor enough", () => {
  const fibre = byKey("fibre");
  assert.equal(wordFor(fibre, 69, 100), "little");
  assert.equal(wordFor(fibre, 70, 100), "on track");
  assert.equal(wordFor(fibre, 100, 100), "on track");
  assert.equal(wordFor(fibre, 101, 100), "on track");
  const iron = byKey("iron");
  assert.equal(wordFor(iron, 45, 18), "on track");
  assert.equal(wordFor(iron, 46, 18), "more than needed");
});

test("wordFor under", () => {
  const sodium = byKey("sodium");
  assert.equal(wordFor(sodium, 2300, 2300), "within limit");
  assert.equal(wordFor(sodium, 2301, 2300), "a lot");
});

test("wordFor match", () => {
  const carbs = byKey("carbs");
  assert.equal(wordFor(carbs, 69, 100), "little");
  assert.equal(wordFor(carbs, 70, 100), "on track");
  assert.equal(wordFor(carbs, 130, 100), "on track");
  assert.equal(wordFor(carbs, 131, 100), "a lot");
  assert.equal(wordFor(carbs, 100, 100), "on track");
});

test("targetFor iron", () => {
  const iron = byKey("iron");
  assert.equal(targetFor(iron, { sexAtBirth: "FEMALE", age: 30 }), 18);
  assert.equal(targetFor(iron, { sexAtBirth: "MALE", age: 30 }), 8);
  assert.equal(targetFor(iron, { sexAtBirth: "FEMALE", age: 60 }), 8);
  assert.equal(targetFor(iron, { sexAtBirth: null, age: null }), 18);
  assert.equal(targetFor(byKey("fibre"), { sexAtBirth: "MALE", age: 30 }), 28);
});

test("defaultTracked", () => {
  assert.deepEqual(defaultTracked([]), ["protein", "fibre", "addedSugar", "sodium", "iron", "vitaminD"]);
  assert.ok(defaultTracked(["Chronic Kidney Disease stage 1-2"]).includes("phosphorus"));
  const both = defaultTracked(["Hypertension", "Type 2 Diabetes"]);
  assert.equal(new Set(both).size, both.length);
  assert.ok(both.includes("potassium") && both.includes("carbs"));
});

test("areas and pills reference real keys", () => {
  const keys = new Set(LEVELS.map((l) => l.key));
  for (const a of AREAS) for (const k of a.uses) assert.ok(keys.has(k), `${a.key}:${k}`);
  for (const [, items] of Object.entries(TYPICAL_PILLS)) for (const i of items) assert.ok(keys.has(i.key), i.key);
  assert.equal(AREAS.length, 6);
  assert.equal(TYPICAL_PILLS.Multivitamin.length, 10);
});

test("groups follow the spec", () => {
  const g = (name: string) => LEVELS.filter((l) => l.group === name).map((l) => l.key);
  assert.deepEqual(g("food"), ["protein", "carbs", "fibre", "addedSugar", "saturatedFat", "sodium", "omega3"]);
  assert.deepEqual(g("minerals"), ["potassium", "calcium", "iron", "magnesium", "zinc", "iodine", "phosphorus"]);
  assert.deepEqual(g("vitamins"), ["vitaminA", "vitaminB6", "vitaminB12", "vitaminC", "vitaminD", "vitaminE", "vitaminK", "folate"]);
});
