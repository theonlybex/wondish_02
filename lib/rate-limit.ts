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
  const entry = memStore.get(id);
  if (!entry || now > entry.resetAt) {
    memStore.set(id, { count: 1, resetAt: now + windowSec * 1000 });
    return { success: true };
  }
  if (entry.count >= limit) return { success: false };
  entry.count++;
  return { success: true };
}

/**
 * Check a rate limit for `identifier` (e.g. a Clerk userId) under a named
 * bucket. Returns `{ success: false }` when the limit is exceeded.
 *
 * @param name        bucket name, e.g. "dish-checker"
 * @param identifier  who is being limited, e.g. userId
 * @param limit       max requests allowed in the window
 * @param windowSec   window length in seconds
 */
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  if (redis) {
    const { success } = await getUpstashLimiter(name, limit, windowSec).limit(identifier);
    return { success };
  }
  return memoryLimit(`${name}:${identifier}`, limit, windowSec);
}
