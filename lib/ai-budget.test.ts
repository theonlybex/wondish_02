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

test("tiers: free 1 new week/week + 5 Clara messages/day; premium 5/week + 25/day", () => {
  assert.deepEqual(limitFor("planGen", "free"), { max: 1, windowSec: 7 * 86_400, window: "week" });
  assert.deepEqual(limitFor("planGen", "premium"), { max: 5, windowSec: 7 * 86_400, window: "week" });
  assert.equal(limitFor("claraChat", "free").max, 5);
  assert.equal(limitFor("claraChat", "premium").max, 25);
  assert.equal(limitFor("claraChat", "free").window, "day");
  assert.equal(limitFor("swap", "premium").max, 5);
  assert.equal(limitFor("fridge", "premium").max, 6);
  assert.equal(limitFor("cookDay", "premium").max, 3);
  assert.equal(limitFor("planInit", "premium").max, 3);
  for (const k of Object.keys(AI_LIMITS)) assert.ok(AI_LIMITS[k].premium >= AI_LIMITS[k].free, k);
});

// Measured Haiku cost per request (2026-09-12), duplicated here on purpose: the
// budget promise is a property of the TABLE, and a test that imported the costs
// from the same place that sets the limits could not catch a bad edit.
const COST_USD: Record<string, number> = {
  claraChat: 0.012,
  fridge: 0.02,
  cookDay: 0.05,
  planInit: 0.08,
  planGen: 0.08,
  swap: 0.02,
};
const DAYS_PER_MONTH = 365 / 12;

function worstCaseUsdPerDay(tier: "free" | "beta" | "premium"): number {
  return Object.keys(AI_LIMITS).reduce((sum, k) => {
    const { max, window } = limitFor(k as keyof typeof AI_LIMITS, tier);
    const perWindow = max * COST_USD[k];
    return sum + (window === "week" ? perWindow / 7 : perWindow);
  }, 0);
}

test("a paying user who maxes every bucket every day costs at most $30/month", () => {
  // The hard budget (2026-09-17, user-directed) against $20/month of revenue.
  // Raising any premium limit without re-checking the arithmetic fails here.
  const monthly = worstCaseUsdPerDay("premium") * DAYS_PER_MONTH;
  assert.ok(monthly <= 30, `premium worst case $${monthly.toFixed(2)}/month exceeds the $30 ceiling`);
  assert.ok(monthly > 25, `premium worst case $${monthly.toFixed(2)}/month — too far under, limits are stingier than intended`);
  // Free stays well clear of what a paying user can spend.
  assert.ok(worstCaseUsdPerDay("free") < worstCaseUsdPerDay("premium") / 2);
});

test("beta is half of premium, floored at free, and never exceeds premium", () => {
  for (const k of Object.keys(AI_LIMITS) as Array<keyof typeof AI_LIMITS>) {
    const free = limitFor(k, "free").max;
    const beta = limitFor(k, "beta").max;
    const premium = limitFor(k, "premium").max;
    assert.ok(beta >= free, `${k}: beta ${beta} dropped below free ${free}`);
    assert.ok(beta <= premium, `${k}: beta ${beta} exceeded premium ${premium}`);
    assert.equal(beta, Math.max(free, Math.ceil(premium / 2)), k);
  }
  assert.equal(limitFor("claraChat", "beta").max, 13);
  assert.equal(limitFor("fridge", "beta").max, 3);
  // Beta beats free on every ongoing feature, and ties on exactly one:
  // plan setups, where ceil(3/2) lands back on free's 2. That is fine — plan
  // setups are onboarding, not something a tester needs more of — but it is
  // the bucket to re-check if either number moves, since it is one step from
  // the floor actually biting.
  const ties = (Object.keys(AI_LIMITS) as Array<keyof typeof AI_LIMITS>).filter(
    (k) => limitFor(k, "beta").max === limitFor(k, "free").max
  );
  assert.deepEqual(ties, ["planInit"], `beta/free ties changed: ${ties.join(", ")}`);
});

test("every spend bucket carries the ai- prefix the rate limiter keys its fallback on", () => {
  // lib/rate-limit.ts only degrades "ai-*" buckets to the per-instance counter
  // on a backend error; anything else fails fully open. Renaming a bucket out
  // of the prefix would silently uncap the Anthropic bill during a Redis blip.
  for (const k of Object.keys(AI_LIMITS)) assert.ok(AI_LIMITS[k].bucket.startsWith("ai-"), k);
});

test("tierFor: paid is premium, a coupon alone is beta, admin always premium", () => {
  assert.equal(tierFor([{ source: "STRIPE", plan: "PREMIUM", status: "ACTIVE" }]), "premium");
  assert.equal(tierFor([{ source: "APPLE", plan: "PREMIUM", status: "ACTIVE" }]), "premium");
  assert.equal(tierFor([{ source: "COUPON", plan: "PREMIUM", status: "ACTIVE" }]), "beta");
  // A tester who subscribes gets the full limits at once rather than waiting
  // for the coupon to lapse — paid outranks the coupon on the same account.
  assert.equal(
    tierFor([
      { source: "COUPON", plan: "PREMIUM", status: "ACTIVE" },
      { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE" },
    ]),
    "premium"
  );
  // A dead coupon row alongside a live one must not drag the account to beta.
  assert.equal(
    tierFor([
      { source: "COUPON", plan: "PREMIUM", status: "CANCELED" },
      { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE" },
    ]),
    "premium"
  );
  assert.equal(tierFor([{ source: "STRIPE", plan: "FREE", status: "ACTIVE" }]), "free");
  assert.equal(tierFor([{ source: "STRIPE", plan: "PREMIUM", status: "CANCELED" }]), "free");
  assert.equal(tierFor([{ source: "COUPON", plan: "PREMIUM", status: "CANCELED" }]), "free");
  assert.equal(tierFor([], true), "premium");
  assert.equal(tierFor([]), "free");
});

test("a beta tester who runs out is still offered the upgrade; their allowance is not called 'free'", () => {
  const b = quotaExceededBody("claraChat", "beta");
  assert.equal(b.upgrade, true);
  assert.match(b.error, /13 Clara messages for today/);
  assert.doesNotMatch(b.error, /free/);
  assert.match(b.error, /Premium gives you 25 a day/);
  // Since the free column was tightened (2026-09-17) EVERY bucket has headroom
  // above free and beta, so every non-premium refusal can offer the upgrade.
  // Premium is the only tier with nothing left to sell.
  assert.equal(quotaExceededBody("planInit", "beta").upgrade, true);
  assert.equal(quotaExceededBody("planInit", "free").upgrade, true);
  assert.equal(quotaExceededBody("planInit", "premium").upgrade, false);
});

test("free user: 6th Clara message today is refused with an upgrade hint; the global bucket is untouched", async () => {
  const { limiter, calls } = fakeLimiter();
  for (let i = 0; i < 5; i++) assert.equal((await guardAiSpend("u1", "claraChat", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "claraChat", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    assert.match(r.error, /5 free Clara messages for today/);
    assert.match(r.error, /Premium gives you 25 a day/);
    assert.equal((r.body as { upgrade?: boolean }).upgrade, true);
  }
  assert.equal(calls.filter((c) => c.startsWith("ai-global-day")).length, 5);
});

test("free user: second new week in the same week is refused; premium gets five", async () => {
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("u1", "planGen", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "planGen", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /1 free new week for this week/);
  for (let i = 0; i < 5; i++) assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, true);
  assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, false);
});

test("premium at its cap gets a plain reset message, no upgrade hint", () => {
  const b = quotaExceededBody("claraChat", "premium");
  assert.equal(b.upgrade, false);
  assert.match(b.error, /today's limit for Clara messages \(25\)/);
});

// ── The quota → UI contract ──────────────────────────────────────────────────
// The 429 body is the only thing the meal-plan UI has to go on when deciding
// whether to show "Upgrade for more →" (DailyMealPlanView reads
// `code === "quota" && upgrade === true`). These pin the flag's meaning across
// the WHOLE table rather than the handful of cells the tests above spot-check,
// so a new bucket or a changed limit cannot flip the hint by accident.
// The render side of the same contract is held by
// lib/new-week-upgrade-surface.test.ts.

const ALL_KINDS = Object.keys(AI_LIMITS) as Array<keyof typeof AI_LIMITS>;
const ALL_TIERS = ["free", "beta", "premium"] as const;

test("upgrade is true exactly when premium would grant more than the caller's tier, for every bucket and tier", () => {
  for (const kind of ALL_KINDS) {
    for (const tier of ALL_TIERS) {
      const body = quotaExceededBody(kind, tier);
      const mine = limitFor(kind, tier).max;
      const premium = limitFor(kind, "premium").max;
      assert.equal(
        body.upgrade,
        premium > mine,
        `${kind}/${tier}: upgrade=${body.upgrade} but premium gives ${premium} vs this tier's ${mine}`
      );
      // The sentence must agree with the flag: an upgrade hint names the
      // premium number; a non-upgrade body promises the reset instead.
      if (body.upgrade) {
        assert.match(body.error, new RegExp(`Premium gives you ${premium} a (day|week)\\.$`), `${kind}/${tier}`);
        assert.doesNotMatch(body.error, /resets/, `${kind}/${tier}`);
      } else {
        assert.match(body.error, /it resets (tomorrow|next week)\.$/, `${kind}/${tier}`);
        assert.doesNotMatch(body.error, /Premium gives you/, `${kind}/${tier}`);
      }
    }
    // Premium can never be offered an upgrade, whatever the numbers say.
    assert.equal(quotaExceededBody(kind, "premium").upgrade, false, kind);
  }
});

test("the 429 body echoes what the UI needs: code, kind, tier, this tier's limit, the window", () => {
  for (const kind of ALL_KINDS) {
    for (const tier of ALL_TIERS) {
      const body = quotaExceededBody(kind, tier);
      const expected = limitFor(kind, tier);
      assert.equal(body.code, "quota", `${kind}/${tier}`);
      assert.equal(body.kind, kind, `${kind}/${tier}`);
      assert.equal(body.tier, tier, `${kind}/${tier}`);
      assert.equal(body.limit, expected.max, `${kind}/${tier}: limit in body drifted from limitFor`);
      assert.equal(body.window, expected.window, `${kind}/${tier}`);
      assert.equal(typeof body.upgrade, "boolean", `${kind}/${tier}: upgrade must be a real boolean, not truthy/undefined`);
      // The number the sentence quotes is the same one the body carries.
      assert.match(body.error, new RegExp(`\\b${body.limit}\\b`), `${kind}/${tier}`);
    }
  }
});

test("a single allowance is worded in the singular, on every bucket and tier where the limit is 1", () => {
  let checked = 0;
  for (const kind of ALL_KINDS) {
    for (const tier of ALL_TIERS) {
      if (limitFor(kind, tier).max !== 1) continue;
      checked++;
      const { error, upgrade } = quotaExceededBody(kind, tier);
      const singular = AI_LIMITS[kind].label.replace(/s$/, "");
      if (upgrade) {
        assert.match(error, new RegExp(`your 1 (free )?${singular} for`), `${kind}/${tier}: "${error}"`);
        assert.doesNotMatch(error, new RegExp(`1 (free )?${AI_LIMITS[kind].label} for`), `${kind}/${tier}: plural after "1"`);
      }
    }
  }
  assert.ok(checked > 0, "no bucket has a limit of 1 any more — drop this test or pick a new fixture");
});

test("the documented free-tier new-week 429 body, byte for byte", () => {
  // This is the body the meal-plan UI was tested against by hand when the
  // missing upgrade link was found (2026-09-17). If the wording or a field
  // changes, this fails on purpose: update the fixture AND re-check the UI.
  assert.deepEqual(quotaExceededBody("planGen", "free"), {
    error: "You've used your 1 free new week for this week. Premium gives you 5 a week.",
    code: "quota",
    kind: "planGen",
    tier: "free",
    limit: 1,
    window: "week",
    upgrade: true,
  });
});

test("guardAiSpend's new-week 429 carries the same body the UI keys on (code + upgrade), not just the sentence", async () => {
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("u1", "planGen", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "planGen", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    // The route serialises `guard.body` as-is, so the body — not `error` — is
    // the contract. DailyMealPlanView reads exactly these two fields.
    const body = r.body as Partial<ReturnType<typeof quotaExceededBody>>;
    assert.equal(body.code, "quota");
    assert.equal(body.upgrade, true);
    assert.equal(body.kind, "planGen");
    assert.equal(body.error, r.error);
  }
  // A premium user at the cap gets `upgrade: false` — the UI must not offer
  // an upgrade to someone already on the top tier.
  for (let i = 0; i < 5; i++) await guardAiSpend("u2", "planGen", "premium", limiter);
  const p = await guardAiSpend("u2", "planGen", "premium", limiter);
  assert.equal(p.ok, false);
  if (!p.ok) {
    assert.equal((p.body as { code?: string }).code, "quota");
    assert.equal((p.body as { upgrade?: boolean }).upgrade, false);
  }
  // The global-ceiling 429 is NOT a quota body: no `code`, no `upgrade`. The
  // UI must not mistake "Clara is at capacity" for an upsell moment.
  const g = fakeLimiter();
  for (let i = 0; i < GLOBAL_AI_DAILY_MAX; i++) await g.limiter("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, 86_400);
  const c = await guardAiSpend("fresh", "planGen", "premium", g.limiter);
  assert.equal(c.ok, false);
  if (!c.ok) {
    assert.equal("code" in c.body, false);
    assert.equal("upgrade" in c.body, false);
  }
});

test("global ceiling stops everyone once the org-wide daily count is spent", async () => {
  const { limiter } = fakeLimiter();
  // Exhaust the global bucket directly, then a fresh premium user is refused.
  for (let i = 0; i < GLOBAL_AI_DAILY_MAX; i++) await limiter("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, 86_400);
  const r = await guardAiSpend("fresh", "swap", "premium", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /at capacity/);
});

test("global ceiling is sized for a 50-tester beta", () => {
  // 50 testers x ~40 requests/day worst case = 2000. Below that the 51st
  // request of a busy evening read as an outage ("Clara is at capacity").
  assert.equal(GLOBAL_AI_DAILY_MAX, 2000);
});
