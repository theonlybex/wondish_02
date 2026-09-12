// Pure entitlement summary for the admin Users screen. One row per account
// can't say "premium" any more: premium may come from Stripe, Apple, a coupon
// or the ADMIN row, and the old screen read only the Stripe row (so admins
// and coupon holders showed as FREE).
import { accountHasActivePremium, primarySubscriptionRow } from "@/lib/auth";
import { hasPaidPremium } from "@/lib/coupon";

export type EntitlementSummary = {
  plan: "PREMIUM" | "FREE";
  source: "STRIPE" | "APPLE" | "COUPON" | "ADMIN" | null; // where the premium comes from
  periodEnd: string | null; // ISO; when the premium ends (null = no end)
  paid: boolean; // live Stripe/Apple subscription — the manual toggle must not touch it
};

type Row = {
  source: string;
  plan: string;
  status: string;
  stripeCurrentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

export function summarizeEntitlement(subs: Row[]): EntitlementSummary {
  const premium = accountHasActivePremium(subs);
  const primary = premium ? primarySubscriptionRow(subs) : null;
  return {
    plan: premium ? "PREMIUM" : "FREE",
    source: (primary?.source as EntitlementSummary["source"]) ?? null,
    periodEnd: primary?.stripeCurrentPeriodEnd?.toISOString() ?? null,
    paid: hasPaidPremium(subs),
  };
}

// Manual grant from the Users screen: a COUPON-source row with no end. It is
// the admin's explicit per-user action (revoked with "→ Free"), so unlike
// codes it carries no access date. Never touches the Stripe row.
export function manualGrantUpsertArgs(accountId: string) {
  return {
    where: { accountId_source: { accountId, source: "COUPON" as const } },
    update: { plan: "PREMIUM" as const, status: "ACTIVE" as const, canceledAt: null, stripeCurrentPeriodEnd: null },
    create: { accountId, source: "COUPON" as const, plan: "PREMIUM" as const, status: "ACTIVE" as const, stripeCurrentPeriodEnd: null },
  };
}

// Sort key for the list: admins, then premium, then everyone else. Stable
// within a group (the query already orders by createdAt desc).
export function userRank(u: { isAdmin: boolean; subscription: { plan: string } }): number {
  if (u.isAdmin) return 0;
  return u.subscription.plan === "PREMIUM" ? 1 : 2;
}
