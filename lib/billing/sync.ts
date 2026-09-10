// The single Stripe → Subscription-row writer. Every caller (webhook, the
// post-checkout success page, the billing panel) re-retrieves the
// subscription through the pinned SDK and passes it here, so no code path
// depends on the field layout of a webhook event payload — which follows the
// dashboard's API version, not ours (2024-04-10).
import { prisma } from "@/lib/db";
import { stripe, mapStripeStatus } from "@/lib/stripe";

export interface StripeSubLike {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  trial_end: number | null;
  metadata: { accountId?: string };
  items: { data: { price: { id: string } }[] };
}

export function subscriptionRowFromStripe(sub: StripeSubLike) {
  const status = mapStripeStatus(sub.status);
  const gone = status === "CANCELED";
  return {
    stripeSubscriptionId: sub.id,
    stripePriceId: sub.items.data[0]?.price.id ?? null,
    stripeCurrentPeriodEnd: new Date(sub.current_period_end * 1000),
    plan: gone ? ("FREE" as const) : ("PREMIUM" as const),
    status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    canceledAt: gone ? new Date() : null,
  };
}

interface SyncDeps {
  retrieve: (id: string) => Promise<StripeSubLike>;
  updateMany: (args: {
    where: { accountId: string; source: "STRIPE" };
    data: ReturnType<typeof subscriptionRowFromStripe>;
  }) => Promise<{ count: number }>;
}

const defaultDeps: SyncDeps = {
  retrieve: (id) => stripe().subscriptions.retrieve(id) as unknown as Promise<StripeSubLike>,
  updateMany: (args) => prisma.subscription.updateMany(args),
};

/**
 * Re-read the subscription from Stripe and write the (accountId, STRIPE) row.
 * `count === 0` means the row is gone (account deleted) — callers treat it as
 * a tolerated no-op, never an error, so Stripe retries don't loop for days.
 */
export async function syncStripeSubscription(
  accountId: string,
  stripeSubscriptionId: string,
  deps: SyncDeps = defaultDeps
): Promise<{ count: number }> {
  const sub = await deps.retrieve(stripeSubscriptionId);
  // Defense: a session/subscription id must belong to the account we were
  // told about. Stripe stamps accountId into subscription metadata at
  // checkout (lib/stripe.ts createPlanCheckoutSession).
  if (sub.metadata?.accountId && sub.metadata.accountId !== accountId) {
    throw new Error(
      `[billing/sync] account mismatch: subscription ${sub.id} belongs to ${sub.metadata.accountId}, not ${accountId}`
    );
  }
  return deps.updateMany({ where: { accountId, source: "STRIPE" }, data: subscriptionRowFromStripe(sub) });
}
