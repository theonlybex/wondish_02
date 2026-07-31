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
  assert.equal(GAP_DAILY_CAP, 10);
});

test("the tool's enums are exactly the stored enums — no drift", () => {
  const props = gapSkill.tools[0].def.input_schema.properties as Record<
    string,
    { enum?: string[] }
  >;
  assert.deepEqual(props.category.enum, [...GAP_CATEGORIES]);
});
