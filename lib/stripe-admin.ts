import { stripe } from "@/lib/stripe";

// Thin wrapper over the existing Stripe client for account-deletion (D12):
// cancel a live Stripe/coupon-backed subscription at period end rather than
// deleting the account out from under active billing. Best-effort — a
// billing-provider hiccup should never block the user from deleting their
// account; we log and move on rather than throwing.
export async function cancelStripeAtPeriodEnd(sub: {
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  if (!sub.stripeSubscriptionId) return;
  try {
    await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    console.error("[stripe-admin] failed to cancel subscription at period end", err);
  }
}
