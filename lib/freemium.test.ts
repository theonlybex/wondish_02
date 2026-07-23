import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_DAILY_FREE,
  CHAT_DAY_RATE_LIMIT_NAME,
  CHAT_DAY_RATE_LIMIT_WINDOW_SEC,
  chatQuotaExceededResponseBody,
} from "./freemium";

test("CHAT_DAILY_FREE is 5 (free-tier Clara messages per day)", () => {
  assert.equal(CHAT_DAILY_FREE, 5);
});

test("chat daily gate uses the 'chat-day' rate-limit bucket, 24h window", () => {
  assert.equal(CHAT_DAY_RATE_LIMIT_NAME, "chat-day");
  assert.equal(CHAT_DAY_RATE_LIMIT_WINDOW_SEC, 86400);
});

test("chatQuotaExceededResponseBody matches the repo's premium-gate convention", () => {
  assert.deepEqual(chatQuotaExceededResponseBody(), { error: "Premium required" });
});
