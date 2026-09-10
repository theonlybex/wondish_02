import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createCustomerPortalSession } from "@/lib/stripe";

// GET /api/billing/portal — Stripe Customer Portal for card + invoice history.
// Plan changes and cancellation are handled in-app (PATCH /api/billing/subscription).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const account = await prisma.account.findUnique({ where: { clerkId: userId }, include: { subscriptions: true } });
  const customerId = account?.subscriptions.find((s) => s.source === "STRIPE")?.stripeCustomerId;
  if (!customerId) return NextResponse.json({ error: "No billing account found." }, { status: 404 });
  try {
    const portal = await createCustomerPortalSession(customerId, `${appUrl}/membership`);
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error("[billing/portal]", err);
    return NextResponse.json({ error: "Failed to open billing portal." }, { status: 500 });
  }
}
