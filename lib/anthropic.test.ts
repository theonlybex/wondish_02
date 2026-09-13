import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";

process.env.ANTHROPIC_API_KEY ??= "test-key";

import { createAnthropic, claraBusyStatus, ANTHROPIC_TIMEOUT_MS, ANTHROPIC_MAX_RETRIES } from "./anthropic";

test("factory pins a timeout and retry count that fit inside a 60s Vercel function", () => {
  const client = createAnthropic();
  assert.equal(client.timeout, ANTHROPIC_TIMEOUT_MS);
  assert.equal(client.maxRetries, ANTHROPIC_MAX_RETRIES);
  assert.equal(ANTHROPIC_TIMEOUT_MS, 25_000);
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
