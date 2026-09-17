import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HARD_FAIL_OPT_IN,
  MEMORY_FALLBACK_OPT_OUT,
  assertRateLimitBackend,
  memoryFallbackViolation,
  probeRateLimitBackend,
  rateLimitBackend,
  shouldFailBoot,
} from "./rate-limit-backend";

const upstash = { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok" };

test("backend is upstash only when both vars are set and non-empty", () => {
  assert.equal(rateLimitBackend(upstash), "upstash");
  assert.equal(rateLimitBackend({}), "memory");
  assert.equal(rateLimitBackend({ UPSTASH_REDIS_REST_URL: upstash.UPSTASH_REDIS_REST_URL }), "memory");
  assert.equal(rateLimitBackend({ UPSTASH_REDIS_REST_TOKEN: "tok" }), "memory");
  assert.equal(rateLimitBackend({ ...upstash, UPSTASH_REDIS_REST_TOKEN: "" }), "memory");
});

test("dev and test processes may run on the memory fallback", () => {
  assert.equal(memoryFallbackViolation({}), null);
  assert.equal(memoryFallbackViolation({ NODE_ENV: "development" }), null);
  assert.equal(memoryFallbackViolation({ NODE_ENV: "test" }), null);
  assert.doesNotThrow(() => assertRateLimitBackend({ NODE_ENV: "development" }));
});

test("a production process without Upstash is flagged, naming both vars and the spend caps", () => {
  const violation = memoryFallbackViolation({ NODE_ENV: "production" });
  assert.ok(violation);
  assert.match(violation, /UPSTASH_REDIS_REST_URL/);
  assert.match(violation, /UPSTASH_REDIS_REST_TOKEN/);
  assert.match(violation, /ai-\*/);
  assert.match(violation, new RegExp(MEMORY_FALLBACK_OPT_OUT));
  assert.throws(() => assertRateLimitBackend({ NODE_ENV: "production" }), /not set in a production process/);
});

test("production boots with Upstash configured, or with the explicit opt-out", () => {
  assert.equal(memoryFallbackViolation({ NODE_ENV: "production", ...upstash }), null);
  assert.equal(memoryFallbackViolation({ NODE_ENV: "production", [MEMORY_FALLBACK_OPT_OUT]: "1" }), null);
  // Only the literal "1" opts out — "true"/"yes" must not silently pass.
  assert.ok(memoryFallbackViolation({ NODE_ENV: "production", [MEMORY_FALLBACK_OPT_OUT]: "true" }));
  // Half a configuration is no configuration.
  assert.ok(memoryFallbackViolation({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: upstash.UPSTASH_REDIS_REST_URL }));
});

// ── The boot is reported, not fatal, unless a deployment opts in ─────────────
// Downgraded 2026-09-17: failing the boot bounds the Anthropic bill perfectly
// but turns one unset variable into an outage, and Vercel Preview runs
// NODE_ENV=production too. These tests pin the DEFAULT, so re-promoting the
// hard failure has to be a deliberate edit rather than a drifting side effect.

test("a production violation does NOT fail the boot by default", () => {
  // The violation is still detected — instrumentation.ts logs it and sends
  // Sentry a fatal — it just doesn't stop the process from serving traffic.
  assert.ok(memoryFallbackViolation({ NODE_ENV: "production" }));
  assert.equal(shouldFailBoot({ NODE_ENV: "production" }), false);
});

test("RATE_LIMIT_ENFORCE_BACKEND=1 opts a deployment back into failing the boot", () => {
  assert.equal(shouldFailBoot({ NODE_ENV: "production", [HARD_FAIL_OPT_IN]: "1" }), true);
  // Only the literal "1", same as the opt-out — a stray "true" must not arm it.
  assert.equal(shouldFailBoot({ NODE_ENV: "production", [HARD_FAIL_OPT_IN]: "true" }), false);
});

test("no violation means no boot failure, even when enforcement is armed", () => {
  assert.equal(shouldFailBoot({ NODE_ENV: "production", ...upstash, [HARD_FAIL_OPT_IN]: "1" }), false);
  assert.equal(shouldFailBoot({ NODE_ENV: "development", [HARD_FAIL_OPT_IN]: "1" }), false);
  // The memory-fallback opt-out still wins: nothing to enforce if it's allowed.
  assert.equal(
    shouldFailBoot({ NODE_ENV: "production", [MEMORY_FALLBACK_OPT_OUT]: "1", [HARD_FAIL_OPT_IN]: "1" }),
    false
  );
});

const envSet = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

test("probe on the memory fallback: reachable (nothing to reach) but not shared", { skip: envSet ? "Upstash env vars set" : false }, async () => {
  const probe = await probeRateLimitBackend();
  assert.equal(probe.backend, "memory");
  assert.equal(probe.reachable, true);
  assert.equal(probe.shared, false);
  assert.equal(probe.error, undefined);
});
