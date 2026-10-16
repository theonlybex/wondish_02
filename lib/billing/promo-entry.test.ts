import { test } from "node:test";
import assert from "node:assert/strict";
import { couponRedeemResult } from "./promo-entry";

test("a successful PREMIUM redeem reports beta access with its end date", () => {
  assert.deepEqual(
    couponRedeemResult(200, { success: true, type: "PREMIUM", accessUntil: "2026-11-30T23:59:59.999Z" }),
    { kind: "activated", admin: false, until: "2026-11-30T23:59:59.999Z" }
  );
});

test("a successful ADMIN redeem is flagged as admin", () => {
  assert.deepEqual(couponRedeemResult(200, { success: true, type: "ADMIN", accessUntil: null }), {
    kind: "activated",
    admin: true,
    until: null,
  });
});

test("signed-out visitors are told to sign in, not that the code is invalid", () => {
  assert.deepEqual(couponRedeemResult(401, { error: "Unauthorized" }), { kind: "signIn" });
});

test("an unknown code (generic 404) reads as invalid", () => {
  assert.deepEqual(couponRedeemResult(404, { error: "Invalid or unavailable code" }), { kind: "invalid" });
});

test("409/429 pass the server's own message through", () => {
  assert.deepEqual(couponRedeemResult(409, { error: "You have already redeemed this coupon" }), {
    kind: "error",
    message: "You have already redeemed this coupon",
  });
  assert.deepEqual(couponRedeemResult(429, null), { kind: "error", message: null });
});

test("a 200 without success (non-JSON fallback) is not treated as activated", () => {
  assert.deepEqual(couponRedeemResult(200, null), { kind: "error", message: null });
});
