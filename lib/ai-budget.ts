import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { accountHasActivePremium } from "@/lib/auth";

// ── Anthropic spend guard (tiered) ───────────────────────────────────────────
//
// Every Anthropic-billed endpoint runs through guardAiSpend() BEFORE the model
// call (charge-before-model), so a rejected request costs zero tokens. Three
// layers:
//
//   1. Per-user quota by TIER — free vs premium (Stripe, Apple, coupon, admin).
//      This is the product's free tier: generous enough to try Wondish for
//      real, small enough that upgrading is the obvious next step.
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

export type AiTier = "free" | "premium";
export type AiWindow = "day" | "week";

export interface AiLimit {
  bucket: string;
  window: AiWindow;
  free: number;
  premium: number;
  /** Plural noun for messages: "Clara messages", "new weeks". */
  label: string;
}

// Measured Haiku cost per request (this session): chat ≈ $0.012, swap /
// fridge ≈ $0.02, cook-day ≈ $0.05, a full new week ≈ $0.08.
// Free worst case ≈ $0.55/week; premium worst case ≈ $3.70/week (realistic
// ≈ $1) against $4.60/week of revenue on the monthly plan.
export const AI_LIMITS: Record<string, AiLimit> = {
  // Conversations with Clara (dish-checker).
  claraChat: { bucket: "ai-chat", window: "day", free: 5, premium: 20, label: "Clara messages" },
  // Fridge recipe generation.
  fridge: { bucket: "ai-fridge", window: "day", free: 3, premium: 15, label: "fridge suggestions" },
  // Pantry "cook my day" full-day generation.
  cookDay: { bucket: "ai-cookday", window: "day", free: 1, premium: 3, label: "cook-my-day plans" },
  // First plan / start-date changes (onboarding) — not the weekly allowance.
  planInit: { bucket: "ai-planinit", window: "day", free: 3, premium: 5, label: "plan setups" },
  // Rolling-week generation (New week, regenerate): the headline free limit.
  planGen: { bucket: "ai-plangen", window: "week", free: 1, premium: 3, label: "new weeks" },
  // Clara single-dish swaps and "cuisine for today".
  swap: { bucket: "ai-swap", window: "day", free: 2, premium: 10, label: "dish swaps" },
} as const;

export type AiGuardKind = keyof typeof AI_LIMITS;

// Org-wide hard ceiling on total Anthropic-billed REQUESTS per rolling day.
// THIS is the number that caps a runaway bill.
//
// Budget target: ~$100/week ≈ $14/day. With everything on Haiku the average
// request is ≈ $0.02 (chat $0.012 … week $0.08), so $14 ÷ $0.02 ≈ 700. A
// pure new-week spam day at the ceiling would cost ~$56 — the per-user weekly
// planGen cap makes that unreachable in practice.
export const GLOBAL_AI_DAILY_MAX = 700;

export function limitFor(kind: AiGuardKind, tier: AiTier): { max: number; windowSec: number; window: AiWindow } {
  const cfg = AI_LIMITS[kind];
  return { max: cfg[tier], windowSec: cfg.window === "week" ? WEEK : DAY, window: cfg.window };
}

/** Premium for any active source (Stripe/Apple/coupon) or a SUPER admin. */
export function tierFor(
  subs: Array<{ plan: string; status: string; stripeCurrentPeriodEnd?: Date | null } | null | undefined>,
  isAdmin = false
): AiTier {
  return isAdmin || accountHasActivePremium(subs) ? "premium" : "free";
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
  const limit = cfg[tier];
  const per = cfg.window === "week" ? "this week" : "today";
  const resets = cfg.window === "week" ? "next week" : "tomorrow";
  const upgrade = tier === "free" && cfg.premium > cfg.free;
  // Every label is a regular plural ("new weeks", "Clara messages"): "1 free
  // new weeks" read as a typo on the meal-plan banner (mobile QA 2026-09-11).
  const noun = limit === 1 ? cfg.label.replace(/s$/, "") : cfg.label;
  const error = upgrade
    ? `You've used your ${limit} free ${noun} for ${per}. Premium gives you ${cfg.premium} ${cfg.window === "week" ? "a week" : "a day"}.`
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
