// The ONLY place plan prices are named in the app. Stripe holds the real
// Price objects; we address them by lookup_key and verify amountCents at
// checkout (lib/stripe.ts resolvePlanPrice) so the UI can never show a number
// Stripe won't charge.

export type PlanKey = "monthly" | "sixmonth";

export interface Plan {
  key: PlanKey;
  lookupKey: string;
  amountCents: number;
  currency: "usd";
  interval: "month";
  intervalCount: 1 | 6;
  months: number;
}

export const PLANS: readonly Plan[] = [
  { key: "monthly", lookupKey: "premium_monthly_20", amountCents: 2000, currency: "usd", interval: "month", intervalCount: 1, months: 1 },
  { key: "sixmonth", lookupKey: "premium_6mo_100", amountCents: 10000, currency: "usd", interval: "month", intervalCount: 6, months: 6 },
] as const;

export function planByKey(key: string): Plan | null {
  return PLANS.find((p) => p.key === key) ?? null;
}

export function planByLookupKey(lookupKey: string): Plan | null {
  return PLANS.find((p) => p.lookupKey === lookupKey) ?? null;
}

export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function perMonthCents(plan: Plan): number {
  return Math.round(plan.amountCents / plan.months);
}

/** Integer percent saved per month versus another plan; 0 when not cheaper. */
export function savingsPct(plan: Plan, versus: Plan): number {
  const a = perMonthCents(plan);
  const b = perMonthCents(versus);
  if (a >= b) return 0;
  return Math.round((1 - a / b) * 100);
}
