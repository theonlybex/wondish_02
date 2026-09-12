import { test } from "node:test";
import assert from "node:assert/strict";
import {
  couponPremiumUpsertArgs,
  classifyCoupon,
  couponCapWhere,
  couponEndingSoon,
  extendGrantsWhere,
  hasPaidPremium,
  mergeGrantEnd,
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
    accessUntil: null as Date | null,
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

test("classifyCoupon: a code whose access-until already passed is unavailable", () => {
  assert.equal(classifyCoupon(coupon({ accessUntil: new Date("2026-07-01") }), NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ accessUntil: new Date("2026-08-01") }), NOW), "ok");
  assert.equal(classifyCoupon(coupon({ accessUntil: null }), NOW), "ok"); // ADMIN codes
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

// ─── 2026-09-12 beta premium coupons ────────────────────────────────────────
//
// PREMIUM redemption writes the COUPON-source row with the coupon's access
// end in stripeCurrentPeriodEnd (the source-agnostic "entitlement ends here"
// column hasActivePremium already enforces). It never touches Stripe ids.

const UNTIL = new Date("2026-12-31T23:59:59.999Z");
const LATER = new Date("2027-03-31T23:59:59.999Z");

test("couponPremiumUpsertArgs targets the COUPON row, sets the access end, never touches Stripe ids", () => {
  const args = couponPremiumUpsertArgs("acc1", UNTIL);
  assert.deepEqual(args.where, { accountId_source: { accountId: "acc1", source: "COUPON" } });
  assert.equal(args.create.source, "COUPON");
  for (const shape of [args.update, args.create] as Array<Record<string, unknown>>) {
    assert.equal("stripeSubscriptionId" in shape, false);
    assert.equal("stripeCustomerId" in shape, false);
    assert.equal(shape.plan, "PREMIUM");
    assert.equal(shape.status, "ACTIVE");
    assert.equal(shape.stripeCurrentPeriodEnd, UNTIL);
  }
  assert.equal(args.update.canceledAt, null);
});

test("couponPremiumUpsertArgs with null access end writes a null period end (lifetime)", () => {
  const args = couponPremiumUpsertArgs("acc1", null);
  assert.equal(args.update.stripeCurrentPeriodEnd, null);
  assert.equal(args.create.stripeCurrentPeriodEnd, null);
});

test("mergeGrantEnd: no existing row → incoming", () => {
  assert.equal(mergeGrantEnd(null, UNTIL), UNTIL);
});

test("mergeGrantEnd: existing active grant keeps the later date", () => {
  const row = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(row, UNTIL), LATER);
  const shorter = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: UNTIL };
  assert.equal(mergeGrantEnd(shorter, LATER), LATER);
});

test("mergeGrantEnd: lifetime on either side wins", () => {
  assert.equal(mergeGrantEnd({ plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null }, UNTIL), null);
  assert.equal(mergeGrantEnd({ plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: UNTIL }, null), null);
});

test("mergeGrantEnd: an expired or non-premium existing row is replaced by incoming", () => {
  const expired = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };
  assert.equal(mergeGrantEnd(expired, UNTIL), UNTIL);
  const free = { plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(free, UNTIL), UNTIL);
  const canceled = { plan: "PREMIUM", status: "CANCELED", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(canceled, UNTIL), UNTIL);
});

test("hasPaidPremium: only a live STRIPE or APPLE premium row counts", () => {
  const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  const appleLive = { source: "APPLE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
  const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
  const stripeLapsed = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };
  const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(hasPaidPremium([stripeLive]), true);
  assert.equal(hasPaidPremium([appleLive]), true);
  assert.equal(hasPaidPremium([stripeFree, couponLive]), false);
  assert.equal(hasPaidPremium([stripeLapsed]), false);
  assert.equal(hasPaidPremium([]), false);
});

test("hasPaidPremium: a paid row already scheduled to cancel does not block a coupon", () => {
  const canceling = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER, cancelAtPeriodEnd: true };
  assert.equal(hasPaidPremium([canceling]), false);
});

test("extendGrantsWhere: lifts only COUPON rows of the given accounts that end before the new date", () => {
  assert.deepEqual(extendGrantsWhere(["a1", "a2"], UNTIL), {
    source: "COUPON",
    accountId: { in: ["a1", "a2"] },
    stripeCurrentPeriodEnd: { lt: UNTIL },
  });
});

test("couponEndingSoon: only-premium coupon ending within 7 days returns its end", () => {
  const now = new Date("2026-12-27T12:00:00Z");
  const end = new Date("2026-12-31T23:59:59.999Z");
  const subs = [
    { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null, cancelAtPeriodEnd: false },
    { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: end, cancelAtPeriodEnd: false },
  ];
  assert.equal(couponEndingSoon(subs, now), end);
});

test("couponEndingSoon: null when far away, already ended, lifetime, or a paid row is live", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const end = new Date("2026-12-31T23:59:59.999Z");
  const coupon = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: end, cancelAtPeriodEnd: false };
  assert.equal(couponEndingSoon([coupon], now), null); // 30 days out
  assert.equal(couponEndingSoon([{ ...coupon, stripeCurrentPeriodEnd: new Date("2020-01-01") }], now), null);
  assert.equal(couponEndingSoon([{ ...coupon, stripeCurrentPeriodEnd: null }], now), null);
  const paid = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2100-01-01"), cancelAtPeriodEnd: false };
  assert.equal(couponEndingSoon([coupon, paid], new Date("2026-12-27T12:00:00Z")), null);
  assert.equal(couponEndingSoon([], now), null);
});
