// Pure coupon-redemption decision logic backing app/api/coupon/redeem.
// Extracted (2026-07-24 audit Task 8) so the failure taxonomy and the atomic
// usage-cap predicate are unit-testable; the route stays a thin wrapper.

// One generic message for every pre-transaction failure class (not found /
// inactive / expired / cap reached). Distinct messages were an enumeration
// aid on an endpoint whose ADMIN coupons mint the permanent SUPER role.
export const GENERIC_COUPON_ERROR = "Invalid or unavailable code";

export interface CouponState {
  isActive: boolean;
  expiresAt: Date | null;
  maxUses: number; // -1 = unlimited
  usedCount: number;
}

export function classifyCoupon(coupon: CouponState | null, now: Date): "ok" | "unavailable" {
  if (!coupon || !coupon.isActive) return "unavailable";
  if (coupon.expiresAt && coupon.expiresAt < now) return "unavailable";
  if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) return "unavailable";
  return "ok";
}

// Where-clause for the cap-enforcing increment. Combined with
// `data: { usedCount: { increment: 1 } }` in a single updateMany, the
// usedCount predicate and the increment execute as ONE conditional UPDATE
// statement — N concurrent redemptions of the last slot can no longer all
// pass a stale pre-read and overshoot maxUses (count === 0 ⇒ lost the race).
// Upsert args for a PREMIUM coupon grant. Targets the COUPON-source row
// (2026-07-24 audit Task 10): the old STRIPE-row write nulled
// stripeSubscriptionId — erasing the only cancel handle, so a deleted
// account could keep being billed — and any later Stripe webhook (which
// keys on the STRIPE row) silently clobbered coupon-granted premium.
// accountHasActivePremium ORs across rows, so a COUPON/PREMIUM row grants
// premium regardless of the STRIPE row's state.
export function couponPremiumUpsertArgs(accountId: string) {
  return {
    where: { accountId_source: { accountId, source: "COUPON" as const } },
    update: { plan: "PREMIUM" as const, status: "ACTIVE" as const, canceledAt: null },
    create: {
      accountId,
      source: "COUPON" as const,
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
    },
  };
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
