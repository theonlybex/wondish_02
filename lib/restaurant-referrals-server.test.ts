import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Same globalThis.prisma stub technique as lib/restaurant-invites-server.test.ts
// — the import below MUST stay dynamic so @/lib/db binds to the stub.
interface Calls {
  referralCreate: any[];
  qrUpdate: any[];
}
let calls: Calls;
const db = { existingReferral: null as any, qrCode: null as any };

function freshCalls(): Calls {
  return { referralCreate: [], qrUpdate: [] };
}
calls = freshCalls();

class FakeUniqueViolation extends Error {
  code = "P2002";
}

(globalThis as any).prisma = {
  restaurantReferral: {
    findUnique: async () => db.existingReferral,
    create: async (args: any) => {
      calls.referralCreate.push(args);
      if (db.existingReferral) throw new FakeUniqueViolation("dup");
      return { id: "ref_1", ...args.data };
    },
  },
  restaurantQrCode: {
    findUnique: async () => db.qrCode,
    update: async (args: any) => {
      calls.qrUpdate.push(args);
      return {};
    },
  },
};

const modPromise = import("./restaurant-referrals-server");

beforeEach(() => {
  calls = freshCalls();
  db.existingReferral = null;
  db.qrCode = {
    id: "qr_1",
    restaurantId: "rest_1",
    active: true,
    restaurant: { slug: "dumpling-u" },
  };
});

describe("generateQrToken", () => {
  it("produces a token the validator accepts", async () => {
    const { generateQrToken } = await modPromise;
    const { isValidQrToken } = await import("./restaurant-referrals");
    assert.equal(isValidQrToken(generateQrToken()), true);
  });

  it("does not repeat across calls", async () => {
    const { generateQrToken } = await modPromise;
    const seen = new Set(Array.from({ length: 50 }, () => generateQrToken()));
    assert.equal(seen.size, 50);
  });
});

describe("resolveQrToken", () => {
  it("rejects a malformed token without querying", async () => {
    const { resolveQrToken } = await modPromise;
    assert.equal(await resolveQrToken("../etc"), null);
  });

  it("returns null for an inactive code", async () => {
    db.qrCode = { ...db.qrCode, active: false };
    const { resolveQrToken } = await modPromise;
    assert.equal(await resolveQrToken("a".repeat(12)), null);
  });

  it("resolves an active code to its restaurant", async () => {
    const { resolveQrToken } = await modPromise;
    const out = await resolveQrToken("a".repeat(12));
    assert.equal(out?.restaurantId, "rest_1");
    assert.equal(out?.restaurantSlug, "dumpling-u");
  });
});

describe("recordReferral", () => {
  it("creates the attribution row and bumps the signup counter", async () => {
    const { recordReferral } = await modPromise;
    const out = await recordReferral({ accountId: "acc_1", qrCodeId: "qr_1", restaurantId: "rest_1" });
    assert.equal(out, "created");
    assert.equal(calls.referralCreate.length, 1);
    assert.equal(calls.referralCreate[0].data.accountId, "acc_1");
    assert.equal(calls.qrUpdate.length, 1);
    assert.deepEqual(calls.qrUpdate[0].data, { signups: { increment: 1 } });
  });

  // Re-scanning is normal behaviour, not an error. It must not create a
  // second row and must not inflate the pilot's signup number.
  it("is idempotent when the account was already attributed", async () => {
    db.existingReferral = { id: "ref_existing" };
    const { recordReferral } = await modPromise;
    const out = await recordReferral({ accountId: "acc_1", qrCodeId: "qr_1", restaurantId: "rest_1" });
    assert.equal(out, "already");
    assert.equal(calls.referralCreate.length, 0, "must not attempt a second row");
    assert.equal(calls.qrUpdate.length, 0, "must not double-count the signup");
  });
});
