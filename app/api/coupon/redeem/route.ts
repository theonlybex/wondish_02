import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { classifyCoupon, couponCapWhere, couponPremiumUpsertArgs, GENERIC_COUPON_ERROR } from "@/lib/coupon";

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
  const { success } = await rateLimit("coupon-redeem", userId, 5, 3600);
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

  // Fetch account
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Fetch coupon
  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: { redemptions: { where: { accountId: account.id } } },
  });

  // One generic outcome for not-found/inactive/expired/capped — distinct
  // copy was an enumeration aid (see lib/coupon.ts).
  if (!coupon || classifyCoupon(coupon, new Date()) === "unavailable") {
    return genericUnavailable();
  }

  if (coupon.redemptions.length > 0) {
    // The caller already knows this code is valid (they redeemed it), so a
    // distinct message leaks nothing.
    return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
  }

  // Apply the coupon in a transaction
  try {
    await prisma.$transaction(async (tx) => {
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
        // Upsert SUPER role
        const role = await tx.role.upsert({
          where: { name: "SUPER" },
          update: {},
          create: { name: "SUPER" },
        });

        // Assign to account (ignore if already assigned)
        await tx.accountRole.upsert({
          where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
          update: {},
          create: { accountId: account.id, roleId: role.id },
        });
      } else {
        // PREMIUM coupon — grant lives on the COUPON-source row; the STRIPE
        // row (and its stripeSubscriptionId cancel handle) is never touched.
        // See lib/coupon.ts couponPremiumUpsertArgs for the full rationale.
        await tx.subscription.upsert(couponPremiumUpsertArgs(account.id));
      }
    });
  } catch (err) {
    if (err instanceof CouponUnavailableError) return genericUnavailable();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrent double-redeem by the same account lost the unique race.
      return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
    }
    throw err;
  }

  const message =
    coupon.type === "ADMIN"
      ? "Admin access granted — you now have unlimited access."
      : "Premium access activated — enjoy all features!";

  return NextResponse.json({ success: true, type: coupon.type, message });
}
