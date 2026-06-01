import { Redis } from "@upstash/redis";

// Shared Upstash Redis client. Null when the env vars are absent (local dev),
// so callers must treat Redis-backed features (rate limiting, webhook
// idempotency) as best-effort and degrade gracefully when it's unavailable.
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;
