import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeMe } from "./me";

// Minimal Account shape serializeMe needs — id/email/name/photo plus the
// per-source subscriptions array (Task 1's schema: one row per source).
function account(subscriptions: any[]) {
  return {
    id: "acc_1",
    email: "x@y.com",
    firstName: "Ada",
    lastName: "Lovelace",
    photoUrl: null,
    subscriptions,
  };
}

function sub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    plan: "PREMIUM",
    status: "ACTIVE",
    source: "STRIPE",
    stripeCurrentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    trialEndsAt: null,
    canceledAt: null,
    ...overrides,
  };
}

// A fully complete patient profile (metric height) — satisfies isProfileComplete.
function completeProfile() {
  return {
    birthday: new Date("1994-01-01"),
    height: 165,
    weight: 60,
    physicalActivityId: "activity-2",
  };
}

test("premium + active subscription: isPremium true, currentPeriodEnd is ISO, source present", () => {
  const dto = serializeMe(account([sub()]), completeProfile());
  assert.equal(dto.isPremium, true);
  assert.deepEqual(dto.subscription, {
    plan: "PREMIUM",
    status: "ACTIVE",
    source: "STRIPE",
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    trialEndsAt: null,
    canceledAt: null,
  });
});

test("free + active subscription: isPremium false", () => {
  const dto = serializeMe(
    account([sub({ plan: "FREE", stripeCurrentPeriodEnd: null })]),
    completeProfile()
  );
  assert.equal(dto.isPremium, false);
  assert.equal(dto.subscription?.plan, "FREE");
});

test("canceled premium subscription: isPremium false", () => {
  const dto = serializeMe(
    account([sub({ status: "CANCELED", canceledAt: new Date("2026-07-01T00:00:00.000Z") })]),
    completeProfile()
  );
  assert.equal(dto.isPremium, false);
  assert.equal(dto.subscription?.status, "CANCELED");
  assert.equal(dto.subscription?.canceledAt, "2026-07-01T00:00:00.000Z");
});

test("no active row among several sources still finds the active one", () => {
  const subs = [
    sub({ source: "STRIPE", status: "CANCELED", canceledAt: new Date("2026-06-01T00:00:00.000Z") }),
    sub({ source: "APPLE", status: "ACTIVE" }),
  ];
  const dto = serializeMe(account(subs), completeProfile());
  assert.equal(dto.isPremium, true);
  assert.equal(dto.subscription?.source, "APPLE");
});

test("no subscriptions at all: subscription is null, isPremium is false", () => {
  const dto = serializeMe(account([]), completeProfile());
  assert.equal(dto.isPremium, false);
  assert.equal(dto.subscription, null);
});

test("onboardingComplete reflects isProfileComplete(patient), not a raw cached column", () => {
  // The patient object itself carries no `onboardingComplete`/`profileCompleted`
  // flag at all — serializeMe must derive it from the real profile fields.
  const complete = serializeMe(account([sub()]), completeProfile());
  assert.equal(complete.onboardingComplete, true);

  const incomplete = serializeMe(account([sub()]), { ...completeProfile(), weight: null });
  assert.equal(incomplete.onboardingComplete, false);
});

test("no patient: onboardingComplete is false", () => {
  const dto = serializeMe(account([sub()]), null);
  assert.equal(dto.onboardingComplete, false);
});

test("subscription DTO key-set is exactly the allow-listed fields — no stripe secret/customerId leakage", () => {
  const dto = serializeMe(account([sub()]), completeProfile());
  assert.deepEqual(
    Object.keys(dto.subscription!).sort(),
    ["canceledAt", "currentPeriodEnd", "plan", "source", "status", "trialEndsAt"]
  );
});

test("currentPeriodEnd coalesces stripeCurrentPeriodEnd then appleExpiresAt", () => {
  const dto = serializeMe(
    account([
      sub({
        source: "APPLE",
        stripeCurrentPeriodEnd: null,
        appleExpiresAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    ]),
    completeProfile()
  );
  assert.equal(dto.subscription?.currentPeriodEnd, "2026-09-15T00:00:00.000Z");
});
