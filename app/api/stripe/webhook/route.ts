import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe as getStripe } from "@/lib/stripe";
import { syncStripeSubscription } from "@/lib/billing/sync";
import { redis } from "@/lib/redis";
import * as Sentry from "@sentry/nextjs";
import { handleStripeEvent, type EventLike } from "./handlers";

export const runtime = "nodejs";

// Every event reduces to (accountId, subscriptionId) in ./handlers and is
// written by syncStripeSubscription, which re-retrieves the subscription
// through the pinned SDK (2024-04-10). A missing row is a tolerated no-op
// (count 0), never a 500 — a 500 would release the idempotency claim and
// make Stripe retry the same failure for days.

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const stripeClient = getStripe();
  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency: claim this event id so Stripe retries don't double-process.
  // Claim before handling; release on failure so a retry can re-run.
  const idempKey = `stripe:evt:${event.id}`;
  if (redis) {
    const claimed = await redis.set(idempKey, "1", { nx: true, ex: 60 * 60 * 24 });
    if (claimed === null) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    const outcome = await handleStripeEvent(event as unknown as EventLike, {
      sync: (accountId, subscriptionId) => syncStripeSubscription(accountId, subscriptionId),
      retrieveInvoiceSubscription: async (invoiceId) => {
        // Retrieve through the pinned SDK so `subscription` is where 2024-04-10 puts it.
        const inv = await stripeClient.invoices.retrieve(invoiceId, { expand: ["subscription"] });
        const sub = inv.subscription;
        if (typeof sub === "string") {
          const full = await stripeClient.subscriptions.retrieve(sub);
          return { subscriptionId: full.id, accountId: full.metadata?.accountId ?? null };
        }
        if (!sub) return { subscriptionId: null, accountId: null };
        return { subscriptionId: sub.id, accountId: sub.metadata?.accountId ?? null };
      },
    });
    if (outcome === "skipped") console.warn(`[webhook] ${event.type} ${event.id}: no account/subscription — skipped`);
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "stripe-webhook", eventType: event.type } });
    console.error("[webhook] processing error", err);
    // Release the idempotency claim so Stripe's retry can re-process this event.
    if (redis) await redis.del(idempKey).catch(() => {});
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
