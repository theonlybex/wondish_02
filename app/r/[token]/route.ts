import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import {
  resolveQrToken,
  recordScan,
  recordReferral,
} from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — the QR scan entry point (docs/restaurants/phase-3.md).
// Public by design: the visitor has no account yet. Two outcomes:
//   signed in  -> attribute now, drop them on the menu
//   signed out -> remember the code in a cookie, send them to sign up
// The cookie (not a query param) is the carrier because the register page
// hard-codes Clerk's forceRedirectUrl, so a redirect_url would be discarded.
export const dynamic = "force-dynamic";

export const REFERRAL_COOKIE = "wondish_ref";
const REFERRAL_COOKIE_MAX_AGE = 30 * 60; // 30 minutes — one sitting

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const code = await resolveQrToken(params.token);

  // Unknown or retired code: send them to the directory rather than a dead
  // end. A stale table tent should still land somewhere useful.
  if (!code) return NextResponse.redirect(new URL("/restaurants", req.url));

  await recordScan(code.id);

  const { userId } = await auth();
  if (userId) {
    const account = await getOrCreateAccount(userId);
    await recordReferral({
      accountId: account.id,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
    });
    return NextResponse.redirect(new URL(`/restaurants/${code.restaurantSlug}`, req.url));
  }

  const res = NextResponse.redirect(new URL("/register", req.url));
  res.cookies.set(REFERRAL_COOKIE, params.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
