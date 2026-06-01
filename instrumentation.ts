import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown in App Router server handlers (Next 15+). Harmless on
// Next 14 where the hook isn't invoked.
export const onRequestError = Sentry.captureRequestError;
