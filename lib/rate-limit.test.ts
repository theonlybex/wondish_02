import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { rateLimit } from "./rate-limit";

// rateLimit() has two paths: Upstash Redis (when UPSTASH_REDIS_REST_URL/TOKEN
// are set) and a deterministic in-memory fallback. We only test the in-memory
// fallback; if the Upstash env vars are present these tests are skipped so we
// never touch a real Redis instance. Note that lib/redis reads the env at
// module load time, so setting/unsetting vars here would not change the path.
const usingRedis = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);
const opts = { skip: usingRedis ? "Upstash env vars set; in-memory fallback not active" : false };

// Each test uses a unique bucket name because the fallback store is
// module-level state shared across the whole test file.

test("allows exactly `limit` requests, then rejects", opts, async () => {
  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    results.push((await rateLimit("t-exact", "user1", 3, 60)).success);
  }
  assert.deepEqual(results, [true, true, true, false, false]);
});

test("limit of 1 rejects the second request", opts, async () => {
  assert.equal((await rateLimit("t-one", "user1", 1, 60)).success, true);
  assert.equal((await rateLimit("t-one", "user1", 1, 60)).success, false);
});

test("identifiers are limited independently", opts, async () => {
  assert.equal((await rateLimit("t-ids", "alice", 1, 60)).success, true);
  assert.equal((await rateLimit("t-ids", "alice", 1, 60)).success, false);
  // bob is untouched by alice's exhaustion
  assert.equal((await rateLimit("t-ids", "bob", 1, 60)).success, true);
});

test("bucket names are limited independently", opts, async () => {
  assert.equal((await rateLimit("t-bucket-a", "carol", 1, 60)).success, true);
  assert.equal((await rateLimit("t-bucket-a", "carol", 1, 60)).success, false);
  // same identifier, different bucket: fresh allowance
  assert.equal((await rateLimit("t-bucket-b", "carol", 1, 60)).success, true);
});

test("window expiry resets the allowance", opts, async () => {
  // 50ms window (windowSec accepts fractions in the fallback path)
  assert.equal((await rateLimit("t-expire", "dave", 1, 0.05)).success, true);
  assert.equal((await rateLimit("t-expire", "dave", 1, 0.05)).success, false);
  await sleep(80);
  assert.equal((await rateLimit("t-expire", "dave", 1, 0.05)).success, true);
});

test("rejected requests do not extend the window (fixed window, not sliding)", opts, async () => {
  // resetAt is set once when the entry is created; rejections must not push it
  // forward. With a 120ms window, rejections at ~40ms and ~80ms would keep the
  // bucket closed past 150ms if the window slid on each call.
  assert.equal((await rateLimit("t-fixed", "frank", 1, 0.12)).success, true);
  await sleep(40);
  assert.equal((await rateLimit("t-fixed", "frank", 1, 0.12)).success, false);
  await sleep(40);
  assert.equal((await rateLimit("t-fixed", "frank", 1, 0.12)).success, false);
  await sleep(70); // ~150ms after the first request; original window has expired
  assert.equal((await rateLimit("t-fixed", "frank", 1, 0.12)).success, true);
});

test("limit of 0 blocks every request", opts, async () => {
  // limit=0 must reject even the first request.
  assert.equal((await rateLimit("t-zero", "erin", 0, 60)).success, false);
});

test("fallback key does not collide across (name, identifier) splits", opts, async () => {
  // ("t-col", "y:z") and ("t-col:y", "z") are different logical buckets and
  // must be limited independently, even though naively joining name and
  // identifier with ':' would make them collide in the in-memory store.
  assert.equal((await rateLimit("t-col", "y:z", 1, 60)).success, true);
  assert.equal((await rateLimit("t-col:y", "z", 1, 60)).success, true);
  // A second request on the same (name, identifier) pair is still limited.
  assert.equal((await rateLimit("t-col", "y:z", 1, 60)).success, false);
  assert.equal((await rateLimit("t-col:y", "z", 1, 60)).success, false);
});
