import { test } from "node:test";
import assert from "node:assert/strict";
import { claraSignal, resetClaraSignalThrottle, setClaraSignalReporter, SIGNAL_REPORT_EVERY_MS } from "./signal";

test("a signal reaches the reporter with its kind, and a reporter that throws breaks nothing", () => {
  const seen: string[] = [];
  const before = setClaraSignalReporter((kind, detail) => seen.push(`${kind}|${detail}`));
  resetClaraSignalThrottle();
  try {
    claraSignal("steer-failed", "boom");
    claraSignal("kept-foods-slow");
    assert.deepEqual(seen, ["steer-failed|boom", "kept-foods-slow|"]);
    setClaraSignalReporter(() => {
      throw new Error("sentry down");
    });
    assert.doesNotThrow(() => claraSignal("brain-failed"));
  } finally {
    setClaraSignalReporter(before);
  }
});

test("one report per kind per minute: a burst is held back and counted in the next report", () => {
  const seen: string[] = [];
  const before = setClaraSignalReporter((kind, detail) => seen.push(`${kind}|${detail}`));
  resetClaraSignalThrottle();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const t0 = 1_000_000;
    claraSignal("library-failed", "db down", t0);
    for (let i = 1; i <= 500; i++) claraSignal("library-failed", "db down", t0 + i);
    claraSignal("steer-failed", "boom", t0 + 5); // another kind is not held back
    assert.deepEqual(seen, ["library-failed|db down", "steer-failed|boom"]);
    claraSignal("library-failed", "db down", t0 + SIGNAL_REPORT_EVERY_MS);
    assert.equal(seen[2], "library-failed|db down (+500 more in the last minute)");
  } finally {
    console.warn = warn;
    setClaraSignalReporter(before);
    resetClaraSignalThrottle();
  }
});
