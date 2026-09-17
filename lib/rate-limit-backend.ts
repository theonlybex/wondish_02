import { redis } from "@/lib/redis";

// Which backend lib/rate-limit.ts is running on, and the production rule
// about it. Kept apart from rate-limit.ts so the limiter's failure policy
// (fail open / ai-* degrades to memory, documented there) stays untouched.
//
// The memory fallback is a per-process Map: fine for `next dev`, useless in
// serverless production where every warm instance counts from zero and the
// effective cap on the Anthropic bill becomes `limit × instances`. Three
// places surface it:
//   1. memoryFallbackViolation() — instrumentation.ts logs it as an error and
//      sends Sentry a fatal when a production process has no Upstash. It only
//      FAILS the boot when RATE_LIMIT_ENFORCE_BACKEND=1 (see shouldFailBoot).
//   2. probeRateLimitBackend()   — /api/health reports the backend and a real
//      round-trip; production on memory, or Upstash unreachable, is "degraded".
//   3. scripts/check-rate-limit-backend.ts — the same probe from a terminal.

export type RateLimitBackend = "upstash" | "memory";
type Env = Record<string, string | undefined>;

/** Same test lib/redis.ts makes at import time: both Upstash vars present and non-empty. */
export function rateLimitBackend(env: Env = process.env): RateLimitBackend {
  return env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? "upstash" : "memory";
}

/**
 * Explicit opt-out for a production-mode process that must run without Redis
 * (a preview deployment, `next start` on a laptop). It only silences the boot
 * assertion; /api/health still reports "degraded", so it cannot hide the state.
 */
export const MEMORY_FALLBACK_OPT_OUT = "RATE_LIMIT_ALLOW_MEMORY_FALLBACK";

/**
 * Null when the process may run; otherwise why it must not. Only production
 * is judged — `next dev` and the test runner legitimately have no Redis.
 */
export function memoryFallbackViolation(env: Env = process.env): string | null {
  if (env.NODE_ENV !== "production") return null;
  if (rateLimitBackend(env) === "upstash") return null;
  if (env[MEMORY_FALLBACK_OPT_OUT] === "1") return null;
  return (
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set in a production process. " +
    "Every rate limit — including the ai-* spend caps that bound the Anthropic bill — would run on a " +
    "per-instance memory counter that resets on every cold start (effective cap ≈ limit × instances). " +
    `Set the Upstash vars, or set ${MEMORY_FALLBACK_OPT_OUT}=1 to run anyway (/api/health then reports "degraded").`
  );
}

/**
 * Opt-IN to making a violation fatal at boot (RATE_LIMIT_ENFORCE_BACKEND=1).
 *
 * Default OFF (2026-09-17, user-directed): a violation is logged and reported
 * to Sentry, /api/health goes "degraded", and the process serves traffic. The
 * hard failure is strictly safer for the Anthropic bill — nothing serves, so
 * nothing spends — but it turns one unset variable into an outage, and Vercel
 * Preview runs NODE_ENV=production too. Turn it on once the behaviour has been
 * confirmed against a real `next build && next start`.
 */
export const HARD_FAIL_OPT_IN = "RATE_LIMIT_ENFORCE_BACKEND";

/** True when there is a violation AND the deployment asked for a hard failure. */
export function shouldFailBoot(env: Env = process.env): boolean {
  return memoryFallbackViolation(env) !== null && env[HARD_FAIL_OPT_IN] === "1";
}

/** Throws the violation, if any. Kept as the explicit hard-fail contract that
 *  shouldFailBoot() gates; instrumentation.ts calls it only when opted in. */
export function assertRateLimitBackend(env: Env = process.env): void {
  const violation = memoryFallbackViolation(env);
  if (violation) throw new Error(violation);
}

export interface RateLimitBackendProbe {
  backend: RateLimitBackend;
  /** A real round-trip succeeded. Always true for memory — there is nothing to reach. */
  reachable: boolean;
  /** Limits hold across processes/instances: Upstash, and reachable. */
  shared: boolean;
  latencyMs: number;
  /** Host of the configured Upstash URL (never the token). */
  host?: string;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Real SET → GET → DEL round-trip through the shared client, bounded by
 * `timeoutMs` (the client itself retries with backoff for ~4 s when the host
 * is down, too long for a health check). Never throws.
 */
export async function probeRateLimitBackend(timeoutMs = 3000): Promise<RateLimitBackendProbe> {
  const backend = rateLimitBackend();
  if (backend === "memory" || !redis) return { backend: "memory", reachable: true, shared: false, latencyMs: 0 };

  let host: string | undefined;
  try {
    host = new URL(process.env.UPSTASH_REDIS_REST_URL!).host;
  } catch {
    host = process.env.UPSTASH_REDIS_REST_URL;
  }
  const started = Date.now();
  // "pong", not "1": the client JSON-parses replies, and "1" would come back as a number.
  const key = `probe:rate-limit-backend:${process.pid}:${started}`;
  try {
    await withTimeout(
      (async () => {
        await redis.set(key, "pong", { px: 10_000 });
        const got = await redis.get<string>(key);
        if (got !== "pong") throw new Error(`round-trip mismatch: wrote "pong", read ${JSON.stringify(got)}`);
        await redis.del(key);
      })(),
      timeoutMs
    );
    return { backend, reachable: true, shared: true, latencyMs: Date.now() - started, host };
  } catch (err) {
    return {
      backend,
      reachable: false,
      shared: false,
      latencyMs: Date.now() - started,
      host,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
