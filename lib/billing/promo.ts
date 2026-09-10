// Pure preview of what a Stripe coupon does to a plan's charges. Stripe is
// the authority at invoice time; this only drives the "→ $16.00 today, then
// $20/month" line in the plan picker. Rounding follows Stripe: percent
// discounts round half-up to the cent.
import { formatCents, type Plan } from "./plans";

export interface PromoCoupon {
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
  name: string | null;
}

export interface PromoPreview {
  firstChargeCents: number;
  recurringCents: number;
  label: string;
}

function discounted(amountCents: number, c: PromoCoupon): number {
  if (c.percentOff != null) return Math.max(0, Math.round(amountCents * (1 - c.percentOff / 100)));
  if (c.amountOffCents != null) return Math.max(0, amountCents - c.amountOffCents);
  return amountCents;
}

export function applyPromotion(plan: Plan, c: PromoCoupon): PromoPreview {
  const first = discounted(plan.amountCents, c);
  // "repeating" covers durationInMonths of invoices; a 6-month plan's second
  // invoice is 6 months out, so only "forever" (or repeating past the plan's
  // second invoice) discounts the recurring charge.
  const coversRecurring =
    c.duration === "forever" || (c.duration === "repeating" && (c.durationInMonths ?? 0) > plan.months);
  const recurring = coversRecurring ? first : plan.amountCents;

  const amount = c.percentOff != null ? `${c.percentOff}% off` : `${formatCents(c.amountOffCents ?? 0)} off`;
  const period = plan.months === 1 ? "month" : `${plan.months} months`;
  const label =
    c.duration === "once"
      ? `${amount} your first ${period}`
      : c.duration === "forever"
        ? `${amount} every ${period}`
        : `${amount} for ${c.durationInMonths} months`;

  return { firstChargeCents: first, recurringCents: recurring, label };
}
