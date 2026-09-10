import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { planByKey, planByLookupKey } from "@/lib/billing/plans";
import { loadSubscriptionView } from "@/lib/billing/load-view";
import { syncStripeSubscription } from "@/lib/billing/sync";
import { releasePendingSwitch, resolvePlanPrice, setCancelAtPeriodEnd, stripe, switchPlanPrice } from "@/lib/stripe";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const loaded = await loadSubscriptionView(userId);
  if (!loaded) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(loaded.view);
}

// PATCH { action: "cancel" | "resume" | "switch" | "keep", plan? } — the app owns plan
// changes and cancellation (the Customer Portal only handles card + invoices),
// so the DB row is re-synced right after every change.
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("billing-change", userId, 10, 3600);
  if (!success) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; plan?: unknown } | null;
  const action = body?.action;
  const loaded = await loadSubscriptionView(userId);
  if (!loaded) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const { account, row } = loaded;
  if (!row || row.source !== "STRIPE" || !row.stripeSubscriptionId) {
    return NextResponse.json({ error: "No Stripe subscription to change." }, { status: 409 });
  }

  if (action === "cancel" || action === "resume") {
    await setCancelAtPeriodEnd(row.stripeSubscriptionId, action === "cancel");
  } else if (action === "keep") {
    // Drop a scheduled downgrade; stay on the current plan.
    await releasePendingSwitch(row.stripeSubscriptionId);
  } else if (action === "switch") {
    const target = typeof body?.plan === "string" ? planByKey(body.plan) : null;
    if (!target) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    const currentPrice = row.stripePriceId ? await stripe().prices.retrieve(row.stripePriceId) : null;
    const current = currentPrice?.lookup_key ? planByLookupKey(currentPrice.lookup_key) : null;
    if (current?.key === target.key) return NextResponse.json({ error: "Already on that plan." }, { status: 409 });
    const upgrade = target.months > (current?.months ?? 1);
    await switchPlanPrice(row.stripeSubscriptionId, await resolvePlanPrice(target), upgrade);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await syncStripeSubscription(account.id, row.stripeSubscriptionId);
  const fresh = await loadSubscriptionView(userId);
  return NextResponse.json(fresh!.view);
}
