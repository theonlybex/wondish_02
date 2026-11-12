import { test } from "node:test";
import assert from "node:assert/strict";
import { startingPicture, type UsualEating } from "./starting-picture";
import type { PillName } from "./level-catalogue";

const blank: UsualEating = {
  veg: null, fruit: null, beans: null, grains: null, fish: null,
  meat: null, dairy: null, packaged: null, sweet: null,
};
const all = (n: 0 | 1 | 2): UsualEating => ({
  veg: n, fruit: n, beans: n, grains: n, fish: n, meat: n, dairy: n, packaged: n, sweet: n,
});

// Vector 1: nothing answered.
test("all null gives empty lists", () => {
  assert.deepEqual(startingPicture(blank, []), { little: [], aLot: [] });
});

const sample: UsualEating = {
  veg: 1, fruit: 1, beans: 0, grains: 1, fish: 0, meat: 1, dairy: 1, packaged: 2, sweet: 1,
};

// Vector 2: the mockup sample, no pills.
test("mockup sample, no pills", () => {
  assert.deepEqual(startingPicture(sample, []), {
    little: ["fibre", "iron", "potassium", "omega3", "vitaminD"],
    aLot: ["sodium"],
  });
});

// Vector 3: pills cover several.
test("mockup sample with Multivitamin, Iron, Omega-3", () => {
  const pills: PillName[] = ["Multivitamin", "Iron", "Omega-3"];
  assert.deepEqual(startingPicture(sample, pills), { little: ["fibre", "potassium"], aLot: ["sodium"] });
});

// Vector 4: all most-days.
test("all 2", () => {
  assert.deepEqual(startingPicture(all(2), []), {
    little: [],
    aLot: ["sodium", "addedSugar", "saturatedFat"],
  });
});

// Vector 5: all rarely.
test("all 0 gives all nine little", () => {
  assert.deepEqual(startingPicture(all(0), []), {
    little: ["fibre", "iron", "potassium", "calcium", "omega3", "vitaminD", "vitaminB12", "vitaminC", "magnesium"],
    aLot: [],
  });
});

test("partial answers do not fire rules that read a null", () => {
  // veg, fruit answered but beans/grains not: fibre cannot fire; vitaminC reads only veg+fruit.
  const r = startingPicture({ ...blank, veg: 0, fruit: 0 }, []);
  assert.deepEqual(r, { little: ["vitaminC"], aLot: [] });
  // meat 2 but dairy unanswered: saturatedFat does not fire.
  assert.deepEqual(startingPicture({ ...blank, meat: 2 }, []).aLot, []);
});
