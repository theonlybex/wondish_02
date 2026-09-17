// Local Upstash-compatible backend for lib/rate-limit.ts — a real redis-server
// behind an HTTP shim that speaks the Upstash REST protocol, so the app's
// Redis path (not the per-process memory fallback) runs on a laptop.
//
//   npm run redis:install      # once: builds redis-server into ~/.wondish/redis
//   npm run redis:local        # this file; leave it running
//   npm run rate-limit:check   # proves which backend the app sees
//
// Then in .env.local:
//   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079
//   UPSTASH_REDIS_REST_TOKEN=local-dev-token
//
// Env overrides: UPSTASH_LOCAL_PORT (8079), UPSTASH_LOCAL_TOKEN (local-dev-token),
// UPSTASH_LOCAL_REDIS_PORT (6379), REDIS_SERVER_BIN, WONDISH_REDIS_HOME.
// If a redis-server is already listening on the Redis port it is reused;
// otherwise one is spawned and stopped with this process (Ctrl-C). Data
// snapshots live in ~/.wondish/redis/data, so counters survive restarts;
// `~/.wondish/redis/bin/redis-cli FLUSHALL` clears every counter.
//
// See docs/rate-limiting.md.

import path from "node:path";
import {
  DEFAULT_REDIS_PORT,
  DEFAULT_SHIM_PORT,
  DEFAULT_TOKEN,
  LOCALHOST,
  RedisConnection,
  createShimServer,
  defaultRedisHome,
  ensureRedisServer,
} from "./shim";

const tag = "[upstash-local]";

async function main() {
  const port = Number(process.env.UPSTASH_LOCAL_PORT ?? DEFAULT_SHIM_PORT);
  const token = process.env.UPSTASH_LOCAL_TOKEN ?? DEFAULT_TOKEN;
  const redisPort = Number(process.env.UPSTASH_LOCAL_REDIS_PORT ?? DEFAULT_REDIS_PORT);
  const dataDir = path.join(defaultRedisHome(), "data");
  const quiet = process.env.UPSTASH_LOCAL_QUIET === "1";

  const { child, bin } = await ensureRedisServer({ host: LOCALHOST, port: redisPort, dataDir });
  console.log(
    child
      ? `${tag} started redis-server (${bin}) on ${LOCALHOST}:${redisPort}, data in ${dataDir}`
      : `${tag} reusing the redis-server already listening on ${LOCALHOST}:${redisPort}`
  );

  const redis = new RedisConnection(LOCALHOST, redisPort);
  const logger = {
    log: (line: string) => {
      if (!quiet) console.log(`${tag} ${line}`);
    },
    error: (line: string) => console.error(`${tag} ${line}`),
  };
  const server = createShimServer(redis, token, logger);

  let shuttingDown = false;
  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    redis.close();
    if (child && child.exitCode === null) child.kill("SIGTERM"); // redis saves its RDB on SIGTERM
    setTimeout(() => process.exit(code), 200).unref();
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  child?.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`${tag} redis-server exited (code ${code}) — stopping`);
    shutdown(1);
  });

  server.on("error", (err) => {
    console.error(`${tag} cannot listen on ${LOCALHOST}:${port}: ${err.message}`);
    shutdown(1);
  });
  server.listen(port, LOCALHOST, () => {
    console.log(`${tag} Upstash-compatible REST API on http://${LOCALHOST}:${port}`);
    console.log(`${tag} put these in .env.local (then restart next dev if it does not reload them):`);
    console.log(`  UPSTASH_REDIS_REST_URL=http://${LOCALHOST}:${port}`);
    console.log(`  UPSTASH_REDIS_REST_TOKEN=${token}`);
    console.log(`${tag} verify with: npm run rate-limit:check`);
  });
}

main().catch((err) => {
  console.error(`${tag} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
