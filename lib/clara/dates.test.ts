import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToday, shiftLocalDate } from "./dates";

test("resolveToday prefers a valid clientDate", () => {
  const r = resolveToday("2026-07-31", undefined, new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(r, { localDate: "2026-07-31", source: "client" });
});

test("resolveToday rejects garbage clientDate and falls back", () => {
  const r = resolveToday("31/07/2026", undefined, new Date("2026-07-31T12:00:00Z"));
  assert.equal(r.source, "server");
});

test("resolveToday uses tzOffsetMinutes when clientDate is absent", () => {
  // 2026-07-31T02:00Z at UTC-5 is still 2026-07-30 locally.
  const r = resolveToday(undefined, -300, new Date("2026-07-31T02:00:00Z"));
  assert.deepEqual(r, { localDate: "2026-07-30", source: "offset" });
});

test("resolveToday ignores an out-of-range offset", () => {
  const r = resolveToday(undefined, 5000, new Date("2026-07-31T02:00:00Z"));
  assert.equal(r.source, "server");
});

test("shiftLocalDate walks calendar days across a month boundary", () => {
  assert.equal(shiftLocalDate("2026-08-01", -14), "2026-07-18");
  assert.equal(shiftLocalDate("2026-02-28", 1), "2026-03-01"); // 2026 is not a leap year
});

// Amendment 2026-07-31: the regression that made the prompt assert a wrong date
// for iOS callers before T1 — a UTC server is not the caller's calendar.
test("a UTC server in the evening of a negative-offset caller is NOT their today", () => {
  // 2026-07-31T00:30Z is still 2026-07-30 for a UTC-7 caller.
  const server = resolveToday(undefined, undefined, new Date("2026-07-31T00:30:00Z"));
  assert.equal(server.source, "server"); // ⇒ prompt omits the date (see registry)
  assert.equal(
    resolveToday(undefined, -420, new Date("2026-07-31T00:30:00Z")).localDate,
    "2026-07-30"
  );
});
