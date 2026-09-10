import { test } from "node:test";
import assert from "node:assert/strict";
import { mapStripeStatus, resolvePlanPrice, PriceDriftError } from "./stripe";
import { planByKey } from "./billing/plans";

// ─── 2026-07-24 logic-audit Task 9 ──────────────────────────────────────────
//
// The webhook's inline mappings sent unpaid/paused/incomplete_expired to
// INCOMPLETE — which hasActivePremium counts as premium — so a sub whose
// payments stopped kept premium indefinitely. One shared honest mapping;
// unknown statuses fail safe to CANCELED.

test("mapStripeStatus: full table", () => {
  const table: Array<[string, string]> = [
    ["active", "ACTIVE"],
    ["trialing", "TRIALING"],
    ["past_due", "PAST_DUE"],
    ["unpaid", "PAST_DUE"],
    ["paused", "PAST_DUE"],
    ["canceled", "CANCELED"],
    ["incomplete", "INCOMPLETE"],
    ["incomplete_expired", "CANCELED"],
  ];
  for (const [input, expected] of table) {
    assert.equal(mapStripeStatus(input), expected, `${input} → ${expected}`);
  }
});

test("mapStripeStatus: unknown status fails safe to CANCELED", () => {
  assert.equal(mapStripeStatus("some_future_status"), "CANCELED");
});

// ─── Billing v2: catalog ↔ Stripe price drift guard ─────────────────────────

test("resolvePlanPrice returns the price id when Stripe matches the catalog", async () => {
  const id = await resolvePlanPrice(planByKey("sixmonth")!, async () => ({
    id: "price_6mo", unit_amount: 10000, currency: "usd", recurring: { interval: "month", interval_count: 6 },
  }));
  assert.equal(id, "price_6mo");
});

test("resolvePlanPrice fails closed on amount drift", async () => {
  await assert.rejects(
    () => resolvePlanPrice(planByKey("monthly")!, async () => ({
      id: "price_m", unit_amount: 1500, currency: "usd", recurring: { interval: "month", interval_count: 1 },
    })),
    PriceDriftError
  );
});

test("resolvePlanPrice fails closed on interval drift and on a missing price", async () => {
  await assert.rejects(
    () => resolvePlanPrice(planByKey("sixmonth")!, async () => ({
      id: "price_x", unit_amount: 10000, currency: "usd", recurring: { interval: "month", interval_count: 1 },
    })),
    PriceDriftError
  );
  await assert.rejects(() => resolvePlanPrice(planByKey("monthly")!, async () => null), /No Stripe price/);
});
