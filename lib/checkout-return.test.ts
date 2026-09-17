import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutReturnPath } from "./checkout-return";

test("recognises the Stripe return the middleware wrote into redirect_url", () => {
  const search = "?redirect_url=" + encodeURIComponent("/billing/success?session_id=cs_test_abc");
  assert.equal(checkoutReturnPath(search), "/billing/success?session_id=cs_test_abc");
  assert.equal(checkoutReturnPath("?redirect_url=%2Fbilling%2Fsuccess"), "/billing/success");
  assert.equal(checkoutReturnPath("?foo=1&redirect_url=%2Fbilling%2Fsuccess%3Fsession_id%3Dx"), "/billing/success?session_id=x");
});

test("an ordinary sign-in is not a checkout return", () => {
  assert.equal(checkoutReturnPath(""), null);
  assert.equal(checkoutReturnPath("?"), null);
  assert.equal(checkoutReturnPath("?__clerk_ticket=abc"), null);
  assert.equal(checkoutReturnPath("?redirect_url=%2Foverview"), null);
  assert.equal(checkoutReturnPath("?redirect_url=%2Fbilling"), null);
  assert.equal(checkoutReturnPath("?redirect_url=%2Fbilling%2Fsuccessful"), null);
  assert.equal(checkoutReturnPath("?redirect_url=%2Fmembership%3Ffrom%3D%2Fbilling%2Fsuccess"), null);
});

test("never returns anything that could leave the origin", () => {
  for (const evil of [
    "https://evil.example/billing/success",
    "//evil.example/billing/success",
    "/\\evil.example/billing/success",
    "billing/success",
    "javascript:alert(1)",
  ]) {
    assert.equal(checkoutReturnPath("?redirect_url=" + encodeURIComponent(evil)), null, evil);
  }
});
