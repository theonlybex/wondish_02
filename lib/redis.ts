import { Redis } from "@upstash/redis";

// Shared Upstash Redis client. Null when no credentials are configured (local
// dev without the shim), so callers must treat Redis-backed features (rate
// limiting, webhook idempotency) as best-effort and degrade gracefully when
// it's unavailable.
//
// TWO namings are accepted, on purpose. Upstash's own convention — and what
// Redis.fromEnv() reads — is UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
// But the Vercel Marketplace integration provisions the SAME credentials under
// KV_REST_API_URL / KV_REST_API_TOKEN, the names the retired Vercel KV product
// used (verified on this project 2026-09-17: connecting upstash-kv wrote only
// the KV_* pair, so Redis.fromEnv() alone would have found nothing and every
// limit would have silently run on the memory fallback).
//
// Reading both keeps the integration as the single source of truth. The
// alternative — hand-copying the values into UPSTASH_* variables — breaks the
// moment Upstash rotates the credential, and stale-but-present is the worst
// possible state: rateLimit() would believe Redis is available and stop
// falling back, so every limit call would fail instead of degrading.
//
// UPSTASH_* wins when both are set, so .env.local can point at the local shim
// (scripts/upstash-local) while the deployed app uses the integration's vars.

export interface RedisCredentials {
  url: string;
  token: string;
}

type Env = Record<string, string | undefined>;

/** The configured credentials under either naming, or null when unset. */
export function redisCredentials(env: Env = process.env): RedisCredentials | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

const credentials = redisCredentials();
export const redis = credentials ? new Redis(credentials) : null;
