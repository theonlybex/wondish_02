import { tierFor } from "@/lib/ai-budget";

// The plan pill in the dashboard header (DashboardHeader.tsx), derived from
// the same tier the spend guard enforces so the badge can never promise more
// than guardAiSpend will allow. Three user tiers plus admin:
//
//   ADMIN    SUPER role — "Admin ★"
//   PREMIUM  any live PAID row (Stripe / Apple / admin grant) — shown as "Plus"
//   BETA     a coupon grant is the ONLY live entitlement — "Beta → Plus"
//   FREE     nothing live — "Free → Upgrade"
//
// Naming gap, on purpose: the code says PREMIUM (Prisma enum, AiTier, bucket
// keys) while every string a user reads says "Plus" — the paid product is
// "Wondish Plus" / "Wondish Chef". Renaming the internals would need a DB
// migration and a Stripe lookup_key transfer for no user-visible gain.
//
// Server-only: lib/ai-budget pulls in the rate limiter and Prisma. Client
// components receive the resulting string, never this import.
export type PlanBadge = "ADMIN" | "PREMIUM" | "BETA" | "FREE";

export function planBadgeFor(
  subs: Array<{ source?: string; plan: string; status: string; stripeCurrentPeriodEnd?: Date | null } | null | undefined>,
  isAdmin: boolean
): PlanBadge {
  if (isAdmin) return "ADMIN";
  const tier = tierFor(subs, false);
  if (tier === "premium") return "PREMIUM";
  if (tier === "beta") return "BETA";
  return "FREE";
}
