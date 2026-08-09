import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orphanedStaffAccountIds } from "./restaurant-staff-cleanup";

// Deleting a restaurant cascades its RestaurantStaff rows away, which skips
// removeStaffMember's role cleanup. Any account left with no staff row
// anywhere must lose RESTAURANT_ADMIN, or it keeps being routed to a portal
// it can never enter.

describe("orphanedStaffAccountIds", () => {
  it("orphans an account with no remaining staff rows", () => {
    assert.deepEqual(orphanedStaffAccountIds(["a1"], []), ["a1"]);
  });

  it("keeps an account that still staffs another restaurant", () => {
    assert.deepEqual(orphanedStaffAccountIds(["a1"], [{ accountId: "a1", count: 2 }]), []);
  });

  it("splits a mixed set", () => {
    assert.deepEqual(
      orphanedStaffAccountIds(["a1", "a2", "a3"], [{ accountId: "a2", count: 1 }]),
      ["a1", "a3"]
    );
  });

  it("treats an explicit zero count as orphaned", () => {
    assert.deepEqual(orphanedStaffAccountIds(["a1"], [{ accountId: "a1", count: 0 }]), ["a1"]);
  });

  it("de-duplicates accounts that staffed the deleted restaurant twice", () => {
    assert.deepEqual(orphanedStaffAccountIds(["a1", "a1"], []), ["a1"]);
  });

  it("returns nothing when the restaurant had no staff", () => {
    assert.deepEqual(orphanedStaffAccountIds([], []), []);
  });

  it("ignores counts for accounts that were not staff of the deleted restaurant", () => {
    assert.deepEqual(orphanedStaffAccountIds(["a1"], [{ accountId: "zz", count: 5 }]), ["a1"]);
  });
});
