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
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email(.*)",
  "/api/stripe/webhook",
]);

const isAuthRoute = createRouteMatcher(["/login(.*)", "/register(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims } = await auth();
  const { pathname } = req.nextUrl;

  // Redirect authenticated users away from landing/auth pages to their dashboard
  if (userId && isAuthRoute(req)) {
    return NextResponse.redirect(new URL("/meal-plan", req.url));
  }

  if (!isPublicRoute(req) && !userId) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (userId && !isPublicRoute(req)) {
    const meta = sessionClaims?.metadata as { onboardingComplete?: boolean } | undefined;
    const cookieDone = req.cookies.get("onboarding_complete")?.value === "1";
    const onboardingComplete = cookieDone || (meta?.onboardingComplete ?? false);
    if (!onboardingComplete && !pathname.startsWith("/profile") && !pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/profile?onboarding=true", req.url));
    }
  }

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
