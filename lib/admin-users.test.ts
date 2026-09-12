import { test } from "node:test";
import assert from "node:assert/strict";
import { manualGrantUpsertArgs, summarizeEntitlement, userRank } from "./admin-users";

const FUTURE = new Date("2100-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const couponDead = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: PAST };
const adminRow = { source: "ADMIN", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };

test("summarizeEntitlement: free account", () => {
  assert.deepEqual(summarizeEntitlement([stripeFree]), { plan: "FREE", source: null, periodEnd: null, paid: false });
  assert.deepEqual(summarizeEntitlement([]), { plan: "FREE", source: null, periodEnd: null, paid: false });
});

test("summarizeEntitlement: admin row → PREMIUM · ADMIN, no end, not paid", () => {
  assert.deepEqual(summarizeEntitlement([stripeFree, adminRow]), { plan: "PREMIUM", source: "ADMIN", periodEnd: null, paid: false });
});

test("summarizeEntitlement: coupon grant → PREMIUM · COUPON with its end", () => {
  const s = summarizeEntitlement([couponLive, stripeFree]);
  assert.equal(s.plan, "PREMIUM");
  assert.equal(s.source, "COUPON");
  assert.equal(s.periodEnd, FUTURE.toISOString());
  assert.equal(s.paid, false);
});

test("summarizeEntitlement: expired coupon → FREE", () => {
  assert.equal(summarizeEntitlement([couponDead, stripeFree]).plan, "FREE");
});

test("summarizeEntitlement: paid beats coupon and is flagged paid", () => {
  const s = summarizeEntitlement([couponLive, stripeLive]);
  assert.equal(s.source, "STRIPE");
  assert.equal(s.paid, true);
});

test("manualGrantUpsertArgs: COUPON row, no end, never Stripe fields", () => {
  const a = manualGrantUpsertArgs("acc1");
  assert.equal(a.where.accountId_source.source, "COUPON");
  assert.equal(a.create.stripeCurrentPeriodEnd, null);
  assert.equal("stripeSubscriptionId" in a.update, false);
});

test("userRank: admins, then premium, then free", () => {
  assert.equal(userRank({ isAdmin: true, subscription: { plan: "FREE" } }), 0);
  assert.equal(userRank({ isAdmin: false, subscription: { plan: "PREMIUM" } }), 1);
  assert.equal(userRank({ isAdmin: false, subscription: { plan: "FREE" } }), 2);
});
