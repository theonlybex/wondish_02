// The landing-page promo field takes two kinds of code: Stripe promotion
// codes (a checkout discount, previewed via /api/billing/promo) and the
// admin-minted DB coupons from /admin/coupons (beta or admin access, redeemed
// via /api/coupon/redeem). It used to ask only Stripe, so every admin coupon
// typed there read "That code isn't valid" (2026-10-16). PlanPicker asks
// Stripe first and, on Apply, falls back to redeeming; this maps the redeem
// response to what the field shows.
export type CouponRedeemResult =
  | { kind: "activated"; admin: boolean; until: string | null }
  | { kind: "signIn" }
  | { kind: "invalid" }
  | { kind: "error"; message: string | null };

export function couponRedeemResult(status: number, data: unknown): CouponRedeemResult {
  const d = (data ?? {}) as { success?: unknown; type?: unknown; accessUntil?: unknown; error?: unknown };
  if (status === 401) return { kind: "signIn" };
  // The redeem route answers every not-found/expired/capped code with one
  // generic 404 (anti-enumeration), so the field's own "isn't valid" fits.
  if (status === 404) return { kind: "invalid" };
  if (status >= 200 && status < 300 && d.success === true) {
    return {
      kind: "activated",
      admin: d.type === "ADMIN",
      until: typeof d.accessUntil === "string" ? d.accessUntil : null,
    };
  }
  return { kind: "error", message: typeof d.error === "string" ? d.error : null };
}
