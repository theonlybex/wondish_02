import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPromotion } from "./promo";
import { planByKey } from "./plans";

const monthly = planByKey("monthly")!;
const six = planByKey("sixmonth")!;

test("percent off, once: first charge discounted, then full price", () => {
  const p = applyPromotion(monthly, { percentOff: 20, amountOffCents: null, duration: "once", durationInMonths: null, name: "SAVE20" });
  assert.deepEqual(p, { firstChargeCents: 1600, recurringCents: 2000, label: "20% off your first month" });
});

test("amount off, forever: both charges discounted, never below zero", () => {
  const p = applyPromotion(six, { percentOff: null, amountOffCents: 15000, duration: "forever", durationInMonths: null, name: null });
  assert.deepEqual(p, { firstChargeCents: 0, recurringCents: 0, label: "$150.00 off every 6 months" });
});

test("repeating for N months on a 6-month plan applies to the first invoice only", () => {
  const p = applyPromotion(six, { percentOff: 50, amountOffCents: null, duration: "repeating", durationInMonths: 3, name: null });
  assert.deepEqual(p, { firstChargeCents: 5000, recurringCents: 10000, label: "50% off for 3 months" });
});

test("rounding: 33% off $20 is $13.40", () => {
  const p = applyPromotion(monthly, { percentOff: 33, amountOffCents: null, duration: "once", durationInMonths: null, name: null });
  assert.equal(p.firstChargeCents, 1340);
});
