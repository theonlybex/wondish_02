import { test } from "node:test";
import assert from "node:assert/strict";
import { screenshotFailure } from "./storage";

test("missing credentials read as 'storage not configured' and are not alarming", () => {
  const f = screenshotFailure(new Error("AWS credentials are not configured."));
  assert.deepEqual(f, { note: "not stored: storage not configured", log: false });
});

test("any other upload error is reported as a failure and logged", () => {
  const f = screenshotFailure(new Error("AccessDenied: s3:PutObject"));
  assert.equal(f.note, "not stored: upload failed");
  assert.equal(f.log, true);
});
