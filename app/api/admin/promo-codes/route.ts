import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { validatePromoInput } from "@/lib/billing/promo-admin";

// SUPER-only. Promo codes live in Stripe (Coupon + Promotion Code); nothing
// is stored in our DB, so the pricing page and Checkout always agree.
async function requireSuper(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const account = await prisma.account.findUnique({ where: { clerkId: userId }, include: { roles: { include: { role: true } } } });
  return account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
}

export async function GET() {
  if (!(await requireSuper())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const list = await stripe().promotionCodes.list({ limit: 100 });
  return NextResponse.json({
    codes: list.data.map((pc) => ({
      id: pc.id,
      code: pc.code,
      active: pc.active,
      timesRedeemed: pc.times_redeemed,
      maxRedemptions: pc.max_redemptions ?? null,
      expiresAt: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
      coupon: {
        percentOff: pc.coupon.percent_off ?? null,
        amountOffCents: pc.coupon.amount_off ?? null,
        duration: pc.coupon.duration,
        durationInMonths: pc.coupon.duration_in_months ?? null,
        name: pc.coupon.name ?? null,
      },
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSuper())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = validatePromoInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const s = stripe();
  try {
    const coupon = await s.coupons.create({
      name: v.code,
      duration: v.duration,
      ...(v.duration === "repeating" ? { duration_in_months: v.durationInMonths } : {}),
      ...(v.percentOff != null ? { percent_off: v.percentOff } : { amount_off: v.amountOffCents, currency: "usd" }),
    });
    const promo = await s.promotionCodes.create({
      coupon: coupon.id,
      code: v.code,
      ...(v.maxRedemptions ? { max_redemptions: v.maxRedemptions } : {}),
      ...(v.expiresAt ? { expires_at: Math.floor(Date.parse(v.expiresAt) / 1000) } : {}),
      restrictions: { first_time_transaction: v.firstTimeOnly },
    });
    return NextResponse.json({ id: promo.id, code: promo.code }, { status: 201 });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? "Stripe rejected the promo code.";
    console.error("[admin/promo-codes]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireSuper())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; active?: unknown } | null;
  if (typeof body?.id !== "string" || typeof body?.active !== "boolean") {
    return NextResponse.json({ error: "id and active required" }, { status: 400 });
  }
  const pc = await stripe().promotionCodes.update(body.id, { active: body.active });
  return NextResponse.json({ id: pc.id, active: pc.active });
}
