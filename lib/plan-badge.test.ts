import { test } from "node:test";
import assert from "node:assert/strict";
import { planBadgeFor } from "./plan-badge";

// The header pill must never claim more than the spend guard grants. The
// 2026-09-17 QA run: a coupon holder read "Premium ✦" top-right, expected
// 5 new weeks, and got a 429 at 3 — because the layout only asked "is any
// row premium?" and a COUPON row says yes. The badge now follows tierFor.

const FUTURE = new Date("2100-01-01T00:00:00.000Z");
const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const appleLive = { source: "APPLE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const adminGrant = { source: "ADMIN", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeCanceled = { source: "STRIPE", plan: "PREMIUM", status: "CANCELED", stripeCurrentPeriodEnd: FUTURE };
const couponExpired = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };

test("a coupon-only account is BETA, not PREMIUM", () => {
  assert.equal(planBadgeFor([couponLive], false), "BETA");
  assert.equal(planBadgeFor([stripeFree, couponLive], false), "BETA");
});

test("any live paid row outranks a coupon: the precedence case (COUPON + STRIPE) is PREMIUM", () => {
  assert.equal(planBadgeFor([couponLive, stripeLive], false), "PREMIUM");
  assert.equal(planBadgeFor([stripeLive, couponLive], false), "PREMIUM");
  assert.equal(planBadgeFor([stripeLive], false), "PREMIUM");
  assert.equal(planBadgeFor([appleLive], false), "PREMIUM");
  assert.equal(planBadgeFor([adminGrant], false), "PREMIUM");
});

test("nothing live is FREE — a canceled paid row or an expired coupon does not count", () => {
  assert.equal(planBadgeFor([], false), "FREE");
  assert.equal(planBadgeFor([stripeFree], false), "FREE");
  assert.equal(planBadgeFor([stripeCanceled], false), "FREE");
  assert.equal(planBadgeFor([couponExpired], false), "FREE");
  assert.equal(planBadgeFor([null, undefined], false), "FREE");
});

test("SUPER admins are ADMIN whatever their rows say", () => {
  assert.equal(planBadgeFor([], true), "ADMIN");
  assert.equal(planBadgeFor([couponLive], true), "ADMIN");
  assert.equal(planBadgeFor([stripeLive], true), "ADMIN");
});
