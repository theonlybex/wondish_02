import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackRedisUrl, parseResetArgs, refuseUnlessLocal, userRateLimitKeys } from "./reset-user";

// The guard is the whole point of the script: it must be impossible to aim
// it at a production Upstash database, and impossible to widen it to more
// than one user. These tests pin both.

test("isLoopbackRedisUrl: only the local machine counts", () => {
  for (const ok of ["http://127.0.0.1:8079", "http://localhost:8079", "https://localhost", "http://127.5.6.7", "http://[::1]:8079"]) {
    assert.equal(isLoopbackRedisUrl(ok), true, ok);
  }
  for (const no of [
    "https://usw1-fine-mongoose-12345.upstash.io",
    "https://127.0.0.1.evil.example",
    "http://192.168.1.20:8079",
    "http://10.0.0.5",
    "http://0.0.0.0:8079",
    "http://localhost.example.com",
    "redis://127.0.0.1:6379",
    "127.0.0.1:8079",
    "",
    undefined,
    null,
  ]) {
    assert.equal(isLoopbackRedisUrl(no), false, String(no));
  }
});

test("refuseUnlessLocal: production, no Redis, and any non-loopback host are all refused", () => {
  assert.equal(refuseUnlessLocal({ NODE_ENV: "development" }, "http://127.0.0.1:8079"), null);
  assert.equal(refuseUnlessLocal({}, "http://localhost:8079"), null);
  assert.match(refuseUnlessLocal({ NODE_ENV: "production" }, "http://127.0.0.1:8079")!, /production/);
  assert.match(refuseUnlessLocal({}, null)!, /memory fallback/);
  const prod = refuseUnlessLocal({}, "https://usw1-fine-mongoose-12345.upstash.io");
  assert.match(prod!, /Refusing/);
  assert.match(prod!, /usw1-fine-mongoose-12345\.upstash\.io/);
  assert.match(prod!, /unlimited Anthropic spend/);
});

test("parseResetArgs: exactly one user, by email or Clerk id; --dry-run is the only flag; no --all", () => {
  assert.deepEqual(parseResetArgs(["qa@wondish.io"]), { ok: true, args: { who: "qa@wondish.io", dryRun: false } });
  assert.deepEqual(parseResetArgs(["user_3JAbi4zBNkxyOW8O9zNE5XTPVSV", "--dry-run"]), {
    ok: true,
    args: { who: "user_3JAbi4zBNkxyOW8O9zNE5XTPVSV", dryRun: true },
  });
  for (const bad of [[], ["a@b.io", "c@d.io"], ["ALL"], ["*"], ["rl:*"], ["user_"], ["not-an-email"], ["a@b.io", "--all"], ["--all"]]) {
    const r = parseResetArgs(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  const all = parseResetArgs(["a@b.io", "--all"]);
  assert.ok(!all.ok && /no --all/.test(all.error));
});

test("userRateLimitKeys: only rl:<bucket>:<thisUser>:<window>, never ALL, never a prefix/substring neighbour", () => {
  const me = "user_3JApFYDzudQsmnkdC0X5d30fVR5";
  const keys = [
    `rl:ai-plangen-premium:${me}:2959`,
    `rl:ai-plangen-beta:${me}:2959`,
    `rl:coupon-redeem:${me}:497134`,
    "rl:ai-global-day:ALL:20713",
    "rl:ai-plangen-free:user_3JC5wncFxpEzh4vOMhf9bOmWlnD:2959",
    `rl:ai-chat-free:${me}X:2959`, // a longer id that starts with mine
    `rl:ai-chat-free:x${me}:2959`,
    `${me}:2959`, // not an rl key
    `rl:${me}:2959`, // wrong shape
    `probe:rate-limit-backend:${me}:1`,
  ];
  assert.deepEqual(userRateLimitKeys(keys, me), [
    `rl:ai-plangen-premium:${me}:2959`,
    `rl:ai-plangen-beta:${me}:2959`,
    `rl:coupon-redeem:${me}:497134`,
  ]);
  assert.deepEqual(userRateLimitKeys(keys, "ALL"), []);
  assert.deepEqual(userRateLimitKeys(keys, "*"), []);
  assert.deepEqual(userRateLimitKeys(keys, ""), []);
});
