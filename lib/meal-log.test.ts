import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEAL_TYPES,
  formatLocalDate,
  parseMealLogInput,
  parseBatchInput,
  parsePatchInput,
  resolveSnapshot,
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  buildMealLogLookupWhere,
  serializeMealLog,
  computeRemaining,
} from "./meal-log";
import { r1 } from "./macros";

// ─── formatLocalDate (local getters, zero-padded) ──────────────────────────

test("formatLocalDate: uses local calendar getters, zero-pads month/day", () => {
  // 23:30 local on 2026-07-19 must stay 2026-07-19 (never rolls to UTC's tomorrow).
  assert.equal(formatLocalDate(new Date(2026, 6, 19, 23, 30)), "2026-07-19");
  assert.equal(formatLocalDate(new Date(2026, 0, 5, 0, 0)), "2026-01-05");
  assert.equal(formatLocalDate(new Date(2026, 11, 31, 12)), "2026-12-31");
});

// ─── parseMealLogInput — localDate (required, anchored, never defaulted) ────

test("parseMealLogInput: missing localDate is rejected, never defaulted", () => {
  const r = parseMealLogInput({ mealType: "lunch", source: "MANUAL", name: "Eggs", perServing: { calories: 100 } });
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 400);
  assert.match((r as { error: string }).error, /localDate/i);
});

test("parseMealLogInput: non-anchored localDate rejected", () => {
  for (const bad of ["2026-7-9", "2026-07-19x", "x2026-07-19", "2026/07/19", ""]) {
    const r = parseMealLogInput({ localDate: bad, mealType: "lunch", source: "MANUAL", name: "x", perServing: { calories: 1 } });
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(bad)}`);
  }
});

test("parseMealLogInput: anchored localDate accepted", () => {
  const r = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "Eggs", servings: 2, perServing: { calories: 100, protein: 5 } });
  assert.ok(r.ok);
  assert.equal(r.value.localDate, "2026-07-19");
  assert.equal(r.value.servings, 2);
  assert.equal(r.value.source, "MANUAL");
});

// ─── mealType / source allow-lists ─────────────────────────────────────────

test("parseMealLogInput: mealType must be in the 4-value allow-list", () => {
  for (const t of MEAL_TYPES) {
    const r = parseMealLogInput({ localDate: "2026-07-19", mealType: t, source: "MANUAL", name: "x", perServing: { calories: 1 } });
    assert.ok(r.ok, `expected ${t} accepted`);
  }
  const bad = parseMealLogInput({ localDate: "2026-07-19", mealType: "brunch", source: "MANUAL", name: "x", perServing: { calories: 1 } });
  assert.equal(bad.ok, false);
});

test("parseMealLogInput: source must be a MealLogSource; defaults to MANUAL when absent", () => {
  const bad = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "PANTRY", name: "x", perServing: { calories: 1 } });
  assert.equal(bad.ok, false);
  const def = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", name: "x", perServing: { calories: 1 } });
  assert.ok(def.ok);
  assert.equal(def.value.source, "MANUAL");
});

// ─── servings bounds ───────────────────────────────────────────────────────

test("parseMealLogInput: servings must be finite, > 0, <= 50", () => {
  const mk = (s: unknown) => parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "x", servings: s, perServing: { calories: 1 } });
  assert.equal(mk(0).ok, false);
  assert.equal(mk(-1).ok, false);
  assert.equal(mk(51).ok, false);
  assert.equal(mk(Infinity).ok, false);
  assert.equal(mk("2").ok, false);
  assert.ok(mk(1.5).ok);
  assert.ok(mk(50).ok);
  // absent → defaults to 1
  const def = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "x", perServing: { calories: 1 } });
  assert.ok(def.ok);
  assert.equal(def.value.servings, 1);
});

// ─── macro bounds (non-negative or null, <= 10000) ─────────────────────────

test("parseMealLogInput: per-serving macros must be finite, >= 0, <= 10000", () => {
  const mk = (ps: Record<string, unknown>) => parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "x", perServing: ps });
  assert.equal(mk({ calories: -1 }).ok, false);
  assert.equal(mk({ calories: 10001 }).ok, false);
  assert.equal(mk({ protein: Infinity }).ok, false);
  assert.equal(mk({ calories: "5" }).ok, false);
  assert.ok(mk({ calories: 0 }).ok);
  assert.ok(mk({ calories: 420, protein: 38, carbs: 12, fat: 24, fiber: 5 }).ok);
});

// ─── name trim / length + source-specific requirement ──────────────────────

test("parseMealLogInput: name required for MANUAL/PICTURE/FRIDGE, trimmed, <= 120", () => {
  const noName = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", perServing: { calories: 1 } });
  assert.equal(noName.ok, false);
  const blank = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "   ", perServing: { calories: 1 } });
  assert.equal(blank.ok, false);
  const long = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "a".repeat(121), perServing: { calories: 1 } });
  assert.equal(long.ok, false);
  const good = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "  Grilled chicken  ", perServing: { calories: 1 } });
  assert.ok(good.ok);
  assert.equal(good.value.name, "Grilled chicken");
});

test("parseMealLogInput: name optional for RECIPE and CUSTOM (server defaults it)", () => {
  const rec = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1", servings: 1.5 });
  assert.ok(rec.ok);
  assert.equal(rec.value.name, undefined);
  const cus = parseMealLogInput({ localDate: "2026-07-19", mealType: "snack", source: "CUSTOM", customIngredientId: "c1", servings: 2 });
  assert.ok(cus.ok);
});

// ─── source-specific required ids ──────────────────────────────────────────

test("parseMealLogInput: RECIPE requires recipeId, CUSTOM requires customIngredientId", () => {
  assert.equal(parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE" }).ok, false);
  assert.equal(parseMealLogInput({ localDate: "2026-07-19", mealType: "snack", source: "CUSTOM" }).ok, false);
  assert.ok(parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1" }).ok);
  assert.ok(parseMealLogInput({ localDate: "2026-07-19", mealType: "snack", source: "CUSTOM", customIngredientId: "c1" }).ok);
});

test("parseMealLogInput: MANUAL/PICTURE/FRIDGE require a perServing object", () => {
  assert.equal(parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "PICTURE", name: "x" }).ok, false);
});

// ─── batch bounds ──────────────────────────────────────────────────────────

test("parseBatchInput: 1-50 items, shared localDate/mealType required", () => {
  const item = { source: "PICTURE", name: "x", servings: 1, perServing: { calories: 10 }, clientRequestId: "a" };
  assert.equal(parseBatchInput({ localDate: "2026-07-19", mealType: "lunch", items: [] }).ok, false);
  const many = { localDate: "2026-07-19", mealType: "lunch", items: Array.from({ length: 51 }, (_, i) => ({ ...item, clientRequestId: `k${i}` })) };
  assert.equal(parseBatchInput(many).ok, false);
  const ok = parseBatchInput({ localDate: "2026-07-19", mealType: "lunch", items: [item] });
  assert.ok(ok.ok);
  assert.equal(ok.value.items.length, 1);
  assert.equal(ok.value.items[0].localDate, "2026-07-19");
  assert.equal(ok.value.items[0].mealType, "lunch");
  // envelope localDate still required
  assert.equal(parseBatchInput({ mealType: "lunch", items: [item] }).ok, false);
  // a bad item fails the whole batch
  assert.equal(parseBatchInput({ localDate: "2026-07-19", mealType: "lunch", items: [{ ...item, servings: 0 }] }).ok, false);
});

// ─── parsePatchInput ───────────────────────────────────────────────────────

test("parsePatchInput: validates provided fields, allows deletedAt:null (undo)", () => {
  assert.equal(parsePatchInput({ servings: 0 }).ok, false);
  assert.equal(parsePatchInput({ mealType: "brunch" }).ok, false);
  assert.equal(parsePatchInput({ localDate: "2026-7-9" }).ok, false);
  assert.equal(parsePatchInput({ perServing: { calories: -3 } }).ok, false);
  const undo = parsePatchInput({ deletedAt: null });
  assert.ok(undo.ok);
  assert.equal(undo.value.deletedAt, null);
  const edit = parsePatchInput({ servings: 2.5, mealType: "dinner", name: "New" });
  assert.ok(edit.ok);
  assert.equal(edit.value.servings, 2.5);
});

// ─── resolveSnapshot — branch selection per source ─────────────────────────

test("resolveSnapshot: RECIPE prices server-side and IGNORES client macros", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1", servings: 1, perServing: { calories: 99999 } });
  assert.ok(parsed.ok);
  const out = resolveSnapshot(parsed.value, { recipe: { calories: 400, protein: 20, carbs: 40, fat: 10, fiber: 2, servings: 2, name: "Bowl" } });
  // 400 kcal whole dish / 2 servings = 200 per serving; client's 99999 ignored.
  assert.equal(out.snapshot.calories, 200);
  assert.equal(out.name, "Bowl");
});

test("resolveSnapshot: CUSTOM stores per-unit macros verbatim, fiber 0, no incomplete", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "snack", source: "CUSTOM", customIngredientId: "c1", servings: 2 });
  assert.ok(parsed.ok);
  const out = resolveSnapshot(parsed.value, { customIngredient: { calories: 50, protein: 3, carbs: 1, fat: 0, name: "Almonds" } });
  // per-UNIT, NOT scaled by servings here (servings applied once at read)
  assert.equal(out.snapshot.calories, 50);
  assert.equal(out.snapshot.fiber, 0);
  assert.equal(out.snapshot.incomplete, false);
  assert.equal(out.name, "Almonds");
});

test("resolveSnapshot: MANUAL uses caller macros and its supplied name", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "Salad", servings: 1, perServing: { calories: 420, protein: 38 } });
  assert.ok(parsed.ok);
  const out = resolveSnapshot(parsed.value, {});
  assert.equal(out.snapshot.calories, 420);
  assert.equal(out.snapshot.protein, 38);
  assert.equal(out.name, "Salad");
  // missing carbs/fat/fiber → incomplete flagged
  assert.equal(out.snapshot.incomplete, true);
});

// ─── buildMealLogCreateData ────────────────────────────────────────────────

test("buildMealLogCreateData: assembles Prisma row from parsed input + snapshot (unrounded per-serving)", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1", servings: 1.5, journalMealId: "cjm_9", clientRequestId: "b3f0" });
  assert.ok(parsed.ok);
  const snap = { calories: 460.037, protein: 34, carbs: 44, fat: 14, fiber: 4, incomplete: false };
  const data = buildMealLogCreateData("pat_1", parsed.value, { snapshot: snap, name: "Salmon" });
  assert.equal(data.patientId, "pat_1");
  assert.equal(data.name, "Salmon");
  assert.equal(data.servings, 1.5);
  assert.equal(data.calories, 460.037); // stored UNROUNDED
  assert.equal(data.recipeId, "r1");
  assert.equal(data.journalMealId, "cjm_9");
  assert.equal(data.clientRequestId, "b3f0");
  assert.equal(data.incomplete, false);
});

// ─── buildMealLogUpsertArgs — PINNED update: {} ────────────────────────────

test("buildMealLogUpsertArgs: create-or-return-existing with pinned no-op update", () => {
  const data = { patientId: "pat_1", clientRequestId: "crid_9", localDate: "2026-07-19", mealType: "lunch" } as Parameters<typeof buildMealLogUpsertArgs>[0];
  const args = buildMealLogUpsertArgs(data);
  assert.deepEqual(args.update, {}); // replay must NEVER clobber a landed edit
  assert.deepEqual(args.where, { patientId_clientRequestId: { patientId: "pat_1", clientRequestId: "crid_9" } });
  assert.equal(args.create, data);
});

// ─── buildMealLogLookupWhere — dual address, ownership-scoped ───────────────

test("buildMealLogLookupWhere: matches server id OR clientRequestId, scoped to patient", () => {
  assert.deepEqual(buildMealLogLookupWhere("pat_1", "abc"), {
    patientId: "pat_1",
    OR: [{ id: "abc" }, { clientRequestId: "abc" }],
  });
});

// ─── serializeMealLog — DTO with r1 perServing + scaled totals ─────────────

test("serializeMealLog: perServing r1 at boundary, totals scaled by servings", () => {
  const row = {
    id: "clog_01", localDate: "2026-07-19", mealType: "dinner", source: "RECIPE" as const,
    name: "Salmon", servings: 1.5,
    calories: 460.04, protein: 34, carbs: 44, fat: 14, fiber: 4, incomplete: false,
    recipeId: "r1", customIngredientId: null, journalMealId: "cjm_9",
    pictureResultId: null, fridgeRecipeId: null, note: null,
    clientRequestId: "b3f0", deletedAt: null,
    loggedAt: new Date("2026-07-19T18:22:04.000Z"), updatedAt: new Date("2026-07-19T18:22:04.000Z"),
  };
  const dto = serializeMealLog(row);
  assert.equal(dto.perServing.calories, r1(460.04));
  assert.equal(dto.totals.calories, r1(460.04 * 1.5));
  assert.equal(dto.clientRequestId, "b3f0");
  assert.equal(dto.journalMealId, "cjm_9");
  assert.equal(dto.loggedAt, "2026-07-19T18:22:04.000Z");
});

// ─── computeRemaining — signed, null when target null ──────────────────────

test("computeRemaining: signed difference, null when target is null", () => {
  assert.equal(computeRemaining(null, { calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: false }), null);
  const rem = computeRemaining(
    { calories: 2100, protein: 158, carbs: 236, fat: 47, profile: "balanced", basis: "plan-ramp" },
    { calories: 1740, protein: 108, carbs: 190, fat: 55, fiber: 22, incomplete: false }
  );
  assert.deepEqual(rem, { calories: 360, protein: 50, carbs: 46, fat: -8 });
});
