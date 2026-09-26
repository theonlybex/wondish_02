import * as Sentry from "@sentry/nextjs";

// Server-side Sentry init. No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (dev).
Sentry.init({
  // Vercel has held this as NEXT_PUBLIC_SENTRY_DNS (sic) since the project was
  // set up, so production has reported nothing (found 2026-09-26). Either
  // spelling works until the variable is renamed there.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DNS,
  enabled: !!(process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DNS),
  tracesSampleRate: 0.1,
});
