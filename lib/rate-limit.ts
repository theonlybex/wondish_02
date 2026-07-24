import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";

// Shared rate limiting. When Upstash env vars are present (production), limits
// are enforced across all serverless instances via Redis. Otherwise we fall
// back to a per-instance in-memory limiter — fine for local dev, but it resets
// on every cold start, so it is NOT effective in serverless production.

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
const memStore = new Map<string, { count: number; resetAt: number }>();

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
 *
 * @param name        bucket name, e.g. "dish-checker"
 * @param identifier  who is being limited, e.g. userId
 * @param limit       max requests allowed in the window
 * @param windowSec   window length in seconds
 * @param backendOverride  test seam: replaces the Upstash/memory backend
 */
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
    console.error(`[rate-limit] backend error for bucket "${name}" — failing open`, err);
    return { success: true };
  }
}
