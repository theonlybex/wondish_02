import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const code = (body.code as string)?.trim().toUpperCase();
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

  if (!coupon || !coupon.isActive) {
    return NextResponse.json({ error: "Invalid or inactive coupon code" }, { status: 400 });
  }

  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return NextResponse.json({ error: "This coupon has expired" }, { status: 400 });
  }

  if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) {
    return NextResponse.json({ error: "This coupon has reached its usage limit" }, { status: 400 });
  }

  if (coupon.redemptions.length > 0) {
    return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 400 });
  }

  // Apply the coupon in a transaction
  await prisma.$transaction(async (tx) => {
    // Record redemption
    await tx.couponRedemption.create({
      data: { couponId: coupon.id, accountId: account.id },
    });

    // Increment usedCount
    await tx.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });

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
      // PREMIUM coupon — upsert subscription
      await tx.subscription.upsert({
        where: { accountId: account.id },
        update: {
          plan: "PREMIUM",
          status: "ACTIVE",
          stripeSubscriptionId: null,
          stripeCurrentPeriodEnd: null,
          canceledAt: null,
        },
        create: {
          accountId: account.id,
          plan: "PREMIUM",
          status: "ACTIVE",
        },
      });
    }
  });

  const message =
    coupon.type === "ADMIN"
      ? "Admin access granted — you now have unlimited access."
      : "Premium access activated — enjoy all features!";

  return NextResponse.json({ success: true, type: coupon.type, message });
}
