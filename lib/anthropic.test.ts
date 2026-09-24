import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";

process.env.ANTHROPIC_API_KEY ??= "test-key";

import { createAnthropic, claraBusyStatus, ANTHROPIC_TIMEOUT_MS, ANTHROPIC_MAX_RETRIES } from "./anthropic";

// The AI routes declare `export const maxDuration = 300` (Next requires a
// literal, so it cannot be imported and shared). This mirrors it: the whole
// point of the factory is that a retried call finishes BEFORE the platform
// kills the function, or the user is charged for a 504 with no JSON body.
const AI_ROUTE_MAX_DURATION_MS = 300_000;

test("a fully retried call finishes inside the route's maxDuration, with room for DB work", () => {
  const client = createAnthropic();
  assert.equal(client.timeout, ANTHROPIC_TIMEOUT_MS);
  assert.equal(client.maxRetries, ANTHROPIC_MAX_RETRIES);

  // The invariant, not the number: worst case is the timeout once per attempt.
  const worstCase = ANTHROPIC_TIMEOUT_MS * (1 + ANTHROPIC_MAX_RETRIES);
  assert.ok(
    worstCase <= AI_ROUTE_MAX_DURATION_MS * 0.8,
    `worst case ${worstCase}ms must leave headroom inside ${AI_ROUTE_MAX_DURATION_MS}ms for the DB work around the call`
  );

  // Raised from 25s on 2026-09-24. The old value was chosen to fit a 60s
  // maxDuration, and that ceiling reached back into product quality:
  // generating 8 basket-constrained recipes does not finish in 25s, so the
  // breakfast top-up timed out and one dish filled all seven breakfasts.
  assert.equal(ANTHROPIC_TIMEOUT_MS, 90_000);
  assert.equal(ANTHROPIC_MAX_RETRIES, 1);
});

test("factory accepts per-route overrides (streaming chat needs a longer window)", () => {
  const client = createAnthropic({ timeout: 55_000 });
  assert.equal(client.timeout, 55_000);
  assert.equal(client.maxRetries, ANTHROPIC_MAX_RETRIES);
});

test("an override of 0 retries survives: the default must be applied with ?? and not ||", () => {
  // Streaming chat pins maxRetries to 0 so a 55s timeout can't be retried past
  // the 60s maxDuration. `overrides.maxRetries || ANTHROPIC_MAX_RETRIES` would
  // silently turn that 0 back into 1 and re-open the bug.
  const client = createAnthropic({ maxRetries: 0 });
  assert.equal(client.maxRetries, 0);
});

test("claraBusyStatus maps rate limit, overload and timeout to a retryable status", () => {
  const rateLimited = new Anthropic.APIError(429, undefined, "rate", undefined);
  const overloaded = new Anthropic.APIError(529, undefined, "overloaded", undefined);
  const timeout = new Anthropic.APIConnectionTimeoutError({ message: "timed out" });
  assert.equal(claraBusyStatus(rateLimited), 429);
  assert.equal(claraBusyStatus(overloaded), 503);
  assert.equal(claraBusyStatus(timeout), 503);
  // A dropped connection is as retryable as a timeout; before this it fell
  // through to null and the route answered 502 for a transient blip.
  assert.equal(claraBusyStatus(new Anthropic.APIConnectionError({ message: "ECONNRESET" })), 503);
  assert.equal(claraBusyStatus(new Error("other")), null);
  assert.equal(claraBusyStatus(new Anthropic.APIError(400, undefined, "bad", undefined)), null);
});
