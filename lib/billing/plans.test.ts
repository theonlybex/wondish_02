import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, planByKey, planByLookupKey, formatCents, perMonthCents, savingsPct } from "./plans";

test("catalog: exactly two plans, $20/1mo and $100/6mo", () => {
  assert.deepEqual(PLANS.map((p) => [p.key, p.amountCents, p.intervalCount, p.months]), [
    ["monthly", 2000, 1, 1],
    ["sixmonth", 10000, 6, 6],
  ]);
  assert.equal(planByKey("monthly")?.lookupKey, "premium_monthly_20");
  assert.equal(planByKey("sixmonth")?.lookupKey, "premium_6mo_100");
  assert.equal(planByKey("yearly"), null);
  assert.equal(planByLookupKey("premium_6mo_100")?.key, "sixmonth");
});

test("formatCents renders USD with two decimals", () => {
  assert.equal(formatCents(2000), "$20.00");
  assert.equal(formatCents(1667), "$16.67");
  assert.equal(formatCents(0), "$0.00");
});

test("per-month price and savings for the 6-month plan", () => {
  const monthly = planByKey("monthly")!;
  const six = planByKey("sixmonth")!;
  assert.equal(perMonthCents(six), 1667);
  assert.equal(savingsPct(six, monthly), 17);
  assert.equal(savingsPct(monthly, monthly), 0);
});
