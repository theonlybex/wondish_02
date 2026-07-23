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
test("does NOT claim an unclaimed row when the incoming email is unverified (takeover guard)", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: null, email: "x@y.com" }, "user_123", false),
    { action: "create" });
});
test("creates when no email row exists", () => {
  assert.deepEqual(resolveAccountClaim(null, "user_123", true), { action: "create" });
});
test("no-op when the email row already belongs to this clerk user", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: "user_123", email: "x@y.com" }, "user_123", true),
    { action: "none", accountId: "a1" });
});
test("does not claim a row already owned by a different clerk user (no silent reassignment)", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: "user_other", email: "x@y.com" }, "user_123", true),
    { action: "create" });
});
