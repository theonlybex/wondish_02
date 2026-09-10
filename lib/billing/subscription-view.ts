import { hasActivePremium } from "@/lib/auth";
import { formatCents, priceLabelFor, type PlanKey } from "./plans";

// Server-only module (lib/auth pulls in Clerk's server entry). Client
// components import the SubscriptionView TYPE from here and priceLabelFor
// from ./plans.
export { priceLabelFor };

// What the billing panel renders. Pure: built from the Subscription row plus
// an optional Stripe summary (card + invoices). Never carries Stripe ids.
export interface SubscriptionView {
  isPremium: boolean;
  source: "STRIPE" | "APPLE" | "COUPON" | "ADMIN" | null;
  plan: PlanKey | null;
  priceLabel: string | null;
  status: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canSwitchTo: PlanKey | null;
  // A scheduled downgrade: the plan that takes over at periodEnd.
  pendingPlan: PlanKey | null;
  card: { brand: string; last4: string } | null;
  invoices: { id: string; date: string; amount: string; status: string; pdfUrl: string | null }[];
}

type Row = {
  source: "STRIPE" | "APPLE" | "COUPON" | "ADMIN";
  plan: string;
  status: string;
  stripePriceId: string | null;
  stripeCurrentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

type Summary = {
  card: { brand: string; last4: string } | null;
  pendingPriceId?: string | null;
  invoices: { id: string; created: number; amountPaidCents: number; status: string; pdfUrl: string | null }[];
} | null;

export function buildSubscriptionView(
  row: Row | null,
  summary: Summary,
  priceToPlan: (priceId: string | null) => PlanKey | null
): SubscriptionView {
  if (!row) {
    return { isPremium: false, source: null, plan: null, priceLabel: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canSwitchTo: null, pendingPlan: null, card: null, invoices: [] };
  }
  const isStripe = row.source === "STRIPE";
  const plan = isStripe ? priceToPlan(row.stripePriceId) : null;
  const pendingPlan = isStripe ? priceToPlan(summary?.pendingPriceId ?? null) : null;
  return {
    isPremium: hasActivePremium(row),
    source: row.source,
    plan,
    priceLabel: plan ? priceLabelFor(plan) : null,
    status: row.status,
    periodEnd: row.stripeCurrentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canSwitchTo: plan === "monthly" ? "sixmonth" : plan === "sixmonth" ? "monthly" : null,
    pendingPlan: pendingPlan && pendingPlan !== plan ? pendingPlan : null,
    card: isStripe ? (summary?.card ?? null) : null,
    invoices: isStripe
      ? (summary?.invoices ?? []).map((i) => ({
          id: i.id,
          date: new Date(i.created * 1000).toISOString(),
          amount: formatCents(i.amountPaidCents),
          status: i.status,
          pdfUrl: i.pdfUrl,
        }))
      : [],
  };
}
