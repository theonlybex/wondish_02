import { prisma } from "@/lib/db";
import { hasActivePremium } from "@/lib/auth";
import { planByKey, type PlanKey } from "./plans";
import { buildSubscriptionView } from "./subscription-view";
import { getStripeSubscriptionSummary, resolvePlanPrice } from "@/lib/stripe";

// Shared by GET/PATCH /api/billing/subscription and the /membership page:
// account + the row that best describes billing state + the client view.

async function priceToPlanResolver(): Promise<(priceId: string | null) => PlanKey | null> {
  // Two lookups per request at most; the catalog is two prices.
  const cache = new Map<string, PlanKey | null>();
  const ids = await Promise.all(
    [planByKey("monthly")!, planByKey("sixmonth")!].map((p) => resolvePlanPrice(p).catch(() => null))
  );
  if (ids[0]) cache.set(ids[0], "monthly");
  if (ids[1]) cache.set(ids[1], "sixmonth");
  return (priceId) => (priceId ? (cache.get(priceId) ?? null) : null);
}

export async function loadSubscriptionView(clerkId: string) {
  const account = await prisma.account.findUnique({ where: { clerkId }, include: { subscriptions: true } });
  if (!account) return null;
  const rows = account.subscriptions;
  // Prefer the row that currently grants premium; otherwise the Stripe row
  // (so PAST_DUE / cancelled state still shows), otherwise anything.
  const row = rows.find(hasActivePremium) ?? rows.find((s) => s.source === "STRIPE") ?? rows[0] ?? null;
  const summary =
    row?.source === "STRIPE" && row.stripeCustomerId && row.stripeSubscriptionId
      ? await getStripeSubscriptionSummary(row.stripeCustomerId, row.stripeSubscriptionId).catch(() => null)
      : null;
  return { account, row, view: buildSubscriptionView(row, summary, await priceToPlanResolver()) };
}
