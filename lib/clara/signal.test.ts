import { test } from "node:test";
import assert from "node:assert/strict";
import { claraSignal, setClaraSignalReporter } from "./signal";

test("a signal reaches the reporter with its kind, and a reporter that throws breaks nothing", () => {
  const seen: string[] = [];
  const before = setClaraSignalReporter((kind, detail) => seen.push(`${kind}|${detail}`));
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
