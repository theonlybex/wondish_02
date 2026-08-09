import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// assignStaffDirect reads the prisma singleton from @/lib/db, which resolves
// `globalThis.prisma ?? createPrismaClient()`. Injecting a stub on globalThis
// BEFORE the module loads turns the grant into an inspectable data-in/data-out
// function — no network, no real Prisma client. Same technique as
// meal-plan.test.ts; see its comment for why the import below must be dynamic.
//
// This covers the write path that had no tests at all: which account counts as
// assignable, assign vs promote vs already, and the invite supersession rules
// (the part most likely to silently strand a claimable invite).

interface Calls {
  staffCreate: any[];
  staffUpdate: any[];
  inviteFindMany: any[];
  inviteUpdateMany: any[];
  audit: any[];
  accountFindFirst: any[];
}

const db = {
  account: null as any,
  pendingInvites: [] as any[],
};
let calls: Calls;

function freshCalls(): Calls {
  return {
    staffCreate: [],
    staffUpdate: [],
    inviteFindMany: [],
    inviteUpdateMany: [],
    audit: [],
    accountFindFirst: [],
  };
}
calls = freshCalls();

const tx = {
  role: { upsert: async () => ({ id: "role_restaurant_admin" }) },
  accountRole: { upsert: async () => ({}) },
  restaurantStaff: {
    create: async (args: any) => {
      calls.staffCreate.push(args);
      return { id: "staff_new", role: args.data.role };
    },
    update: async (args: any) => {
      calls.staffUpdate.push(args);
      return { id: args.where.id, role: args.data.role };
    },
  },
  restaurantInvite: {
    findMany: async (args: any) => {
      calls.inviteFindMany.push(args);
      // Honour the role filter from the args rather than hardcoding it, so a
      // regression that drops supersedableInviteRoles fails these tests.
      const roles: string[] | undefined = args?.where?.role?.in;
      return db.pendingInvites.filter((i) => !roles || roles.includes(i.role));
    },
    updateMany: async (args: any) => {
      calls.inviteUpdateMany.push(args);
      return { count: args.where.id.in.length };
    },
  },
  restaurantAuditLog: {
    create: async (args: any) => {
      calls.audit.push(args);
      return {};
    },
  },
};

(globalThis as any).prisma = {
  account: {
    findFirst: async (args: any) => {
      calls.accountFindFirst.push(args);
      return db.account;
    },
  },
  $transaction: async (fn: any) => fn(tx),
};

const modPromise = import("./restaurant-invites-server");

const CLAIMED = {
  id: "acc_1",
  clerkId: "user_live",
  restaurantStaff: [] as Array<{ id: string; role: "OWNER" | "MANAGER" }>,
};

function baseArgs(over: Record<string, unknown> = {}) {
  return {
    restaurantId: "rest_1",
    rawEmail: "chef@example.com",
    role: "OWNER" as const,
    actorId: "admin_1",
    origin: "https://wondish.test",
    ...over,
  };
}

beforeEach(() => {
  calls = freshCalls();
  db.account = { ...CLAIMED, restaurantStaff: [] };
  db.pendingInvites = [];
});

describe("assignStaffDirect — who counts as assignable", () => {
  it("rejects a bad email before touching the database", async () => {
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(baseArgs({ rawEmail: "not-an-email" }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 400);
    assert.equal(calls.accountFindFirst.length, 0);
  });

  it("looks the email up case-insensitively", async () => {
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs({ rawEmail: "Chef@Example.COM" }));
    const where = calls.accountFindFirst[0].where.email;
    assert.equal(where.mode, "insensitive");
    assert.equal(where.equals, "chef@example.com");
  });

  it("refuses an unclaimed shell account when the portal forbids invites", async () => {
    db.account = { id: "acc_shell", clerkId: null, restaurantStaff: [] };
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(
      baseArgs({ role: "MANAGER", allowInviteFallback: false })
    );
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 404);
      assert.match(res.error, /sign up first/i);
    }
    assert.equal(calls.staffCreate.length, 0, "must not grant a restaurant to a shell row");
  });

  it("refuses a missing account the same way", async () => {
    db.account = null;
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(baseArgs({ allowInviteFallback: false }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 404);
    assert.equal(calls.staffCreate.length, 0);
  });
});

describe("assignStaffDirect — assign, promote, already", () => {
  it("assigns a claimed account with no existing membership", async () => {
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(baseArgs());
    assert.equal(res.ok, true);
    if (res.ok && "mode" in res) assert.equal(res.mode, "assigned");
    assert.equal(calls.staffCreate.length, 1);
    assert.equal(calls.staffCreate[0].data.role, "OWNER");
    assert.equal(calls.staffCreate[0].data.invitedById, "admin_1");
    assert.equal(calls.staffUpdate.length, 0);
  });

  it("promotes a MANAGER to OWNER rather than creating a second row", async () => {
    db.account.restaurantStaff = [{ id: "staff_existing", role: "MANAGER" }];
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(baseArgs({ role: "OWNER" }));
    assert.equal(res.ok, true);
    if (res.ok && "mode" in res) assert.equal(res.mode, "promoted");
    assert.equal(calls.staffUpdate.length, 1);
    assert.equal(calls.staffUpdate[0].where.id, "staff_existing");
    assert.equal(calls.staffUpdate[0].data.role, "OWNER");
    assert.equal(calls.staffCreate.length, 0);
  });

  it("never demotes an OWNER to MANAGER — 409, no writes", async () => {
    db.account.restaurantStaff = [{ id: "staff_existing", role: "OWNER" }];
    const { assignStaffDirect } = await modPromise;
    const res = await assignStaffDirect(baseArgs({ role: "MANAGER" }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 409);
    assert.equal(calls.staffCreate.length, 0);
    assert.equal(calls.staffUpdate.length, 0);
  });

  it("writes an audit row naming the assignment", async () => {
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs());
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0].data.entity, "staff");
    assert.equal(calls.audit[0].data.action, "assign");
    assert.equal(calls.audit[0].data.accountId, "admin_1");
  });
});

describe("assignStaffDirect — invite supersession", () => {
  it("supersedes a pending invite at the assigned tier, as REVOKED not ACCEPTED", async () => {
    db.pendingInvites = [{ id: "inv_1", role: "OWNER", clerkInvitationId: null }];
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs({ role: "OWNER" }));
    assert.equal(calls.inviteUpdateMany.length, 1);
    assert.deepEqual(calls.inviteUpdateMany[0].where.id.in, ["inv_1"]);
    assert.equal(
      calls.inviteUpdateMany[0].data.status,
      "REVOKED",
      "nobody accepted anything — ACCEPTED would falsify the invite history"
    );
  });

  it("leaves a higher-tier pending OWNER invite claimable after a MANAGER assignment", async () => {
    db.pendingInvites = [
      { id: "inv_owner", role: "OWNER", clerkInvitationId: null },
      { id: "inv_mgr", role: "MANAGER", clerkInvitationId: null },
    ];
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs({ role: "MANAGER" }));
    assert.deepEqual(calls.inviteFindMany[0].where.role.in, ["MANAGER"]);
    assert.deepEqual(calls.inviteUpdateMany[0].where.id.in, ["inv_mgr"]);
  });

  it("an OWNER assignment supersedes both tiers", async () => {
    db.pendingInvites = [
      { id: "inv_owner", role: "OWNER", clerkInvitationId: null },
      { id: "inv_mgr", role: "MANAGER", clerkInvitationId: null },
    ];
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs({ role: "OWNER" }));
    assert.deepEqual([...calls.inviteFindMany[0].where.role.in].sort(), ["MANAGER", "OWNER"]);
    assert.deepEqual(calls.inviteUpdateMany[0].where.id.in, ["inv_owner", "inv_mgr"]);
  });

  it("skips the update entirely when nothing is pending", async () => {
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs());
    assert.equal(calls.inviteUpdateMany.length, 0);
  });

  it("records superseded invite ids in the audit diff", async () => {
    db.pendingInvites = [{ id: "inv_1", role: "OWNER", clerkInvitationId: null }];
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs());
    assert.deepEqual(calls.audit[0].data.diff.supersededInviteIds, ["inv_1"]);
  });

  it("scopes the invite search to this restaurant and email", async () => {
    db.pendingInvites = [{ id: "inv_1", role: "OWNER", clerkInvitationId: null }];
    const { assignStaffDirect } = await modPromise;
    await assignStaffDirect(baseArgs({ rawEmail: "Chef@Example.COM" }));
    const where = calls.inviteFindMany[0].where;
    assert.equal(where.restaurantId, "rest_1");
    assert.equal(where.email, "chef@example.com");
    assert.equal(where.status, "PENDING");
  });
});
