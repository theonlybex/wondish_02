import { stripe } from "@/lib/stripe";

// Raised when the billing provider rejects/fails the cancel — callers must
// abort account deletion (2026-07-24 audit Task 11): proceeding cascades
// away the only copy of stripeSubscriptionId, leaving the user billed
// indefinitely with no server-side handle to reconcile.
export class StripeCancelError extends Error {
  constructor(subscriptionId: string, cause: unknown) {
    super(`Failed to cancel Stripe subscription ${subscriptionId} at period end`);
    this.name = "StripeCancelError";
    this.cause = cause;
  }
}

// Cancel a live Stripe/coupon-backed subscription at period end before
// account deletion (D12). NOT best-effort: a failure throws
// StripeCancelError so the route can 502 and keep the account (and the sub
// id) intact for a retry. `cancelFn` is injectable for tests.
export async function cancelStripeAtPeriodEnd(
  sub: { stripeSubscriptionId?: string | null },
  cancelFn: (subscriptionId: string) => Promise<unknown> = (id) =>
    stripe().subscriptions.update(id, { cancel_at_period_end: true })
): Promise<void> {
  if (!sub.stripeSubscriptionId) return;
  try {
    await cancelFn(sub.stripeSubscriptionId);
  } catch (err) {
    console.error("[stripe-admin] failed to cancel subscription at period end", err);
    throw new StripeCancelError(sub.stripeSubscriptionId, err);
  }
}
