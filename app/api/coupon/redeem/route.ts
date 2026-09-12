import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  classifyCoupon,
  couponCapWhere,
  couponPremiumUpsertArgs,
  hasPaidPremium,
  mergeGrantEnd,
  GENERIC_COUPON_ERROR,
} from "@/lib/coupon";

// Thrown when the atomic cap-enforcing increment matches no row (cap reached
// or coupon deactivated between the pre-check and the transaction).
class CouponUnavailableError extends Error {}

function genericUnavailable() {
  return NextResponse.json({ error: GENERIC_COUPON_ERROR }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Brute-force guard: ADMIN-type coupons grant the permanent SUPER role, so
  // unthrottled guessing here would be privilege escalation to full admin.
  // 10/h leaves room for a beta tester's typos; codes are ≥4 chars of a
  // 36-symbol alphabet, so the guess space is still out of reach.
  const { success } = await rateLimit("coupon-redeem", userId, 10, 3600);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawCode = (body as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ error: "Coupon code is required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: {
      id: true,
      subscriptions: {
        select: { source: true, plan: true, status: true, stripeCurrentPeriodEnd: true, cancelAtPeriodEnd: true },
      },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: { redemptions: { where: { accountId: account.id } } },
  });

  // One generic outcome for not-found/inactive/expired/capped — distinct
  // copy was an enumeration aid (see lib/coupon.ts).
  if (!coupon || classifyCoupon(coupon, new Date()) === "unavailable") {
    return genericUnavailable();
  }
  // PREMIUM codes minted before `accessUntil` existed carry no end date and
  // would grant lifetime premium. The admin validator forbids that for new
  // codes; this closes the gap for legacy rows (2026-09-12 scenario run found
  // three such codes with uses left). ADMIN codes never carry an end.
  if (coupon.type === "PREMIUM" && !coupon.accessUntil) {
    return genericUnavailable();
  }

  if (coupon.redemptions.length > 0) {
    // The caller already knows this code is valid (they redeemed it), so a
    // distinct message leaks nothing.
    return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
  }

  // A renewing Stripe/Apple subscriber gains nothing from a PREMIUM code and
  // would only burn a use; refuse before touching usedCount. (Checked after
  // the generic gate so an invalid code still reads as merely invalid. A
  // subscriber who already cancelled at period end passes — see
  // hasPaidPremium.)
  if (coupon.type === "PREMIUM" && hasPaidPremium(account.subscriptions)) {
    return NextResponse.json({ error: "You already have Premium — no code needed." }, { status: 409 });
  }

  // The access end actually written (may be later than the coupon's own
  // accessUntil when the account already holds a longer grant). ADMIN → null.
  let grantEnd: Date | null;

  try {
    grantEnd = await prisma.$transaction(async (tx): Promise<Date | null> => {
      // Record redemption first — the (couponId, accountId) unique aborts a
      // concurrent double-redeem by the same account (P2002 → 409 below).
      await tx.couponRedemption.create({
        data: { couponId: coupon.id, accountId: account.id },
      });

      // Atomic cap enforcement: predicate + increment in ONE UPDATE
      // statement, so last-slot races can't overshoot maxUses.
      const capped = await tx.coupon.updateMany({
        where: couponCapWhere(coupon),
        data: { usedCount: { increment: 1 } },
      });
      if (capped.count === 0) throw new CouponUnavailableError();

      if (coupon.type === "ADMIN") {
        const role = await tx.role.upsert({
          where: { name: "SUPER" },
          update: {},
          create: { name: "SUPER" },
        });
        await tx.accountRole.upsert({
          where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
          update: {},
          create: { accountId: account.id, roleId: role.id },
        });
        return null;
      }

      // PREMIUM: grant on the COUPON-source row until the coupon's access
      // end; a second code never shortens an active grant.
      const existing = await tx.subscription.findUnique({
        where: { accountId_source: { accountId: account.id, source: "COUPON" } },
        select: { plan: true, status: true, stripeCurrentPeriodEnd: true },
      });
      const end = mergeGrantEnd(existing, coupon.accessUntil);
      await tx.subscription.upsert(couponPremiumUpsertArgs(account.id, end));
      return end;
    });
  } catch (err) {
    if (err instanceof CouponUnavailableError) return genericUnavailable();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrent double-redeem by the same account lost the unique race.
      return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
    }
    throw err;
  }

  const accessUntil = grantEnd ? grantEnd.toISOString() : null;
  const message =
    coupon.type === "ADMIN"
      ? "Admin access granted — you now have unlimited access."
      : accessUntil
        ? `Premium activated until ${new Date(accessUntil).toLocaleDateString("en-US")}.`
        : "Premium access activated — enjoy all features!";

  return NextResponse.json({ success: true, type: coupon.type, accessUntil, message });
}
