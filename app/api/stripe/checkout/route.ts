import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createStripeCustomer, createCheckoutSession, createCustomerPortalSession } from "@/lib/stripe";

const LOOKUP_KEY = process.env.STRIPE_PRICE_LOOKUP_KEY ?? "premium_monthly";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const account = await prisma.account.findUnique({
      where: { clerkId: userId },
      include: { subscription: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    let customerId = account.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await createStripeCustomer(account.email, `${account.firstName} ${account.lastName}`);
      customerId = customer.id;
      await prisma.subscription.update({ where: { accountId: account.id }, data: { stripeCustomerId: customerId } });
    }

    const checkoutSession = await createCheckoutSession({
      customerId,
      lookupKey: LOOKUP_KEY,
      successUrl: `${appUrl}/taste`,
      cancelUrl: `${appUrl}/pricing`,
      accountId: account.id,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const account = await prisma.account.findUnique({ where: { clerkId: userId }, include: { subscription: true } });
    if (!account?.subscription?.stripeCustomerId) return NextResponse.json({ error: "No billing account found." }, { status: 404 });

    const portalSession = await createCustomerPortalSession(account.subscription.stripeCustomerId, `${appUrl}/dashboard`);
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[stripe/portal]", err);
    return NextResponse.json({ error: "Failed to open billing portal." }, { status: 500 });
  }
}
