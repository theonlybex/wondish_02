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
    // Far-future on purpose: this was "2026-08-01", written as a future period
    // end — and the suite went red the day the calendar caught up with it.
    // A fixture date that must be in the future must not be near the present.
    stripeCurrentPeriodEnd: new Date("2100-01-01T00:00:00.000Z"),
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
    currentPeriodEnd: "2100-01-01T00:00:00.000Z",
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
        appleExpiresAt: new Date("2100-06-15T00:00:00.000Z"), // far-future, same reason as sub()
      }),
    ]),
    completeProfile()
  );
  assert.equal(dto.subscription?.currentPeriodEnd, "2100-06-15T00:00:00.000Z");
});

// ─── 2026-09-12 beta premium coupons ────────────────────────────────────────

test("expired COUPON grant listed first, free STRIPE row second: STRIPE row is reported, isPremium false", () => {
  const me = serializeMe(
    account([
      sub({ source: "COUPON", stripeCurrentPeriodEnd: new Date("2020-01-01T00:00:00.000Z") }),
      sub({ source: "STRIPE", plan: "FREE", stripeCurrentPeriodEnd: null }),
    ]),
    null
  );
  assert.equal(me.isPremium, false);
  assert.equal(me.subscription?.source, "STRIPE");
  assert.equal(me.subscription?.plan, "FREE");
});

test("live COUPON grant is the reported subscription with its end date", () => {
  const until = new Date("2099-12-31T23:59:59.999Z");
  const me = serializeMe(
    account([
      sub({ source: "STRIPE", plan: "FREE", stripeCurrentPeriodEnd: null }),
      sub({ source: "COUPON", stripeCurrentPeriodEnd: until }),
    ]),
    null
  );
  assert.equal(me.isPremium, true);
  assert.equal(me.subscription?.source, "COUPON");
  assert.equal(me.subscription?.currentPeriodEnd, until.toISOString());
});

test("live COUPON grant plus live STRIPE subscription: the paid row is reported", () => {
  const me = serializeMe(
    account([
      sub({ source: "COUPON", stripeCurrentPeriodEnd: new Date("2099-12-31T23:59:59.999Z") }),
      sub({ source: "STRIPE" }),
    ]),
    null
  );
  assert.equal(me.isPremium, true);
  assert.equal(me.subscription?.source, "STRIPE");
});

// A coupon holder is entitled but is NOT a paying customer, and the payload
// has to let a consumer tell the difference. Reading isPremium alone is how
// /restaurants came to greet a beta tester with a "Plus" badge.
test("tier distinguishes a beta coupon from a paid subscription", () => {
  const future = new Date(Date.now() + 30 * 86400000);
  const row = (source: string) => ({
    plan: "PREMIUM", status: "ACTIVE", source,
    stripeCurrentPeriodEnd: future, trialEndsAt: null, canceledAt: null,
  });
  const me = (subs: ReturnType<typeof row>[]) =>
    serializeMe(
      { id: "a", email: "e@x.io", firstName: "A", lastName: "B", photoUrl: null, subscriptions: subs },
      null
    );

  const coupon = me([row("COUPON")]);
  assert.equal(coupon.tier, "beta");
  assert.equal(coupon.isPremium, true, "beta access IS an entitlement");

  assert.equal(me([row("STRIPE")]).tier, "premium");
  assert.equal(me([row("APPLE")]).tier, "premium");
  // A paid row alongside a coupon is a paying customer.
  assert.equal(me([row("COUPON"), row("STRIPE")]).tier, "premium");
  assert.equal(me([]).tier, "free");
  assert.equal(me([]).isPremium, false);
});
