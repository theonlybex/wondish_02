import { test } from "node:test";
import assert from "node:assert/strict";
import { gapRetentionCutoff, isAuthorizedCron, GAP_RETENTION_DAYS } from "./retention";

test("retention is the 180 days the spec promised", () => {
  assert.equal(GAP_RETENTION_DAYS, 180);
});

test("the cutoff is exactly N days before now", () => {
  const now = new Date("2026-07-31T00:00:00Z");
  const cutoff = gapRetentionCutoff(now);
  assert.equal(cutoff.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(Math.round((now.getTime() - cutoff.getTime()) / 86_400_000), 180);
});

test("an unset secret refuses every request — no unauthenticated delete", () => {
  assert.equal(isAuthorizedCron("Bearer anything", undefined), false);
  assert.equal(isAuthorizedCron(null, undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", ""), false);
});

test("only the exact bearer token is accepted", () => {
  assert.equal(isAuthorizedCron("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorizedCron("Bearer wrong", "s3cret"), false);
  assert.equal(isAuthorizedCron("s3cret", "s3cret"), false, "scheme is required");
  assert.equal(isAuthorizedCron(null, "s3cret"), false);
});
