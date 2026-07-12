import { test } from "node:test";
import assert from "node:assert/strict";
import { dishes, featuredDishes, dishesByType } from "./dishes";
import type { MealTypeKey } from "@/types";

const MEAL_TYPES: MealTypeKey[] = ["breakfast", "lunch", "dinner", "snack"];

test("dataset is non-empty", () => {
  assert.ok(dishes.length > 0, "dishes must contain at least one entry");
});

test("ids are unique positive integers", () => {
  const ids = dishes.map((d) => d.id);
  for (const id of ids) {
    assert.ok(Number.isInteger(id), `id ${id} must be an integer`);
    assert.ok(id > 0, `id ${id} must be positive`);
  }
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("names are unique, non-empty, and trimmed", () => {
  const names = dishes.map((d) => d.name);
  for (const name of names) {
    assert.equal(typeof name, "string");
    assert.ok(name.trim().length > 0, "name must be non-empty");
    assert.equal(name, name.trim(), `name "${name}" must have no surrounding whitespace`);
  }
  assert.equal(new Set(names).size, names.length, "names must be unique");
});

test("descriptions are non-empty and substantial", () => {
  for (const d of dishes) {
    assert.ok(
      d.description.trim().length >= 20,
      `dish ${d.id} (${d.name}) description must be at least 20 chars`
    );
  }
});

test("mealType is one of the four valid MealTypeKey values", () => {
  for (const d of dishes) {
    assert.ok(
      MEAL_TYPES.includes(d.mealType),
      `dish ${d.id} (${d.name}) has invalid mealType "${d.mealType}"`
    );
  }
});

test("every meal type is represented in the dataset", () => {
  const present = new Set(dishes.map((d) => d.mealType));
  for (const mt of MEAL_TYPES) {
    assert.ok(present.has(mt), `no dishes for meal type "${mt}"`);
  }
});

test("calories are positive and within a sane meal range", () => {
  for (const d of dishes) {
    assert.ok(Number.isFinite(d.calories), `dish ${d.id} calories must be finite`);
    assert.ok(d.calories > 0, `dish ${d.id} calories must be positive`);
    assert.ok(
      d.calories >= 50 && d.calories <= 1500,
      `dish ${d.id} calories (${d.calories}) outside sane 50-1500 kcal range`
    );
  }
});

test("macros (protein/carbs/fat) are non-negative finite numbers", () => {
  for (const d of dishes) {
    for (const [key, value] of [
      ["protein", d.protein],
      ["carbs", d.carbs],
      ["fat", d.fat],
    ] as const) {
      assert.ok(Number.isFinite(value), `dish ${d.id} ${key} must be finite`);
      assert.ok(value >= 0, `dish ${d.id} ${key} must be non-negative`);
    }
  }
});

test("stated calories roughly agree with macro-derived calories (4/4/9 rule, ±20%)", () => {
  for (const d of dishes) {
    const derived = d.protein * 4 + d.carbs * 4 + d.fat * 9;
    const ratio = derived / d.calories;
    assert.ok(
      ratio >= 0.8 && ratio <= 1.2,
      `dish ${d.id} (${d.name}): macro-derived ${derived} kcal vs stated ${d.calories} kcal (ratio ${ratio.toFixed(2)})`
    );
  }
});

test("prepTime and cookTime are non-negative integers with sane bounds", () => {
  for (const d of dishes) {
    for (const [key, value] of [
      ["prepTime", d.prepTime],
      ["cookTime", d.cookTime],
    ] as const) {
      assert.ok(Number.isInteger(value), `dish ${d.id} ${key} must be an integer`);
      assert.ok(value >= 0, `dish ${d.id} ${key} must be non-negative`);
      assert.ok(value <= 240, `dish ${d.id} ${key} (${value} min) unreasonably long`);
    }
    assert.ok(
      d.prepTime + d.cookTime > 0 || d.mealType === "snack",
      `dish ${d.id} needs some prep or cook time unless it is a grab-and-go snack`
    );
  }
});

test("servings is a positive integer", () => {
  for (const d of dishes) {
    assert.ok(Number.isInteger(d.servings), `dish ${d.id} servings must be an integer`);
    assert.ok(d.servings >= 1, `dish ${d.id} servings must be at least 1`);
    assert.ok(d.servings <= 12, `dish ${d.id} servings (${d.servings}) unreasonably large`);
  }
});

test("tags are non-empty arrays of unique, non-empty, trimmed strings", () => {
  for (const d of dishes) {
    assert.ok(Array.isArray(d.tags), `dish ${d.id} tags must be an array`);
    assert.ok(d.tags.length > 0, `dish ${d.id} must have at least one tag`);
    for (const tag of d.tags) {
      assert.equal(typeof tag, "string", `dish ${d.id} tag must be a string`);
      assert.ok(tag.trim().length > 0, `dish ${d.id} has an empty tag`);
      assert.equal(tag, tag.trim(), `dish ${d.id} tag "${tag}" has surrounding whitespace`);
    }
    assert.equal(
      new Set(d.tags).size,
      d.tags.length,
      `dish ${d.id} has duplicate tags`
    );
  }
});

test("emoji is a short non-ASCII glyph", () => {
  for (const d of dishes) {
    assert.ok(d.emoji.length > 0, `dish ${d.id} emoji must be non-empty`);
    // At most a couple of code points — this is a single pictograph, not text.
    assert.ok([...d.emoji].length <= 2, `dish ${d.id} emoji "${d.emoji}" too long`);
    const first = d.emoji.codePointAt(0)!;
    assert.ok(first > 0x7f, `dish ${d.id} emoji "${d.emoji}" is plain ASCII`);
  }
});

test("imageUrl (when present) is a local /dishes/ png matching the dish id", () => {
  for (const d of dishes) {
    if (d.imageUrl === undefined) continue;
    assert.equal(
      d.imageUrl,
      `/dishes/dish-${d.id}.png`,
      `dish ${d.id} imageUrl "${d.imageUrl}" must follow /dishes/dish-<id>.png`
    );
  }
});

test("imageUrls are unique across dishes", () => {
  const urls = dishes.map((d) => d.imageUrl).filter((u): u is string => u !== undefined);
  assert.equal(new Set(urls).size, urls.length, "imageUrls must be unique");
});

test("featured (when present) is a boolean", () => {
  for (const d of dishes) {
    if (d.featured !== undefined) {
      assert.equal(typeof d.featured, "boolean", `dish ${d.id} featured must be boolean`);
    }
  }
});

// ─── Derived exports ─────────────────────────────────────────────────────────

test("featuredDishes contains exactly the dishes flagged featured", () => {
  assert.ok(featuredDishes.length > 0, "there must be at least one featured dish");
  for (const d of featuredDishes) {
    assert.equal(d.featured, true, `dish ${d.id} in featuredDishes must be flagged`);
  }
  const expected = dishes.filter((d) => d.featured === true).map((d) => d.id);
  assert.deepEqual(featuredDishes.map((d) => d.id), expected);
  for (const d of featuredDishes) {
    assert.ok(dishes.includes(d), `featured dish ${d.id} is not a reference into dishes`);
  }
});

test("dishesByType exposes exactly the four meal-type keys", () => {
  assert.deepEqual(
    Object.keys(dishesByType).sort(),
    [...MEAL_TYPES].sort(),
    "dishesByType must have exactly breakfast/lunch/dinner/snack keys"
  );
});

test("dishesByType partitions the full dataset by mealType", () => {
  const bucketIds: number[] = [];
  for (const mt of MEAL_TYPES) {
    const bucket = dishesByType[mt];
    assert.ok(bucket.length > 0, `dishesByType.${mt} must be non-empty`);
    for (const d of bucket) {
      assert.equal(d.mealType, mt, `dish ${d.id} in wrong bucket "${mt}"`);
      // Same object, not a clone — mutations to `dishes` entries must be visible here.
      assert.ok(dishes.includes(d), `dish ${d.id} in bucket "${mt}" is not a reference into dishes`);
      bucketIds.push(d.id);
    }
  }
  // Multiset equality: catches a bucket duplicating one dish while omitting
  // another of the same meal type, which a plain count check would miss.
  assert.deepEqual(
    bucketIds.sort((a, b) => a - b),
    dishes.map((d) => d.id).sort((a, b) => a - b),
    "buckets must cover every dish exactly once, no duplicates or omissions"
  );
});
