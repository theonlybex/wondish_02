import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTriage, buildTriageMessage, maxSeverity } from "./triage-parse";

const open = [{ id: "iss1", title: "Shopping list shows meat to vegetarians", category: "WRONG_FOOD" }];

test("valid output passes through; title trimmed to 90", () => {
  const r = parseTriage({ category: "UI", severity: "LOW", title: "x".repeat(120), duplicateOf: null, reasoning: "cosmetic" }, "The button is misaligned on mobile", open);
  assert.equal(r.category, "UI");
  assert.equal(r.severity, "LOW");
  assert.equal(r.title.length, 90);
});

test("unknown enums fall back to OTHER / MEDIUM", () => {
  const r = parseTriage({ category: "COSMIC", severity: "URGENT", title: "t", duplicateOf: null }, "Something odd happened here", open);
  assert.deepEqual([r.category, r.severity], ["OTHER", "MEDIUM"]);
});

test("duplicateOf must be one of the open issues sent", () => {
  assert.equal(parseTriage({ category: "UI", severity: "LOW", title: "t", duplicateOf: "iss1" }, "dup of the vegetarian thing", open).duplicateOf, "iss1");
  assert.equal(parseTriage({ category: "UI", severity: "LOW", title: "t", duplicateOf: "made-up" }, "something else entirely", open).duplicateOf, null);
});

test("safety text forces SAFETY_FOOD / CRITICAL even if the model said LOW", () => {
  const r = parseTriage({ category: "UI", severity: "LOW", title: "minor", duplicateOf: null }, "I'm vegan and got chicken, minor", open);
  assert.deepEqual([r.category, r.severity], ["SAFETY_FOOD", "CRITICAL"]);
});

test("model choosing SAFETY_FOOD is CRITICAL", () => {
  assert.equal(parseTriage({ category: "SAFETY_FOOD", severity: "MEDIUM", title: "t", duplicateOf: null }, "The dish had something I avoid", open).severity, "CRITICAL");
});

test("garbage input never throws", () => {
  const r = parseTriage(null, "The page froze when I saved", open);
  assert.deepEqual([r.category, r.severity, r.duplicateOf], ["OTHER", "MEDIUM", null]);
  assert.ok(r.title.length > 0);
});

test("prompt carries the report and open issue titles, no profile data", () => {
  const m = buildTriageMessage({ text: "Plan shows bacon", area: "meal-plan", context: { from: "/meal-plan", tier: "free" } }, open);
  assert.match(m, /Plan shows bacon/);
  assert.match(m, /iss1 · WRONG_FOOD · Shopping list shows meat to vegetarians/);
});

test("maxSeverity never lowers", () => {
  assert.equal(maxSeverity("CRITICAL", "LOW"), "CRITICAL");
  assert.equal(maxSeverity("LOW", "HIGH"), "HIGH");
});
