import { rateLimit } from "@/lib/rate-limit";

// ── Anthropic spend guard ────────────────────────────────────────────────────
//
// Every Anthropic-billed endpoint runs through guardAiSpend() BEFORE the model
// call (charge-before-model), so a rejected request costs zero tokens. Two
// layers:
//
//   1. Per-user daily quota — generous enough for real daily use, low enough
//      that one account can't run up a large bill. Bounds a single abuser.
//
//   2. Global daily ceiling — ONE shared counter across ALL users. This is the
//      backstop against the account-multiplication attack (scripting Clerk
//      sign-ups to get many fresh accounts, each within its own per-user
//      quota): no matter how many accounts exist, total Anthropic calls per day
//      are capped. Tune GLOBAL_AI_DAILY_MAX to your daily Claude budget.
//
// Enforcement depends on Upstash (Redis) being configured in production — the
// in-memory fallback is per-instance and resets on cold start, so these caps
// are only real cross-instance when Upstash env vars are present (they are in
// prod). See lib/rate-limit.ts.

const DAY = 86_400;

// Per-user daily allowances. Sized so a heavy legitimate day stays under the
// cap while a script hits the wall quickly. Approx worst-case cost per user/day
// at these limits is ~$2–3 (chat is the pricey one; generation is on Haiku).
export const AI_LIMITS = {
  // Conversations with Clara about dishes (dish-checker). Each message can be
  // up to ~3 model calls (tool rounds), so this is the priciest surface.
  claraChat: { bucket: "ai-chat-day", perUserDaily: 40 },
  // Fridge recipe generation.
  fridge: { bucket: "ai-fridge-day", perUserDaily: 15 },
  // Pantry "cook my day" full-day generation.
  cookDay: { bucket: "ai-cookday-day", perUserDaily: 3 },
  // Meal-plan (re)generation — each build may trigger one Clara top-up call.
  // Shared across POST / regenerate / start-date.
  planGen: { bucket: "ai-plangen-day", perUserDaily: 10 },
  // Clara-generated single-dish swaps. One Haiku call each; kept modest so
  // swapping doesn't eat the daily budget other features need.
  swap: { bucket: "ai-swap-day", perUserDaily: 15 },
} as const;

// Org-wide hard ceiling on total Anthropic-billed REQUESTS per rolling day.
// THIS is the number that caps a runaway bill.
//
// Budget target: ~$50/day. The priciest request is a Clara chat message
// (Sonnet 5, up to 3 model calls per message with tool rounds) ≈ $0.15–0.18
// worst case; generation requests run on Haiku ≈ $0.012 (~10× cheaper). Sizing
// against the worst case (a pure chat-spam day): $50 ÷ ~$0.17 ≈ 300 requests.
// A realistic mixed day spends far less than $50 at this ceiling because
// generation dominates the cheap end. Raise this as real usage grows; lower it
// to tighten the cap.
export const GLOBAL_AI_DAILY_MAX = 300;

export type AiGuardKind = keyof typeof AI_LIMITS;

export type AiGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Gate an Anthropic-billed request. Call BEFORE the model request.
 * Checks the per-user quota first (so an already-capped user can't also drain
 * the global bucket), then the global daily ceiling.
 */
export async function guardAiSpend(
  userId: string,
  kind: AiGuardKind
): Promise<AiGuardResult> {
  const cfg = AI_LIMITS[kind];

  // 1. Per-user daily quota.
  const user = await rateLimit(cfg.bucket, userId, cfg.perUserDaily, DAY);
  if (!user.success) {
    return {
      ok: false,
      status: 429,
      error: "You've reached today's limit for this feature — it resets tomorrow.",
    };
  }

  // 2. Global daily ceiling (single shared counter for the whole org).
  const global = await rateLimit("ai-global-day", "ALL", GLOBAL_AI_DAILY_MAX, DAY);
  if (!global.success) {
    return {
      ok: false,
      status: 429,
      error: "Clara is at capacity for today — please try again tomorrow.",
    };
  }

  return { ok: true };
}
