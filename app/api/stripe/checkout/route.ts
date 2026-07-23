import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createStripeCustomer, createCheckoutSession, createCustomerPortalSession, getPriceByLookupKey } from "@/lib/stripe";

async function resolvePriceId(): Promise<string> {
  const directId = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (directId) return directId;
  const lookupKey = process.env.STRIPE_PRICE_LOOKUP_KEY ?? "premium_monthly";
  return getPriceByLookupKey(lookupKey);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    let account = await prisma.account.findUnique({
      where: { clerkId: userId },
      include: { subscriptions: true },
    });

    if (!account) {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      const firstName = clerkUser.firstName ?? "";
      const lastName = clerkUser.lastName ?? "";

      // Account may exist under a different auth path — link Clerk ID rather than creating a duplicate
      const existing = await prisma.account.findUnique({ where: { email } });
      if (existing) {
        account = await prisma.account.update({
          where: { email },
          data: { clerkId: userId },
          include: { subscriptions: true },
        });
      } else {
        account = await prisma.account.create({
          data: {
            clerkId: userId,
            email,
            firstName,
            lastName,
            subscriptions: { create: {} },
          },
          include: { subscriptions: true },
        });
      }
    }

    // Stripe checkout always reads/writes the (accountId, STRIPE) row.
    let customerId = account.subscriptions.find((s) => s.source === "STRIPE")?.stripeCustomerId;
    if (!customerId) {
      const customer = await createStripeCustomer(account.email, `${account.firstName} ${account.lastName}`);
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { accountId_source: { accountId: account.id, source: "STRIPE" } },
        update: { stripeCustomerId: customerId },
        create: { accountId: account.id, source: "STRIPE", stripeCustomerId: customerId },
      });
    }

    const priceId = await resolvePriceId();
    const checkoutSession = await createCheckoutSession({
      customerId,
      priceId,
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
    const account = await prisma.account.findUnique({ where: { clerkId: userId }, include: { subscriptions: true } });
    const stripeSub = account?.subscriptions.find((s) => s.source === "STRIPE");
    if (!stripeSub?.stripeCustomerId) return NextResponse.json({ error: "No billing account found." }, { status: 404 });

    const portalSession = await createCustomerPortalSession(stripeSub.stripeCustomerId, `${appUrl}/dashboard`);
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[stripe/portal]", err);
    return NextResponse.json({ error: "Failed to open billing portal." }, { status: 500 });
  }
}
