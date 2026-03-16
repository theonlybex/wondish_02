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

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims } = await auth();
  const { pathname } = req.nextUrl;

  if (!isPublicRoute(req) && !userId) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (userId && !isPublicRoute(req)) {
    const meta = sessionClaims?.metadata as { onboardingComplete?: boolean } | undefined;
    const onboardingComplete = meta?.onboardingComplete ?? false;
    if (!onboardingComplete && !pathname.startsWith("/profile")) {
      return NextResponse.redirect(new URL("/profile?onboarding=true", req.url));
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
