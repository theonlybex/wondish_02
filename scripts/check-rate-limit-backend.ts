// Which rate-limit backend does the app see with the current env, and does it
// actually answer? Prints UPSTASH or MEMORY unmistakably, does a real
// round-trip, then runs lib/rate-limit.ts on a throwaway bucket and checks the
// counter landed in Redis.
//
//   npm run rate-limit:check                     # exit 1 if Upstash is configured but unreachable
//   npm run rate-limit:check -- --require-upstash  # also exit 1 on the memory fallback
//
// Loads .env.local then .env like `next dev` does (an already-exported
// variable wins over both), so it reports exactly what the dev server sees.
// See docs/rate-limiting.md.

import path from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), file));
    } catch {
      // absent — fine
    }
  }
}

async function main() {
  loadEnv();
  const requireUpstash = process.argv.includes("--require-upstash");
  // Imported after loadEnv(): lib/redis.ts decides the backend at import time.
  const { rateLimitBackend, probeRateLimitBackend } = await import("../lib/rate-limit-backend");
  const { rateLimit } = await import("../lib/rate-limit");
  const { redis } = await import("../lib/redis");

  const bucket = `check-${Date.now()}`;
  const limitTwice = async () => [(await rateLimit(bucket, "probe", 1, 60)).success, (await rateLimit(bucket, "probe", 1, 60)).success];

  if (rateLimitBackend() === "memory") {
    console.log("rate-limit backend: MEMORY fallback");
    console.log("  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. Limits live in a per-process Map:");
    console.log("  they reset when the dev server restarts, and every serverless instance counts from zero.");
    const [first, second] = await limitTwice();
    console.log(`  rateLimit("${bucket}", limit 1): ${first ? "allowed" : "refused"}, then ${second ? "allowed" : "refused"} — in this process only`);
    if (requireUpstash) {
      console.log("RESULT: FAIL — --require-upstash given but the memory fallback is active. Start it: npm run redis:local");
      process.exit(1);
    }
    console.log("RESULT: MEMORY — quota tests against this process do NOT exercise Redis. Start the local backend: npm run redis:local");
    return;
  }

  const probe = await probeRateLimitBackend(5000);
  console.log(`rate-limit backend: UPSTASH (${probe.host})`);
  if (!probe.reachable) {
    console.log(`  round-trip SET/GET/DEL: FAILED after ${probe.latencyMs} ms — ${probe.error}`);
    console.log("  On this, lib/rate-limit.ts fails open (ai-* buckets degrade to the per-instance counter) after ~5 s per call.");
    console.log("RESULT: FAIL — Upstash is configured but unreachable. Is `npm run redis:local` running, or is the URL/token wrong?");
    process.exit(1);
  }
  console.log(`  round-trip SET/GET/DEL: ok (${probe.latencyMs} ms)`);

  const [first, second] = await limitTwice();
  const keys = await redis!.keys(`rl:${bucket}:*`);
  if (keys.length) await redis!.del(...keys);
  const enforced = first && !second;
  console.log(
    `  rateLimit("${bucket}", limit 1): ${first ? "allowed" : "refused"}, then ${second ? "allowed" : "refused"}; ` +
      `${keys.length} counter key(s) in Redis${keys.length ? ` (${keys.join(", ")})` : ""}`
  );
  if (!enforced || keys.length === 0) {
    console.log("RESULT: FAIL — the limiter answered, but not from Redis (a backend error falls back to memory; check the shim's log).");
    process.exit(1);
  }
  console.log("RESULT: UPSTASH is live — limits are enforced in Redis and shared across processes.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
