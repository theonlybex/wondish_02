import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// findClaimableInvites is the single source of truth for "which invites may
// this email still accept", shared by the portal entry page, the dashboard and
// profile banners, and the pending API. It had no tests, yet it is the thing
// standing between a user and an Accept button that 409s forever.
//
// Same globalThis.prisma stub technique as meal-plan.test.ts — the import below
// must stay dynamic so @/lib/db binds to the stub, not a real client.

const db = { rows: [] as any[] };
let updateManyCalls: any[] = [];

(globalThis as any).prisma = {
  restaurantInvite: {
    findMany: async (args: any) => {
      // Honour the where-clause from the args so a regression that stops
      // filtering to PENDING, or stops lowercasing, fails these tests.
      return db.rows.filter(
        (r) => r.status === args.where.status && r.email === args.where.email
      );
    },
    updateMany: async (args: any) => {
      updateManyCalls.push(args);
      return { count: args.where.id.in.length };
    },
  },
};

const modPromise = import("./restaurant-pending-invites-server");

const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function invite(over: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    email: "chef@example.com",
    status: "PENDING",
    role: "MANAGER",
    createdAt: ago(1),
    restaurant: { id: "r1", name: "Trattoria", neighborhood: "Downtown" },
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  updateManyCalls = [];
});

describe("findClaimableInvites", () => {
  it("lowercases the email before matching (Clerk stores it verbatim)", async () => {
    db.rows = [invite()];
    const { findClaimableInvites } = await modPromise;
    const out = await findClaimableInvites("Chef@Example.COM");
    assert.equal(out.length, 1);
  });

  it("returns a fresh pending invite", async () => {
    db.rows = [invite({ createdAt: ago(1) })];
    const { findClaimableInvites } = await modPromise;
    const out = await findClaimableInvites("chef@example.com");
    assert.deepEqual(out.map((r: any) => r.id), ["inv_1"]);
    assert.equal(updateManyCalls.length, 0, "nothing expired — no write on a read path");
  });

  it("hides an invite past the 30-day TTL and marks it EXPIRED", async () => {
    db.rows = [invite({ id: "inv_old", createdAt: ago(31) })];
    const { findClaimableInvites } = await modPromise;
    const out = await findClaimableInvites("chef@example.com");
    assert.deepEqual(out, [], "an expired invite must never render an Accept button");
    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(updateManyCalls[0].where.id.in, ["inv_old"]);
    assert.equal(updateManyCalls[0].data.status, "EXPIRED");
  });

  it("expires only the overdue rows in a mixed set", async () => {
    db.rows = [
      invite({ id: "fresh", createdAt: ago(2) }),
      invite({ id: "stale", createdAt: ago(40) }),
    ];
    const { findClaimableInvites } = await modPromise;
    const out = await findClaimableInvites("chef@example.com");
    assert.deepEqual(out.map((r: any) => r.id), ["fresh"]);
    assert.deepEqual(updateManyCalls[0].where.id.in, ["stale"]);
  });

  it("ignores invites addressed to a different email", async () => {
    db.rows = [invite({ email: "someone@else.com" })];
    const { findClaimableInvites } = await modPromise;
    assert.deepEqual(await findClaimableInvites("chef@example.com"), []);
  });

  it("ignores non-PENDING rows", async () => {
    db.rows = [invite({ status: "REVOKED" }), invite({ id: "acc", status: "ACCEPTED" })];
    const { findClaimableInvites } = await modPromise;
    assert.deepEqual(await findClaimableInvites("chef@example.com"), []);
  });

  it("carries the restaurant through for the banner", async () => {
    db.rows = [invite()];
    const { findClaimableInvites } = await modPromise;
    const [row] = await findClaimableInvites("chef@example.com");
    assert.equal(row.restaurant.name, "Trattoria");
  });
});
