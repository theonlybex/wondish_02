import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { probeRateLimitBackend } from "@/lib/rate-limit-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight uptime/health check. Verifies the process is up, the database is
// reachable, and which rate-limit backend is live. Public (no auth) so external
// uptime monitors can poll it.
//
// `rateLimit.shared` is the field that matters: false means the Anthropic
// spend caps are per-instance counters (memory fallback, or Upstash configured
// but unreachable). That is "degraded" (503) in production so a monitor pages
// on it; in dev the memory fallback is normal and stays "ok".
export async function GET() {
  const time = new Date().toISOString();
  const [dbUp, rl] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(
      () => true,
      (err) => {
        console.error("[health] db check failed", err);
        return false;
      }
    ),
    probeRateLimitBackend(),
  ]);
  if (rl.error) console.error(`[health] rate-limit backend ${rl.backend} (${rl.host ?? "-"}) unreachable: ${rl.error}`);

  const rateLimitOk = rl.backend === "upstash" ? rl.reachable : process.env.NODE_ENV !== "production";
  const ok = dbUp && rateLimitOk;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      rateLimit: { backend: rl.backend, reachable: rl.reachable, shared: rl.shared },
      time,
    },
    { status: ok ? 200 : 503 }
  );
}
