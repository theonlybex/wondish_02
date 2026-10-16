// A coupon code typed into the landing-page promo field by a SIGNED-OUT
// visitor (2026-10-16). It can't be redeemed yet — there is no account — so
// /r/code/[code] parks it in a cookie and sends them to /register; Clerk lands
// every sign-up on /r/claim, which redeems it for the new account and hands
// the outcome to onboarding as `?coupon=…`. Same carrier as the restaurant QR
// referral (a cookie, because register hard-codes forceRedirectUrl).
import { CODE_RE } from "@/lib/coupon-admin";
import type { RedeemOutcome } from "@/lib/coupon-redeem-server";

export const PENDING_COUPON_COOKIE = "wondish_coupon";
// Long enough to sign up and verify an email; short enough that a code left in
// a shared browser isn't picked up by somebody else's sign-up tomorrow.
export const PENDING_COUPON_MAX_AGE = 60 * 60;

/** The code as the admin validator would have minted it, or null. */
export function pendingCouponCode(raw: string | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export type ClaimNoticeKind = "activated" | "already" | "paid" | "invalid" | "stripe" | "error";

/** `?coupon=` value for onboarding: "activated:YYYY-MM-DD", or the refusal. */
export function claimNoticeParam(outcome: RedeemOutcome | "error" | "stripe"): string {
  if (outcome === "error" || outcome === "stripe") return outcome;
  if (outcome.ok) {
    return outcome.accessUntil ? `activated:${outcome.accessUntil.toISOString().slice(0, 10)}` : "activated";
  }
  return outcome.reason === "unavailable" ? "invalid" : outcome.reason;
}

const KINDS: ReadonlySet<string> = new Set(["activated", "already", "paid", "invalid", "stripe", "error"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inverse of claimNoticeParam; anything unrecognised (a hand-edited URL) → null. */
export function parseClaimNotice(raw: string | undefined): { kind: ClaimNoticeKind; until: string | null } | null {
  if (!raw) return null;
  const [kind, until] = raw.split(":", 2);
  if (!KINDS.has(kind)) return null;
  return { kind: kind as ClaimNoticeKind, until: kind === "activated" && until && DAY_RE.test(until) ? until : null };
}
