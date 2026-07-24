import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCoupon,
  couponCapWhere,
  GENERIC_COUPON_ERROR,
} from "./coupon";

// ─── 2026-07-24 logic-audit Task 8 ──────────────────────────────────────────
//
// The redeem route distinguished invalid/expired/exhausted in its error copy
// (enumeration aid on an endpoint whose ADMIN coupons mint the SUPER role)
// and checked maxUses outside the transaction (overshoot race). Failure
// classification is now pure + generic; the cap becomes a single-statement
// conditional increment.

const NOW = new Date("2026-07-24T12:00:00Z");

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    expiresAt: null as Date | null,
    maxUses: -1,
    usedCount: 0,
    ...overrides,
  };
}

test("classifyCoupon: every failure class collapses to the same generic outcome", () => {
  assert.equal(classifyCoupon(null, NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ isActive: false }), NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ expiresAt: new Date("2026-07-01") }), NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ maxUses: 3, usedCount: 3 }), NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ maxUses: 3, usedCount: 4 }), NOW), "unavailable");
});

test("classifyCoupon: valid states pass — unlimited, under cap, future expiry", () => {
  assert.equal(classifyCoupon(coupon(), NOW), "ok");
  assert.equal(classifyCoupon(coupon({ maxUses: 3, usedCount: 2 }), NOW), "ok");
  assert.equal(classifyCoupon(coupon({ expiresAt: new Date("2026-08-01") }), NOW), "ok");
});

test("couponCapWhere: capped coupon gates the increment on usedCount < maxUses", () => {
  assert.deepEqual(couponCapWhere({ id: "c1", maxUses: 3 }), {
    id: "c1",
    isActive: true,
    usedCount: { lt: 3 },
  });
});

test("couponCapWhere: unlimited (-1) coupon gates only on id + active", () => {
  assert.deepEqual(couponCapWhere({ id: "c1", maxUses: -1 }), {
    id: "c1",
    isActive: true,
  });
});

test("generic error copy names no specific failure cause", () => {
  for (const needle of ["expired", "limit", "inactive", "already"]) {
    assert.equal(GENERIC_COUPON_ERROR.toLowerCase().includes(needle), false);
  }
});
