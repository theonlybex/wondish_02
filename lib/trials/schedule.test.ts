import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseFor, dayNumber, phaseWindows, isEnforced, startDateFor, addDays } from "./schedule";

const rule = { baselineDays: 7, trialDays: 28, reintroductionDays: 3, washoutDays: 3 };
const start = new Date(2026, 8, 20); // 20 Sep 2026, local

const at = (n: number) => phaseFor(rule, start, addDays(start, n - 1));

test("phase boundaries follow the workbook schedule", () => {
  assert.deepEqual([at(-6).phase, at(-6).dayInPhase], ["BASELINE", 1]);
  assert.deepEqual([at(0).phase, at(0).dayInPhase, at(0).phaseLength], ["BASELINE", 7, 7]);
  assert.deepEqual([at(1).phase, at(1).dayInPhase, at(1).phaseLength], ["ELIMINATION", 1, 27]);
  assert.deepEqual([at(27).phase, at(27).dayInPhase], ["ELIMINATION", 27]);
  assert.deepEqual([at(28).phase, at(28).dayInPhase], ["EVALUATION", 1]);
  assert.deepEqual([at(29).phase, at(29).dayInPhase, at(29).phaseLength], ["REINTRODUCTION", 1, 3]);
  assert.deepEqual([at(31).phase, at(31).dayInPhase], ["REINTRODUCTION", 3]);
  assert.deepEqual([at(32).phase, at(32).dayInPhase, at(32).phaseLength], ["WASHOUT", 1, 3]);
  assert.deepEqual([at(34).phase, at(34).dayInPhase], ["WASHOUT", 3]);
  assert.deepEqual([at(35).phase, at(35).dayInPhase, at(35).phaseLength, at(35).nextPhaseOn], ["FINAL", 1, 0, null]);
  assert.equal(at(1).dayNumber, 1);
  assert.equal(at(-6).dayNumber, -6);
});

test("nextPhaseOn points at the first day of the following phase", () => {
  assert.deepEqual(at(0).nextPhaseOn, start);
  assert.deepEqual(at(10).nextPhaseOn, addDays(start, 27));
  assert.deepEqual(at(28).nextPhaseOn, addDays(start, 28));
  assert.deepEqual(at(30).nextPhaseOn, addDays(start, 31));
  assert.deepEqual(at(33).nextPhaseOn, addDays(start, 34));
});

test("enforcement: elimination, evaluation, washout and final ban; baseline and reintroduction do not", () => {
  assert.equal(isEnforced("BASELINE"), false);
  assert.equal(isEnforced("ELIMINATION"), true);
  assert.equal(isEnforced("EVALUATION"), true);
  assert.equal(isEnforced("REINTRODUCTION"), false);
  assert.equal(isEnforced("WASHOUT"), true);
  assert.equal(isEnforced("FINAL"), true);
});

test("day arithmetic survives a DST change (US, 8 Mar 2026)", () => {
  const s = new Date(2026, 2, 7);
  assert.equal(dayNumber(s, new Date(2026, 2, 9)), 3);
  assert.equal(dayNumber(s, new Date(2026, 2, 9, 23, 30)), 3);
  assert.equal(dayNumber(s, new Date(2026, 2, 6, 0, 5)), 0);
});

test("phaseWindows and startDateFor", () => {
  const w = phaseWindows(rule, start);
  assert.deepEqual(w.BASELINE.from, addDays(start, -7));
  assert.deepEqual(w.BASELINE.to, addDays(start, -1));
  assert.deepEqual(w.EVALUATION.from, addDays(start, 27));
  assert.deepEqual(w.WASHOUT.to, addDays(start, 33));
  assert.equal(w.FINAL.to, null);
  const today = new Date(2026, 8, 10, 15, 42);
  assert.deepEqual(startDateFor(rule, today, false), new Date(2026, 8, 17));
  assert.deepEqual(startDateFor(rule, today, true), new Date(2026, 8, 10));
});
