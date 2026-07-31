import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaraRequestOptions } from "./request";

test("a body with no new fields parses to unknown surface and no date", () => {
  assert.deepEqual(parseClaraRequestOptions({ messages: [] }), {
    clientDate: undefined,
    tzOffsetMinutes: undefined,
    surface: "unknown",
  });
});

test("valid new fields are picked up", () => {
  assert.deepEqual(
    parseClaraRequestOptions({
      messages: [],
      clientDate: "2026-07-31",
      tzOffsetMinutes: -300,
      surface: "web",
    }),
    { clientDate: "2026-07-31", tzOffsetMinutes: -300, surface: "web" }
  );
});

test("the iOS surface literal is accepted (T1 wire agreement)", () => {
  assert.equal(parseClaraRequestOptions({ surface: "ios" }).surface, "ios");
});

test("garbage new fields are dropped, never fatal — the turn still works", () => {
  assert.deepEqual(
    parseClaraRequestOptions({
      messages: [],
      clientDate: 42,
      tzOffsetMinutes: "x",
      surface: "hacker",
    }),
    { clientDate: undefined, tzOffsetMinutes: undefined, surface: "unknown" }
  );
});

test("an out-of-range or fractional offset is dropped", () => {
  assert.equal(parseClaraRequestOptions({ tzOffsetMinutes: 900 }).tzOffsetMinutes, undefined);
  assert.equal(parseClaraRequestOptions({ tzOffsetMinutes: -30.5 }).tzOffsetMinutes, undefined);
  assert.equal(parseClaraRequestOptions({ tzOffsetMinutes: -840 }).tzOffsetMinutes, -840);
});

test("a non-object body is tolerated", () => {
  assert.equal(parseClaraRequestOptions(null).surface, "unknown");
  assert.equal(parseClaraRequestOptions("nonsense").surface, "unknown");
});
