import Stripe from "stripe";
import type { Plan } from "@/lib/billing/plans";
import type { PromoCoupon } from "@/lib/billing/promo";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2024-04-10", typescript: true });
}

// Honest Stripe→DB status mapping, shared by every webhook handler. The old
// inline mappings collapsed unpaid/paused/incomplete_expired into INCOMPLETE
// — which hasActivePremium counts as premium (fresh-checkout grace) — so a
// sub whose payments stopped kept premium indefinitely. Unknown/future
// statuses fail SAFE to CANCELED: losing entitlement wrongly is recoverable,
// granting it wrongly is free premium.
export function mapStripeStatus(
  stripeStatus: string
): "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
    case "paused":
      return "PAST_DUE";
    case "incomplete":
      return "INCOMPLETE";
    case "canceled":
    case "incomplete_expired":
    default:
      return "CANCELED";
  }
}

/** Resolve a price by lookup_key (set in Stripe dashboard) */
export async function getPriceByLookupKey(lookupKey: string): Promise<string> {
  const prices = await getStripe().prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`No Stripe price found for lookup_key: "${lookupKey}"`);
  return price.id;
}

export async function createStripeCustomer(email: string, name: string) {
  return getStripe().customers.create({ email, name });
}

export async function createCheckoutSession({
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  accountId,
}: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  accountId: string;
}) {
  return getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { accountId },
    },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: { accountId },
  });
}

export async function createCustomerPortalSession(customerId: string, returnUrl: string) {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export function stripe() {
  return getStripe();
}

// ─── Billing v2 ──────────────────────────────────────────────────────────────

export class PriceDriftError extends Error {
  constructor(plan: Plan, detail: string) {
    super(`Stripe price for ${plan.lookupKey} does not match the catalog: ${detail}`);
    this.name = "PriceDriftError";
  }
}

type PriceLike = {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
};

async function listPriceByLookupKey(lookupKey: string): Promise<PriceLike | null> {
  const prices = await getStripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return (prices.data[0] as PriceLike | undefined) ?? null;
}

/**
 * Resolve a catalog plan to its Stripe price id, verifying amount, currency
 * and billing interval. Fails CLOSED: a dashboard edit that changes the price
 * blocks checkout with a clear error instead of charging a number the UI
 * never showed.
 */
export async function resolvePlanPrice(
  plan: Plan,
  listPrices: (lookupKey: string) => Promise<PriceLike | null> = listPriceByLookupKey
): Promise<string> {
  const price = await listPrices(plan.lookupKey);
  if (!price) throw new Error(`No Stripe price found for lookup_key: "${plan.lookupKey}"`);
  if (price.unit_amount !== plan.amountCents) throw new PriceDriftError(plan, `amount ${price.unit_amount} ≠ ${plan.amountCents}`);
  if (price.currency !== plan.currency) throw new PriceDriftError(plan, `currency ${price.currency} ≠ ${plan.currency}`);
  if (price.recurring?.interval !== plan.interval || price.recurring?.interval_count !== plan.intervalCount) {
    throw new PriceDriftError(
      plan,
      `interval ${price.recurring?.interval}×${price.recurring?.interval_count} ≠ ${plan.interval}×${plan.intervalCount}`
    );
  }
  return price.id;
}

/** Active promotion code by its customer-facing code (case-insensitive), or null. */
export async function findPromotionCode(code: string): Promise<{ id: string; coupon: PromoCoupon } | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const res = await getStripe().promotionCodes.list({ code: trimmed, active: true, limit: 1 });
  const pc = res.data[0];
  if (!pc || !pc.coupon.valid) return null;
  return {
    id: pc.id,
    coupon: {
      percentOff: pc.coupon.percent_off ?? null,
      amountOffCents: pc.coupon.amount_off ?? null,
      duration: pc.coupon.duration,
      durationInMonths: pc.coupon.duration_in_months ?? null,
      name: pc.coupon.name ?? null,
    },
  };
}

export async function createPlanCheckoutSession(args: {
  customerId: string;
  priceId: string;
  accountId: string;
  promotionCodeId?: string | null;
  successUrl: string;
  cancelUrl: string;
}) {
  // Stripe rejects allow_promotion_codes together with discounts: when the
  // user applied a code in-app we pass it as a discount; otherwise the hosted
  // page keeps its own code field as a fallback.
  const discountOrPromo = args.promotionCodeId
    ? { discounts: [{ promotion_code: args.promotionCodeId }] }
    : { allow_promotion_codes: true as const };
  return getStripe().checkout.sessions.create({
    customer: args.customerId,
    mode: "subscription",
    line_items: [{ price: args.priceId, quantity: 1 }],
    subscription_data: { metadata: { accountId: args.accountId } },
    metadata: { accountId: args.accountId },
    billing_address_collection: "auto",
    customer_update: { address: "auto" },
    success_url: `${args.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: args.cancelUrl,
    ...discountOrPromo,
  });
}

export async function getStripeSubscriptionSummary(customerId: string, subscriptionId: string) {
  const s = getStripe();
  const [sub, invoices] = await Promise.all([
    s.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] }),
    s.invoices.list({ customer: customerId, subscription: subscriptionId, limit: 5 }),
  ]);
  const pm = sub.default_payment_method;
  const card = pm && typeof pm !== "string" && pm.card ? { brand: pm.card.brand, last4: pm.card.last4 } : null;
  return {
    card,
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      created: inv.created,
      amountPaidCents: inv.amount_paid,
      status: inv.status ?? "unknown",
      pdfUrl: inv.invoice_pdf ?? null,
    })),
  };
}

export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
  await getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
}

/**
 * Upgrade (monthly → 6-month): charge the prorated difference now.
 * Downgrade (6-month → monthly): no proration, new price from the next period.
 */
export async function switchPlanPrice(subscriptionId: string, newPriceId: string, upgrade: boolean): Promise<void> {
  const s = getStripe();
  const sub = await s.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error(`Subscription ${subscriptionId} has no items`);
  await s.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: upgrade ? "always_invoice" : "none",
    billing_cycle_anchor: upgrade ? "now" : "unchanged",
    cancel_at_period_end: false,
  });
}
