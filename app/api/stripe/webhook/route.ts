import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe as getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = session.metadata?.accountId;
        const subscriptionId = session.subscription as string;

        if (accountId && subscriptionId) {
          const stripeSubscription =
            await stripeClient.subscriptions.retrieve(subscriptionId);

          await prisma.subscription.update({
            where: { accountId },
            data: {
              stripeSubscriptionId: subscriptionId,
              stripePriceId: stripeSubscription.items.data[0]?.price.id,
              stripeCurrentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
              plan: "PREMIUM",
              status: stripeSubscription.status === "trialing"
                ? "TRIALING"
                : "ACTIVE",
              trialEndsAt: stripeSubscription.trial_end
                ? new Date(stripeSubscription.trial_end * 1000)
                : null,
            },
          });
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
            await prisma.subscription.update({
              where: { accountId },
              data: {
                status: stripeSubscription.status === "trialing" ? "TRIALING" : "ACTIVE",
                stripeCurrentPeriodEnd: new Date(
                  stripeSubscription.current_period_end * 1000
                ),
              },
            });
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
            await prisma.subscription.update({
              where: { accountId },
              data: { status: "PAST_DUE" },
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = subscription.metadata?.accountId;

        if (accountId) {
          await prisma.subscription.update({
            where: { accountId },
            data: {
              plan: "FREE",
              status: "CANCELED",
              canceledAt: new Date(),
              stripeSubscriptionId: null,
              stripePriceId: null,
            },
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = subscription.metadata?.accountId;

        if (accountId) {
          await prisma.subscription.update({
            where: { accountId },
            data: {
              status: subscription.status === "active"
                ? "ACTIVE"
                : subscription.status === "trialing"
                ? "TRIALING"
                : subscription.status === "past_due"
                ? "PAST_DUE"
                : subscription.status === "canceled"
                ? "CANCELED"
                : "INCOMPLETE",
              stripeCurrentPeriodEnd: new Date(
                subscription.current_period_end * 1000
              ),
            },
          });
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[webhook] processing error", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
