import * as Sentry from "@sentry/nextjs";

// Client-side Sentry init. No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (dev).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
