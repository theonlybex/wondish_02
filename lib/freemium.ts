// Server-side freemium constants for AI-gated features (Clara chat now; other
// AI surfaces — Picture, Fridge — will add their own constants here later).
// Backs the credit-gate architecture decided in
// docs/superpowers/plans/2026-07-23-clara-ai-access-architecture.md: users
// never hold an API key, so cost is controlled entirely server-side via a
// per-user daily allowance on top of the existing burst rate limit.

/**
 * Free-tier Clara chat messages allowed per rolling day. Premium bypasses this
 * entirely (unlimited, burst-limited only).
 *
 * 5 → 3 (AMENDMENT 2026-07-31, user-directed): the C0 skill runtime made a
 * message cost up to 3 model calls (2 tool rounds + forced final) with adaptive
 * thinking on, so the free allowance was cut to keep the per-user ceiling near
 * the pre-runtime level instead of tripling it.
 */
export const CHAT_DAILY_FREE = 3;

/** lib/rate-limit `rateLimit()` bucket name + window (seconds) for the Clara daily chat gate. */
export const CHAT_DAY_RATE_LIMIT_NAME = "chat-day";
export const CHAT_DAY_RATE_LIMIT_WINDOW_SEC = 86400;

/**
 * Free-tier Fridge generations allowed per rolling day (F-D2, server-side
 * economic backstop — the ONLY freemium gate per the Cycle-5 execution
 * amendment; client-side UsageMeter/EntitlementStore/PaywallView are void).
 * Set above the client-honest 1/day so legitimate users never hit it, but
 * bounds a tampered client to FRIDGE_DAILY_FREE/day instead of the burst
 * limit's much higher ceiling. Premium bypasses this entirely.
 */
export const FRIDGE_DAILY_FREE = 3;

/** lib/rate-limit `rateLimit()` bucket name + window (seconds) for the Fridge daily gate. */
export const FRIDGE_DAY_RATE_LIMIT_NAME = "fridge-day";
export const FRIDGE_DAY_RATE_LIMIT_WINDOW_SEC = 86400;

/**
 * Response body for the 402 returned when a non-premium user exceeds
 * CHAT_DAILY_FREE. Matches the repo's existing premium-gate convention (see
 * the CUSTOM meal-log path in app/api/meal-log/route.ts).
 */
export function chatQuotaExceededResponseBody(): { error: string } {
  return { error: "Premium required" };
}
