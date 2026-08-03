import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterCalendarMeals,
  parseLocalDateStrict,
  shouldReplaceMeals,
  validateJournalPost,
} from "./journal";

// ─── 2026-07-24 logic-audit Task 14 ─────────────────────────────────────────
//
// POST /api/journal unconditionally deleted the day's JournalMeals and
// recreated only `if (meals?.length)` — a mood/weight-only save destroyed
// ratings logged via log-meal. It also stored NaN/negative weights (which
// sync into patient BMI) and accepted any JSON value as a rating.

test("parseLocalDateStrict: YYYY-MM-DD parses as LOCAL midnight; garbage is null", () => {
  const d = parseLocalDateStrict("2026-07-24");
  assert.ok(d);
  assert.equal(d!.getFullYear(), 2026);
  assert.equal(d!.getMonth(), 6);
  assert.equal(d!.getDate(), 24); // local, not UTC-shifted
  assert.equal(parseLocalDateStrict("garbage"), null);
  assert.equal(parseLocalDateStrict("2026-7-4"), null);
  assert.equal(parseLocalDateStrict(42), null);
  assert.equal(parseLocalDateStrict(undefined), null);
});

test("shouldReplaceMeals: only when the client actually sent the meals key", () => {
  assert.equal(shouldReplaceMeals({}), false);
  assert.equal(shouldReplaceMeals({ meals: undefined }), false);
  assert.equal(shouldReplaceMeals({ meals: [] }), true); // explicit clear stays a clear
  assert.equal(shouldReplaceMeals({ meals: [{ mealType: "lunch" }] }), true);
});

test("validateJournalPost: happy path with weight string and meals", () => {
  const r = validateJournalPost({
    date: "2026-07-24",
    weight: "182.5",
    meals: [{ mealType: "lunch", rating: 1, skipped: false }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.weight, 182.5);
    assert.equal(r.date.getDate(), 24);
  }
});

test("validateJournalPost: rejects garbage date, NaN/negative/absurd weight, bad rating", () => {
  assert.equal(validateJournalPost({ date: "nope" }).ok, false);
  assert.equal(validateJournalPost({ date: "2026-07-24", weight: "abc" }).ok, false);
  assert.equal(validateJournalPost({ date: "2026-07-24", weight: "-150" }).ok, false);
  assert.equal(validateJournalPost({ date: "2026-07-24", weight: "99999" }).ok, false);
  assert.equal(
    validateJournalPost({ date: "2026-07-24", meals: [{ mealType: "lunch", rating: "five" }] }).ok,
    false
  );
  assert.equal(validateJournalPost({ date: "2026-07-24", meals: [{ mealType: "" }] }).ok, false);
  assert.equal(validateJournalPost({ date: "2026-07-24", meals: "notarray" }).ok, false);
});

test("validateJournalPost: omitted weight/meals are preserved as absent, empty-string weight is null", () => {
  const r = validateJournalPost({ date: "2026-07-24", weight: "" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.weight, null);
    assert.equal(r.meals, undefined);
  }
});

// ─── Calendar meal filter (iOS journal allMeals mode) ───────────────────────

test("filterCalendarMeals: default keeps only rated, non-skipped meals", () => {
  const meals = [
    { skipped: false, rating: 1 },
    { skipped: false, rating: 0 },
    { skipped: false, rating: null },
    { skipped: true, rating: 1 },
  ];
  assert.deepEqual(filterCalendarMeals(meals, false), [{ skipped: false, rating: 1 }]);
});

test("filterCalendarMeals: allMeals keeps every non-skipped meal", () => {
  const meals = [
    { skipped: false, rating: 1 },
    { skipped: false, rating: null },
    { skipped: true, rating: 1 },
  ];
  assert.deepEqual(filterCalendarMeals(meals, true), [
    { skipped: false, rating: 1 },
    { skipped: false, rating: null },
  ]);
});

// ─── S3 E1: upsertMealCompletion (extracted from /api/journal/log-meal) ──────

import { upsertMealCompletion, type CompletionDb } from "./journal";

function fakeCompletionDb(existingMeals: { id: string; recipeId: string | null; skipped: boolean; rating: number | null }[] | null) {
  const ops: string[] = [];
  const db: CompletionDb = {
    findEntry: async () => (existingMeals === null ? null : { id: "entry-1", meals: existingMeals }),
    createEntry: async () => {
      ops.push("createEntry");
      return { id: "entry-new" };
    },
    createMeal: async (data) => {
      ops.push(`createMeal:${data.recipeId}:${String(data.rating)}`);
      return { id: "meal-new" };
    },
    updateMealRating: async (id, rating) => {
      ops.push(`update:${id}:${String(rating)}`);
    },
    deleteMeal: async (id) => {
      ops.push(`delete:${id}`);
    },
  };
  return { db, ops };
}

test("completion: invalid date returns null, no effects", async () => {
  const { db, ops } = fakeCompletionDb(null);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "not-a-date", rating: 1 }, db);
  assert.equal(res, null);
  assert.equal(ops.length, 0);
});

test("completion: no entry → entry + meal created with the rating", async () => {
  const { db, ops } = fakeCompletionDb(null);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", mealTypeName: "Dinner", date: "2026-08-03", rating: 1 }, db);
  assert.deepEqual(res, { action: "created", journalMealId: "meal-new", rating: 1 });
  assert.deepEqual(ops, ["createEntry", "createMeal:r1:1"]);
});

test("completion: toggle mode + same rating removes the row (route parity)", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1, toggle: true }, db);
  assert.deepEqual(res, { action: "removed", journalMealId: null, rating: null });
  assert.deepEqual(ops, ["delete:m1"]);
});

test("completion: NON-toggle + same rating is unchanged — Clara re-marking done must never undo", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1 }, db);
  assert.deepEqual(res, { action: "unchanged", journalMealId: "m1", rating: 1 });
  assert.deepEqual(ops, []);
});

test("completion: different rating updates (both modes)", async () => {
  for (const toggle of [true, false]) {
    const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
    const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: -1, toggle }, db);
    assert.deepEqual(res, { action: "updated", journalMealId: "m1", rating: -1 });
    assert.deepEqual(ops, ["update:m1:-1"]);
  }
});

test("completion: null rating creates an unrated row when missing", async () => {
  const { db, ops } = fakeCompletionDb([]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: null }, db);
  assert.deepEqual(res, { action: "created", journalMealId: "meal-new", rating: null });
  assert.deepEqual(ops, ["createMeal:r1:null"]);
});

test("completion: null rating NEVER clears an existing rating", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: -1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: null }, db);
  assert.deepEqual(res, { action: "unchanged", journalMealId: "m1", rating: -1 });
  assert.deepEqual(ops, []);
});

test("completion: skipped rows are invisible to matching (a skipped dinner can be re-completed)", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: true, rating: null }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1 }, db);
  assert.equal(res?.action, "created");
  assert.deepEqual(ops, ["createMeal:r1:1"]);
});
