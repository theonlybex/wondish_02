import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createStripeCustomer,
  createCheckoutSession,
  createCustomerPortalSession,
} from "@/lib/stripe";

const LOOKUP_KEY = process.env.STRIPE_PRICE_LOOKUP_KEY ?? "premium_monthly";

// POST — create a checkout session (upgrade existing account to Premium)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const account = await prisma.account.findUnique({
      where: { id: session.user.id },
      include: { subscription: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    let customerId = account.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await createStripeCustomer(
        account.email,
        `${account.firstName} ${account.lastName}`
      );
      customerId = customer.id;
      await prisma.subscription.update({
        where: { accountId: account.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const checkoutSession = await createCheckoutSession({
      customerId,
      lookupKey: LOOKUP_KEY,
      successUrl: `${appUrl}/dashboard`,
      cancelUrl: `${appUrl}/pricing`,
      accountId: account.id,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}

// GET — open customer billing portal
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { accountId: session.user.id },
    });
    if (!subscription?.stripeCustomerId) {
      return NextResponse.json({ error: "No billing account found." }, { status: 404 });
    }

    const portalSession = await createCustomerPortalSession(
      subscription.stripeCustomerId,
      `${appUrl}/dashboard`
    );

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[stripe/portal]", err);
    return NextResponse.json({ error: "Failed to open billing portal." }, { status: 500 });
  }
}
