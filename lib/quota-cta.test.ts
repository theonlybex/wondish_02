import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaCta } from "./quota-cta";
import { quotaExceededBody } from "./ai-budget";

test("a lapsed member is sent to the card update, everyone else to pricing, premium nowhere", () => {
  assert.deepEqual(quotaCta(quotaExceededBody("planGen", "free", "past_due")), { href: "/membership", label: "Update your card →" });
  assert.deepEqual(quotaCta(quotaExceededBody("planGen", "free")), { href: "/pricing", label: "Upgrade for more →" });
  assert.equal(quotaCta(quotaExceededBody("planGen", "premium")), null);
  assert.equal(quotaCta({ error: "Clara is at capacity" }), null);
  assert.equal(quotaCta(null), null);
});
