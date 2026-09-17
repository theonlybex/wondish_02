import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // A production process on the per-instance rate-limit fallback is a real
    // problem: without Upstash the ai-* spend caps — and GLOBAL_AI_DAILY_MAX,
    // the org-wide backstop — become per-instance, so the effective ceiling is
    // `limit × instances` and every cold start resets it.
    //
    // It is reported, not fatal (2026-09-17, user-directed). Failing the boot
    // was the original design, and it does bound the bill perfectly, but it
    // trades an outage for that: Vercel Preview also runs NODE_ENV=production,
    // so one unset variable takes previews (or production) down, and the
    // mechanism has never been exercised against a real `next build` —
    // an untested kill switch is the wrong thing to put in front of a beta.
    // /api/health reports "degraded" and Sentry gets a fatal, so a monitor
    // still pages. Dev and tests are never judged.
    //
    // Promotion path, once verified against a real production build: set
    // RATE_LIMIT_ENFORCE_BACKEND=1 (see shouldFailBoot) — config, not a code
    // change.
    const { memoryFallbackViolation, shouldFailBoot } = await import("./lib/rate-limit-backend");
    const violation = memoryFallbackViolation();
    if (violation) {
      console.error(violation);
      Sentry.captureMessage(violation, "fatal");
      if (shouldFailBoot()) {
        await Sentry.flush(2000);
        throw new Error(violation);
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown in App Router server handlers (Next 15+). Harmless on
// Next 14 where the hook isn't invoked.
export const onRequestError = Sentry.captureRequestError;
