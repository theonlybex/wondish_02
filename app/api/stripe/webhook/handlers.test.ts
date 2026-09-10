import { test } from "node:test";
import assert from "node:assert/strict";
import { handleStripeEvent } from "./handlers";

function deps() {
  const synced: [string, string][] = [];
  return {
    synced,
    deps: {
      sync: async (a: string, s: string) => { synced.push([a, s]); return { count: 1 }; },
      retrieveInvoiceSubscription: async () => ({ subscriptionId: "sub_from_invoice", accountId: "acc_inv" }),
    },
  };
}

test("checkout.session.completed syncs from session metadata + subscription id", async () => {
  const d = deps();
  const r = await handleStripeEvent(
    { type: "checkout.session.completed", data: { object: { metadata: { accountId: "acc_1" }, subscription: "sub_1" } } },
    d.deps
  );
  assert.equal(r, "synced");
  assert.deepEqual(d.synced, [["acc_1", "sub_1"]]);
});

test("customer.subscription.updated/deleted sync by id only — never trust payload fields", async () => {
  const d = deps();
  for (const type of ["customer.subscription.updated", "customer.subscription.deleted"]) {
    await handleStripeEvent(
      { type, data: { object: { id: "sub_9", metadata: { accountId: "acc_9" }, status: "active", current_period_end: undefined } } },
      d.deps
    );
  }
  assert.deepEqual(d.synced, [["acc_9", "sub_9"], ["acc_9", "sub_9"]]);
});

test("invoice.* resolve the subscription through the SDK, not invoice.subscription", async () => {
  const d = deps();
  const r = await handleStripeEvent({ type: "invoice.payment_failed", data: { object: { id: "in_1" } } }, d.deps);
  assert.equal(r, "synced");
  assert.deepEqual(d.synced, [["acc_inv", "sub_from_invoice"]]);
});

test("events without an account or subscription are skipped, unknown types ignored", async () => {
  const d = deps();
  assert.equal(await handleStripeEvent({ type: "checkout.session.completed", data: { object: { metadata: {} } } }, d.deps), "skipped");
  assert.equal(await handleStripeEvent({ type: "customer.created", data: { object: {} } }, d.deps), "ignored");
  assert.deepEqual(d.synced, []);
});
