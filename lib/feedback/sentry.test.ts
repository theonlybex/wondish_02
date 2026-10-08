import { test } from "node:test";
import assert from "node:assert/strict";
import { sentryEventUrl } from "./sentry";

test("an event id becomes a link to the org's Sentry issues search", () => {
  assert.equal(sentryEventUrl("wondish", "abc123"), "https://wondish.sentry.io/issues/?query=abc123");
});
test("no org or a malformed id gives no link", () => {
  assert.equal(sentryEventUrl(null, "abc123"), null);
  assert.equal(sentryEventUrl("wondish", ""), null);
  assert.equal(sentryEventUrl("evil.com/x?", "abc"), null);
  assert.equal(sentryEventUrl("wondish", "<script>"), null);
});
