import { rateLimit, remainingTokens } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { hasActivePremium } from "@/lib/auth";

// ── Anthropic spend guard (tiered) ───────────────────────────────────────────
//
// Every Anthropic-billed endpoint runs through guardAiSpend() BEFORE the model
// call (charge-before-model), so a rejected request costs zero tokens. Three
// layers:
//
//   1. Per-user quota by TIER — free / beta / premium. This IS the paywall:
//      signing in gets you the whole app, and the free column is generous
//      enough to try Wondish for real but small enough that buying Plus or
//      Chef is the obvious next step. Nothing is hidden behind a wall
//      (2026-09-17: the dashboard-wide PremiumGuard was removed).
//
//   2. Global daily ceiling — ONE shared counter across ALL users. This is the
//      backstop against the account-multiplication attack (scripting Clerk
//      sign-ups to get many fresh free accounts): no matter how many accounts
//      exist, total Anthropic calls per day are capped.
//
//   3. Everything runs on Haiku (2026-09-10, user-directed) — chat included —
//      so a request costs ~$0.01–0.08 and the tiers differ in availability,
//      not model.
//
// Enforcement depends on Upstash (Redis) being configured in production — the
// in-memory fallback is per-instance and resets on cold start, so these caps
// are only real cross-instance when Upstash env vars are present (they are in
// prod). See lib/rate-limit.ts.

const DAY = 86_400;
const WEEK = 7 * DAY;
// Sliding 30 days, like every window here (lib/rate-limit.ts slidingWindow).
const MONTH = 30 * DAY;

// "beta" is TEMPORARY (2026-09-17): coupon holders simulating the paid product
// for a couple of runs. It has no column of its own — see maxFor(). Retiring it
// is three deletions: this union member, the branch in maxFor(), and the
// COUPON check in tierFor().
export type AiTier = "free" | "beta" | "premium";
export type AiWindow = "day" | "week" | "month";

export interface AiLimit {
  bucket: string;
  window: AiWindow;
  free: number;
  premium: number;
  /** Plural noun for messages: "Clara messages", "new weeks". */
  label: string;
}

// Measured Haiku cost per request (2026-09-12): chat ≈ $0.012, swap /
// fridge ≈ $0.02, cook-day ≈ $0.05, a full new week ≈ $0.08 (plan setups
// build a plan, so they cost about the same as a new week).
//
// The "premium" column is sized to a HARD BUDGET (2026-09-17, user-directed):
// a paying user who maxes every bucket every day costs at most ≈ $0.99/day,
// ≈ $30/month, against $20/month of revenue. Flat-rate pricing always loses on
// the worst case; what matters is that the worst case is bounded and that real
// usage (~12 requests/day ≈ $0.30/day) is comfortably profitable.
//
// Per-bucket reasoning: Clara chat keeps its 25/day because it is the cheapest
// request and the product's headline. New weeks were 5/week until 2026-09-26,
// when they became a monthly allowance (see planGen). The big cut is plan setups, 10/day → 3: at $0.08 each that line was
// quietly the most expensive in the table, and nobody re-runs onboarding ten
// times a day.
//
// The FREE column is a taste, not a usable tier (2026-09-17, user-directed):
// one week's plan and five Clara messages is enough to see whether the product
// works for you, and anything more is what Plus is for. Ratios against premium:
// chat 1:5, new weeks 0:4 (the first week comes with setup), swaps 2:5,
// fridge 1:3, cook-my-day 1:3.
//
// Worst case per day (recomputed 2026-09-26, monthly new weeks + rebuilds):
// free ≈ $0.47 ($14.3/month), beta ≈ $0.56 ($16.9/month), premium ≈ $0.94
// ($28.7/month at 30.44 days). lib/ai-budget.test.ts asserts
// the $30 premium ceiling directly, so a future limit bump that breaks the
// budget fails the suite rather than the bill.
// (A previous note here claimed free worst case ≈ $0.55/week; that cannot be
// right — Clara and fridge alone reach $0.84/week at the free limits — so it
// has been re-derived rather than carried forward.)
export const AI_LIMITS: Record<string, AiLimit> = {
  // Conversations with Clara (dish-checker).
  // Premium 20, not 25 (2026-09-25, user-directed): the $0.06/day it frees
  // pays for up to three refunded swap attempts a day inside the $30 ceiling.
  claraChat: { bucket: "ai-chat", window: "day", free: 5, premium: 20, label: "Clara messages" },
  // Fridge recipe generation.
  fridge: { bucket: "ai-fridge", window: "day", free: 2, premium: 6, label: "fridge suggestions" },
  // Pantry "cook my day" full-day generation.
  cookDay: { bucket: "ai-cookday", window: "day", free: 1, premium: 3, label: "cook-my-day plans" },
  // First plan / start-date changes (onboarding) — not the weekly allowance.
  // Free stays at 2 rather than 1 on purpose: this is the path to BECOMING a
  // user, and at 1/day a single failed attempt would lock a brand-new account
  // out of onboarding for the rest of the day. It is still the most expensive
  // line in the free column ($0.16/day of $0.36) — drop it to 1 if cost beats
  // first-run safety.
  planInit: { bucket: "ai-planinit", window: "day", free: 2, premium: 3, label: "plan setups" },
  // New weeks (2026-09-26, user-directed): Free has the week it was set up
  // with (planInit) and no new ones; Beta 2 a month (half of premium); Plus 4
  // a month — a month of plans. When the week runs out, the refusal is the
  // upgrade moment, the way ChatGPT and Claude plans meter.
  planGen: { bucket: "ai-plangen", window: "month", free: 0, premium: 4, label: "new weeks" },
  // Rebuilding the week you ALREADY have because the profile changed (a new
  // allergy, goal or weight — patient.mealPlanStale, set server-side). Not a
  // new week: a Free member who adds an allergy must be able to get the unsafe
  // dishes off their plan. Its own small bucket so it can't be farmed for
  // weeks: every rebuild needs a real profile change first.
  planRebuild: { bucket: "ai-planrebuild", window: "week", free: 1, premium: 2, label: "plan rebuilds" },
  // Clara single-dish swaps and "cuisine for today" — charged only when one
  // DELIVERS (chargeAiSpend after the dish is saved). Costs nothing by itself;
  // the model's tokens are metered by swapAttempt below.
  swap: { bucket: "ai-swap", window: "day", free: 2, premium: 5, label: "dish swaps" },
  // Every swap/cuisine model call, successful or not: the allowance above plus
  // up to three that came back empty (a refusal is not the user's fault, so it
  // does not spend a swap). This is the bucket that bounds the bill. Beta,
  // being half of premium, gets two refunds rather than three.
  swapAttempt: { bucket: "ai-swapattempt", window: "day", free: 5, premium: 8, label: "swap attempts" },
  // Every cook-my-day model call. cookDay above is charged only when a day is
  // DELIVERED; a day Clara answered but that failed the safety filters spends
  // an attempt, not the allowance. Free gets one retry (1 + 1) — its whole day
  // was one attempt; premium's attempts equal its allowance, because the $30
  // ceiling has no room for more cook-my-day calls (lib/ai-budget.test.ts).
  cookDayAttempt: { bucket: "ai-cookdayattempt", window: "day", free: 2, premium: 3, label: "cook-my-day attempts" },

} as const;

export type AiGuardKind = keyof typeof AI_LIMITS;

// Org-wide hard ceiling on total Anthropic-billed REQUESTS per rolling day.
// THIS is the number that caps a runaway bill.
//
// Sized for the closed beta (2026-09-13): 50 testers x ~40 requests/day at
// the trial limits = 2000. Worst case at the ceiling on Haiku ≈ $40 for the
// day; realistic usage (~12 requests/tester) is a small fraction of that.
// Raise proportionally as the cohort grows.
export const GLOBAL_AI_DAILY_MAX = 2000;

/**
 * The allowance for one bucket at one tier.
 *
 * Beta is half of premium rather than a column of its own, so the table stays
 * the single set of numbers to maintain. The Math.max floor matters: half of a
 * small premium limit can land BELOW free (fridge 6 → 3, plan setups 3 → 2),
 * and a coupon tester must never get less than a signed-out-of-pocket user.
 */
const WINDOW_SEC: Record<AiWindow, number> = { day: DAY, week: WEEK, month: MONTH };
const PER: Record<AiWindow, string> = { day: "today", week: "this week", month: "this month" };
const RESETS: Record<AiWindow, string> = { day: "tomorrow", week: "next week", month: "as the month rolls on" };
const A_WINDOW: Record<AiWindow, string> = { day: "a day", week: "a week", month: "a month" };

function maxFor(cfg: AiLimit, tier: AiTier): number {
  if (tier === "premium") return cfg.premium;
  if (tier === "beta") return Math.max(cfg.free, Math.ceil(cfg.premium / 2));
  return cfg.free;
}

export function limitFor(kind: AiGuardKind, tier: AiTier): { max: number; windowSec: number; window: AiWindow } {
  const cfg = AI_LIMITS[kind];
  return { max: maxFor(cfg, tier), windowSec: WINDOW_SEC[cfg.window], window: cfg.window };
}

/**
 * Premium for a SUPER admin or any active PAID row (Stripe/Apple/admin grant);
 * beta when the only thing keeping the account premium is a coupon. Paid
 * outranks a coupon deliberately — a tester who subscribes gets the full
 * limits immediately, without waiting for the coupon to lapse.
 */
export function tierFor(
  subs: Array<{ source?: string; plan: string; status: string; stripeCurrentPeriodEnd?: Date | null } | null | undefined>,
  isAdmin = false
): AiTier {
  if (isAdmin) return "premium";
  const live = subs.filter((s) => hasActivePremium(s));
  if (live.length === 0) return "free";
  return live.every((s) => s!.source === "COUPON") ? "beta" : "premium";
}

export interface QuotaExceededBody {
  error: string;
  code: "quota";
  kind: AiGuardKind;
  tier: AiTier;
  limit: number;
  window: AiWindow;
  /** true when the premium tier has a higher limit — the UI can offer an upgrade. */
  upgrade: boolean;
  /**
   * Set when the account is on the free allowance only because its Plus
   * payment failed: the UI links to the card update, not to /pricing.
   */
  lapsed?: "past_due";
}

/**
 * A member whose renewal failed drops to the free allowance at once — what
 * they already have (this week's plan, saved dishes) stays; only new
 * generation is metered at the free rate, the way ChatGPT and Claude plans
 * lapse. The refusal is where they find out, so it has to say why.
 */
export async function paymentLapsed(userId: string): Promise<"past_due" | null> {
  const row = await prisma.subscription.findFirst({
    where: { account: { clerkId: userId }, source: { not: "COUPON" }, status: "PAST_DUE" },
    select: { id: true },
  });
  return row ? "past_due" : null;
}

type LapsedLookup = (userId: string) => Promise<"past_due" | null>;

export function quotaExceededBody(kind: AiGuardKind, tier: AiTier, lapsed: "past_due" | null = null): QuotaExceededBody {
  const cfg = AI_LIMITS[kind];
  const limit = maxFor(cfg, tier);
  const per = PER[cfg.window];
  const resets = RESETS[cfg.window];
  // Anyone below premium who would actually gain something is offered the
  // upgrade — beta testers included. Buckets where premium matches the tier's
  // own limit (plan setups) get the plain "resets tomorrow" message instead of
  // an upgrade that would buy nothing.
  const upgrade = tier !== "premium" && cfg.premium > limit;
  // Every label is a regular plural ("new weeks", "Clara messages"): "1 free
  // new weeks" read as a typo on the meal-plan banner (mobile QA 2026-09-11).
  const noun = limit === 1 ? cfg.label.replace(/s$/, "") : cfg.label;
  // Only the free tier's allowance is "free" — a coupon holder's isn't.
  const allowance = tier === "free" ? `${limit} free ${noun}` : `${limit} ${noun}`;
  // "Plus" is the product name a user sees (Wondish Plus / Wondish Chef); the
  // tier is still called "premium" in code, the enum and the bucket keys.
  // This sentence is the upgrade prompt on every quota refusal — the single
  // most-read line in the app — so it must use the name on the pricing page.
  const error = upgrade
    ? limit === 0
      // Nothing to have "used": the tier simply doesn't include it (Free's new
      // weeks — its first week came with setup).
      ? `New weeks are part of Plus — Free comes with your first week. Plus gives you ${cfg.premium} ${cfg.label} ${A_WINDOW[cfg.window]}.`
      : `You've used your ${allowance} for ${per}. Plus gives you ${cfg.premium} ${A_WINDOW[cfg.window]}.`
    : `You've reached ${per}'s limit for ${cfg.label} (${limit}) — it resets ${resets}.`;
  if (lapsed === "past_due" && tier === "free") {
    return {
      error:
        limit === 0
          // The action is the link beside it (quotaCta → "Update your card →").
          ? `Your Plus payment didn't go through, so ${cfg.label} are paused until your card is updated.`
          : `Your Plus payment didn't go through, so you're on the free allowance — and you've used your ${allowance} for ${per}.`,
      code: "quota", kind, tier, limit, window: cfg.window, upgrade, lapsed,
    };
  }
  return { error, code: "quota", kind, tier, limit, window: cfg.window, upgrade };
}

async function refusal(userId: string, kind: AiGuardKind, tier: AiTier, lapsedLookup: LapsedLookup): Promise<AiGuardResult> {
  // Only a free-tier refusal can be a lapse; the lookup runs only on refusal.
  const lapsed = tier === "free" ? await lapsedLookup(userId).catch(() => null) : null;
  const body = quotaExceededBody(kind, tier, lapsed);
  return { ok: false, status: 429, error: body.error, body };
}

/**
 * An allowance as a frequency: "Once a day", "Twice a day", "3 times a day".
 *
 * /pantry's cook-my-day card said "Once a day" in hardcoded text. Free gets 1,
 * beta 2 and Plus 3, so the line was wrong for two thirds of the tiers — and
 * wrong in the direction that hides what somebody already paid for. The number
 * has to come from the same table the guard enforces.
 */
export function allowanceFrequency(kind: AiGuardKind, tier: AiTier): string {
  const { max, window } = limitFor(kind, tier);
  const per = A_WINDOW[window];
  if (max === 1) return `Once ${per}`;
  if (max === 2) return `Twice ${per}`;
  return `${max} times ${per}`;
}

export type AiGuardResult =
  | { ok: true; tier: AiTier }
  | { ok: false; status: number; error: string; body: QuotaExceededBody | { error: string } };

/** Tier lookup for routes that haven't loaded the account (one small query). */
export async function resolveAiTier(userId: string): Promise<AiTier> {
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
  });
  if (!account) return "free";
  const isAdmin = account.roles.some((r) => r.role.name === "SUPER");
  return tierFor(account.subscriptions, isAdmin);
}

type Limiter = (name: string, identifier: string, limit: number, windowSec: number) => Promise<{ success: boolean }>;

/**
 * Gate an Anthropic-billed request. Call BEFORE the model request.
 * Checks the per-user tier quota first (so an already-capped user can't also
 * drain the global bucket), then the global daily ceiling. `tier` may be
 * passed by routes that already know it; otherwise it's looked up.
 */
/**
 * Is there allowance left, WITHOUT spending any?
 *
 * For the two-phase case: check before calling the model, charge once the
 * model has produced something usable. The swap route needs both halves — see
 * AI_LIMITS.swapAttempt for why.
 */
/**
 * Spend one unit of `kind` for a request that has ALREADY been paid for in
 * model tokens (see swapAttempt) and has now delivered. User bucket only: the
 * global ceiling counted the model call when the attempt was guarded.
 *
 * Never refuses the delivered result. A lost race (two swaps finishing on the
 * last unit) lets one extra through, which is cheaper than throwing away a
 * dish the user has already paid for in waiting.
 */
export async function chargeAiSpend(
  userId: string,
  kind: AiGuardKind,
  tier: AiTier,
  limiter: Limiter = rateLimit
): Promise<void> {
  const { max, windowSec } = limitFor(kind, tier);
  await limiter(`${AI_LIMITS[kind].bucket}-${tier}`, userId, max, windowSec);
}

export async function remainingAiSpend(
  userId: string,
  kind: AiGuardKind,
  tier?: AiTier,
  lapsedLookup: LapsedLookup = paymentLapsed
): Promise<AiGuardResult> {
  const t = tier ?? (await resolveAiTier(userId));
  const { max, windowSec } = limitFor(kind, t);
  if (max === 0) return refusal(userId, kind, t, lapsedLookup);
  const left = await remainingTokens(`${AI_LIMITS[kind].bucket}-${t}`, userId, max, windowSec);
  // null = the backend could not answer. Proceed rather than refuse on a read
  // we did not manage to make; the charge on success still meters it.
  if (left !== null && left <= 0) return refusal(userId, kind, t, lapsedLookup);
  return { ok: true, tier: t };
}

export async function guardAiSpend(
  userId: string,
  kind: AiGuardKind,
  tier?: AiTier,
  limiter: Limiter = rateLimit,
  lapsedLookup: LapsedLookup = paymentLapsed
): Promise<AiGuardResult> {
  const t = tier ?? (await resolveAiTier(userId));
  const { max, windowSec } = limitFor(kind, t);
  // Not in this tier at all (Free's new weeks): refuse before any counter.
  if (max === 0) return refusal(userId, kind, t, lapsedLookup);

  // 1. Per-user quota for this tier. The bucket carries the tier so an
  //    upgrade mid-window starts a fresh (larger) counter.
  const user = await limiter(`${AI_LIMITS[kind].bucket}-${t}`, userId, max, windowSec);
  if (!user.success) return refusal(userId, kind, t, lapsedLookup);

  // 2. Global daily ceiling (single shared counter for the whole org).
  const global = await limiter("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, DAY);
  if (!global.success) {
    const error = "Clara is at capacity for today — please try again tomorrow.";
    return { ok: false, status: 429, error, body: { error } };
  }

  return { ok: true, tier: t };
}
