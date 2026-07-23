// Server-side freemium constants for AI-gated features (Clara chat now; other
// AI surfaces — Picture, Fridge — will add their own constants here later).
// Backs the credit-gate architecture decided in
// docs/superpowers/plans/2026-07-23-clara-ai-access-architecture.md: users
// never hold an API key, so cost is controlled entirely server-side via a
// per-user daily allowance on top of the existing burst rate limit.

/** Free-tier Clara chat messages allowed per rolling day. Premium bypasses this entirely. */
export const CHAT_DAILY_FREE = 5;

/** lib/rate-limit `rateLimit()` bucket name + window (seconds) for the Clara daily chat gate. */
export const CHAT_DAY_RATE_LIMIT_NAME = "chat-day";
export const CHAT_DAY_RATE_LIMIT_WINDOW_SEC = 86400;

/**
 * Response body for the 402 returned when a non-premium user exceeds
 * CHAT_DAILY_FREE. Matches the repo's existing premium-gate convention (see
 * the CUSTOM meal-log path in app/api/meal-log/route.ts).
 */
export function chatQuotaExceededResponseBody(): { error: string } {
  return { error: "Premium required" };
}
