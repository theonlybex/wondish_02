import Stripe from "stripe";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2024-04-10", typescript: true });
}

export const TRIAL_PERIOD_DAYS = 14;

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
  lookupKey,
  successUrl,
  cancelUrl,
  accountId,
}: {
  customerId: string;
  lookupKey: string;
  successUrl: string;
  cancelUrl: string;
  accountId: string;
}) {
  const priceId = await getPriceByLookupKey(lookupKey);

  return getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_PERIOD_DAYS,
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
