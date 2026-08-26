import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/register(.*)",
  "/pricing(.*)",
  "/dishes(.*)",
  // Phase 2 web: the consumer restaurant directory + menu. Public by design —
  // a diner scanning a table QR code has no account yet (Phase 3 lands here),
  // and the menu must render for them. Verdicts still require a signed-in
  // profile; signed-out visitors get the menu plus a sign-in prompt.
  "/restaurants(.*)",
  // Phase 3: the QR scan entry point. The whole point is that a diner with no
  // account can scan a table code — this must never redirect to login.
  "/r/(.*)",
  "/terms(.*)",
  "/privacy(.*)",
  "/api/stripe/webhook",
  "/api/health",
  // Cookie-only locale switch — signed-out visitors on public pages
  // previously got a middleware 401 when changing language (audit Task 18).
  "/api/set-locale",
]);

const isAuthRoute = createRouteMatcher(["/login(.*)", "/register(.*)"]);

// Pure decision, extracted so it's unit-testable without a live Clerk auth
// context / NextRequest (see middleware.test.ts). Anchored to the "/api"
// path segment so "/apiary" or "/api-docs" pages still redirect normally.
export function wantsJson401(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const { pathname } = req.nextUrl;

  // Redirect authenticated users away from landing/auth pages to their dashboard
  if (userId && (isAuthRoute(req) || pathname === "/")) {
    return NextResponse.redirect(new URL("/overview", req.url));
  }

  if (!isPublicRoute(req) && !userId) {
    // iOS/XHR Bearer clients can't act on an HTML 307 redirect (URLSession
    // follows it and treats the login page as a "successful" response) — API
    // callers get a real JSON 401 instead. Browser page navigation is
    // unaffected: it holds a session cookie and never reaches this branch.
    if (wantsJson401(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Onboarding is gated in the dashboard layout (Node runtime), which can derive
  // completion from the actual profile data. The edge can't query the DB, so it
  // no longer guesses from a cookie/JWT flag that could be stale.

  // Inject pathname so server layouts can read it
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: [
    // Clerk's stock matcher, hardened with end-of-path anchoring so only
    // genuine asset paths (and only the "_next" segment itself) bypass auth.
    "/((?!_next(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)",
    "/(api|trpc)(.*)",
  ],
};
