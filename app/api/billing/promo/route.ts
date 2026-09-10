import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { findPromotionCode } from "@/lib/stripe";
import { planByKey, formatCents } from "@/lib/billing/plans";
import { applyPromotion } from "@/lib/billing/promo";

// POST /api/billing/promo — validate a promo code against a plan and preview
// the charges. Read-only; Stripe re-validates at checkout. Rate-limited: this
// is a guessable namespace.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("promo-preview", userId, 20, 3600);
  if (!success) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { code?: unknown; plan?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const plan = typeof body?.plan === "string" ? planByKey(body.plan) : null;
  if (!code || !plan) return NextResponse.json({ error: "code and plan are required" }, { status: 400 });

  const promo = await findPromotionCode(code);
  if (!promo) return NextResponse.json({ valid: false });
  const preview = applyPromotion(plan, promo.coupon);
  return NextResponse.json({
    valid: true,
    label: preview.label,
    firstCharge: formatCents(preview.firstChargeCents),
    recurring: formatCents(preview.recurringCents),
  });
}
