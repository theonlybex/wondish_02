import { test } from "node:test";
import assert from "node:assert/strict";
import { logsSkill, makeLogsHandlers, type LogsDeps } from "./logs";
import type { ClaraContext } from "../types";
import type { MealLogRow } from "@/lib/meal-log";

const ctx: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-08-01",
  surface: "web",
  disabledSkills: [],
};

const row = (over: Partial<MealLogRow> = {}): MealLogRow =>
  ({
    id: "log-1",
    localDate: "2026-08-01",
    mealType: "lunch",
    source: "CLARA",
    name: "Ramen",
    servings: 1,
    calories: 550,
    protein: 24,
    carbs: null,
    fat: null,
    fiber: null,
    incomplete: true,
    recipeId: null,
    restaurantDishId: null,
    customIngredientId: null,
    journalMealId: null,
    pictureResultId: null,
    fridgeRecipeId: null,
    planExchangeId: null,
    note: null,
    clientRequestId: null,
    deletedAt: null,
    loggedAt: new Date("2026-08-01T12:00:00Z"),
    updatedAt: new Date("2026-08-01T12:00:00Z"),
    ...over,
  }) as MealLogRow;

function fakeDeps(over: Partial<LogsDeps> = {}) {
  const writes: unknown[] = [];
  const deletes: string[] = [];
  const deps: LogsDeps = {
    findRows: async () => [row()],
    findById: async (id) => (id === "log-1" ? row() : null),
    create: async (args) => {
      writes.push(args);
      return row();
    },
    softDelete: async (id) => {
      deletes.push(id);
    },
    ...over,
  };
  return { deps, writes, deletes };
}
const h = (deps: LogsDeps) => makeLogsHandlers(deps);

// ── shape ──
test("the skill registers 4 logs_ tools with no identity fields", () => {
  assert.equal(logsSkill.name, "logs");
  assert.deepEqual(
    logsSkill.tools.map((t) => t.def.name),
    ["logs_search", "logs_day_summary", "logs_create", "logs_delete"]
  );
});

// ── search ──
test("search validates dates and caps the range at 90 days", async () => {
  const bad = await h(fakeDeps().deps).search(ctx, { fromDate: "garbage", toDate: "2026-08-01" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.reason, "INVALID_INPUT");
  const wide = await h(fakeDeps().deps).search(ctx, { fromDate: "2020-01-01", toDate: "2026-08-01" });
  assert.equal(!wide.ok && wide.reason, "OUT_OF_RANGE");
});

test("search returns serialized rows and an empty list is ok:true", async () => {
  const { deps } = fakeDeps({ findRows: async () => [] });
  const r = await h(deps).search(ctx, { fromDate: "2026-07-25", toDate: "2026-08-01" });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && (r.data as { items: unknown[] }).items, []);
});

test("search truncates at 51+ rows and says so", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row({ id: `log-${i}` }));
  const { deps } = fakeDeps({ findRows: async () => rows });
  const r = await h(deps).search(ctx, { fromDate: "2026-07-25", toDate: "2026-08-01" });
  assert.ok(r.ok);
  const data = r.ok ? (r.data as { items: unknown[]; truncated: boolean }) : null!;
  assert.equal(data.items.length, 50);
  assert.equal(data.truncated, true);
});

// ── day summary ──
test("day summary defaults to ctx.today and sums with null-safe totals", async () => {
  const asked: unknown[] = [];
  const { deps } = fakeDeps({
    findRows: async (q) => {
      asked.push(q);
      return [row(), row({ id: "log-2", calories: 300, protein: null, incomplete: true })];
    },
  });
  const r = await h(deps).daySummary(ctx, {});
  assert.ok(r.ok);
  const data = r.ok
    ? (r.data as { date: string; totals: { calories: number }; incompleteCount: number })
    : null!;
  assert.equal(data.date, "2026-08-01");
  assert.equal(data.totals.calories, 850);
  assert.equal(data.incompleteCount, 2);
  assert.equal((asked[0] as { fromDate: string }).fromDate, "2026-08-01");
});

// ── create ──
test("create forces source CLARA and derives clientRequestId from the tool call", async () => {
  const { deps, writes } = fakeDeps();
  const r = await h(deps).create(
    ctx,
    { name: "Tonkotsu ramen", mealType: "lunch", date: "2026-08-01", servings: 1, calories: 550, protein: 24 },
    "toolu_xyz"
  );
  assert.ok(r.ok);
  const args = writes[0] as {
    create: { source: string; clientRequestId: string; calories: number; carbs: null; incomplete: boolean; patientId: string };
  };
  assert.equal(args.create.source, "CLARA");
  assert.equal(args.create.clientRequestId, "clara:toolu_xyz");
  assert.equal(args.create.calories, 550);
  assert.equal(args.create.carbs, null);
  assert.equal(args.create.incomplete, true);
  assert.equal(args.create.patientId, "p1"); // ctx, never input
});

test("create with no stated macros still logs — all NULL + incomplete", async () => {
  const { deps, writes } = fakeDeps();
  const r = await h(deps).create(ctx, { name: "Mystery bowl", mealType: "dinner" }, "t2");
  assert.ok(r.ok);
  const args = writes[0] as { create: { calories: null; incomplete: boolean; localDate: string } };
  assert.equal(args.create.calories, null);
  assert.equal(args.create.incomplete, true);
  assert.equal(args.create.localDate, "2026-08-01"); // defaults to ctx.today
});

test("create rejects a bad mealType or absent name as INVALID_INPUT, not a throw", async () => {
  const r1 = await h(fakeDeps().deps).create(ctx, { name: "x", mealType: "brunch", date: "2026-08-01" }, "t");
  assert.equal(!r1.ok && r1.reason, "INVALID_INPUT");
  const r2 = await h(fakeDeps().deps).create(ctx, { mealType: "lunch", date: "2026-08-01" }, "t");
  assert.equal(!r2.ok && r2.reason, "INVALID_INPUT");
});

test("a create input cannot smuggle a server-priced source or foreign patient", async () => {
  const { deps, writes } = fakeDeps();
  await h(deps).create(
    ctx,
    { name: "x", mealType: "lunch", date: "2026-08-01", source: "RECIPE", patientId: "attacker", recipeId: "r-1" },
    "t"
  );
  const args = writes[0] as { create: { source: string; patientId: string; recipeId: null } };
  assert.equal(args.create.source, "CLARA");
  assert.equal(args.create.patientId, "p1");
  assert.equal(args.create.recipeId, null);
});

// ── delete ──
test("delete tombstones an owned row", async () => {
  const { deps, deletes } = fakeDeps();
  const r = await h(deps).del(ctx, { logId: "log-1" });
  assert.ok(r.ok);
  assert.deepEqual(deletes, ["log-1"]);
});

test("delete of a missing or foreign row is NOT_FOUND", async () => {
  const { deps, deletes } = fakeDeps({ findById: async () => null });
  const r = await h(deps).del(ctx, { logId: "someone-elses" });
  assert.equal(!r.ok && r.reason, "NOT_FOUND");
  assert.deepEqual(deletes, []);
});

test("delete of an already-deleted row is NOT_FOUND, not a second tombstone", async () => {
  const { deps, deletes } = fakeDeps({ findById: async () => row({ deletedAt: new Date() }) });
  const r = await h(deps).del(ctx, { logId: "log-1" });
  assert.equal(!r.ok && r.reason, "NOT_FOUND");
  assert.deepEqual(deletes, []);
});
