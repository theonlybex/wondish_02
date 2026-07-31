import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGapInput, gapSkill, GAP_CATEGORIES, GAP_DAILY_CAP } from "./gap";

test("a well-formed report normalizes", () => {
  const r = normalizeGapInput({
    category: "LOGS",
    summary: "wanted last week's meals",
    reason: "NOT_BUILT",
  });
  assert.deepEqual(r, {
    ok: true,
    value: { category: "LOGS", summary: "wanted last week's meals", reason: "NOT_BUILT" },
  });
});

test("reason defaults to NOT_BUILT", () => {
  const r = normalizeGapInput({ category: "GROCERY", summary: "add milk" });
  assert.equal(r.ok && r.value.reason, "NOT_BUILT");
});

test("an unknown category falls back to OTHER rather than failing the turn", () => {
  const r = normalizeGapInput({ category: "TELEPORTATION", summary: "beam me up" });
  assert.equal(r.ok && r.value.category, "OTHER");
});

test("an unknown reason falls back to NOT_BUILT", () => {
  const r = normalizeGapInput({ category: "LOGS", summary: "s", reason: "BECAUSE" });
  assert.equal(r.ok && r.value.reason, "NOT_BUILT");
});

test("summary is required and trimmed to 200 chars", () => {
  assert.equal(normalizeGapInput({ category: "LOGS" }).ok, false);
  assert.equal(normalizeGapInput({ category: "LOGS", summary: "   " }).ok, false);
  const long = normalizeGapInput({ category: "LOGS", summary: "x".repeat(500) });
  assert.equal(long.ok && long.value.summary.length, 200);
});

test("every planned skill has a category, plus OTHER", () => {
  for (const c of [
    "LOGS", "NUTRITION", "MEAL_PLAN", "JOURNAL", "SUPPLEMENTS", "FILTERS",
    "GROCERY", "RESTAURANTS", "FRIDGE", "EXCHANGES", "PROGRESS", "TASTE",
    "CUSTOM_INGREDIENTS", "BODY_GOALS", "OTHER",
  ]) {
    assert.ok(GAP_CATEGORIES.includes(c as never), `${c} missing`);
  }
});

test("gap_report takes no identity field and is capped per user per day", () => {
  const def = gapSkill.tools[0].def;
  assert.equal(def.name, "gap_report");
  assert.deepEqual(Object.keys(def.input_schema.properties).sort(), [
    "category",
    "reason",
    "summary",
  ]);
  assert.deepEqual(def.input_schema.required, ["category", "summary"]);
});

// A cap at or below the category count could only ever delete distinct-category
// signal: the unique (patient, category, day) index already bounds volume.
test("the daily cap sits above the category count so it cannot silence categories", () => {
  assert.ok(
    GAP_DAILY_CAP > GAP_CATEGORIES.length,
    `cap ${GAP_DAILY_CAP} must exceed ${GAP_CATEGORIES.length} categories`
  );
});

test("the tool's enums are exactly the stored enums — no drift", () => {
  const props = gapSkill.tools[0].def.input_schema.properties as Record<
    string,
    { enum?: string[] }
  >;
  assert.deepEqual(props.category.enum, [...GAP_CATEGORIES]);
});

// ─── handler behaviour (injectable deps, per the plan's factory shape) ───────

import { makeGapHandler, resolveGapReason, type GapDeps } from "./gap";
import type { ClaraContext } from "./types";

const ctx: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-07-31",
  surface: "web",
  disabledSkills: [],
};

function fakeDeps(over: Partial<GapDeps> = {}) {
  const writes: Parameters<GapDeps["write"]>[0][] = [];
  let budgetCalls = 0;
  const deps: GapDeps = {
    findExisting: async () => false,
    consumeDailyBudget: async () => {
      budgetCalls += 1;
      return true;
    },
    write: async (row) => {
      writes.push(row);
    },
    ...over,
  };
  return { deps, writes, budget: () => budgetCalls };
}

test("a new report consumes budget and writes one row", async () => {
  const { deps, writes, budget } = fakeDeps();
  const result = await makeGapHandler(deps)(ctx, { category: "LOGS", summary: "wanted last week" });
  assert.deepEqual(result, { ok: true, data: { recorded: true } });
  assert.equal(budget(), 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].localDate, "2026-07-31");
  assert.equal(writes[0].patientId, "p1");
});

// Repeats dedupe on the unique index anyway, so charging for them would let one
// category burn the whole daily allowance and lose every other category's signal.
test("a same-day repeat in the same category spends no budget and writes nothing", async () => {
  const { deps, writes, budget } = fakeDeps({ findExisting: async () => true });
  const result = await makeGapHandler(deps)(ctx, { category: "LOGS", summary: "again" });
  assert.deepEqual(result, { ok: true, data: { recorded: true, duplicate: true } });
  assert.equal(budget(), 0);
  assert.equal(writes.length, 0);
});

test("over the cap the report is dropped, but the user's chat is unaffected", async () => {
  const { deps, writes } = fakeDeps({ consumeDailyBudget: async () => false });
  const result = await makeGapHandler(deps)(ctx, { category: "LOGS", summary: "s" });
  assert.deepEqual(result, { ok: true, data: { recorded: false } });
  assert.equal(writes.length, 0);
});

test("a missing summary is rejected before any effect runs", async () => {
  const { deps, writes, budget } = fakeDeps();
  const result = await makeGapHandler(deps)(ctx, { category: "LOGS" });
  assert.equal(result.ok, false);
  assert.equal(budget(), 0);
  assert.equal(writes.length, 0);
});

test("the patient id written is the context's, never the model's input", async () => {
  const { deps, writes } = fakeDeps();
  await makeGapHandler(deps)(ctx, {
    category: "LOGS",
    summary: "s",
    patientId: "attacker",
    ctx: { patientId: "attacker" },
  });
  assert.equal(writes[0].patientId, "p1");
});

// ─── FLAGGED_OFF is a server verdict ────────────────────────────────────────
// A disabled skill has its tools and prompt fragment stripped from the request,
// so the model sees the same absence as "never built" and cannot tell them apart.

test("a category whose skill is switched off is recorded as FLAGGED_OFF", () => {
  assert.equal(resolveGapReason("FILTERS", "NOT_BUILT", ["profile"]), "FLAGGED_OFF");
});

test("the same category with its skill enabled stays NOT_BUILT", () => {
  assert.equal(resolveGapReason("FILTERS", "NOT_BUILT", []), "NOT_BUILT");
});

test("a model-claimed FLAGGED_OFF is downgraded — it cannot see config", () => {
  assert.equal(resolveGapReason("LOGS", "FLAGGED_OFF", []), "NOT_BUILT");
});

test("OUT_OF_SCOPE from the model is respected", () => {
  assert.equal(resolveGapReason("OTHER", "OUT_OF_SCOPE", ["profile"]), "OUT_OF_SCOPE");
});

test("the handler stores the server-resolved reason, not the model's", async () => {
  const { deps, writes } = fakeDeps();
  await makeGapHandler(deps)(
    { ...ctx, disabledSkills: ["profile"] },
    { category: "FILTERS", summary: "add shellfish", reason: "NOT_BUILT" }
  );
  assert.equal(writes[0].reason, "FLAGGED_OFF");
});
