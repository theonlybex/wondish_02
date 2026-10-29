import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_COST_CENTS,
  AI_LIMITS,
  CLARA_BETA_AI_DAILY_CENTS,
  CLARA_FREE_AI_DAILY_CENTS,
  CLARA_RESTING_COPY,
  CLARA_SAFETY_CAP,
  FREE_AI_DAILY_CENTS,
  guardAiSpend,
  guardClaraAppSpend,
  guardGlobalAiSpend,
  limitFor,
  quotaExceededBody,
  tierFor,
  weekBuildKind,
} from "./ai-budget";

test("a member's first week is onboarding, never a new week — Free (0 new weeks) must still get it", async () => {
  assert.equal(weekBuildKind({ hasAnyPlan: false, stale: false }), "planInit");
  assert.equal(weekBuildKind({ hasAnyPlan: false, stale: true }), "planInit");
  assert.equal(weekBuildKind({ hasAnyPlan: true, stale: true }), "planRebuild");
  assert.equal(weekBuildKind({ hasAnyPlan: true, stale: false }), "planGen");
  // The whole point: a brand-new Free member's first build is allowed.
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("new", weekBuildKind({ hasAnyPlan: false, stale: false }), "free", limiter)).ok, true);
});

// In-memory limiter: counts per (bucket, identifier); no time passes.
function fakeLimiter() {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  // `rate` = units this call uses (the Free pool counts cents). Like
  // Upstash's sliding window (measured 2026-09-30), a refused call that is
  // bigger than what is left still drains the remainder: 24/30 used, +12 is
  // refused and the last 6 are gone too.
  const limiter = async (name: string, id: string, limit: number, _windowSec: number, _o?: undefined, rate = 1) => {
    const key = `${name}|${id}`;
    const n = (counts.get(key) ?? 0) + rate;
    calls.push(`${key}:${limit}`);
    if (n > limit) { counts.set(key, Math.max(counts.get(key) ?? 0, limit)); return { success: false }; }
    counts.set(key, n);
    return { success: true };
  };
  return { limiter, calls };
}

test("tiers: new weeks — free none after its first, beta 2 and Plus 4 a month; Clara 5/day free, 20 Plus", () => {
  assert.deepEqual(limitFor("planGen", "free"), { max: 0, windowSec: 30 * 86_400, window: "month" });
  assert.deepEqual(limitFor("planGen", "beta"), { max: 2, windowSec: 30 * 86_400, window: "month" });
  assert.deepEqual(limitFor("planGen", "premium"), { max: 4, windowSec: 30 * 86_400, window: "month" });
  // Only new weeks are "not in Free at all"; the zero wording is written for them.
  for (const k of Object.keys(AI_LIMITS) as Array<keyof typeof AI_LIMITS>) {
    if (k !== "planGen") assert.ok(AI_LIMITS[k].free > 0, `${k}: a free limit of 0 needs its own refusal wording`);
  }
  // A profile-change rebuild is not a new week (its own bucket, Free included).
  assert.deepEqual(limitFor("planRebuild", "free"), { max: 1, windowSec: 7 * 86_400, window: "week" });
  assert.equal(limitFor("planRebuild", "premium").max, 2);
  assert.equal(limitFor("claraChat", "free").max, 5);
  assert.equal(limitFor("claraChat", "premium").max, 20);
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
  planInit: 0.08,
  planGen: 0.08,
  planRebuild: 0.08,
  // A swap costs its tokens when ATTEMPTED; charging the swap bucket on
  // delivery spends no more model time. The attempt cap is what bounds it.
  swap: 0,
  swapAttempt: 0.02,
  // Same shape: the tokens are spent per ATTEMPT, charging on delivery adds none.
  cookDay: 0,
  cookDayAttempt: 0.05,
  // Clara app chat, measured p90 per message with the full toolbox, 50 memories
  // and 20 messages of history (scripts/clara-cost-measure.ts, 2026-10-28:
  // mean $0.0123, p90 $0.0157).
  claraApp: 0.0123,
};
const DAYS_PER_MONTH = 365 / 12;

function worstCaseUsdPerDay(tier: "free" | "beta" | "premium", exclude: string[] = []): number {
  return Object.keys(AI_LIMITS).reduce((sum, k) => {
    if (exclude.includes(k)) return sum;
    const { max, window } = limitFor(k as keyof typeof AI_LIMITS, tier);
    const perWindow = max * COST_USD[k];
    return sum + perWindow / { day: 1, week: 7, month: 30 }[window];
  }, 0);
}

test("a paying user who maxes every bucket every day costs at most $30/month", () => {
  // The hard budget (2026-09-17, user-directed) against $20/month of revenue.
  // Raising any premium limit without re-checking the arithmetic fails here.
  //
  // claraApp is EXCLUDED from this sum: user decision 2026-10-28, cap 150/day,
  // $30 rule relaxed for Clara. Its hidden safety cap is an abuse backstop, not
  // an allowance anyone is expected to reach; its own worst case is pinned by
  // the next test instead, so it cannot drift unnoticed.
  const monthly = worstCaseUsdPerDay("premium", ["claraApp"]) * DAYS_PER_MONTH;
  assert.ok(monthly <= 30, `premium worst case $${monthly.toFixed(2)}/month exceeds the $30 ceiling`);
  assert.ok(monthly > 25, `premium worst case $${monthly.toFixed(2)}/month — too far under, limits are stingier than intended`);
  // Free stays well clear of what a paying user can spend.
  assert.ok(worstCaseUsdPerDay("free", ["claraApp"]) < worstCaseUsdPerDay("premium", ["claraApp"]) / 2);
});

test("claraApp's own premium worst case is pinned: 150/day at $0.0123 is about $56.1/month, at most $57", () => {
  // User decision 2026-10-28, cap 150/day, $30 rule relaxed for Clara.
  assert.equal(CLARA_SAFETY_CAP, 150);
  const monthly = limitFor("claraApp", "premium").max * COST_USD.claraApp * DAYS_PER_MONTH;
  assert.ok(monthly <= 57, `claraApp worst case $${monthly.toFixed(2)}/month exceeds the $57 pin`);
  assert.ok(monthly > 55, `claraApp worst case $${monthly.toFixed(2)}/month — pin is stale, tighten it`);
});

test("claraApp: one hidden cap for every tier, one daily window, its own bucket", () => {
  assert.deepEqual(AI_LIMITS.claraApp, { bucket: "ai-clara-app", window: "day", free: 150, premium: 150, label: "Clara messages" });
  for (const tier of ["free", "beta", "premium"] as const) assert.equal(limitFor("claraApp", tier).max, 150, tier);
  assert.equal(AI_COST_CENTS.claraApp, 2);
  // The dish-checker's allowance is untouched.
  assert.equal(limitFor("claraChat", "free").max, 5);
  assert.equal(limitFor("claraChat", "premium").max, 20);
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
  assert.equal(limitFor("claraChat", "beta").max, 10);
  assert.equal(limitFor("fridge", "beta").max, 3);
  // Beta beats free on every ongoing feature, and ties on exactly one:
  // plan setups, where ceil(3/2) lands back on free's 2. That is fine — plan
  // setups are onboarding, not something a tester needs more of — but it is
  // the bucket to re-check if either number moves, since it is one step from
  // the floor actually biting.
  const ties = (Object.keys(AI_LIMITS) as Array<keyof typeof AI_LIMITS>).filter(
    (k) => limitFor(k, "beta").max === limitFor(k, "free").max
  );
  // swapAttempt ties too, and that is not a lost benefit: it is a model-call
  // cap, not an allowance. Beta's 5 attempts carry 3 swaps + 2 refunds, free's
  // carry 2 + 3; the swaps themselves are still 3 against 2.
  // cookDayAttempt ties by design: beta's 2 attempts carry its 2 plans.
  // planRebuild ties by design: a rebuild repairs the week you have after a
  // profile change; one a week is what a real change needs, on either tier.
  // claraApp ties by design: it is one hidden safety cap (150/day) for every
  // tier, so free = beta = premium (user decision 2026-10-28).
  assert.deepEqual(ties, ["planInit", "planRebuild", "swapAttempt", "cookDayAttempt", "claraApp"], `beta/free ties changed: ${ties.join(", ")}`);
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
  assert.match(b.error, /10 Clara messages for today/);
  assert.doesNotMatch(b.error, /free/);
  // "Plus" is the on-screen name of the paid tier (Wondish Plus / Chef); the
  // code keeps "premium". The sentence must never say "Premium".
  assert.match(b.error, /Plus gives you 20 a day\.$/);
  assert.doesNotMatch(b.error, /premium/i);
  // Since the free column was tightened (2026-09-17) EVERY bucket has headroom
  // above free and beta, so every non-premium refusal can offer the upgrade.
  // Premium is the only tier with nothing left to sell.
  assert.equal(quotaExceededBody("planInit", "beta").upgrade, true);
  assert.equal(quotaExceededBody("planInit", "free").upgrade, true);
  assert.equal(quotaExceededBody("planInit", "premium").upgrade, false);
});

const noLapse = async () => null;

test("free user: 6th Clara message today is refused with an upgrade hint; the global bucket is untouched", async () => {
  const { limiter, calls } = fakeLimiter();
  for (let i = 0; i < 5; i++) assert.equal((await guardAiSpend("u1", "claraChat", "free", limiter, noLapse)).ok, true);
  const r = await guardAiSpend("u1", "claraChat", "free", limiter, noLapse);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    assert.match(r.error, /5 free Clara messages for today/);
    assert.match(r.error, /Plus gives you 20 a day\.$/);
    assert.doesNotMatch(r.error, /premium/i);
    assert.equal((r.body as { upgrade?: boolean }).upgrade, true);
  }
  assert.equal(calls.filter((c) => c.startsWith("ai-free-pool|")).length, 5);
});

test("free user: no new week after the first (which came with setup); beta gets 2 a month, Plus 4", async () => {
  const { limiter, calls } = fakeLimiter();
  const r = await guardAiSpend("u1", "planGen", "free", limiter, noLapse);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /^New weeks are part of Plus — Free comes with your first week\./);
  // Refused before any counter — and before the org-wide one.
  assert.equal(calls.length, 0);
  for (let i = 0; i < 2; i++) assert.equal((await guardAiSpend("u3", "planGen", "beta", limiter)).ok, true);
  assert.equal((await guardAiSpend("u3", "planGen", "beta", limiter, noLapse)).ok, false);
  for (let i = 0; i < 4; i++) assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, true);
  const p = await guardAiSpend("u2", "planGen", "premium", limiter);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error, "You've reached this month's limit for new weeks (4) — it resets as the month rolls on.");
});

test("a profile-change rebuild is its own allowance: Free can apply a new allergy without a new week", async () => {
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("u5", "planRebuild", "free", limiter)).ok, true);
  const r = await guardAiSpend("u5", "planRebuild", "free", limiter, noLapse);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "You've used your 1 free plan rebuild for this week. Plus gives you 2 a week.");
});

test("premium at its cap gets a plain reset message, no upgrade hint", () => {
  const b = quotaExceededBody("claraChat", "premium");
  assert.equal(b.upgrade, false);
  assert.match(b.error, /today's limit for Clara messages \(20\)/);
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
        assert.match(body.error, new RegExp(`Plus gives you ${premium} (${AI_LIMITS[kind].label} )?a (day|week|month)\\.$`), `${kind}/${tier}`);
        assert.doesNotMatch(body.error, /resets/, `${kind}/${tier}`);
      } else {
        assert.match(body.error, /it resets (tomorrow|next week|as the month rolls on)\.$/, `${kind}/${tier}`);
        assert.doesNotMatch(body.error, /Plus gives you/, `${kind}/${tier}`);
      }
      // The code's internal name must not leak into user-facing copy on any cell.
      assert.doesNotMatch(body.error, /premium/i, `${kind}/${tier}: "${body.error}"`);
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
      // The number the sentence quotes is the same one the body carries —
      // except a tier that has none of it, which is told what Plus has.
      if (body.limit > 0) assert.match(body.error, new RegExp(`\\b${body.limit}\\b`), `${kind}/${tier}`);
      else assert.match(body.error, /^New weeks are part of Plus — Free comes with your first week\./, `${kind}/${tier}`);
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
    error: "New weeks are part of Plus — Free comes with your first week. Plus gives you 4 new weeks a month.",
    code: "quota",
    kind: "planGen",
    tier: "free",
    limit: 0,
    window: "month",
    upgrade: true,
  });
});

test("guardAiSpend's new-week 429 carries the same body the UI keys on (code + upgrade), not just the sentence", async () => {
  const { limiter } = fakeLimiter();
  const r = await guardAiSpend("u1", "planGen", "free", limiter, noLapse);
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
  for (let i = 0; i < 4; i++) await guardAiSpend("u2", "planGen", "premium", limiter);
  const p = await guardAiSpend("u2", "planGen", "premium", limiter);
  assert.equal(p.ok, false);
  if (!p.ok) {
    assert.equal((p.body as { code?: string }).code, "quota");
    assert.equal((p.body as { upgrade?: boolean }).upgrade, false);
  }
  // The Free-pool 429 is NOT a quota body: no `code`, no `upgrade` flag the
  // UI would render as an allowance refusal ("very busy" is its own message).
  const g = fakeLimiter();
  await g.limiter("ai-free-pool", "ALL", FREE_AI_DAILY_CENTS, 86_400, undefined, FREE_AI_DAILY_CENTS);
  const c = await guardAiSpend("fresh", "planInit", "free", g.limiter, noLapse);
  assert.equal(c.ok, false);
  if (!c.ok) {
    assert.equal("code" in c.body, false);
    assert.equal("upgrade" in c.body, false);
  }
});

test("a swap that finds nothing spends an attempt, not a swap; a delivered one spends both", async () => {
  const { chargeAiSpend, guardAiSpend } = await import("./ai-budget");
  const counts = new Map<string, number>();
  const limiter = async (name: string, id: string, limit: number) => {
    const k = `${name}:${id}`; const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return { success: n <= limit };
  };
  // Three refusals: three attempts, no swaps.
  for (let i = 0; i < 3; i++) assert.equal((await guardAiSpend("u1", "swapAttempt", "free", limiter)).ok, true);
  assert.equal(counts.get("ai-swap-free:u1") ?? 0, 0);
  // Then a delivered one charges the swap.
  assert.equal((await guardAiSpend("u1", "swapAttempt", "free", limiter)).ok, true);
  await chargeAiSpend("u1", "swap", "free", limiter);
  assert.equal(counts.get("ai-swap-free:u1"), 1);
  // The attempt cap still stops a sixth model call: free is 2 swaps + 3 refunds.
  assert.equal((await guardAiSpend("u1", "swapAttempt", "free", limiter)).ok, true);
  assert.equal((await guardAiSpend("u1", "swapAttempt", "free", limiter, async () => null)).ok, false);
});

test("a cook-my-day that finds no safe day spends an attempt, not the day's plan; free gets one retry", async () => {
  const { chargeAiSpend, guardAiSpend, remainingAiSpend } = await import("./ai-budget");
  const counts = new Map<string, number>();
  const limiter = async (name: string, id: string, limit: number) => {
    const k = `${name}:${id}`; const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return { success: n <= limit };
  };
  // A refused day: one attempt, no plan.
  assert.equal((await guardAiSpend("u2", "cookDayAttempt", "free", limiter)).ok, true);
  assert.equal(counts.get("ai-cookday-free:u2") ?? 0, 0);
  // The retry delivers: a second attempt and the plan.
  assert.equal((await guardAiSpend("u2", "cookDayAttempt", "free", limiter)).ok, true);
  await chargeAiSpend("u2", "cookDay", "free", limiter);
  assert.equal(counts.get("ai-cookday-free:u2"), 1);
  // No third model call on free.
  assert.equal((await guardAiSpend("u2", "cookDayAttempt", "free", limiter, async () => null)).ok, false);
  void remainingAiSpend;
});

test("a member whose Plus payment failed is told why they are on the free allowance, and sent to update the card", async () => {
  const { limiter } = fakeLimiter();
  // New weeks: not in Free at all, so they are simply paused.
  const r = await guardAiSpend("u9", "planGen", "free", limiter, async () => "past_due");
  assert.equal(r.ok, false);
  if (!r.ok) {
    const body = r.body as ReturnType<typeof quotaExceededBody>;
    assert.equal(body.lapsed, "past_due");
    assert.equal(body.code, "quota");
    assert.equal(body.error, "Your Plus payment didn't go through, so new weeks are paused until your card is updated.");
  }
  // Something Free does include: the free allowance is named, then the card.
  for (let i = 0; i < 5; i++) await guardAiSpend("u9", "claraChat", "free", limiter, async () => "past_due");
  const c = await guardAiSpend("u9", "claraChat", "free", limiter, async () => "past_due");
  assert.equal(c.ok, false);
  if (!c.ok) assert.equal(c.error, "Your Plus payment didn't go through, so you're on the free allowance — and you've used your 5 free Clara messages for today.");
});

test("the lapse wording is only for the free tier, and a failed lookup falls back to the plain refusal", async () => {
  assert.equal(quotaExceededBody("planGen", "beta", "past_due").lapsed, undefined);
  const { limiter } = fakeLimiter();
  const r = await guardAiSpend("u8", "planGen", "free", limiter, async () => { throw new Error("db down"); });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "New weeks are part of Plus — Free comes with your first week. Plus gives you 4 new weeks a month.");
});

test("the Free pool is a daily budget in dollars: $20 of measured costs, then 'very busy'", async () => {
  const { guardGlobalAiSpend } = await import("./ai-budget");
  assert.equal(FREE_AI_DAILY_CENTS, 2000);
  const { limiter } = fakeLimiter();
  // A flood of first weeks (12c each) runs out after $20, not after 2000 requests.
  let weeks = 0;
  while ((await guardGlobalAiSpend("free", "planInit", limiter)).ok) weeks++;
  assert.equal(weeks, Math.floor(2000 / AI_COST_CENTS.planInit));
  const f = await guardGlobalAiSpend("free", "planInit", limiter);
  assert.equal(f.ok, false);
  if (!f.ok) assert.match(f.error, /very busy today/);
  // Upstash drains the few cents a refused week couldn't use (≤ 11c of $20),
  // so the pool is simply spent for the day.
  assert.equal((await guardGlobalAiSpend("free", "claraChat", limiter)).ok, false);
});

test("Free and Beta have separate pools; paying members have none", async () => {
  const { guardGlobalAiSpend, BETA_AI_DAILY_CENTS } = await import("./ai-budget");
  assert.equal(BETA_AI_DAILY_CENTS, 4000);
  const { limiter, calls } = fakeLimiter();
  // A Free flood spends Free's pool…
  await limiter("ai-free-pool", "ALL", FREE_AI_DAILY_CENTS, 86_400, undefined, FREE_AI_DAILY_CENTS);
  assert.equal((await guardGlobalAiSpend("free", "claraChat", limiter)).ok, false);
  // …and Beta testers are untouched: their own pool.
  assert.equal((await guardGlobalAiSpend("beta", "planGen", limiter)).ok, true);
  assert.ok(calls.some((c) => c.startsWith("ai-beta-pool|ALL")));
  // Beta's own pool runs out on its own budget.
  await limiter("ai-beta-pool", "ALL", BETA_AI_DAILY_CENTS, 86_400, undefined, BETA_AI_DAILY_CENTS);
  const b = await guardGlobalAiSpend("beta", "claraChat", limiter);
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.error, /very busy today/);
  // Plus: straight through, no pool consulted at all.
  const before = calls.length;
  assert.equal((await guardGlobalAiSpend("premium", "planGen", limiter)).ok, true);
  assert.equal((await guardAiSpend("u-plus", "claraChat", "premium", limiter)).ok, true);
  assert.ok(!calls.slice(before).some((c) => /pool/.test(c)), "paying members never touch a pool");
});

test("every metered kind has a measured cost; the ones charged on delivery cost nothing extra", () => {
  for (const k of Object.keys(AI_LIMITS)) assert.ok(k in AI_COST_CENTS, `${k} has no cost`);
  assert.equal(AI_COST_CENTS.swap, 0);
  assert.equal(AI_COST_CENTS.cookDay, 0);
  // A week build is four Clara calls, ~10c measured (2026-09-27).
  assert.ok(AI_COST_CENTS.planInit >= 10);
});

// ── Clara app chat: hidden safety cap and its own pools (2026-10-28) ─────────

test("guardClaraAppSpend: past the per-member cap it refuses with the resting copy and CLARA_RESTING", async () => {
  assert.equal(CLARA_RESTING_COPY, "I need a short break. Let's pick this up again tomorrow.");
  const { limiter } = fakeLimiter();
  for (let i = 0; i < CLARA_SAFETY_CAP; i++) {
    assert.equal((await guardClaraAppSpend("u-cap", "premium", limiter)).ok, true, `message ${i + 1}`);
  }
  const r = await guardClaraAppSpend("u-cap", "premium", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: CLARA_RESTING_COPY, code: "CLARA_RESTING" });
  }
  // Another member is unaffected.
  assert.equal((await guardClaraAppSpend("u-other", "premium", limiter)).ok, true);
});

test("guardClaraAppSpend draws from ai-clara-free-pool / ai-clara-beta-pool, never the shared pools", async () => {
  assert.equal(CLARA_FREE_AI_DAILY_CENTS, 1000);
  assert.equal(CLARA_BETA_AI_DAILY_CENTS, 1000);
  const { limiter, calls } = fakeLimiter();
  assert.equal((await guardClaraAppSpend("u-free", "free", limiter)).ok, true);
  assert.equal((await guardClaraAppSpend("u-beta", "beta", limiter)).ok, true);
  assert.ok(calls.some((c) => c.startsWith("ai-clara-free-pool|ALL:1000")), calls.join(" "));
  assert.ok(calls.some((c) => c.startsWith("ai-clara-beta-pool|ALL:1000")), calls.join(" "));
  assert.ok(!calls.some((c) => c.startsWith("ai-free-pool") || c.startsWith("ai-beta-pool")), "Clara must not touch the shared pools");
  // Plus passes straight through: no pool consulted.
  const before = calls.length;
  assert.equal((await guardClaraAppSpend("u-plus", "premium", limiter)).ok, true);
  assert.ok(!calls.slice(before).some((c) => /pool/.test(c)));
});

test("Clara's pools are separate from the shared ones, in both directions", async () => {
  const { limiter } = fakeLimiter();
  // A shared Free flood does not stop Clara…
  await limiter("ai-free-pool", "ALL", FREE_AI_DAILY_CENTS, 86_400, undefined, FREE_AI_DAILY_CENTS);
  assert.equal((await guardGlobalAiSpend("free", "claraChat", limiter)).ok, false);
  assert.equal((await guardClaraAppSpend("u1", "free", limiter)).ok, true);
  // …and Clara's pool running out does not stop the rest of the app.
  const fresh = fakeLimiter().limiter;
  await fresh("ai-clara-free-pool", "ALL", CLARA_FREE_AI_DAILY_CENTS, 86_400, undefined, CLARA_FREE_AI_DAILY_CENTS);
  assert.equal((await guardGlobalAiSpend("free", "planInit", fresh)).ok, true);
});

test("when Clara's pool is spent the member sees the resting copy, with no upgrade or Plus wording", async () => {
  const { limiter } = fakeLimiter();
  await limiter("ai-clara-free-pool", "ALL", CLARA_FREE_AI_DAILY_CENTS, 86_400, undefined, CLARA_FREE_AI_DAILY_CENTS);
  const r = await guardClaraAppSpend("u-busy", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: CLARA_RESTING_COPY, code: "CLARA_RESTING" });
    assert.doesNotMatch(JSON.stringify(r), /upgrade|plus|busy/i);
  }
  // The lower-level pool guard speaks the same words for this kind.
  const g = await guardGlobalAiSpend("free", "claraApp", limiter);
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.error, CLARA_RESTING_COPY);
});

test("the resting refusal never mentions upgrading, Plus, or premium", async () => {
  assert.doesNotMatch(CLARA_RESTING_COPY, /upgrade|plus|premium|pric/i);
  const { limiter } = fakeLimiter();
  for (let i = 0; i < CLARA_SAFETY_CAP; i++) await guardClaraAppSpend("u-x", "free", limiter);
  const r = await guardClaraAppSpend("u-x", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(JSON.stringify(r.body), /upgrade|plus|premium/i);
});
