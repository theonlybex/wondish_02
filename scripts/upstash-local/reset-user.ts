// Pure helpers behind scripts/reset-user-rate-limits.ts — the QA-only "wipe
// ONE user's rl:* counters" tool. Kept free of I/O so the safety rules are
// unit-tested (reset-user.test.ts) rather than trusted.
//
// Why this exists: rate-limit buckets are keyed by tier + window and
// deliberately outlive subscription changes (docs/rate-limiting.md, "Counters
// outlive subscription changes"). That is correct for users and wrong for QA
// fixtures, whose rows get reset between runs while Redis still remembers
// last run's generations. Nothing in the app may reset a quota — a user who
// could would farm it (subscribe → spend → cancel → resubscribe) — so the
// reset lives in a script that refuses to talk to anything but a loopback
// Redis.

export interface ResetArgs {
  /** An email address or a Clerk user id (`user_…`). */
  who: string;
  dryRun: boolean;
}

export function parseResetArgs(argv: string[]): { ok: true; args: ResetArgs } | { ok: false; error: string } {
  const flags = argv.filter((a) => a.startsWith("--"));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--dry-run");
  if (unknown.length) return { ok: false, error: `unknown flag ${unknown.join(", ")} (only --dry-run is accepted — there is no --all, on purpose)` };
  if (positional.length !== 1) {
    return { ok: false, error: "usage: npm run rate-limit:reset-user -- <email | user_…> [--dry-run]" };
  }
  const who = positional[0].trim();
  if (!isEmail(who) && !isClerkUserId(who)) {
    return { ok: false, error: `"${who}" is neither an email nor a Clerk user id (user_…)` };
  }
  return { ok: true, args: { who, dryRun: flags.includes("--dry-run") } };
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isClerkUserId(s: string): boolean {
  return /^user_[A-Za-z0-9]+$/.test(s);
}

/**
 * True only for a URL whose host is the local machine: 127.0.0.0/8,
 * localhost, or ::1. An Upstash URL (`https://<db>.upstash.io`), a LAN
 * address, a tunnel hostname — anything else — is false. Malformed → false.
 */
export function isLoopbackRedisUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

type Env = Record<string, string | undefined>;

/**
 * The reason this process must NOT run, or null when it may. Judged on the
 * SAME credentials lib/redis.ts will use (either naming, UPSTASH_* first), so
 * the check cannot be satisfied by one variable while the client reads another.
 */
export function refuseUnlessLocal(env: Env, effectiveUrl: string | null): string | null {
  if (env.NODE_ENV === "production") {
    return "NODE_ENV=production — this script never runs in a production process.";
  }
  if (!effectiveUrl) {
    return "No Redis credentials configured (memory fallback) — nothing to reset; restart the dev server instead.";
  }
  if (!isLoopbackRedisUrl(effectiveUrl)) {
    let host = effectiveUrl;
    try {
      host = new URL(effectiveUrl).host;
    } catch {
      /* keep the raw value */
    }
    return (
      `Refusing: the configured Redis is "${host}", not a loopback address. ` +
      "This tool only ever clears counters on a local redis-server behind scripts/upstash-local; " +
      "pointed at production it would hand a user unlimited Anthropic spend."
    );
  }
  return null;
}

/**
 * Of `keys`, exactly the rate-limit counters that belong to `clerkId`.
 * Key shape is `rl:<bucket>:<identifier>:<window>` (@upstash/ratelimit with
 * prefix `rl:<bucket>`; bucket names never contain ":"). The identifier
 * segment must EQUAL the id — a prefix or substring match could catch
 * another user, and `ALL` (the org-wide ai-global-day bucket) is never a
 * Clerk id, so it can never be selected.
 */
export function userRateLimitKeys(keys: string[], clerkId: string): string[] {
  if (!isClerkUserId(clerkId)) return [];
  return keys.filter((k) => {
    const parts = k.split(":");
    return parts.length === 4 && parts[0] === "rl" && parts[2] === clerkId;
  });
}
