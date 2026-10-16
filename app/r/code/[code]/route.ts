import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { pendingCouponCode, PENDING_COUPON_COOKIE, PENDING_COUPON_MAX_AGE } from "@/lib/pending-coupon";

// Where the landing-page promo field sends a SIGNED-OUT visitor who pressed
// Apply on a code Stripe doesn't know (see lib/pending-coupon.ts). Parks the
// code in a cookie and goes to sign-up; /r/claim redeems it afterwards.
//
// Deliberately does no lookup: telling a stranger whether a code exists would
// be an unauthenticated, un-rate-limited enumeration oracle. A bad code simply
// comes back from /r/claim as "invalid" once there is an account to report to.
// Nested under /r so it is public (middleware) and never collides with the
// one-segment /r/[token] QR route.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  // Signed in already: nothing to carry. The pricing field redeems in place.
  const { userId } = await auth();
  if (userId) return NextResponse.redirect(new URL("/pricing", req.url));

  const code = pendingCouponCode(decodeURIComponent(params.code));
  const res = NextResponse.redirect(new URL("/register", req.url));
  if (code) {
    res.cookies.set(PENDING_COUPON_COOKIE, code, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PENDING_COUPON_MAX_AGE,
      path: "/",
    });
  }
  return res;
}
