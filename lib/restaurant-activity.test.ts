import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAuditEntry, needsVerifyNudge, VERIFY_NUDGE_DAYS } from "./restaurant-activity";

// Phase 6a M4 (docs/restaurants/phase-6a-restaurant-admin-design.md §5.7,
// §7): human-readable activity lines and the quarterly freshness nudge.

describe("formatAuditEntry", () => {
  it("dish create names the dish and section", () => {
    const line = formatAuditEntry(
      { entity: "dish", action: "create", diff: { name: "Pad Thai", section: "Mains" } },
      null
    );
    assert.equal(line, 'added "Pad Thai" to Mains');
  });

  it("dish update lists field changes with from → to", () => {
    const line = formatAuditEntry(
      { entity: "dish", action: "update", diff: { price: { from: "17.99", to: "18.99" }, available: { from: true, to: false } } },
      "Pad Thai"
    );
    assert.equal(line, 'updated "Pad Thai" — price: 17.99 → 18.99, available: yes → no');
  });

  it("null values render as an em dash, not 0", () => {
    const line = formatAuditEntry(
      { entity: "dish", action: "update", diff: { calories: { from: null, to: 520 } } },
      "Pad Thai"
    );
    assert.equal(line, 'updated "Pad Thai" — calories: — → 520');
  });

  it("ingredients update reports the list sizes", () => {
    const line = formatAuditEntry(
      { entity: "ingredients", action: "update", diff: { ingredients: { from: ["Peanut"], to: ["Peanut", "Tofu"] } } },
      "Pad Thai"
    );
    assert.equal(line, 'updated ingredients of "Pad Thai" (1 → 2 items)');
  });

  it("review lifecycle lines: submit, stage, approve, reject with note", () => {
    assert.equal(
      formatAuditEntry({ entity: "dish", action: "submit", diff: {} }, "Pad Thai"),
      'submitted "Pad Thai" for publishing'
    );
    assert.equal(
      formatAuditEntry({ entity: "ingredients", action: "stage", diff: {} }, "Pad Thai"),
      'submitted changes to "Pad Thai" for review'
    );
    assert.equal(
      formatAuditEntry({ entity: "dish", action: "approve", diff: { kind: "PUBLISH" } }, "Pad Thai"),
      'approved "Pad Thai" for publishing'
    );
    assert.equal(
      formatAuditEntry({ entity: "ingredients", action: "reject", diff: { kind: "EDIT", note: "check peanut" } }, "Pad Thai"),
      'rejected changes to "Pad Thai" — "check peanut"'
    );
  });

  it("restaurant, staff, invite and verify lines", () => {
    assert.equal(
      formatAuditEntry({ entity: "restaurant", action: "update", diff: { phone: { from: null, to: "209" }, hours: { from: null, to: "Tue–Sun" } } }, null),
      "updated restaurant profile — phone, hours"
    );
    assert.equal(
      formatAuditEntry({ entity: "invite", action: "create", diff: { email: "maria@x.com", role: "MANAGER" } }, null),
      "invited maria@x.com as manager"
    );
    assert.equal(formatAuditEntry({ entity: "invite", action: "revoke", diff: null }, null), "revoked an invite");
    assert.equal(formatAuditEntry({ entity: "staff", action: "remove", diff: null }, null), "removed a staff member");
    assert.equal(formatAuditEntry({ entity: "restaurant", action: "verify", diff: null }, null), "confirmed the menu is current");
  });

  it("unknown combos fall back to action + entity", () => {
    assert.equal(formatAuditEntry({ entity: "dish", action: "zap", diff: null }, null), "zap dish");
  });
});

describe("needsVerifyNudge", () => {
  const now = new Date("2026-08-07T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it("nudges when the newest verification is older than a quarter", () => {
    assert.equal(needsVerifyNudge(daysAgo(VERIFY_NUDGE_DAYS + 1), 5, now), true);
  });

  it("stays quiet within the quarter", () => {
    assert.equal(needsVerifyNudge(daysAgo(10), 5, now), false);
  });

  it("nudges when nothing was ever verified but dishes are live", () => {
    assert.equal(needsVerifyNudge(null, 3, now), true);
  });

  it("never nudges an empty menu", () => {
    assert.equal(needsVerifyNudge(null, 0, now), false);
    assert.equal(needsVerifyNudge(daysAgo(400), 0, now), false);
  });
});
