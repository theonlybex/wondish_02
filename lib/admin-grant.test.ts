import { test } from "node:test";
import assert from "node:assert/strict";
import { adminPremiumUpsertArgs } from "./admin-grant";
import { hasActivePremium, primarySubscriptionRow } from "./auth";

// Admins have Premium by default (2026-09-12): the SUPER grant writes an
// ADMIN-source row with no end, which hasActivePremium already treats as
// never-expiring.

test("adminPremiumUpsertArgs: ADMIN-source row, PREMIUM/ACTIVE, no end, no Stripe ids", () => {
  const args = adminPremiumUpsertArgs("acc1");
  assert.deepEqual(args.where, { accountId_source: { accountId: "acc1", source: "ADMIN" } });
  for (const shape of [args.update, args.create] as Array<Record<string, unknown>>) {
    assert.equal(shape.plan, "PREMIUM");
    assert.equal(shape.status, "ACTIVE");
    assert.equal(shape.stripeCurrentPeriodEnd, null);
    assert.equal("stripeSubscriptionId" in shape, false);
    assert.equal("stripeCustomerId" in shape, false);
  }
  assert.equal(args.create.source, "ADMIN");
});

test("the ADMIN row grants premium indefinitely and does not outrank a live paid row", () => {
  const admin = { ...adminPremiumUpsertArgs("acc1").create };
  assert.equal(hasActivePremium(admin), true);
  const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2100-01-01") };
  assert.equal(primarySubscriptionRow([admin, stripeLive]), stripeLive);
  const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
  assert.equal(primarySubscriptionRow([stripeFree, admin]), admin);
});
