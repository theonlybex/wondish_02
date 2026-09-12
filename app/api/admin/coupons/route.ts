import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extendGrantsWhere } from "@/lib/coupon";
import { parseDeadline, validateCouponInput } from "@/lib/coupon-admin";

async function assertAdmin(userId: string) {
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  return { account, isAdmin };
}

// GET /api/admin/coupons — every code, newest first, with who redeemed it.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { redemptions: true } },
      redemptions: {
        orderBy: { redeemedAt: "desc" },
        take: 100,
        select: { redeemedAt: true, account: { select: { email: true } } },
      },
    },
  });

  return NextResponse.json(coupons);
}

// POST /api/admin/coupons — create a code. PREMIUM codes grant Premium on the
// COUPON-source Subscription row until `accessUntil`; ADMIN codes grant the
// SUPER role. Shape rules live in lib/coupon-admin.ts.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = validateCouponInput(await req.json().catch(() => null), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const existing = await prisma.coupon.findUnique({ where: { code: v.code } });
  if (existing) {
    return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
  }

  const coupon = await prisma.coupon.create({
    data: {
      code: v.code,
      type: v.type,
      maxUses: v.maxUses,
      expiresAt: v.expiresAt,
      accessUntil: v.accessUntil,
      note: v.note,
      isActive: true,
    },
  });

  return NextResponse.json(coupon, { status: 201 });
}

// PATCH /api/admin/coupons
//   { id, isActive }    — toggle new redemptions (never touches granted access)
//   { id, accessUntil } — "Extend access": move the code's date later and lift
//                         every redeemer's COUPON grant that ends earlier.
//                         Never shortens; revives grants that already ended.
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; isActive?: unknown; accessUntil?: unknown }
    | null;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });

  if (typeof body.isActive === "boolean") {
    const coupon = await prisma.coupon.update({ where: { id: body.id }, data: { isActive: body.isActive } });
    return NextResponse.json(coupon);
  }

  const newEnd = parseDeadline(body.accessUntil);
  if (newEnd === "invalid" || newEnd === null) {
    return NextResponse.json({ error: "accessUntil must be a date" }, { status: 400 });
  }
  if (newEnd <= new Date()) return NextResponse.json({ error: "Access end date must be in the future" }, { status: 400 });

  const coupon = await prisma.coupon.findUnique({
    where: { id: body.id },
    select: { id: true, type: true, accessUntil: true, redemptions: { select: { accountId: true } } },
  });
  if (!coupon) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  if (coupon.type !== "PREMIUM") return NextResponse.json({ error: "Only premium codes have an access end" }, { status: 400 });
  if (coupon.accessUntil && newEnd <= coupon.accessUntil) {
    return NextResponse.json({ error: "New date must be later than the current access end" }, { status: 400 });
  }

  const extendedGrants = await prisma.$transaction(async (tx) => {
    await tx.coupon.update({ where: { id: coupon.id }, data: { accessUntil: newEnd } });
    const ids = coupon.redemptions.map((r) => r.accountId);
    if (ids.length === 0) return 0;
    const res = await tx.subscription.updateMany({
      where: extendGrantsWhere(ids, newEnd),
      data: { stripeCurrentPeriodEnd: newEnd },
    });
    return res.count;
  });

  return NextResponse.json({ id: coupon.id, accessUntil: newEnd.toISOString(), extendedGrants });
}
