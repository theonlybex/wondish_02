// Pure coupon-redemption decision logic backing app/api/coupon/redeem.
// Extracted (2026-07-24 audit Task 8) so the failure taxonomy and the atomic
// usage-cap predicate are unit-testable; the route stays a thin wrapper.
import { hasActivePremium } from "@/lib/auth";

// One generic message for every pre-transaction failure class (not found /
// inactive / expired / cap reached). Distinct messages were an enumeration
// aid on an endpoint whose ADMIN coupons mint the permanent SUPER role.
export const GENERIC_COUPON_ERROR = "Invalid or unavailable code";

export interface CouponState {
  isActive: boolean;
  expiresAt: Date | null; // redeem-by
  accessUntil: Date | null; // access end (PREMIUM); null for ADMIN
  maxUses: number; // -1 = unlimited
  usedCount: number;
}

export function classifyCoupon(coupon: CouponState | null, now: Date): "ok" | "unavailable" {
  if (!coupon || !coupon.isActive) return "unavailable";
  if (coupon.expiresAt && coupon.expiresAt < now) return "unavailable";
  // A code whose access window already closed would grant an expired row
  // and burn a use for nothing.
  if (coupon.accessUntil && coupon.accessUntil < now) return "unavailable";
  if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) return "unavailable";
  return "ok";
}

// Upsert args for a PREMIUM coupon grant. Targets the COUPON-source row
// (2026-07-24 audit Task 10): the old STRIPE-row write nulled
// stripeSubscriptionId — erasing the only cancel handle, so a deleted
// account could keep being billed — and any later Stripe webhook (which
// keys on the STRIPE row) silently clobbered coupon-granted premium.
// accountHasActivePremium ORs across rows, so a COUPON/PREMIUM row grants
// premium regardless of the STRIPE row's state.
//
// `accessUntil` lands in stripeCurrentPeriodEnd: despite the name, that is
// the source-agnostic "entitlement ends here" column — hasActivePremium
// enforces it (+24h grace) for every source, so the grant expires on its
// own with no cron. null = no end (never for beta codes; validator requires
// a date for PREMIUM).
export function couponPremiumUpsertArgs(accountId: string, accessUntil: Date | null) {
  return {
    where: { accountId_source: { accountId, source: "COUPON" as const } },
    update: {
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
      canceledAt: null,
      stripeCurrentPeriodEnd: accessUntil,
    },
    create: {
      accountId,
      source: "COUPON" as const,
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
      stripeCurrentPeriodEnd: accessUntil,
    },
  };
}

// A second coupon never shortens access the account already has. If the
// existing COUPON row still grants premium, keep the later end (null =
// lifetime wins); if it is expired/free/canceled, the new coupon replaces it.
export function mergeGrantEnd(
  existing: { plan: string; status: string; stripeCurrentPeriodEnd: Date | null } | null,
  incoming: Date | null
): Date | null {
  if (!existing || !hasActivePremium(existing)) return incoming;
  const current = existing.stripeCurrentPeriodEnd;
  if (current === null || incoming === null) return null;
  return current > incoming ? current : incoming;
}

type SubLike = {
  source: string;
  plan: string;
  status: string;
  stripeCurrentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

// A renewing paid subscriber gains nothing from a PREMIUM code (Stripe/Apple
// keep billing; premium is already ORed across rows) and would only burn a
// use — the redeem route refuses with a clear 409. A subscriber who already
// cancelled at period end is let through: nothing is wasted and the coupon
// carries them past the period end.
export function hasPaidPremium(subs: SubLike[]): boolean {
  return subs.some(
    (s) => (s.source === "STRIPE" || s.source === "APPLE") && hasActivePremium(s) && !s.cancelAtPeriodEnd
  );
}

// Where-clause for "Extend access" on a code: every redeemer's COUPON row
// that ends before the new date gets lifted to it (updateMany with
// `data: { stripeCurrentPeriodEnd: newEnd }`). Rows ending later (another
// code) or with no end (null fails `lt`) are untouched — never shortens.
// Expired rows satisfy `lt`, so extending a finished beta revives them.
export function extendGrantsWhere(accountIds: string[], newEnd: Date) {
  return {
    source: "COUPON" as const,
    accountId: { in: accountIds },
    stripeCurrentPeriodEnd: { lt: newEnd },
  };
}

// Drives the dashboard "beta access ends soon" banner: the coupon grant's end
// when it is the account's only live premium and ends within `withinDays`.
// A live paid row means the banner would be noise; an already-ended grant
// shows the gate instead, not a warning.
export function couponEndingSoon(subs: SubLike[], now: Date, withinDays = 7): Date | null {
  if (hasPaidPremium(subs)) return null;
  const row = subs.find((s) => s.source === "COUPON" && hasActivePremium(s));
  const end = row?.stripeCurrentPeriodEnd ?? null;
  if (!end || end <= now) return null;
  return end.getTime() - now.getTime() <= withinDays * 24 * 60 * 60 * 1000 ? end : null;
}

export function couponCapWhere(coupon: { id: string; maxUses: number }): {
  id: string;
  isActive: true;
  usedCount?: { lt: number };
} {
  return {
    id: coupon.id,
    isActive: true,
    ...(coupon.maxUses !== -1 ? { usedCount: { lt: coupon.maxUses } } : {}),
  };
}
