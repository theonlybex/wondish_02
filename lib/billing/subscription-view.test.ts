import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSubscriptionView } from "./subscription-view";

const row = {
  source: "STRIPE" as const, plan: "PREMIUM", status: "ACTIVE", stripePriceId: "price_m",
  stripeCurrentPeriodEnd: new Date("2026-10-10T00:00:00Z"), cancelAtPeriodEnd: false,
};
const priceToPlan = (id: string | null) => (id === "price_m" ? "monthly" as const : id === "price_6" ? "sixmonth" as const : null);

test("active monthly: shows $20.00 / month, offers the 6-month switch", () => {
  const v = buildSubscriptionView(row, { card: { brand: "visa", last4: "4242" }, invoices: [] }, priceToPlan);
  assert.equal(v.isPremium, true);
  assert.equal(v.plan, "monthly");
  assert.equal(v.priceLabel, "$20.00 / month");
  assert.equal(v.canSwitchTo, "sixmonth");
  assert.equal(v.periodEnd, "2026-10-10T00:00:00.000Z");
  assert.deepEqual(v.card, { brand: "visa", last4: "4242" });
});

test("6-month plan shows the per-6-months price and offers monthly", () => {
  const v = buildSubscriptionView({ ...row, stripePriceId: "price_6" }, { card: null, invoices: [] }, priceToPlan);
  assert.equal(v.priceLabel, "$100.00 / 6 months");
  assert.equal(v.canSwitchTo, "monthly");
});

test("coupon/admin sources never expose Stripe controls", () => {
  const v = buildSubscriptionView({ ...row, source: "COUPON", stripePriceId: null, stripeCurrentPeriodEnd: null }, null, priceToPlan);
  assert.equal(v.isPremium, true);
  assert.equal(v.plan, null);
  assert.equal(v.canSwitchTo, null);
  assert.equal(v.card, null);
});

test("no row → free", () => {
  const v = buildSubscriptionView(null, null, priceToPlan);
  assert.deepEqual(v, { isPremium: false, source: null, plan: null, priceLabel: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canSwitchTo: null, card: null, invoices: [] });
});
