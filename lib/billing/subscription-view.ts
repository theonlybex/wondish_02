import { hasActivePremium } from "@/lib/auth";
import { formatCents, planByKey, type PlanKey } from "./plans";

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
  invoices: { id: string; created: number; amountPaidCents: number; status: string; pdfUrl: string | null }[];
} | null;

export function priceLabelFor(plan: PlanKey): string {
  const p = planByKey(plan)!;
  return `${formatCents(p.amountCents)} / ${p.months === 1 ? "month" : `${p.months} months`}`;
}

export function buildSubscriptionView(
  row: Row | null,
  summary: Summary,
  priceToPlan: (priceId: string | null) => PlanKey | null
): SubscriptionView {
  if (!row) {
    return { isPremium: false, source: null, plan: null, priceLabel: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canSwitchTo: null, card: null, invoices: [] };
  }
  const isStripe = row.source === "STRIPE";
  const plan = isStripe ? priceToPlan(row.stripePriceId) : null;
  return {
    isPremium: hasActivePremium(row),
    source: row.source,
    plan,
    priceLabel: plan ? priceLabelFor(plan) : null,
    status: row.status,
    periodEnd: row.stripeCurrentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canSwitchTo: plan === "monthly" ? "sixmonth" : plan === "sixmonth" ? "monthly" : null,
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
