import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { stripe as getStripe, mapStripeStatus } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

// All handlers write via updateMany: a bare update throws P2025 when the row
// is gone (account deleted while the Stripe sub was live) → 500 → the
// idempotency claim is released → Stripe retries the same failure for days.
// A missing row is a tolerated no-op, logged once per event.
async function updateStripeRow(
  accountId: string,
  data: Prisma.SubscriptionUpdateManyMutationInput,
  eventType: string
) {
  const { count } = await prisma.subscription.updateMany({
    where: { accountId, source: "STRIPE" },
    data,
  });
  if (count === 0) {
    console.warn(`[webhook] no STRIPE subscription row for account ${accountId} (${eventType}) — skipped`);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const stripeClient = getStripe();
  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
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
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = session.metadata?.accountId;
        const subscriptionId = session.subscription as string;

        if (accountId && subscriptionId) {
          const stripeSubscription =
            await stripeClient.subscriptions.retrieve(subscriptionId);

          // Honest status: a session can complete with the subscription in
          // incomplete/past_due (async payment failure) — mapping everything
          // non-trialing to ACTIVE granted free premium until the next event.
          await updateStripeRow(accountId, {
            stripeSubscriptionId: subscriptionId,
            stripePriceId: stripeSubscription.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: new Date(
              stripeSubscription.current_period_end * 1000
            ),
            plan: "PREMIUM",
            status: mapStripeStatus(stripeSubscription.status),
            trialEndsAt: stripeSubscription.trial_end
              ? new Date(stripeSubscription.trial_end * 1000)
              : null,
          }, event.type);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        if (subscriptionId) {
          const stripeSubscription =
            await stripeClient.subscriptions.retrieve(subscriptionId);
          const accountId = stripeSubscription.metadata?.accountId;

          if (accountId) {
            await updateStripeRow(accountId, {
              status: mapStripeStatus(stripeSubscription.status),
              stripeCurrentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
            }, event.type);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        if (subscriptionId) {
          const stripeSubscription =
            await stripeClient.subscriptions.retrieve(subscriptionId);
          const accountId = stripeSubscription.metadata?.accountId;

          if (accountId) {
            await updateStripeRow(accountId, { status: "PAST_DUE" }, event.type);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = subscription.metadata?.accountId;

        if (accountId) {
          await updateStripeRow(accountId, {
            plan: "FREE",
            status: "CANCELED",
            canceledAt: new Date(),
            stripeSubscriptionId: null,
            stripePriceId: null,
          }, event.type);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = subscription.metadata?.accountId;

        if (accountId) {
          await updateStripeRow(accountId, {
            status: mapStripeStatus(subscription.status),
            stripeCurrentPeriodEnd: new Date(
              subscription.current_period_end * 1000
            ),
          }, event.type);
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "stripe-webhook", eventType: event.type } });
    console.error("[webhook] processing error", err);
    // Release the idempotency claim so Stripe's retry can re-process this event.
    if (redis) await redis.del(idempKey).catch(() => {});
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
