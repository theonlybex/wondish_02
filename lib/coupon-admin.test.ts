import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeadline, validateCouponInput } from "./coupon-admin";

const NOW = new Date("2026-09-12T12:00:00Z");

function premium(overrides: Record<string, unknown> = {}) {
  return {
    code: "beta-2026",
    type: "PREMIUM",
    maxUses: 50,
    expiresAt: "2026-10-31",
    accessUntil: "2026-12-31",
    note: "Beta cohort 1",
    ...overrides,
  };
}

test("parseDeadline: date-only strings become end of that day (UTC)", () => {
  assert.equal(parseDeadline("2026-12-31")?.toString(), new Date("2026-12-31T23:59:59.999Z").toString());
});

test("parseDeadline: full ISO strings are kept; empty is null; garbage is invalid", () => {
  assert.equal((parseDeadline("2026-12-31T10:00:00.000Z") as Date).toISOString(), "2026-12-31T10:00:00.000Z");
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline(null), null);
  assert.equal(parseDeadline(undefined), null);
  assert.equal(parseDeadline("not a date"), "invalid");
  assert.equal(parseDeadline(42), "invalid");
});

test("valid PREMIUM input: code upper-cased, dates normalised to end of day", () => {
  const r = validateCouponInput(premium(), NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.code, "BETA-2026");
  assert.equal(r.value.type, "PREMIUM");
  assert.equal(r.value.maxUses, 50);
  assert.equal(r.value.expiresAt?.toISOString(), "2026-10-31T23:59:59.999Z");
  assert.equal(r.value.accessUntil?.toISOString(), "2026-12-31T23:59:59.999Z");
  assert.equal(r.value.note, "Beta cohort 1");
});

test("PREMIUM requires accessUntil", () => {
  const r = validateCouponInput(premium({ accessUntil: "" }), NOW);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /access/i);
});

test("ADMIN must not carry accessUntil, and works without one", () => {
  const bad = validateCouponInput(premium({ type: "ADMIN" }), NOW);
  assert.equal(bad.ok, false);
  const good = validateCouponInput(premium({ type: "ADMIN", accessUntil: "" }), NOW);
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.accessUntil, null);
});

test("expiresAt is optional for PREMIUM", () => {
  const r = validateCouponInput(premium({ expiresAt: "" }), NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.expiresAt, null);
});

test("dates must be in the future", () => {
  assert.equal(validateCouponInput(premium({ accessUntil: "2026-09-01" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ expiresAt: "2026-09-01" }), NOW).ok, false);
});

test("redeem-by must not be after access end", () => {
  const r = validateCouponInput(premium({ expiresAt: "2027-01-15", accessUntil: "2026-12-31" }), NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /redeem/i);
});

test("code shape: 4–24 chars of A-Z 0-9 _ -", () => {
  assert.equal(validateCouponInput(premium({ code: "abc" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: "has space" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: "x".repeat(25) }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: " ok_code-1 " }), NOW).ok, true);
});

test("maxUses: -1 or a positive integer", () => {
  assert.equal(validateCouponInput(premium({ maxUses: -1 }), NOW).ok, true);
  assert.equal(validateCouponInput(premium({ maxUses: 1 }), NOW).ok, true);
  assert.equal(validateCouponInput(premium({ maxUses: 0 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: -2 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: 2.5 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: "10" }), NOW).ok, false);
});

test("unknown type and non-object bodies are rejected; note is capped at 200 chars", () => {
  assert.equal(validateCouponInput(premium({ type: "GOLD" }), NOW).ok, false);
  assert.equal(validateCouponInput(null, NOW).ok, false);
  assert.equal(validateCouponInput(premium({ note: "n".repeat(201) }), NOW).ok, false);
  const r = validateCouponInput(premium({ note: "" }), NOW);
  if (r.ok) assert.equal(r.value.note, null);
});
