import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedbackText, validateArea, sniffImage, FEEDBACK_AREAS, FEEDBACK_MAX_IMAGE_BYTES } from "./validate";

test("text: trimmed, 10–2000 chars", () => {
  assert.deepEqual(validateFeedbackText("  The plan shows chicken  "), { ok: true, text: "The plan shows chicken" });
  assert.equal(validateFeedbackText("too short").ok, false);
  assert.equal(validateFeedbackText("x".repeat(2001)).ok, false);
  assert.equal(validateFeedbackText(42).ok, false);
});

test("area: one of the listed areas or null", () => {
  assert.equal(validateArea("clara"), "clara");
  assert.equal(validateArea("CLARA"), "clara");
  assert.equal(validateArea("admin"), null);
  assert.equal(validateArea(undefined), null);
  assert.equal(FEEDBACK_AREAS.length, 7);
});

test("image: decided by magic bytes, not the declared type", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new Uint8Array([0x4d, 0x5a, 0x90, 0])), null); // MZ executable
});

// Vercel rejects request bodies over 4.5 MB before the handler runs, with a
// non-JSON 413 — a screenshot near that limit must be refused in the app,
// with our message, leaving room for the text fields (final review).
test("screenshot limit leaves headroom under the 4.5 MB platform body cap", () => {
  assert.ok(FEEDBACK_MAX_IMAGE_BYTES <= 4 * 1024 * 1024, `limit ${FEEDBACK_MAX_IMAGE_BYTES}`);
});
