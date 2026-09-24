import Anthropic from "@anthropic-ai/sdk";

// The ONE place the SDK's network policy is set. The SDK defaults are a
// 10-minute timeout and 2 retries, which outlive every Vercel function here
// (30-60s): on a 529 burst the SDK was still retrying when the platform
// killed the function, and the client got a bare 504 with no JSON body —
// after guardAiSpend had already charged the user's quota.
//
// Raised 2026-09-24 from 25s, together with maxDuration 60 → 300 on the AI
// routes. The old value was sized to "fit under maxDuration = 60", and that
// ceiling then reached back into the product: generating 8 complete recipes
// constrained to a basket does not finish in 25s, so the breakfast top-up
// timed out, its slot pool stayed empty, and one dish filled all seven
// breakfasts. The platform cap was the cause and the recipe quality was the
// symptom.
//
// 90s x (1 + 1 retry) = 180s worst case, inside maxDuration = 300 with room
// for the DB work around the call. Routes with tighter budgets still pass
// their own override — streaming chat (55s) and clara-swap (20s) — because
// there the timeout covers the whole response, not time-to-first-byte.
export const ANTHROPIC_TIMEOUT_MS = 90_000;
export const ANTHROPIC_MAX_RETRIES = 1;

export function createAnthropic(overrides: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: overrides.timeout ?? ANTHROPIC_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? ANTHROPIC_MAX_RETRIES,
  });
}

/**
 * The HTTP status a route should answer with when Anthropic is the reason
 * the request failed in a retryable way: 429 for our own rate limit, 503 for
 * overload (529) and for a timeout. null means "not a busy signal — treat as
 * a real error".
 */
export function claraBusyStatus(err: unknown): 429 | 503 | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 503;
  // Generic connection failures (ECONNRESET, DNS, TLS) are just as retryable
  // as a timeout. The timeout check stays first: APIConnectionTimeoutError
  // extends APIConnectionError, so the order is what keeps them distinct.
  if (err instanceof Anthropic.APIConnectionError) return 503;
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return 429;
    if (err.status === 529) return 503;
  }
  return null;
}

export const CLARA_BUSY_MESSAGE = "Clara is busy — try again in a moment.";
