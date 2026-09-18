import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { isAuthorizedCron } from "@/lib/clara/retention";
import { probeRateLimitBackend, rateLimitWatchOutcome } from "@/lib/rate-limit-backend";

// GET /api/cron/rate-limit-watch — scheduled probe of the rate-limit backend.
// Scheduled by vercel.json; protected by CRON_SECRET the same way as
// clara-gap-purge (Vercel sends it as a bearer token; unset secret ⇒ 401).
//
// It exists for two reasons, and the second is the one that bit us:
//
//   1. ALERTING. The ai-* spend caps are the only bound on the Anthropic bill,
//      and without a reachable shared Redis they silently degrade to a
//      per-instance counter (effective cap ≈ limit × instances). Nothing about
//      that is visible in the UI. A degraded probe raises a Sentry error here
//      so somebody finds out from an alert rather than from the bill.
//
//   2. KEEPING THE DATABASE ALIVE. Upstash archives a Redis database after a
//      stretch of inactivity, and that is exactly how the previous one died:
//      the env vars stayed in place looking perfectly valid while the host
//      stopped resolving (NXDOMAIN). "Set but broken" is invisible to any
//      config check — only a real round-trip catches it. probeRateLimitBackend
//      does a real SET/GET/DEL, so each run is both the check AND the activity
//      that prevents the archival.
//
// Runs DAILY, not hourly, because this project is on a Vercel Hobby plan and
// Hobby rejects any cron that fires more than once a day (the deploy fails
// outright: "Hobby accounts are limited to daily cron jobs"). Daily is ample
// for purpose 2 — Upstash archives after a long idle stretch, not a day — but
// it means up to 24 h before purpose 1 notices a dead Redis.
//
// So this is NOT a substitute for an external uptime monitor, for two separate
// reasons: a cron inside the deployment cannot tell you the deployment is
// down, and once a day is too slow to be an alert. Point an external HTTP
// check at /api/health every few minutes and treat this as the backstop.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probe = await probeRateLimitBackend();
  const { healthy, detail } = rateLimitWatchOutcome(probe);

  if (healthy) {
    console.log(`[rate-limit-watch] ok — ${detail}`);
    return NextResponse.json({ ok: true, ...probe });
  }

  // Deliberately an error, not a warning: this means the spend caps are not
  // actually holding. `shared: false` on the memory fallback is the same
  // condition /api/health reports as "degraded".
  const message = `[rate-limit-watch] spend caps are NOT enforced across instances — ${detail}`;
  console.error(message, probe);
  Sentry.captureException(new Error(message), {
    level: "error",
    extra: { backend: probe.backend, reachable: probe.reachable, shared: probe.shared, host: probe.host, latencyMs: probe.latencyMs },
  });
  await Sentry.flush(2000);

  // 500 so the Vercel cron itself is recorded as failed — a second, independent
  // place this shows up besides Sentry.
  return NextResponse.json({ ok: false, detail, ...probe }, { status: 500 });
}
