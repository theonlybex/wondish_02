import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";

// Shared rate limiting. When Upstash env vars are present (production), limits
// are enforced across all serverless instances via Redis. Otherwise we fall
// back to a per-instance in-memory limiter — fine for local dev, but it resets
// on every cold start, so it is NOT effective in serverless production.
// Which backend is live, the production boot assertion and /api/health's probe
// are in lib/rate-limit-backend.ts; a local Redis setup is docs/rate-limiting.md.

type RateLimitResult = { success: boolean };

// One Ratelimit instance per (name, limit, window) config, reused across calls.
const limiters = new Map<string, Ratelimit>();

function getUpstashLimiter(name: string, limit: number, windowSec: number): Ratelimit {
  const key = `${name}:${limit}:${windowSec}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: `rl:${name}`,
      analytics: false,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

// ── In-memory fallback (dev only; per-instance, resets on cold start) ─────────
// Pinned to globalThis so Next's hot reload doesn't hand out a fresh, empty
// store on every code edit — otherwise local quota testing (5 Clara messages,
// 1 week/week…) silently resets between saves and looks broken.
const g = globalThis as unknown as { __wondishRateLimitStore?: Map<string, { count: number; resetAt: number }> };
const memStore = (g.__wondishRateLimitStore ??= new Map<string, { count: number; resetAt: number }>());

function memoryLimit(id: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  if (limit < 1) return { success: false };
  const entry = memStore.get(id);
  if (!entry || now > entry.resetAt) {
    memStore.set(id, { count: 1, resetAt: now + windowSec * 1000 });
    return { success: true };
  }
  if (entry.count >= limit) return { success: false };
  entry.count++;
  return { success: true };
}

// One loud warning per process when production runs on the in-memory
// fallback: every limit (including the chat/fridge daily economic gates)
// silently degrades to a per-instance counter that resets on cold start.
let warnedMemoryFallbackInProd = false;

/**
 * Check a rate limit for `identifier` (e.g. a Clerk userId) under a named
 * bucket. Returns `{ success: false }` when the limit is exceeded.
 *
 * Failure policy (2026-07-24 audit Task 12): a rate-limit backend error
 * FAILS OPEN — availability over enforcement, matching the Upstash client's
 * own timeout behavior — and is loudly logged. It never throws into the
 * route (which previously 500'd every gated endpoint during a Redis outage).
 * Exception: spend buckets (named "ai-*", see lib/ai-budget.ts) degrade to the
 * per-instance counter instead of opening, so a Redis outage cannot uncap the
 * Anthropic bill.
 *
 * @param name        bucket name, e.g. "dish-checker"
 * @param identifier  who is being limited, e.g. userId
 * @param limit       max requests allowed in the window
 * @param windowSec   window length in seconds
 * @param backendOverride  test seam: replaces the Upstash/memory backend
 */
/**
 * How many of a bucket's tokens are left, WITHOUT spending one.
 *
 * @upstash/ratelimit's limit() always consumes, which forced the AI guard to
 * charge a user's allowance before knowing whether the request would produce
 * anything — so three failed dish swaps cost a QA account all three of its
 * daily swaps and changed nothing. getRemaining() reads the window instead.
 *
 * Returns null when the backend cannot answer (dev memory fallback, Redis
 * down): the caller then proceeds, because refusing a user over a read we
 * could not make is worse than letting one extra request through — and the
 * charge-on-success path still meters it.
 */
export async function remainingTokens(
  name: string,
  identifier: string,
  limit: number,
  windowSec: number
): Promise<number | null> {
  if (!redis) {
    // Dev memory fallback keys by the same JSON shape rateLimit uses.
    const entry = memStore.get(JSON.stringify([name, identifier]));
    if (!entry || Date.now() > entry.resetAt) return limit;
    return Math.max(0, limit - entry.count);
  }
  try {
    const { remaining } = await getUpstashLimiter(name, limit, windowSec).getRemaining(identifier);
    return remaining;
  } catch {
    return null;
  }
}

export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  windowSec: number,
  backendOverride?: (identifier: string) => Promise<RateLimitResult>
): Promise<RateLimitResult> {
  try {
    if (backendOverride) {
      const { success } = await backendOverride(identifier);
      return { success };
    }
    if (redis) {
      const { success } = await getUpstashLimiter(name, limit, windowSec).limit(identifier);
      return { success };
    }
    if (process.env.NODE_ENV === "production" && !warnedMemoryFallbackInProd) {
      warnedMemoryFallbackInProd = true;
      console.warn(
        "[rate-limit] Upstash env vars absent in production — falling back to per-instance memory; limits are NOT enforced across instances"
      );
    }
    return memoryLimit(JSON.stringify([name, identifier]), limit, windowSec);
  } catch (err) {
    // Spend buckets (lib/ai-budget.ts, all named "ai-*") are the Anthropic
    // bill cap. On a backend error they degrade to the per-instance counter:
    // each warm instance then enforces the limit independently from zero, so
    // the effective cap is roughly `limit × instances`, not `limit`. That is
    // far from a hard cap but strictly better than the fully-open path burst
    // buckets take (availability over enforcement, 2026-07-24 audit Task 12).
    if (name.startsWith("ai-")) {
      console.error(`[rate-limit] backend error for spend bucket "${name}" — using per-instance fallback`, err);
      return memoryLimit(JSON.stringify([name, identifier]), limit, windowSec);
    }
    console.error(`[rate-limit] backend error for bucket "${name}" — failing open`, err);
    return { success: true };
  }
}
