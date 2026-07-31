import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToday, shiftLocalDate } from "./dates";

test("resolveToday prefers a valid clientDate", () => {
  const r = resolveToday("2026-07-31", undefined, new Date("2026-07-31T12:00:00Z"));
  assert.deepEqual(r, { localDate: "2026-07-31", source: "client" });
});

test("a clientDate a day either side of the server is still trusted (timezones)", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  assert.equal(resolveToday("2026-07-30", undefined, now).source, "client");
  assert.equal(resolveToday("2026-08-01", undefined, now).source, "client");
});

// The date is client-controlled, asserted verbatim in the prompt, and used as
// the gap-ledger dedupe key — an arbitrary value would let a client defeat the
// unique constraint and distort the report windows.
test("a clientDate far from now is rejected, not trusted", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  assert.equal(resolveToday("2099-01-01", undefined, now).source, "server");
  assert.equal(resolveToday("2020-01-01", undefined, now).source, "server");
});

test("a rolled-over date like 2026-02-31 is rejected rather than silently shifted", () => {
  // parseLocalDateStrict alone accepts it (it becomes March 3); the round-trip
  // check is what catches it.
  const r = resolveToday("2026-02-31", undefined, new Date("2026-03-01T12:00:00Z"));
  assert.equal(r.source, "server");
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
