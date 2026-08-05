import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { staffRoleSatisfies, RESTAURANT_ADMIN_ROLE } from "./restaurant-auth";

// Phase 6a M1 (docs/restaurants/phase-6a-restaurant-admin-design.md §3):
// OWNER outranks MANAGER; a member always satisfies their own tier.

describe("staffRoleSatisfies", () => {
  it("OWNER satisfies both tiers", () => {
    assert.equal(staffRoleSatisfies("OWNER", "MANAGER"), true);
    assert.equal(staffRoleSatisfies("OWNER", "OWNER"), true);
  });

  it("MANAGER satisfies MANAGER but not OWNER", () => {
    assert.equal(staffRoleSatisfies("MANAGER", "MANAGER"), true);
    assert.equal(staffRoleSatisfies("MANAGER", "OWNER"), false);
  });
});

describe("RESTAURANT_ADMIN_ROLE", () => {
  it("is the canonical role name string", () => {
    assert.equal(RESTAURANT_ADMIN_ROLE, "RESTAURANT_ADMIN");
  });
});
