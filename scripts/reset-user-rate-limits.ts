// QA ONLY: delete the rate-limit counters (rl:*) of ONE user in the LOCAL
// Redis, so a test fixture whose subscription row was reset between runs
// starts the next run with fresh allowances.
//
//   npm run rate-limit:reset-user -- qa.desktop.20260911@wondish.io
//   npm run rate-limit:reset-user -- user_3JAbi4zBNkxyOW8O9zNE5XTPVSV --dry-run
//
// Why a script and not an endpoint or a subscription hook: counters that
// survive a subscription change are the anti-farming guarantee (subscribe →
// spend 5 weeks → cancel → resubscribe must NOT yield 5 more). Nothing a user
// can reach may reset a quota. See docs/rate-limiting.md.
//
// Safety (scripts/upstash-local/reset-user.ts, unit-tested):
//   - refuses in NODE_ENV=production;
//   - refuses unless the Redis URL lib/redis.ts will actually use (UPSTASH_*
//     or the KV_* pair, same resolution as the app) has a loopback host —
//     127.0.0.0/8, localhost or ::1. An upstash.io host is refused by name;
//   - one user per run, identified by email or Clerk id; there is no --all
//     and it never calls FLUSHALL/FLUSHDB;
//   - deletes only keys of the exact shape rl:<bucket>:<thisClerkId>:<window>
//     (the org-wide rl:ai-global-day:ALL:* bucket cannot match).
// The account lookup is a read-only Prisma query.

import path from "node:path";
import { parseResetArgs, refuseUnlessLocal, userRateLimitKeys } from "./upstash-local/reset-user";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), file));
    } catch {
      // absent — fine
    }
  }
}

async function main() {
  const parsed = parseResetArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(2);
  }
  const { who, dryRun } = parsed.args;

  loadEnv();
  // Imported after loadEnv(): lib/redis.ts decides the backend at import time.
  const { redis, redisCredentials } = await import("../lib/redis");
  const refusal = refuseUnlessLocal(process.env, redisCredentials()?.url ?? null);
  if (refusal || !redis) {
    console.error(refusal ?? "Redis client unavailable.");
    process.exit(1);
  }
  const host = new URL(redisCredentials()!.url).host;

  const { prisma } = await import("../lib/db");
  const account = who.includes("@")
    ? await prisma.account.findFirst({ where: { email: who }, select: { email: true, clerkId: true } })
    : await prisma.account.findFirst({ where: { clerkId: who }, select: { email: true, clerkId: true } });
  await prisma.$disconnect();
  if (!account?.clerkId) {
    console.error(`No account with a Clerk id for "${who}".`);
    process.exit(1);
  }
  const clerkId = account.clerkId;

  // KEYS is fine here: this is a local dev Redis with a few dozen keys. The
  // pattern narrows the scan; userRateLimitKeys() is the real filter.
  const candidates = await redis.keys(`rl:*:${clerkId}:*`);
  const keys = userRateLimitKeys(candidates, clerkId);

  console.log(`redis: ${host} (loopback ok)`);
  console.log(`user:  ${account.email} (${clerkId})`);
  if (keys.length === 0) {
    console.log("no rl:* counters for this user — nothing to do.");
    return;
  }
  for (const k of keys) console.log(`  ${dryRun ? "would delete" : "delete"} ${k}`);
  if (dryRun) {
    console.log(`DRY RUN — ${keys.length} key(s) left untouched.`);
    return;
  }
  const deleted = await redis.del(...keys);
  console.log(`deleted ${deleted} key(s). The user's next request starts every bucket from zero.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
