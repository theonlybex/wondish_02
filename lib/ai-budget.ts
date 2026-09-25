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

// "beta" is TEMPORARY (2026-09-17): coupon holders simulating the paid product
// for a couple of runs. It has no column of its own — see maxFor(). Retiring it
// is three deletions: this union member, the branch in maxFor(), and the
// COUPON check in tierFor().
export type AiTier = "free" | "beta" | "premium";
export type AiWindow = "day" | "week";

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
// request and the product's headline. New weeks keep 5/week for the same
// reason. The big cut is plan setups, 10/day → 3: at $0.08 each that line was
// quietly the most expensive in the table, and nobody re-runs onboarding ten
// times a day.
//
// The FREE column is a taste, not a usable tier (2026-09-17, user-directed):
// one week's plan and five Clara messages is enough to see whether the product
// works for you, and anything more is what Plus is for. Ratios against premium:
// chat 1:5, new weeks 1:5, swaps 2:5, fridge 1:3, cook-my-day 1:3.
//
// Worst case per day: free ≈ $0.36 ($11/month), beta ≈ $0.57 ($17/month),
// premium ≈ $0.97 ($29.4/month at 30.44 days). lib/ai-budget.test.ts asserts
// the $30 premium ceiling directly, so a future limit bump that breaks the
// budget fails the suite rather than the bill.
// (A previous note here claimed free worst case ≈ $0.55/week; that cannot be
// right — Clara and fridge alone reach $0.84/week at the free limits — so it
// has been re-derived rather than carried forward.)
export const AI_LIMITS: Record<string, AiLimit> = {
  // Conversations with Clara (dish-checker).
  claraChat: { bucket: "ai-chat", window: "day", free: 5, premium: 25, label: "Clara messages" },
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
  // Rolling-week generation (New week, regenerate): the headline free limit.
  planGen: { bucket: "ai-plangen", window: "week", free: 1, premium: 5, label: "new weeks" },
  // Clara single-dish swaps and "cuisine for today".
  swap: { bucket: "ai-swap", window: "day", free: 2, premium: 5, label: "dish swaps" },

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
function maxFor(cfg: AiLimit, tier: AiTier): number {
  if (tier === "premium") return cfg.premium;
  if (tier === "beta") return Math.max(cfg.free, Math.ceil(cfg.premium / 2));
  return cfg.free;
}

export function limitFor(kind: AiGuardKind, tier: AiTier): { max: number; windowSec: number; window: AiWindow } {
  const cfg = AI_LIMITS[kind];
  return { max: maxFor(cfg, tier), windowSec: cfg.window === "week" ? WEEK : DAY, window: cfg.window };
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
}

export function quotaExceededBody(kind: AiGuardKind, tier: AiTier): QuotaExceededBody {
  const cfg = AI_LIMITS[kind];
  const limit = maxFor(cfg, tier);
  const per = cfg.window === "week" ? "this week" : "today";
  const resets = cfg.window === "week" ? "next week" : "tomorrow";
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
    ? `You've used your ${allowance} for ${per}. Plus gives you ${cfg.premium} ${cfg.window === "week" ? "a week" : "a day"}.`
    : `You've reached ${per}'s limit for ${cfg.label} (${limit}) — it resets ${resets}.`;
  return { error, code: "quota", kind, tier, limit, window: cfg.window, upgrade };
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
export async function remainingAiSpend(
  userId: string,
  kind: AiGuardKind,
  tier?: AiTier
): Promise<AiGuardResult> {
  const t = tier ?? (await resolveAiTier(userId));
  const { max, windowSec } = limitFor(kind, t);
  const left = await remainingTokens(`${AI_LIMITS[kind].bucket}-${t}`, userId, max, windowSec);
  // null = the backend could not answer. Proceed rather than refuse on a read
  // we did not manage to make; the charge on success still meters it.
  if (left !== null && left <= 0) {
    const body = quotaExceededBody(kind, t);
    return { ok: false, status: 429, error: body.error, body };
  }
  return { ok: true, tier: t };
}

export async function guardAiSpend(
  userId: string,
  kind: AiGuardKind,
  tier?: AiTier,
  limiter: Limiter = rateLimit
): Promise<AiGuardResult> {
  const t = tier ?? (await resolveAiTier(userId));
  const { max, windowSec } = limitFor(kind, t);

  // 1. Per-user quota for this tier. The bucket carries the tier so an
  //    upgrade mid-window starts a fresh (larger) counter.
  const user = await limiter(`${AI_LIMITS[kind].bucket}-${t}`, userId, max, windowSec);
  if (!user.success) {
    const body = quotaExceededBody(kind, t);
    return { ok: false, status: 429, error: body.error, body };
  }

  // 2. Global daily ceiling (single shared counter for the whole org).
  const global = await limiter("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, DAY);
  if (!global.success) {
    const error = "Clara is at capacity for today — please try again tomorrow.";
    return { ok: false, status: 429, error, body: { error } };
  }

  return { ok: true, tier: t };
}
