import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { LOCALHOST, RedisConnection, createShimServer, ensureRedisServer, findRedisServerBinary, freePort } from "./shim";

// Integration: a real redis-server (spawned on a random port from the local
// build, see install-redis.sh) behind the shim, driven by the real
// @upstash/redis + @upstash/ratelimit and finally by lib/rate-limit.ts itself.
// Skipped, not failed, on a machine without the binary.
const BIN = findRedisServerBinary();
const opts = { skip: BIN ? false : "no redis-server binary — run `npm run redis:install`" };

type Fixture = { url: string; token: string; keys: (pattern: string) => Promise<string[]> };
let fixture: Fixture | null = null;
let stop: () => void = () => {};

async function start(): Promise<Fixture> {
  if (fixture) return fixture;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "upstash-local-test-"));
  const redisPort = await freePort();
  const { child } = await ensureRedisServer({ host: LOCALHOST, port: redisPort, dataDir, stdio: "ignore" });
  const conn = new RedisConnection(LOCALHOST, redisPort);
  const token = "test-token";
  const server = createShimServer(conn, token);
  await new Promise<void>((resolve) => server.listen(0, LOCALHOST, resolve));
  const { port } = server.address() as AddressInfo;
  stop = () => {
    server.closeAllConnections();
    server.close();
    conn.close();
    child?.kill("SIGKILL"); // no snapshot wanted; the dir is deleted next
    rmSync(dataDir, { recursive: true, force: true });
  };
  fixture = {
    url: `http://${LOCALHOST}:${port}`,
    token,
    keys: async (pattern) => ((await conn.send(["KEYS", pattern])) as Buffer[]).map((k) => k.toString("utf8")),
  };
  return fixture;
}
after(() => stop());

async function raw(fx: Fixture, pathname: string, body: unknown, init: { token?: string; base64?: boolean } = {}) {
  const res = await fetch(fx.url + pathname, {
    method: "POST",
    headers: {
      authorization: `Bearer ${init.token ?? fx.token}`,
      "content-type": "application/json",
      ...(init.base64 ? { "upstash-encoding": "base64" } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("a wrong or missing token is refused with 401", opts, async () => {
  const fx = await start();
  assert.equal((await raw(fx, "/", ["PING"], { token: "nope" })).status, 401);
  const res = await fetch(fx.url, { method: "POST", body: '["PING"]' });
  assert.equal(res.status, 401);
});

test("single command: OK stays raw, strings are base64 only when asked, numbers untouched, errors are 400", opts, async () => {
  const fx = await start();
  assert.deepEqual(await raw(fx, "/", ["SET", "shim:k", "hello"], { base64: true }), { status: 200, body: { result: "OK" } });
  assert.deepEqual(await raw(fx, "/", ["GET", "shim:k"], { base64: true }), { status: 200, body: { result: "aGVsbG8=" } });
  assert.deepEqual(await raw(fx, "/", ["GET", "shim:k"]), { status: 200, body: { result: "hello" } });
  assert.deepEqual(await raw(fx, "/", ["INCR", "shim:n"], { base64: true }), { status: 200, body: { result: 1 } });
  assert.deepEqual(await raw(fx, "/", ["GET", "shim:missing"]), { status: 200, body: { result: null } });
  const bad = await raw(fx, "/", ["NOSUCHCMD"]);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /ERR unknown command/);
  assert.equal((await raw(fx, "/", "PING")).status, 400);
  assert.equal((await raw(fx, "/nope", ["PING"])).status, 404);
});

test("pipeline and multi-exec return one envelope per command", opts, async () => {
  const fx = await start();
  const cmds = [["SET", "shim:p", "1"], ["INCR", "shim:p"], ["GET", "shim:p"], ["NOSUCHCMD"]];
  const pipe = await raw(fx, "/pipeline", cmds);
  assert.equal(pipe.status, 200);
  assert.deepEqual(pipe.body.slice(0, 3), [{ result: "OK" }, { result: 2 }, { result: "2" }]);
  assert.match(pipe.body[3].error, /ERR unknown command/);

  const tx = await raw(fx, "/multi-exec", [["SET", "shim:t", "1"], ["INCR", "shim:t"], ["GET", "shim:t"]], { base64: true });
  assert.deepEqual(tx, { status: 200, body: [{ result: "OK" }, { result: 2 }, { result: Buffer.from("2").toString("base64") }] });
  // An unknown command inside MULTI aborts the whole transaction.
  const aborted = await raw(fx, "/multi-exec", [["SET", "shim:t2", "1"], ["NOSUCHCMD"]]);
  assert.equal(aborted.status, 400);
  assert.match(aborted.body.error, /EXECABORT/);
});

test("the real @upstash/redis client round-trips, including the webhook's SET NX EX idempotency form", opts, async () => {
  const fx = await start();
  const redis = new Redis({ url: fx.url, token: fx.token });
  assert.equal(await redis.set("shim:client", { nested: [1, "two"] }), "OK");
  assert.deepEqual(await redis.get("shim:client"), { nested: [1, "two"] });
  assert.equal(await redis.incr("shim:client:n"), 1);
  assert.equal(await redis.set("shim:idem", "1", { nx: true, ex: 60 }), "OK");
  assert.equal(await redis.set("shim:idem", "1", { nx: true, ex: 60 }), null);
  assert.equal(await redis.del("shim:client", "shim:client:n", "shim:idem"), 3);
  assert.equal(await redis.ping(), "PONG");
});

test("@upstash/ratelimit sliding window on a fresh server: NOSCRIPT → EVAL fallback, limit 1 refuses the second call", opts, async () => {
  const fx = await start();
  const redis = new Redis({ url: fx.url, token: fx.token });
  const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1, "60 s"), prefix: "rl:shim-test", analytics: false });
  assert.equal((await limiter.limit("u1")).success, true);
  assert.equal((await limiter.limit("u1")).success, false);
  assert.equal((await limiter.limit("u2")).success, true);
  assert.ok((await fx.keys("rl:shim-test:u1:*")).length >= 1, "the counter lives in Redis");
});

test("lib/rate-limit.ts itself takes the Upstash path when the env points at the shim", opts, async () => {
  const fx = await start();
  // lib/redis.ts reads the env at import time, so set it first and import late.
  process.env.UPSTASH_REDIS_REST_URL = fx.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = fx.token;
  const { rateLimit } = await import("../../lib/rate-limit");
  const { rateLimitBackend, probeRateLimitBackend } = await import("../../lib/rate-limit-backend");
  assert.equal(rateLimitBackend(), "upstash");

  const probe = await probeRateLimitBackend();
  assert.equal(probe.reachable, true, probe.error);
  assert.equal(probe.shared, true);

  // The free tier's headline limit: 1 new week per rolling week.
  const user = `user-${Date.now()}`;
  assert.equal((await rateLimit("ai-plangen-free", user, 1, 7 * 86_400)).success, true);
  assert.equal((await rateLimit("ai-plangen-free", user, 1, 7 * 86_400)).success, false);
  const keys = await fx.keys(`rl:ai-plangen-free:${user}:*`);
  assert.ok(keys.length >= 1, "the refusal came from a counter in Redis, not the memory Map");
});
