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
