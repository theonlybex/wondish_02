import { test } from "node:test";
import assert from "node:assert/strict";
import { RESUME_WINDOW_MS, pickResumeId, retryableKey } from "./chat-client";

const now = Date.parse("2026-10-28T20:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const HOUR = 60 * 60 * 1000;

test("pickResumeId: the newest chat updated inside 12 hours is resumed", () => {
  assert.equal(RESUME_WINDOW_MS, 12 * HOUR);
  assert.equal(pickResumeId([{ id: "a", updatedAt: ago(11 * HOUR) }, { id: "b", updatedAt: ago(1) }], now), "a");
});

test("pickResumeId: only the first item counts (server order, newest first)", () => {
  assert.equal(pickResumeId([{ id: "a", updatedAt: ago(13 * HOUR) }, { id: "b", updatedAt: ago(1) }], now), null);
});

test("pickResumeId: exactly 12 hours old is not resumed; empty or bad dates start a new chat", () => {
  assert.equal(pickResumeId([{ id: "a", updatedAt: ago(12 * HOUR) }], now), null);
  assert.equal(pickResumeId([], now), null);
  assert.equal(pickResumeId([{ id: "a", updatedAt: "not a date" }], now), null);
});

test("retryableKey: only the latest message can offer Try again", () => {
  assert.equal(retryableKey([{ key: "u1" }, { key: "a1", retryText: "hi" }]), "a1");
  // A later successful turn retires the old failed bubble's retry.
  assert.equal(
    retryableKey([{ key: "u1" }, { key: "a1", retryText: "hi" }, { key: "u2" }, { key: "a2" }]),
    null
  );
  assert.equal(retryableKey([]), null);
});
