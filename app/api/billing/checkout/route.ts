import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccountClaimConflictError, getOrCreateAccount, hasActivePremium } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { planByKey } from "@/lib/billing/plans";
import {
  createStripeCustomer,
  createPlanCheckoutSession,
  createCustomerPortalSession,
  findPromotionCode,
  resolvePlanPrice,
  PriceDriftError,
} from "@/lib/stripe";

// POST /api/billing/checkout { plan, promoCode? } → { url } or, for a customer
// who already has a live Stripe subscription, { alreadySubscribed, portalUrl }
// — a second Checkout would create a second subscription (double billing).
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("billing-checkout", userId, 10, 3600);
  if (!success) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { plan?: unknown; promoCode?: unknown } | null;
  const plan = typeof body?.plan === "string" ? planByKey(body.plan) : null;
  if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : "";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const account = await getOrCreateAccount(userId);
    const stripeRow = account.subscriptions.find((s) => s.source === "STRIPE") ?? null;

    if (stripeRow?.stripeSubscriptionId && stripeRow.stripeCustomerId && hasActivePremium(stripeRow)) {
      const portal = await createCustomerPortalSession(stripeRow.stripeCustomerId, `${appUrl}/membership`);
      return NextResponse.json({ alreadySubscribed: true, portalUrl: portal.url });
    }

    let customerId = stripeRow?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await createStripeCustomer(account.email, `${account.firstName} ${account.lastName}`);
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { accountId_source: { accountId: account.id, source: "STRIPE" } },
        update: { stripeCustomerId: customerId },
        create: { accountId: account.id, source: "STRIPE", stripeCustomerId: customerId },
      });
    }

    const promo = promoCode ? await findPromotionCode(promoCode) : null;
    if (promoCode && !promo) {
      return NextResponse.json({ error: "invalid_promo", message: "That promo code isn't valid." }, { status: 400 });
    }

    const priceId = await resolvePlanPrice(plan);
    const session = await createPlanCheckoutSession({
      customerId,
      priceId,
      accountId: account.id,
      promotionCodeId: promo?.id ?? null,
      successUrl: `${appUrl}/billing/success`,
      cancelUrl: `${appUrl}/pricing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof AccountClaimConflictError) {
      return NextResponse.json(
        { error: "email_conflict", message: "This email is already associated with another Wondish account. Contact support." },
        { status: 409 }
      );
    }
    if (err instanceof PriceDriftError) {
      console.error("[billing/checkout] price drift", err.message);
      return NextResponse.json({ error: "Checkout is temporarily unavailable. Please try again later." }, { status: 503 });
    }
    console.error("[billing/checkout]", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}
