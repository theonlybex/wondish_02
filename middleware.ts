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

// The /login URL for an unauthenticated page request, carrying the request's
// own path + query as `redirect_url` so Clerk's <SignIn> (which prefers that
// query param over its fallbackRedirectUrl) returns the user to where they
// were going once the session exists. Without it, a Stripe Checkout return
// to /billing/success?session_id=… (a cross-site navigation that drops the
// SameSite=Strict __client_uat cookie, so Clerk's handshake fails) bounced to
// a bare /login and the user landed on /overview with no confirmation.
//
// Open-redirect guard: the value is built ONLY from the request's pathname +
// search — never from a caller-supplied parameter — and is dropped unless it
// resolves to the request's own origin (a "//evil.example" or "/\evil.example"
// pathname would otherwise resolve to a foreign host). Any inbound
// `redirect_url` on the protected page is just part of that query string,
// nested inside a same-origin path.
export function loginRedirectUrl(
  reqUrl: string,
  nextUrl: { pathname: string; search: string },
): URL {
  const loginUrl = new URL("/login", reqUrl);
  const returnTo = nextUrl.pathname + nextUrl.search;
  if (
    returnTo.startsWith("/") &&
    new URL(returnTo, loginUrl.origin).origin === loginUrl.origin
  ) {
    loginUrl.searchParams.set("redirect_url", returnTo);
  }
  return loginUrl;
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
    return NextResponse.redirect(loginRedirectUrl(req.url, req.nextUrl));
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
