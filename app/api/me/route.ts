import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { AccountClaimConflictError, getOrCreateAccount } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { serializeMe } from "@/lib/me";
import { cancelStripeAtPeriodEnd, StripeCancelError } from "@/lib/stripe-admin";
import { prisma } from "@/lib/db";

// Shared 409 response for the "email already belongs to another Wondish
// account" outcome from getOrCreateAccount — never a 500 (see
// AccountClaimConflictError / resolveAccountClaim's "conflict" branch).
function emailConflictResponse() {
  return NextResponse.json(
    {
      error: "email_conflict",
      message: "This email is already associated with another Wondish account. Contact support.",
    },
    { status: 409 }
  );
}

// GET/DELETE /api/me — the identity + subscription surface for the iOS
// (Bearer-token) client. No existing route returns this shape: GET
// /api/patient/profile omits subscription/onboardingComplete/photoUrl and
// ships a heavy refData catalog; GET /api/stripe/checkout 404s for
// coupon/admin premium.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("me", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let account;
  try {
    account = await getOrCreateAccount(userId); // include: { subscriptions: true }
  } catch (err) {
    if (err instanceof AccountClaimConflictError) return emailConflictResponse();
    throw err;
  }
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  return NextResponse.json(serializeMe(account, patient));
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("me-delete", userId, 10, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let account;
  try {
    account = await getOrCreateAccount(userId);
  } catch (err) {
    if (err instanceof AccountClaimConflictError) return emailConflictResponse();
    throw err;
  }
  const active = account.subscriptions?.filter((s) => s.status !== "CANCELED") ?? [];

  // D12: never delete over live Apple billing the server can't cancel — the
  // client must send the user to the App Store's Manage Subscriptions sheet
  // and get an explicit second confirmation before a forced delete.
  if (active.some((s) => s.source === "APPLE")) {
    return NextResponse.json(
      {
        error: "apple_subscription_active",
        message: "Cancel your subscription in the App Store before deleting your account.",
      },
      { status: 409 }
    );
  }
  // D12: cancel live Stripe/coupon billing at period end BEFORE deletion —
  // and abort if it fails: deletion would cascade away the only copy of
  // stripeSubscriptionId, leaving the user billed forever (audit Task 11).
  try {
    for (const s of active.filter((s) => s.source === "STRIPE" || s.source === "COUPON")) {
      await cancelStripeAtPeriodEnd(s);
    }
  } catch (err) {
    if (err instanceof StripeCancelError) {
      return NextResponse.json(
        {
          error: "billing_cancel_failed",
          message:
            "We couldn't cancel your subscription with our billing provider. Please try again in a few minutes.",
        },
        { status: 502 }
      );
    }
    throw err;
  }

  // D5.1.1(v): delete the Clerk identity FIRST so a failure partway through
  // can't leave a re-createable zombie (an Account row with no Clerk user
  // that getOrCreateAccount would silently resurrect on next sign-in).
  const client = await clerkClient();
  await client.users.deleteUser(userId);
  // Cascades to Subscription/Patient/AccountRole/CouponRedemption via onDelete: Cascade.
  await prisma.account.deleteMany({ where: { clerkId: userId } });
  return NextResponse.json({ ok: true });
}
