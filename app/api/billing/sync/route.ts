import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { syncStripeSubscription } from "@/lib/billing/sync";
import { accountHasActivePremium } from "@/lib/auth";
import { planByLookupKey } from "@/lib/billing/plans";

// POST /api/billing/sync { sessionId } — called by /billing/success right after
// Stripe redirects back, so entitlement lands before the user sees the page
// (the webhook may still be seconds away). The session must belong to the
// caller's account; anything else is a 403.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" && /^cs_/.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.accountId !== account.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  if (!subscriptionId) return NextResponse.json({ error: "Session has no subscription yet" }, { status: 409 });

  await syncStripeSubscription(account.id, subscriptionId);

  const subs = await prisma.subscription.findMany({ where: { accountId: account.id } });
  const stripeRow = subs.find((s) => s.source === "STRIPE");
  let plan: string | null = null;
  if (stripeRow?.stripePriceId) {
    const price = await stripe().prices.retrieve(stripeRow.stripePriceId);
    plan = price.lookup_key ? (planByLookupKey(price.lookup_key)?.key ?? null) : null;
  }
  return NextResponse.json({ isPremium: accountHasActivePremium(subs), plan });
}
