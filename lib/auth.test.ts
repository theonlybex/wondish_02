import { test } from "node:test";
import assert from "node:assert/strict";
import { hasActivePremium } from "./auth";

// Extracted verbatim from the inline check formerly at
// app/(dashboard)/layout.tsx:11-14 — plan === "PREMIUM" AND status in
// [ACTIVE, TRIALING, INCOMPLETE]. Pinned here so the extraction can't drift.

test("null or undefined subscription is never premium", () => {
  assert.equal(hasActivePremium(null), false);
  assert.equal(hasActivePremium(undefined), false);
});

test("non-PREMIUM plan is never premium, regardless of status", () => {
  assert.equal(hasActivePremium({ plan: "FREE", status: "ACTIVE" }), false);
  assert.equal(hasActivePremium({ plan: "FREE", status: "TRIALING" }), false);
});

test("PREMIUM plan with ACTIVE, TRIALING, or INCOMPLETE status is active premium", () => {
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "ACTIVE" }), true);
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "TRIALING" }), true);
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "INCOMPLETE" }), true);
});

test("PREMIUM plan with any other status is not active premium", () => {
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "CANCELED" }), false);
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "PAST_DUE" }), false);
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "INCOMPLETE_EXPIRED" }), false);
});

test("status check is case-sensitive and exact — no substring matching", () => {
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "active" }), false);
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "ACTIVE_TRIAL" }), false);
});

test("return value is a real boolean, never a truthy/falsy leak", () => {
  assert.equal(typeof hasActivePremium(null), "boolean");
  assert.equal(typeof hasActivePremium({ plan: "PREMIUM", status: "ACTIVE" }), "boolean");
});
