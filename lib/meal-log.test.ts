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
  nullableMacroColumns,
  isCallerSuppliedMacroSource,
  serializeMealLog,
  computeRemaining,
  encodeDeltaCursor,
  decodeDeltaCursor,
  parseDeltaSyncParam,
  buildDeltaWhere,
  buildNextDeltaCursor,
  DELTA_PAGE_SIZE,
  type DeltaCursor,
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

// ─── RESTAURANT — restaurantDishId/RESTAURANT pairing (mirrors recipeId/RECIPE) ─

test("parseMealLogInput: RESTAURANT requires restaurantDishId", () => {
  const missing = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT" });
  assert.equal(missing.ok, false);
  assert.match((missing as { error: string }).error, /restaurantDishId/i);
  const ok = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT", restaurantDishId: "rd_1" });
  assert.ok(ok.ok);
  assert.equal(ok.value.restaurantDishId, "rd_1");
  // name optional (server defaults it from the dish, same as RECIPE)
  assert.equal(ok.value.name, undefined);
});

test("parseMealLogInput: restaurantDishId supplied with a non-RESTAURANT source is rejected", () => {
  const withManual = parseMealLogInput({
    localDate: "2026-07-19", mealType: "dinner", source: "MANUAL", name: "x",
    perServing: { calories: 1 }, restaurantDishId: "rd_1",
  });
  assert.equal(withManual.ok, false);
  const withRecipe = parseMealLogInput({
    localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1", restaurantDishId: "rd_1",
  });
  assert.equal(withRecipe.ok, false);
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

test("parseBatchInput: a RESTAURANT item validates and resolves/prices identically to the single-write path", () => {
  const batch = parseBatchInput({
    localDate: "2026-07-19",
    mealType: "dinner",
    items: [{ source: "RESTAURANT", restaurantDishId: "rd_1", servings: 1, clientRequestId: "b1" }],
  });
  assert.ok(batch.ok);
  const item = batch.value.items[0];
  assert.equal(item.source, "RESTAURANT");
  assert.equal(item.restaurantDishId, "rd_1");
  const resolved = resolveSnapshot(item, {
    restaurantDish: { calories: 500, protein: 25, carbs: 40, fat: 15, fiber: 3, name: "Pad Thai" },
  });
  const data = buildMealLogCreateData("pat_1", item, resolved);
  assert.equal(data.name, "Pad Thai");
  assert.equal(data.calories, 500);
  assert.equal(data.restaurantDishId, "rd_1");
  assert.equal(data.incomplete, false);
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

test("resolveSnapshot: RESTAURANT prices server-side from the dish's whole-dish macro columns and IGNORES client macros", () => {
  const parsed = parseMealLogInput({
    localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT", restaurantDishId: "rd_1",
    servings: 1, perServing: { calories: 99999 },
  });
  assert.ok(parsed.ok);
  const out = resolveSnapshot(parsed.value, {
    restaurantDish: { calories: 650, protein: 30, carbs: 60, fat: 20, fiber: 5, name: "Olive & Vine Bowl" },
  });
  // RestaurantDish macros are whole-dish (no servings divisor) — per-serving IS the dish; client's 99999 ignored.
  assert.equal(out.snapshot.calories, 650);
  assert.equal(out.snapshot.protein, 30);
  assert.equal(out.snapshot.incomplete, false);
  assert.equal(out.name, "Olive & Vine Bowl");
});

test("resolveSnapshot: RESTAURANT null-macro dish → incomplete (same convention as RECIPE)", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT", restaurantDishId: "rd_2" });
  assert.ok(parsed.ok);
  const out = resolveSnapshot(parsed.value, {
    restaurantDish: { calories: null, protein: null, carbs: null, fat: null, fiber: null, name: "Mystery Plate" },
  });
  assert.equal(out.snapshot.calories, 0);
  assert.equal(out.snapshot.incomplete, true);
  assert.equal(out.name, "Mystery Plate");
});

test("resolveSnapshot: RESTAURANT source without a resolved dish dep throws (route's 404-not-found guard)", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT", restaurantDishId: "rd_missing" });
  assert.ok(parsed.ok);
  assert.throws(() => resolveSnapshot(parsed.value, {}));
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
    recipeId: "r1", restaurantDishId: null, customIngredientId: null, journalMealId: "cjm_9",
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

// ─── nullable macro columns — blank ≠ 0 (unset macros survive) ─────────────
// The write half of the null/0 distinction: an absent caller-supplied field is
// stored as a NULL column (genuinely unknown), never coerced to 0, and flags
// incomplete. RECIPE/CUSTOM never reach this path (their priced snapshot is
// stored verbatim).

test("nullableMacroColumns: absent fields become null columns and flag incomplete", () => {
  const cols = nullableMacroColumns({ calories: 400 });
  assert.equal(cols.calories, 400);
  assert.equal(cols.protein, null);
  assert.equal(cols.carbs, null);
  assert.equal(cols.fat, null);
  assert.equal(cols.fiber, null);
  assert.equal(cols.incomplete, true);
});

test("nullableMacroColumns: an explicit 0 is kept (0 ≠ unset) and a full set is complete", () => {
  const cols = nullableMacroColumns({ calories: 400, protein: 0, carbs: 50, fat: 12, fiber: 3 });
  assert.equal(cols.protein, 0); // explicit zero preserved, NOT turned into null
  assert.equal(cols.incomplete, false);
});

test("buildMealLogCreateData: MANUAL blank macro is stored NULL (not 0), incomplete true", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "Soup", perServing: { calories: 400 } });
  assert.ok(parsed.ok);
  const resolved = resolveSnapshot(parsed.value, {});
  const data = buildMealLogCreateData("pat_1", parsed.value, resolved);
  assert.equal(data.calories, 400);
  assert.equal(data.protein, null); // NOT 0 — genuinely unset
  assert.equal(data.carbs, null);
  assert.equal(data.fat, null);
  assert.equal(data.incomplete, true);
});

test("buildMealLogCreateData: RECIPE stores its server-priced snapshot verbatim (0s stay 0)", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RECIPE", recipeId: "r1", servings: 1 });
  assert.ok(parsed.ok);
  const snap = { calories: 200, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: false };
  const data = buildMealLogCreateData("pat_1", parsed.value, { snapshot: snap, name: "Bowl" });
  assert.equal(data.protein, 0); // RECIPE never goes through nullableMacroColumns
  assert.equal(data.incomplete, false);
});

test("buildMealLogCreateData: RESTAURANT stores its server-priced snapshot verbatim (0s stay 0) and carries restaurantDishId", () => {
  const parsed = parseMealLogInput({ localDate: "2026-07-19", mealType: "dinner", source: "RESTAURANT", restaurantDishId: "rd_1", servings: 1 });
  assert.ok(parsed.ok);
  const snap = { calories: 650, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: false };
  const data = buildMealLogCreateData("pat_1", parsed.value, { snapshot: snap, name: "Bowl" });
  assert.equal(data.protein, 0); // RESTAURANT never goes through nullableMacroColumns
  assert.equal(data.incomplete, false);
  assert.equal(data.restaurantDishId, "rd_1");
  assert.equal(data.recipeId, null);
});

test("buildMealLogCreateData: FRIDGE stores caller-supplied perServing verbatim and persists fridgeRecipeId (no server pricing)", () => {
  const parsed = parseMealLogInput({
    localDate: "2026-07-19",
    mealType: "dinner",
    source: "FRIDGE",
    name: "Chickpea & Spinach Skillet",
    servings: 1,
    perServing: { calories: 420, protein: 22, carbs: 48, fat: 15, fiber: 9 },
    fridgeRecipeId: "frg_abc123",
  });
  assert.ok(parsed.ok);
  // resolveSnapshot is handed no recipe/customIngredient/restaurantDish dep —
  // proves the FRIDGE branch never invokes server pricing (unlike RECIPE/
  // CUSTOM/RESTAURANT, which throw without their dep).
  const resolved = resolveSnapshot(parsed.value, {});
  const data = buildMealLogCreateData("pat_1", parsed.value, resolved);
  assert.equal(data.calories, 420);
  assert.equal(data.protein, 22);
  assert.equal(data.carbs, 48);
  assert.equal(data.fat, 15);
  assert.equal(data.fiber, 9);
  assert.equal(data.incomplete, false); // all five fields supplied
  assert.equal(data.fridgeRecipeId, "frg_abc123");
  assert.equal(data.recipeId, null); // fridgeRecipeId and recipeId are distinct columns
  assert.equal(data.name, "Chickpea & Spinach Skillet");
});

test("isCallerSuppliedMacroSource: MANUAL/PICTURE/FRIDGE own their macros; RECIPE/CUSTOM/RESTAURANT are server-priced", () => {
  assert.equal(isCallerSuppliedMacroSource("MANUAL"), true);
  assert.equal(isCallerSuppliedMacroSource("PICTURE"), true);
  assert.equal(isCallerSuppliedMacroSource("FRIDGE"), true);
  // The PATCH route uses this to reject a client perServing that would otherwise
  // overwrite a priced RECIPE/CUSTOM/RESTAURANT snapshot.
  assert.equal(isCallerSuppliedMacroSource("RECIPE"), false);
  assert.equal(isCallerSuppliedMacroSource("CUSTOM"), false);
  assert.equal(isCallerSuppliedMacroSource("RESTAURANT"), false);
});

// ─── serializeMealLog — nullable perServing preserves unset macros ─────────

test("serializeMealLog: null column serializes to null perServing (not 0), incomplete preserved", () => {
  const row = {
    id: "clog_02", localDate: "2026-07-19", mealType: "lunch", source: "MANUAL" as const,
    name: "Soup", servings: 2,
    calories: 400, protein: null, carbs: null, fat: null, fiber: null, incomplete: true,
    recipeId: null, restaurantDishId: null, customIngredientId: null, journalMealId: null,
    pictureResultId: null, fridgeRecipeId: null, note: null,
    clientRequestId: "k1", deletedAt: null,
    loggedAt: new Date("2026-07-19T12:00:00.000Z"), updatedAt: new Date("2026-07-19T12:00:00.000Z"),
  };
  const dto = serializeMealLog(row);
  assert.equal(dto.perServing.calories, 400);
  assert.equal(dto.perServing.protein, null); // unset, NOT 0
  assert.equal(dto.perServing.incomplete, true);
  // totals still coerce null→0 for summation (unchanged semantics)
  assert.equal(dto.totals.calories, r1(400 * 2));
  assert.equal(dto.totals.protein, 0);
  assert.equal(dto.totals.incomplete, true);
});

test("serializeMealLog: restaurantDishId is carried on the read envelope exactly as recipeId is (provenance, nullable)", () => {
  const base = {
    id: "clog_rd1", localDate: "2026-07-19", mealType: "dinner", name: "Bowl", servings: 1,
    calories: 650, protein: 30, carbs: 60, fat: 20, fiber: 5, incomplete: false,
    customIngredientId: null, journalMealId: null,
    pictureResultId: null, fridgeRecipeId: null, note: null,
    clientRequestId: null, deletedAt: null,
    loggedAt: new Date("2026-07-19T18:22:04.000Z"), updatedAt: new Date("2026-07-19T18:22:04.000Z"),
  };
  const withDish = serializeMealLog({ ...base, source: "RESTAURANT" as const, recipeId: null, restaurantDishId: "rd_1" });
  assert.equal(withDish.restaurantDishId, "rd_1");
  assert.equal(withDish.recipeId, null);
  // A non-RESTAURANT row's restaurantDishId column is null (SetNull provenance, never read for macro math).
  const recipeRow = serializeMealLog({ ...base, source: "RECIPE" as const, recipeId: "r1", restaurantDishId: null });
  assert.equal(recipeRow.restaurantDishId, null);
});

test("serializeMealLog: unit label only attaches for CUSTOM rows", () => {
  const base = {
    id: "clog_03", localDate: "2026-07-19", mealType: "snack" as const,
    name: "Almonds", servings: 2, calories: 50, protein: 3, carbs: 1, fat: 0, fiber: 0, incomplete: false,
    recipeId: null, restaurantDishId: null, customIngredientId: "ci_1", journalMealId: null,
    pictureResultId: null, fridgeRecipeId: null, note: null,
    clientRequestId: null, deletedAt: null,
    loggedAt: new Date("2026-07-19T15:00:00.000Z"), updatedAt: new Date("2026-07-19T15:00:00.000Z"),
  };
  assert.equal(serializeMealLog({ ...base, source: "CUSTOM" }, "cups").unit, "cups");
  // A non-CUSTOM row ignores any passed unit.
  assert.equal(serializeMealLog({ ...base, source: "MANUAL" }, "cups").unit, null);
  // CUSTOM with no known unit → null.
  assert.equal(serializeMealLog({ ...base, source: "CUSTOM" }).unit, null);
});

test("null macro survives serialize → edit-prefill → patch round-trip without becoming 0", () => {
  // 1. Create MANUAL with only calories filled; protein left blank.
  const created = parseMealLogInput({ localDate: "2026-07-19", mealType: "lunch", source: "MANUAL", name: "Soup", perServing: { calories: 400 } });
  assert.ok(created.ok);
  const data = buildMealLogCreateData("pat_1", created.value, resolveSnapshot(created.value, {}));

  // 2. The stored row (protein null column) is serialized to the DTO.
  const row = {
    id: "clog_rt", localDate: data.localDate, mealType: data.mealType, source: "MANUAL" as const,
    name: data.name, servings: data.servings,
    calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat, fiber: data.fiber,
    incomplete: data.incomplete,
    recipeId: null, restaurantDishId: null, customIngredientId: null, journalMealId: null,
    pictureResultId: null, fridgeRecipeId: null, note: null,
    clientRequestId: "rt", deletedAt: null,
    loggedAt: new Date("2026-07-19T12:00:00.000Z"), updatedAt: new Date("2026-07-19T12:00:00.000Z"),
  };
  const dto = serializeMealLog(row);
  assert.equal(dto.perServing.protein, null);
  assert.equal(dto.perServing.incomplete, true);

  // 3. Modal prefill: null → blank input; a re-save omits blank fields entirely.
  const prefill = {
    calories: dto.perServing.calories == null ? "" : String(dto.perServing.calories),
    protein: dto.perServing.protein == null ? "" : String(dto.perServing.protein),
  };
  const patchPerServing: Record<string, number> = {};
  for (const [k, v] of Object.entries(prefill)) {
    const t = v.trim();
    if (t) patchPerServing[k] = Number(t); // blanks (protein) omitted
  }

  // 4. The PATCH re-derives columns; protein STILL null, still incomplete.
  const patch = parsePatchInput({ servings: dto.servings, perServing: patchPerServing });
  assert.ok(patch.ok);
  const cols = nullableMacroColumns(patch.value.perServing);
  assert.equal(cols.calories, 400);
  assert.equal(cols.protein, null); // never became 0
  assert.equal(cols.incomplete, true);
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

// ─── Delta-sync cursor — compound (updatedAt, id) ───────────────────────────
// Covers the fix for silent data loss when a same-`updatedAt` cluster (batch
// $transaction writes) straddles the DELTA_PAGE_SIZE page boundary: a plain
// `updatedAt`-only cursor would permanently skip the remainder of the
// cluster on the follow-up request. See lib/meal-log.ts for the full writeup.

test("encodeDeltaCursor/decodeDeltaCursor: round-trips updatedAt + id", () => {
  const updatedAt = new Date("2026-07-19T18:22:04.123Z");
  const cursor = encodeDeltaCursor(updatedAt, "clog_abc123");
  assert.equal(typeof cursor, "string");
  const decoded = decodeDeltaCursor(cursor);
  assert.ok(decoded);
  assert.equal(decoded!.updatedAt.getTime(), updatedAt.getTime());
  assert.equal(decoded!.id, "clog_abc123");
});

test("decodeDeltaCursor: rejects malformed / garbage / structurally-wrong input", () => {
  assert.equal(decodeDeltaCursor(""), null);
  assert.equal(decodeDeltaCursor("not-a-cursor-at-all"), null);
  assert.equal(decodeDeltaCursor("2026-07-19T18:22:04.000Z"), null); // plain ISO, not a cursor
  // valid base64url, but decodes to JSON missing required fields
  const badShape = Buffer.from(JSON.stringify({ u: "2026-07-19T18:22:04.000Z" }), "utf8").toString("base64url");
  assert.equal(decodeDeltaCursor(badShape), null); // missing id
  const badDate = Buffer.from(JSON.stringify({ u: "not-a-date", i: "clog_1" }), "utf8").toString("base64url");
  assert.equal(decodeDeltaCursor(badDate), null);
  const emptyId = Buffer.from(JSON.stringify({ u: "2026-07-19T18:22:04.000Z", i: "" }), "utf8").toString("base64url");
  assert.equal(decodeDeltaCursor(emptyId), null);
  // valid base64url, valid JSON, but not an object (e.g. a bare number)
  const notObj = Buffer.from("42", "utf8").toString("base64url");
  assert.equal(decodeDeltaCursor(notObj), null);
});

test("parseDeltaSyncParam: null/empty is rejected (400)", () => {
  assert.equal(parseDeltaSyncParam(null).ok, false);
  assert.equal(parseDeltaSyncParam("").ok, false);
});

test("parseDeltaSyncParam: plain ISO-8601 (page 1) parses to since with no cursor", () => {
  const r = parseDeltaSyncParam("2026-07-19T18:22:04.000Z");
  assert.ok(r.ok);
  assert.equal(r.value.cursor, null);
  assert.equal(r.value.since.toISOString(), "2026-07-19T18:22:04.000Z");
});

test("parseDeltaSyncParam: malformed (neither ISO nor a valid cursor) is rejected (400)", () => {
  const r = parseDeltaSyncParam("not-a-timestamp-or-cursor");
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 400);
  assert.match((r as { error: string }).error, /updatedSince/i);
});

test("parseDeltaSyncParam: an echoed-back compound cursor decodes to since+cursor", () => {
  const updatedAt = new Date("2026-07-19T18:22:04.500Z");
  const encoded = encodeDeltaCursor(updatedAt, "clog_xyz789");
  const r = parseDeltaSyncParam(encoded);
  assert.ok(r.ok);
  assert.ok(r.value.cursor);
  assert.equal(r.value.cursor!.id, "clog_xyz789");
  assert.equal(r.value.since.getTime(), updatedAt.getTime());
});

// ─── buildDeltaWhere / DELTA_ORDER_BY shape ─────────────────────────────────

test("buildDeltaWhere: first page (no cursor) is a plain updatedAt > since filter", () => {
  const since = new Date("2026-07-19T00:00:00.000Z");
  const where = buildDeltaWhere("pat_1", { since, cursor: null });
  assert.deepEqual(where, { patientId: "pat_1", updatedAt: { gt: since } });
});

test("buildDeltaWhere: compound page ties on id at the boundary timestamp", () => {
  const updatedAt = new Date("2026-07-19T00:00:00.000Z");
  const cursor: DeltaCursor = { updatedAt, id: "clog_500" };
  const where = buildDeltaWhere("pat_1", { since: updatedAt, cursor });
  assert.deepEqual(where, {
    patientId: "pat_1",
    OR: [{ updatedAt: { gt: updatedAt } }, { updatedAt, id: { gt: "clog_500" } }],
  });
});

test("buildNextDeltaCursor: null on a short (final) page, opaque cursor when the page is full", () => {
  const rows = [{ updatedAt: new Date("2026-07-19T00:00:00.000Z"), id: "clog_1" }];
  assert.equal(buildNextDeltaCursor(rows), null);

  const full = Array.from({ length: DELTA_PAGE_SIZE }, (_, i) => ({
    updatedAt: new Date(2026, 6, 19, 0, 0, 0, i),
    id: `clog_${String(i).padStart(4, "0")}`,
  }));
  const cursor = buildNextDeltaCursor(full);
  assert.ok(cursor);
  const decoded = decodeDeltaCursor(cursor!);
  const last = full[full.length - 1];
  assert.equal(decoded!.id, last.id);
  assert.equal(decoded!.updatedAt.getTime(), last.updatedAt.getTime());
});

// ─── Simulated same-timestamp-boundary pagination (no drop, no dup) ────────
// A minimal in-memory interpreter for the two where-shapes buildDeltaWhere
// produces — enough to replay what Prisma would actually return, proving the
// real query builder (not a hand-rolled equivalent) never drops or
// duplicates rows when a same-`updatedAt` cluster straddles the page edge.

interface FakeRow {
  id: string;
  patientId: string;
  updatedAt: Date;
}

function matchesDeltaWhere(row: FakeRow, where: ReturnType<typeof buildDeltaWhere>): boolean {
  if (row.patientId !== where.patientId) return false;
  if ("OR" in where) {
    const [gtClause, tieClause] = where.OR;
    if (row.updatedAt.getTime() > gtClause.updatedAt.gt.getTime()) return true;
    return row.updatedAt.getTime() === tieClause.updatedAt.getTime() && row.id > tieClause.id.gt;
  }
  return row.updatedAt.getTime() > where.updatedAt.gt.getTime();
}

function fetchDeltaPage(rows: FakeRow[], patientId: string, param: Parameters<typeof buildDeltaWhere>[1]): FakeRow[] {
  const where = buildDeltaWhere(patientId, param);
  const matched = rows.filter((r) => matchesDeltaWhere(r, where));
  matched.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matched.slice(0, DELTA_PAGE_SIZE);
}

test("simulated pagination: a same-updatedAt cluster straddling the page boundary is never dropped or duplicated", () => {
  const patientId = "pat_1";
  const clusterTs = new Date("2026-07-19T12:00:00.000Z");

  // Build DELTA_PAGE_SIZE + 250 rows: the first (DELTA_PAGE_SIZE - 5) rows get
  // strictly increasing timestamps (one per ms), then 250 rows share the
  // EXACT SAME updatedAt (`clusterTs`) — straddling the boundary at index
  // DELTA_PAGE_SIZE - 5..+245. A plain updatedAt cursor would drop rows
  // clusterTs-tagged rows past whatever page-1 happened to take.
  const rows: FakeRow[] = [];
  const preClusterCount = DELTA_PAGE_SIZE - 5;
  for (let i = 0; i < preClusterCount; i++) {
    rows.push({ id: `pre_${String(i).padStart(5, "0")}`, patientId, updatedAt: new Date(clusterTs.getTime() - (preClusterCount - i) * 1000) });
  }
  const clusterSize = 250;
  for (let i = 0; i < clusterSize; i++) {
    // ids intentionally NOT in a sorted-friendly pattern relative to insertion,
    // just unique — pagination correctness must not depend on id/time correlation.
    rows.push({ id: `clu_${String(i).padStart(5, "0")}`, patientId, updatedAt: new Date(clusterTs.getTime()) });
  }
  // a few rows strictly after the cluster too
  for (let i = 0; i < 10; i++) {
    rows.push({ id: `post_${String(i).padStart(5, "0")}`, patientId, updatedAt: new Date(clusterTs.getTime() + (i + 1) * 1000) });
  }

  const since = new Date(clusterTs.getTime() - preClusterCount * 1000 - 1);
  let param: Parameters<typeof buildDeltaWhere>[1] = { since, cursor: null };
  const seen: FakeRow[] = [];
  let pages = 0;
  for (;;) {
    pages++;
    assert.ok(pages < 20, "pagination did not terminate — possible infinite loop");
    const page = fetchDeltaPage(rows, patientId, param);
    seen.push(...page);
    if (page.length < DELTA_PAGE_SIZE) break; // short page → done
    const last = page[page.length - 1];
    const nextCursor = decodeDeltaCursor(buildNextDeltaCursor(page)!)!;
    param = { since: nextCursor.updatedAt, cursor: nextCursor };
    assert.equal(nextCursor.id, last.id);
  }

  assert.ok(pages >= 2, "test setup should force at least two pages to actually exercise the boundary");
  // No drops: every row from the source set was returned exactly once.
  assert.equal(seen.length, rows.length);
  const seenIds = seen.map((r) => r.id).sort();
  const allIds = rows.map((r) => r.id).sort();
  assert.deepEqual(seenIds, allIds);
  // No duplicates.
  assert.equal(new Set(seenIds).size, rows.length);
});
