import { redis } from "@/lib/redis";

/**
 * A mutex for "this user already has one of these running", with a release.
 *
 * This exists because cook-my-day used a RATE LIMIT as an in-flight lock:
 * `rateLimit("ai-cookday-inflight", userId, 1, 90)`. A rate limit has no
 * release — the token comes back when its window rolls. So a user whose day
 * cooked SUCCESSFULLY in eight seconds was told "Clara is already cooking your
 * day — give her a moment" for the remaining eighty-two, about something that
 * had already finished. QA hit it in cycles 14 and 15; cycle 15 fixed the
 * ordering around it and not the shape.
 *
 * A rate limit answers "how often may you"; a lock answers "are you already".
 * The second question has an answer that changes when the work ends, which is
 * why `SET NX EX` + `DEL` is the primitive and a sliding window is not.
 *
 * The TTL is the crash guard, not the policy: if the process dies mid-run the
 * key expires on its own, so a lock is never held forever by a request nobody
 * is waiting for. Set it to the slowest honest run, not the shortest.
 *
 * Failure policy matches the "ai-" spend buckets in lib/rate-limit.ts, and for
 * the same reason: these locks guard work that COSTS money and writes public
 * rows, so a Redis outage must not open them. On a backend error it degrades to
 * a per-instance in-memory lock — weaker (each warm instance holds its own),
 * strictly better than none.
 */

type Held = { expiresAt: number };

// Pinned to globalThis so Next's hot reload doesn't hand out an empty map on
// every save — the same reason lib/rate-limit.ts pins its store.
const g = globalThis as unknown as { __wondishInFlightLocks?: Map<string, Held> };
const memLocks = (g.__wondishInFlightLocks ??= new Map<string, Held>());

function memAcquire(key: string, ttlSec: number): boolean {
  const now = Date.now();
  const held = memLocks.get(key);
  if (held && held.expiresAt > now) return false;
  memLocks.set(key, { expiresAt: now + ttlSec * 1000 });
  return true;
}

/** What a caller gets back. `release` is safe to call twice and never throws. */
export type InFlightLock = {
  /** False when someone else holds it — refuse, and do NOT call release. */
  acquired: boolean;
  release: () => Promise<void>;
};

const NOOP: InFlightLock = { acquired: true, release: async () => {} };

/**
 * Take a per-user lock named `name`, or report that it is already held.
 *
 * @param name       what is running, e.g. "cookday"
 * @param identifier who is running it, e.g. a Clerk userId
 * @param ttlSec     crash guard: the longest the work can honestly take
 */
export async function acquireInFlight(
  name: string,
  identifier: string,
  ttlSec: number
): Promise<InFlightLock> {
  const key = `lock:${name}:${identifier}`;

  if (!redis) {
    // Dev, or production without Upstash (lib/rate-limit.ts warns about that
    // case loudly; no need to warn twice).
    if (!memAcquire(key, ttlSec)) return { acquired: false, release: async () => {} };
    return {
      acquired: true,
      release: async () => {
        memLocks.delete(key);
      },
    };
  }

  try {
    // NX makes this atomic across instances: exactly one concurrent caller
    // gets "OK", everyone else gets null.
    const ok = await redis.set(key, "1", { nx: true, ex: ttlSec });
    if (ok !== "OK") return { acquired: false, release: async () => {} };
    return {
      acquired: true,
      release: async () => {
        try {
          await redis!.del(key);
        } catch (err) {
          // The TTL still frees it. Losing the release costs the user a wait,
          // never correctness — so this must not turn a SUCCESSFUL run into a
          // failed response.
          console.error(`[in-flight-lock] release failed for "${key}" — TTL will clear it`, err);
        }
      },
    };
  } catch (err) {
    console.error(`[in-flight-lock] backend error for "${name}" — using per-instance fallback`, err);
    if (!memAcquire(key, ttlSec)) return { acquired: false, release: async () => {} };
    return {
      acquired: true,
      release: async () => {
        memLocks.delete(key);
      },
    };
  }
}

/** Test seam: a lock that is always free and releases to nothing. */
export const openLock = (): InFlightLock => NOOP;
