import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INVITE_TTL_DAYS,
  inviteExpiresAt,
  isInviteExpired,
  validateInviteAcceptance,
  normalizeEmail,
  planDirectAssign,
} from "./restaurant-invites";

// Phase 6a M1 (docs/restaurants/phase-6a-restaurant-admin-design.md §4):
// PENDING + email match (case-insensitive) + within 30 days, or a
// user-facing error string.

const NOW = new Date("2026-08-04T12:00:00.000Z");

function invite(overrides: Partial<{ status: string; email: string; createdAt: Date }> = {}) {
  return {
    status: "PENDING",
    email: "owner@lapalma.com",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Owner@LaPalma.COM "), "owner@lapalma.com");
  });
});

describe("inviteExpiresAt / isInviteExpired", () => {
  it("expires exactly INVITE_TTL_DAYS after creation", () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    const expected = new Date(createdAt.getTime() + INVITE_TTL_DAYS * 86400000);
    assert.deepEqual(inviteExpiresAt(createdAt), expected);
    assert.equal(isInviteExpired(createdAt, new Date(expected.getTime() - 1)), false);
    assert.equal(isInviteExpired(createdAt, expected), true);
  });
});

describe("validateInviteAcceptance", () => {
  it("passes a pending, in-date invite with a case-insensitive email match", () => {
    assert.equal(validateInviteAcceptance(invite(), "Owner@LaPalma.com", NOW), null);
  });

  it("rejects non-PENDING invites", () => {
    for (const status of ["ACCEPTED", "REVOKED", "EXPIRED"]) {
      assert.match(validateInviteAcceptance(invite({ status }), "owner@lapalma.com", NOW)!, /no longer valid/i);
    }
  });

  it("rejects an expired invite", () => {
    const old = invite({ createdAt: new Date("2026-07-01T00:00:00.000Z") });
    assert.match(validateInviteAcceptance(old, "owner@lapalma.com", NOW)!, /expired/i);
  });

  it("rejects a signed-in email that doesn't match, naming the invited address", () => {
    const err = validateInviteAcceptance(invite(), "someone-else@gmail.com", NOW)!;
    assert.match(err, /owner@lapalma\.com/);
  });
});

// Phase 6a §4D — ops direct staff assignment. Decides the path for
// POST /api/admin/restaurants/[id]/staff: attach an existing account
// directly, promote (never demote — mirrors accept-invite), fall back to
// the invite flow when no account exists, or reject as already-staff.
describe("planDirectAssign", () => {
  it("falls back to the invite flow when no account exists for the email", () => {
    assert.deepEqual(
      planDirectAssign({ accountExists: false, existingRole: null, requestedRole: "OWNER" }),
      { action: "invite" }
    );
  });

  it("assigns directly when the account exists and is not yet staff", () => {
    for (const requestedRole of ["OWNER", "MANAGER"] as const) {
      assert.deepEqual(
        planDirectAssign({ accountExists: true, existingRole: null, requestedRole }),
        { action: "assign" }
      );
    }
  });

  it("promotes an existing MANAGER when OWNER is requested", () => {
    assert.deepEqual(
      planDirectAssign({ accountExists: true, existingRole: "MANAGER", requestedRole: "OWNER" }),
      { action: "promote" }
    );
  });

  it("rejects when the account already holds the requested tier", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      const plan = planDirectAssign({ accountExists: true, existingRole: role, requestedRole: role });
      assert.equal(plan.action, "already");
    }
  });

  it("never demotes: an existing OWNER with MANAGER requested is already-staff", () => {
    const plan = planDirectAssign({ accountExists: true, existingRole: "OWNER", requestedRole: "MANAGER" });
    assert.equal(plan.action, "already");
  });
});
