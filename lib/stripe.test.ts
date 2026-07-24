import { test } from "node:test";
import assert from "node:assert/strict";
import { mapStripeStatus } from "./stripe";

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
