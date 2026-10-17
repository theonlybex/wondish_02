import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccountWithOutcome } from "@/lib/auth";
import {
  resolveQrToken,
  recordReferral,
  REFERRAL_COOKIE,
} from "@/lib/restaurant-referrals-server";
import { rateLimit } from "@/lib/rate-limit";
import { redeemCouponForAccount } from "@/lib/coupon-redeem-server";
import { findPromotionCode } from "@/lib/stripe";
import { claimNoticeParam, pendingCouponCode, PENDING_COUPON_COOKIE } from "@/lib/pending-coupon";

// Phase 3 §2 — where Clerk lands EVERY new sign-up (the register page's
// forceRedirectUrl). If a QR cookie is present the account is attributed and
// dropped on that restaurant's menu; otherwise this is a pass-through to the
// normal onboarding destination. A coupon code entered on the pricing page
// before sign-up (PENDING_COUPON_COOKIE, set by /r/code/[code]) is redeemed
// here first, and onboarding is told the outcome via `?coupon=`.
//
// Because every sign-up flows through here, it must never be able to break
// sign-up: every failure path falls through to the normal destination.
// Attribution is worth considerably less than a working sign-up.
//
// Route precedence: this static segment wins over the sibling dynamic
// [token] route, so /r/claim is never resolved as a token. It could not be
// one anyway — "claim" is 5 characters and QR_TOKEN_LENGTH is 12.
export const dynamic = "force-dynamic";

const FALLBACK = "/profile?onboarding=true";

export async function GET(req: NextRequest) {
  // Every exit clears the cookie. This route has exactly ONE entry point —
  // register's forceRedirectUrl, which fires once — so a cookie left behind
  // can never be redeemed by the sign-up it was meant for. It can only be
  // redeemed by the NEXT sign-up in that browser, attributing a diner who
  // never scanned anything, and it makes a deterministic failure (an account
  // claim conflict, say) retry a Clerk round trip on every subsequent hit.
  // The coupon cookie is cleared on the same terms, for the same reason.
  let fallback = FALLBACK;
  const exit = (to: string) => {
    const res = NextResponse.redirect(new URL(to, req.url));
    res.cookies.delete(REFERRAL_COOKIE);
    res.cookies.delete(PENDING_COUPON_COOKIE);
    return res;
  };

  try {
    const token = req.cookies.get(REFERRAL_COOKIE)?.value;
    const couponCookie = req.cookies.get(PENDING_COUPON_COOKIE)?.value;
    if (!token && couponCookie === undefined) return NextResponse.redirect(new URL(FALLBACK, req.url));

    const { userId } = await auth();
    if (!userId) return exit(FALLBACK);

    if (couponCookie !== undefined) {
      fallback = `${FALLBACK}&coupon=${await claimCoupon(userId, couponCookie)}`;
      if (!token) return exit(fallback);
    }

    // Unknown, malformed, retired, or pointing at a restaurant that is no
    // longer PUBLISHED — its menu would 404.
    const code = await resolveQrToken(token!);
    if (!code) return exit(fallback);

    // Reaching this route does NOT prove a sign-up happened. Clerk's OAuth
    // sign-up -> sign-in transfer still honours <SignUp>'s forceRedirectUrl,
    // so "Sign up with Google" on an address that already has an account
    // lands here with a RETURNING user. Asking the account layer whether it
    // actually created anything is the only honest signal — asserting true
    // here would reintroduce exactly the inflation countsAsSignup exists to
    // prevent.
    const { account, isNewToWondish } = await getOrCreateAccountWithOutcome(userId);
    await recordReferral({
      accountId: account.id,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
      countsAsSignup: isNewToWondish,
    });

    return exit(`/restaurants/${code.restaurantSlug}`);
  } catch (err) {
    console.error("[referrals] claim failed; falling through to onboarding", err);
    return exit(fallback);
  }
}

// Redeems the parked code; returns the `?coupon=` value. Never throws — a
// failed redemption must not cost the sign-up (the user can still type the
// code on /pricing). Shares the redeem endpoint's rate-limit
// bucket so the cookie isn't a second, separate guessing allowance. ADMIN
// codes are refused here: they must be typed by the person they are for.
async function claimCoupon(userId: string, raw: string): Promise<string> {
  const code = pendingCouponCode(raw);
  if (!code) return "invalid";
  try {
    const { success } = await rateLimit("coupon-redeem", userId, 10, 3600);
    if (!success) return "error";
    const { account } = await getOrCreateAccountWithOutcome(userId);
    const outcome = await redeemCouponForAccount(account.id, code, { allowAdmin: false });
    // The pricing field sends every signed-out code here, Stripe discount
    // codes included. Those aren't redeemable — they apply at checkout — so
    // say that rather than "couldn't be applied".
    if (!outcome.ok && outcome.reason === "unavailable" && (await findPromotionCode(code))) {
      return claimNoticeParam("stripe");
    }
    return claimNoticeParam(outcome);
  } catch (err) {
    console.error("[coupon] pending redeem at claim failed", err);
    return claimNoticeParam("error");
  }
}
