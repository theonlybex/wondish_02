import { test } from "node:test";
import assert from "node:assert/strict";
import { hasActivePremium, resolveAccountClaim } from "./auth";

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

// ── resolveAccountClaim ────────────────────────────────────────────────────
// Pure decision function behind getOrCreateAccount's email-claim reconciliation.
// A `clerkId: null` row (e.g. from a previous partial registration) is only
// claimed when the incoming Clerk email is verified — otherwise a different
// person who merely typed someone else's email address could take over their
// account. Extracted so the takeover guard is unit-testable without Clerk/Prisma.

test("claims an existing unclaimed email row when the incoming email is verified", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: null, email: "x@y.com" }, "user_123", true),
    { action: "claim", accountId: "a1", clerkId: "user_123" });
});
test("does NOT claim an unclaimed row when the incoming email is unverified (takeover guard) — conflict, not create", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: null, email: "x@y.com" }, "user_123", false),
    { action: "conflict" });
});
test("creates when no email row exists", () => {
  assert.deepEqual(resolveAccountClaim(null, "user_123", true), { action: "create" });
});
test("no-op when the email row already belongs to this clerk user", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: "user_123", email: "x@y.com" }, "user_123", true),
    { action: "none", accountId: "a1" });
});
test("does not claim a row already owned by a different clerk user (no silent reassignment) — conflict, not create", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: "user_other", email: "x@y.com" }, "user_123", true),
    { action: "conflict" });
});

// ─── 2026-07-24 logic-audit Task 9: period-end backstop ─────────────────────
//
// Entitlement was 100% webhook-dependent: one missed subscription.deleted
// left status ACTIVE (premium) forever. Rows carrying a Stripe period end
// now lose premium 24h after it lapses regardless of status; coupon/admin
// rows (null periodEnd) are unaffected.

const DAY_MS = 24 * 60 * 60 * 1000;

test("audit-T9: ACTIVE premium with periodEnd 3 days past is NOT premium", () => {
  assert.equal(
    hasActivePremium({
      plan: "PREMIUM",
      status: "ACTIVE",
      stripeCurrentPeriodEnd: new Date(Date.now() - 3 * DAY_MS),
    }),
    false
  );
});

test("audit-T9: periodEnd within the 24h grace window keeps premium", () => {
  assert.equal(
    hasActivePremium({
      plan: "PREMIUM",
      status: "ACTIVE",
      stripeCurrentPeriodEnd: new Date(Date.now() - 12 * 60 * 60 * 1000),
    }),
    true
  );
});

test("audit-T9: null periodEnd (coupon/admin rows) keeps existing semantics", () => {
  assert.equal(
    hasActivePremium({ plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null }),
    true
  );
  assert.equal(hasActivePremium({ plan: "PREMIUM", status: "ACTIVE" }), true);
});

test("audit-T9: future periodEnd keeps premium", () => {
  assert.equal(
    hasActivePremium({
      plan: "PREMIUM",
      status: "TRIALING",
      stripeCurrentPeriodEnd: new Date(Date.now() + 7 * DAY_MS),
    }),
    true
  );
});
