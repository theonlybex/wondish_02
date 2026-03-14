import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    // Onboarding gate: if authenticated but onboarding not complete,
    // redirect to profile (unless already on /profile)
    if (token && !token.onboardingComplete && !pathname.startsWith("/profile")) {
      return NextResponse.redirect(new URL("/profile?onboarding=true", req.url));
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

// Protect all dashboard routes
export const config = {
  matcher: [
    "/overview/:path*",
    "/meal-plan/:path*",
    "/journal/:path*",
    "/journey/:path*",
    "/grocery-list/:path*",
    "/orders/:path*",
    "/admin/:path*",
    "/provider/:path*",
    "/profile/:path*",
  ],
};
