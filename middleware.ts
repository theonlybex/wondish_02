import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/register(.*)",
  "/pricing(.*)",
  "/dishes(.*)",
  "/terms(.*)",
  "/privacy(.*)",
  "/api/stripe/webhook",
  "/api/health",
]);

const isAuthRoute = createRouteMatcher(["/login(.*)", "/register(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const { pathname } = req.nextUrl;

  // Redirect authenticated users away from landing/auth pages to their dashboard
  if (userId && (isAuthRoute(req) || pathname === "/")) {
    return NextResponse.redirect(new URL("/overview", req.url));
  }

  if (!isPublicRoute(req) && !userId) {
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
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
