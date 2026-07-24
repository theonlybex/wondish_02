import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelStripeAtPeriodEnd, StripeCancelError } from "./stripe-admin";

// ─── 2026-07-24 logic-audit Task 11 ─────────────────────────────────────────
//
// The cancel was best-effort: on a Stripe hiccup, deletion proceeded and the
// cascade destroyed the only copy of stripeSubscriptionId — the user kept
// being billed with no server-side handle left. Failure must now abort.

test("null/absent subscription id resolves without calling Stripe", async () => {
  let called = 0;
  await cancelStripeAtPeriodEnd({ stripeSubscriptionId: null }, async () => {
    called++;
  });
  assert.equal(called, 0);
});

test("a Stripe failure surfaces as StripeCancelError (not swallowed)", async () => {
  await assert.rejects(
    cancelStripeAtPeriodEnd({ stripeSubscriptionId: "sub_1" }, async () => {
      throw new Error("stripe down");
    }),
    StripeCancelError
  );
});

test("cancel is invoked with the subscription id", async () => {
  const seen: string[] = [];
  await cancelStripeAtPeriodEnd({ stripeSubscriptionId: "sub_42" }, async (id) => {
    seen.push(id);
  });
  assert.deepEqual(seen, ["sub_42"]);
});
