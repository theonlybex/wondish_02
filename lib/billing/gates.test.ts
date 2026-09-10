import { test } from "node:test";
import assert from "node:assert/strict";
import { premiumGatesEnabled } from "./gates";

test("gates are off unless PREMIUM_GATES=on", () => {
  assert.equal(premiumGatesEnabled({}), false);
  assert.equal(premiumGatesEnabled({ PREMIUM_GATES: "off" }), false);
  assert.equal(premiumGatesEnabled({ PREMIUM_GATES: "true" }), false);
  assert.equal(premiumGatesEnabled({ PREMIUM_GATES: "on" }), true);
});
