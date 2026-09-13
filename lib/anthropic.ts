import Anthropic from "@anthropic-ai/sdk";

// The ONE place the SDK's network policy is set. The SDK defaults are a
// 10-minute timeout and 2 retries, which outlive every Vercel function here
// (30-60s): on a 529 burst the SDK was still retrying when the platform
// killed the function, and the client got a bare 504 with no JSON body —
// after guardAiSpend had already charged the user's quota.
//
// 25s x (1 + 1 retry) fits under maxDuration = 60 with room for the DB work
// around the call. Streaming chat passes a longer timeout because the
// timeout covers the whole response, not just time-to-first-byte.
export const ANTHROPIC_TIMEOUT_MS = 25_000;
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
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return 429;
    if (err.status === 529) return 503;
  }
  return null;
}

export const CLARA_BUSY_MESSAGE = "Clara is busy — try again in a moment.";
