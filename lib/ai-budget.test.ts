import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LIMITS, GLOBAL_AI_DAILY_MAX, guardAiSpend, limitFor, quotaExceededBody, tierFor } from "./ai-budget";

// In-memory limiter: counts per (bucket, identifier); no time passes.
function fakeLimiter() {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const limiter = async (name: string, id: string, limit: number, _windowSec: number) => {
    const key = `${name}|${id}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    calls.push(`${key}:${limit}`);
    return { success: n <= limit };
  };
  return { limiter, calls };
}

test("tiers: free 1 new week/week + 5 Clara messages/day; premium 3/week + 20/day", () => {
  assert.deepEqual(limitFor("planGen", "free"), { max: 1, windowSec: 7 * 86_400, window: "week" });
  assert.deepEqual(limitFor("planGen", "premium"), { max: 3, windowSec: 7 * 86_400, window: "week" });
  assert.equal(limitFor("claraChat", "free").max, 5);
  assert.equal(limitFor("claraChat", "premium").max, 20);
  assert.equal(limitFor("claraChat", "free").window, "day");
  for (const k of Object.keys(AI_LIMITS)) assert.ok(AI_LIMITS[k].premium >= AI_LIMITS[k].free, k);
});

test("tierFor: active premium from any source, or admin, is premium; else free", () => {
  assert.equal(tierFor([{ plan: "PREMIUM", status: "ACTIVE" }]), "premium");
  assert.equal(tierFor([{ plan: "FREE", status: "ACTIVE" }]), "free");
  assert.equal(tierFor([{ plan: "PREMIUM", status: "CANCELED" }]), "free");
  assert.equal(tierFor([], true), "premium");
  assert.equal(tierFor([]), "free");
});

test("free user: 6th Clara message today is refused with an upgrade hint; the global bucket is untouched", async () => {
  const { limiter, calls } = fakeLimiter();
  for (let i = 0; i < 5; i++) assert.equal((await guardAiSpend("u1", "claraChat", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "claraChat", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    assert.match(r.error, /5 free Clara messages for today/);
    assert.match(r.error, /Premium gives you 20 a day/);
    assert.equal((r.body as { upgrade?: boolean }).upgrade, true);
  }
  assert.equal(calls.filter((c) => c.startsWith("ai-global-day")).length, 5);
});

test("free user: second new week in the same week is refused; premium gets three", async () => {
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("u1", "planGen", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "planGen", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /1 free new weeks for this week/);
  for (let i = 0; i < 3; i++) assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, true);
  assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, false);
});

test("premium at its cap gets a plain reset message, no upgrade hint", () => {
  const b = quotaExceededBody("claraChat", "premium");
  assert.equal(b.upgrade, false);
  assert.match(b.error, /today's limit for Clara messages \(20\)/);
});

test("global ceiling stops everyone once the org-wide daily count is spent", async () => {
  const { limiter } = fakeLimiter();
  // Exhaust the global bucket directly, then a fresh premium user is refused.
  for (let i = 0; i < GLOBAL_AI_DAILY_MAX; i++) await limiter("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, 86_400);
  const r = await guardAiSpend("fresh", "swap", "premium", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /at capacity/);
});
