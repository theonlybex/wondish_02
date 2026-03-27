import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

async function assertAdmin(userId: string) {
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  return { account, isAdmin };
}

// GET /api/admin/coupons — list all coupons
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });

  return NextResponse.json(coupons);
}

// POST /api/admin/coupons — create a coupon
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const code = (body.code as string)?.trim().toUpperCase();
  const type = body.type === "ADMIN" ? "ADMIN" : "PREMIUM";
  const maxUses = Number(body.maxUses ?? 1);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const note = (body.note as string) || null;

  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
  }

  const coupon = await prisma.coupon.create({
    data: { code, type, maxUses, expiresAt, note, isActive: true },
  });

  return NextResponse.json(coupon, { status: 201 });
}

// PATCH /api/admin/coupons — toggle isActive
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { id, isActive } = body;

  const coupon = await prisma.coupon.update({
    where: { id },
    data: { isActive },
  });

  return NextResponse.json(coupon);
}
