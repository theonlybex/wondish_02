import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import {
  resolveQrToken,
  recordReferral,
  REFERRAL_COOKIE,
} from "@/lib/restaurant-referrals-server";

// Phase 3 §2 — where Clerk lands EVERY new sign-up (the register page's
// forceRedirectUrl). If a QR cookie is present the account is attributed and
// dropped on that restaurant's menu; otherwise this is a pass-through to the
// normal onboarding destination.
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
  const exit = (to: string) => {
    const res = NextResponse.redirect(new URL(to, req.url));
    res.cookies.delete(REFERRAL_COOKIE);
    return res;
  };

  try {
    const token = req.cookies.get(REFERRAL_COOKIE)?.value;
    if (!token) return NextResponse.redirect(new URL(FALLBACK, req.url));

    const { userId } = await auth();
    if (!userId) return exit(FALLBACK);

    // Unknown, malformed, retired, or pointing at a restaurant that is no
    // longer PUBLISHED — its menu would 404.
    const code = await resolveQrToken(token);
    if (!code) return exit(FALLBACK);

    const account = await getOrCreateAccount(userId);
    await recordReferral({
      accountId: account.id,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
      // Reached only via register's post-sign-up redirect: this is a sign-up.
      countsAsSignup: true,
    });

    return exit(`/restaurants/${code.restaurantSlug}`);
  } catch (err) {
    console.error("[referrals] claim failed; falling through to onboarding", err);
    return exit(FALLBACK);
  }
}
