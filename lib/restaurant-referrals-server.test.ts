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

const tx = {
  restaurantReferral: {
    create: async (args: any) => {
      calls.referralCreate.push(args);
      if (db.existingReferral) throw new FakeUniqueViolation("dup");
      return { id: "ref_1", ...args.data };
    },
  },
  restaurantQrCode: {
    update: async (args: any) => {
      calls.qrUpdate.push(args);
      return {};
    },
  },
};

let txCalls = 0;

(globalThis as any).prisma = {
  // The row and its counter are written together; the stub runs the callback
  // so a regression that drops the transaction still exercises both writes.
  $transaction: async (fn: any) => {
    txCalls++;
    return fn(tx);
  },
  restaurantReferral: {
    findUnique: async () => db.existingReferral,
  },
  restaurantQrCode: {
    findUnique: async () => db.qrCode,
  },
};

const modPromise = import("./restaurant-referrals-server");

beforeEach(() => {
  calls = freshCalls();
  txCalls = 0;
  db.existingReferral = null;
  db.qrCode = {
    id: "qr_1",
    restaurantId: "rest_1",
    active: true,
    restaurant: { slug: "dumpling-u", status: "PUBLISHED" },
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

  // Adversarial review, 2026-08-14: the code being active is not enough. The
  // destination menu is gated on PUBLISHED and 404s otherwise, so an active
  // tent on a DRAFT/ARCHIVED restaurant would land a brand-new account on a
  // 404 the moment it finished signing up.
  it("refuses a code whose restaurant is no longer PUBLISHED", async () => {
    for (const status of ["DRAFT", "ARCHIVED", "PENDING_REVIEW"]) {
      db.qrCode = { ...db.qrCode, restaurant: { slug: "dumpling-u", status } };
      const { resolveQrToken } = await modPromise;
      assert.equal(await resolveQrToken("a".repeat(12)), null, `status ${status} must not resolve`);
    }
  });
});

describe("recordReferral", () => {
  it("creates the attribution row and bumps the signup counter", async () => {
    const { recordReferral } = await modPromise;
    const out = await recordReferral({
      accountId: "acc_1",
      qrCodeId: "qr_1",
      restaurantId: "rest_1",
      countsAsSignup: true,
    });
    assert.equal(out, "created");
    assert.equal(calls.referralCreate.length, 1);
    assert.equal(calls.referralCreate[0].data.accountId, "acc_1");
    assert.equal(calls.qrUpdate.length, 1);
    assert.deepEqual(calls.qrUpdate[0].data, { signups: { increment: 1 } });
  });

  // Adversarial review, 2026-08-14: an already-signed-in diner scanning a tent
  // is a VISIT. Counting it as a sign-up would let staff testing tents and
  // regulars dining out dominate the one number the pilot is judged on.
  it("attributes an existing account without counting it as a sign-up", async () => {
    const { recordReferral } = await modPromise;
    const out = await recordReferral({
      accountId: "acc_1",
      qrCodeId: "qr_1",
      restaurantId: "rest_1",
      countsAsSignup: false,
    });
    assert.equal(out, "created");
    assert.equal(calls.referralCreate.length, 1, "attribution is still recorded");
    assert.equal(calls.qrUpdate.length, 0, "but the signup counter must not move");
  });

  // The row and the counter it feeds must commit together: committing the row
  // and then failing the increment would under-count permanently, because the
  // existing-row guard short-circuits every retry.
  it("writes the row and the counter inside one transaction", async () => {
    const { recordReferral } = await modPromise;
    await recordReferral({
      accountId: "acc_1",
      qrCodeId: "qr_1",
      restaurantId: "rest_1",
      countsAsSignup: true,
    });
    assert.equal(txCalls, 1, "both writes must go through $transaction");
  });

  // Re-scanning is normal behaviour, not an error. It must not create a
  // second row and must not inflate the pilot's signup number.
  it("is idempotent when the account was already attributed", async () => {
    db.existingReferral = { id: "ref_existing" };
    const { recordReferral } = await modPromise;
    const out = await recordReferral({
      accountId: "acc_1",
      qrCodeId: "qr_1",
      restaurantId: "rest_1",
      countsAsSignup: true,
    });
    assert.equal(out, "already");
    assert.equal(calls.referralCreate.length, 0, "must not attempt a second row");
    assert.equal(calls.qrUpdate.length, 0, "must not double-count the signup");
  });
});
