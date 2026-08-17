import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  resolveQrToken,
  recordScan,
  recordReferral,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
} from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — the QR scan entry point (docs/restaurants/phase-3.md).
// Public by design: the visitor has no account yet. Two outcomes:
//   signed in  -> attribute now, drop them on the menu
//   signed out -> remember the code in a cookie, send them to sign up
// The cookie (not a query param) is the carrier because the register page
// hard-codes Clerk's forceRedirectUrl, so a redirect_url would be discarded.
//
// Someone standing at a table has already committed to using this: getting
// them to the menu matters more than any bookkeeping here, so every write is
// best-effort and no failure is allowed to turn a scan into an error page.
export const dynamic = "force-dynamic";

// The token is printed on a table tent, so this URL is public knowledge and
// the write below is unauthenticated. Without a cap anyone holding a tent (or
// a crawler following a shared link) can inflate `scans`, which is the
// denominator of the pilot's conversion metric. Keyed by IP because the whole
// point is that the caller has no account yet.
const SCAN_LIMIT = 30;
const SCAN_WINDOW_SECONDS = 60;

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const code = await resolveQrToken(params.token);

  // Unknown, retired, or pointing at a restaurant that is no longer
  // PUBLISHED (its menu would 404). Send them to the directory rather than a
  // dead end — a stale table tent should still land somewhere useful.
  if (!code) return NextResponse.redirect(new URL("/restaurants", req.url));

  const toMenu = NextResponse.redirect(new URL(`/restaurants/${code.restaurantSlug}`, req.url));

  try {
    const { success } = await rateLimit(
      "restaurant-qr-scan",
      `${clientKey(req)}:${code.id}`,
      SCAN_LIMIT,
      SCAN_WINDOW_SECONDS
    );
    // Over the cap: still route the human, just stop counting.
    if (success) await recordScan(code.id);

    const { userId } = await auth();
    if (userId) {
      const account = await getOrCreateAccount(userId);
      await recordReferral({
        accountId: account.id,
        qrCodeId: code.id,
        restaurantId: code.restaurantId,
        // An already-signed-in diner scanning a tent is a visit, not a
        // sign-up. Attribute it, but keep it out of the conversion numerator.
        countsAsSignup: false,
      });
      return toMenu;
    }
  } catch (err) {
    // A dead code row (P2025), an account-claim conflict, or a Clerk outage
    // must not give someone at a table a 500. Lose the bookkeeping, keep the
    // journey: signed-in visitors still reach the menu, and signed-out ones
    // still fall through to sign-up below.
    console.error("[referrals] scan bookkeeping failed; continuing", err);
    const { userId } = await auth().catch(() => ({ userId: null }));
    if (userId) return toMenu;
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
