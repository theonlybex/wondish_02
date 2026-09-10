import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePromoInput } from "./promo-admin";

test("accepts a percent-off once code and uppercases it", () => {
  const r = validatePromoInput({ code: "save20", percentOff: 20, duration: "once", firstTimeOnly: true });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.code, "SAVE20");
    assert.equal(r.value.percentOff, 20);
    assert.equal(r.value.firstTimeOnly, true);
  }
});

test("rejects both percent and amount, missing durationInMonths for repeating, bad codes", () => {
  assert.equal(validatePromoInput({ code: "X10", percentOff: 10, amountOffCents: 100, duration: "once" }).ok, false);
  assert.equal(validatePromoInput({ code: "X10", percentOff: 10, duration: "repeating" }).ok, false);
  assert.equal(validatePromoInput({ code: "bad code!", percentOff: 10, duration: "once" }).ok, false);
  assert.equal(validatePromoInput({ code: "X10", percentOff: 150, duration: "once" }).ok, false);
  assert.equal(validatePromoInput({ code: "X10", duration: "once" }).ok, false);
});

test("amount-off forever with a cap and expiry passes through", () => {
  const r = validatePromoInput({ code: "ten-off", amountOffCents: 1000, duration: "forever", maxRedemptions: 50, expiresAt: "2027-01-01T00:00:00Z" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.code, "TEN-OFF");
    assert.equal(r.value.amountOffCents, 1000);
    assert.equal(r.value.maxRedemptions, 50);
    assert.equal(r.value.expiresAt, "2027-01-01T00:00:00Z");
    assert.equal(r.value.firstTimeOnly, false);
  }
});
