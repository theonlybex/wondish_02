import { NextRequest, NextResponse } from "next/server";

// One-time route: sets the taste_complete cookie for existing users who
// completed taste setup before the cookie was introduced, then bounces
// them back to where they were going. The layout only redirects here
// after confirming profileCompleted=true in the DB, so no re-check needed.
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/overview";
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set("taste_complete", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
