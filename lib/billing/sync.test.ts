import { test } from "node:test";
import assert from "node:assert/strict";
import { subscriptionRowFromStripe, syncStripeSubscription, type StripeSubLike } from "./sync";

function sub(over: Partial<StripeSubLike> = {}): StripeSubLike {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: 1_800_000_000,
    trial_end: null,
    metadata: { accountId: "acc_1" },
    items: { data: [{ price: { id: "price_monthly" } }] },
    ...over,
  };
}

test("active subscription maps to PREMIUM/ACTIVE with period end and price", () => {
  const row = subscriptionRowFromStripe(sub());
  assert.equal(row.plan, "PREMIUM");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.stripePriceId, "price_monthly");
  assert.equal(row.stripeCurrentPeriodEnd.getTime(), 1_800_000_000_000);
  assert.equal(row.cancelAtPeriodEnd, false);
  assert.equal(row.canceledAt, null);
});

test("cancel_at_period_end keeps PREMIUM/ACTIVE but flags it", () => {
  const row = subscriptionRowFromStripe(sub({ cancel_at_period_end: true }));
  assert.equal(row.plan, "PREMIUM");
  assert.equal(row.cancelAtPeriodEnd, true);
});

test("canceled / incomplete_expired drop to FREE with canceledAt", () => {
  for (const status of ["canceled", "incomplete_expired"]) {
    const row = subscriptionRowFromStripe(sub({ status }));
    assert.equal(row.plan, "FREE", status);
    assert.equal(row.status, "CANCELED", status);
    assert.ok(row.canceledAt instanceof Date, status);
  }
});

test("past_due stays PREMIUM/PAST_DUE (entitlement decided by hasActivePremium)", () => {
  const row = subscriptionRowFromStripe(sub({ status: "past_due" }));
  assert.equal(row.plan, "PREMIUM");
  assert.equal(row.status, "PAST_DUE");
});

test("syncStripeSubscription retrieves via the SDK and writes the STRIPE row", async () => {
  const calls: unknown[] = [];
  const res = await syncStripeSubscription("acc_1", "sub_1", {
    retrieve: async (id) => { calls.push(["retrieve", id]); return sub(); },
    updateMany: async (args) => { calls.push(["update", args]); return { count: 1 }; },
  });
  assert.equal(res.count, 1);
  assert.deepEqual(calls[0], ["retrieve", "sub_1"]);
  const update = calls[1] as ["update", { where: unknown; data: { plan: string } }];
  assert.deepEqual(update[1].where, { accountId: "acc_1", source: "STRIPE" });
  assert.equal(update[1].data.plan, "PREMIUM");
});

test("syncStripeSubscription refuses a subscription whose metadata names another account", async () => {
  await assert.rejects(
    () => syncStripeSubscription("acc_OTHER", "sub_1", {
      retrieve: async () => sub(),
      updateMany: async () => { throw new Error("must not write"); },
    }),
    /account mismatch/
  );
});
