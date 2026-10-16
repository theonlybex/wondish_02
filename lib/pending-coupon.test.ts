import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingCouponCode, claimNoticeParam, parseClaimNotice } from "./pending-coupon";

test("pendingCouponCode normalises a well-formed code", () => {
  assert.equal(pendingCouponCode(" 4xhanf8x "), "4XHANF8X");
});

test("pendingCouponCode rejects anything the admin validator could never mint", () => {
  assert.equal(pendingCouponCode(undefined), null);
  assert.equal(pendingCouponCode(""), null);
  assert.equal(pendingCouponCode("AB"), null);
  assert.equal(pendingCouponCode("A".repeat(25)), null);
  assert.equal(pendingCouponCode("ABC D"), null);
  assert.equal(pendingCouponCode("<script>"), null);
});

test("claimNoticeParam: activated carries the end date (day only)", () => {
  assert.equal(
    claimNoticeParam({ ok: true, type: "PREMIUM", accessUntil: new Date("2026-11-30T23:59:59.999Z") }),
    "activated:2026-11-30"
  );
  assert.equal(claimNoticeParam({ ok: true, type: "PREMIUM", accessUntil: null }), "activated");
});

test("claimNoticeParam: each refusal maps to its reason", () => {
  assert.equal(claimNoticeParam({ ok: false, reason: "already", status: 409, error: "x" }), "already");
  assert.equal(claimNoticeParam({ ok: false, reason: "paid", status: 409, error: "x" }), "paid");
  assert.equal(claimNoticeParam({ ok: false, reason: "unavailable", status: 404, error: "x" }), "invalid");
  assert.equal(claimNoticeParam("error"), "error");
  assert.equal(claimNoticeParam("stripe"), "stripe");
});

test("parseClaimNotice round-trips and ignores junk", () => {
  assert.deepEqual(parseClaimNotice("activated:2026-11-30"), { kind: "activated", until: "2026-11-30" });
  assert.deepEqual(parseClaimNotice("activated"), { kind: "activated", until: null });
  assert.deepEqual(parseClaimNotice("invalid"), { kind: "invalid", until: null });
  assert.deepEqual(parseClaimNotice("stripe"), { kind: "stripe", until: null });
  assert.deepEqual(parseClaimNotice("activated:not-a-date"), { kind: "activated", until: null });
  assert.equal(parseClaimNotice(undefined), null);
  assert.equal(parseClaimNotice("pwned"), null);
});
