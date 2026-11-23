import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate, sign } from "node:crypto";
import chain from "./__fixtures__/apple-test-chain.json";
import {
  APPLE_BUNDLE_ID,
  APPLE_PRODUCTS,
  AppleOwnershipError,
  AppleVerifyError,
  appleRowFromTransaction,
  claimAppleTransaction,
  readAppleTransaction,
  refreshAppleTransaction,
  verifyAppleJws,
  type AppleDb,
  type AppleRow,
  type AppleTransaction,
} from "./apple";

// A throwaway chain stands in for Apple's: its root is passed as the pin.
const TEST_ROOT = new X509Certificate(Buffer.from(chain.x5c[2], "base64")).fingerprint256.replace(/:/g, "");
// After the test certificates were made (2026-11-23).
const NOW = new Date("2027-01-01T12:00:00Z");

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jws(payload: unknown, opts: { key?: string; x5c?: string[]; alg?: string } = {}): string {
  const head = b64({ alg: opts.alg ?? "ES256", x5c: opts.x5c ?? chain.x5c });
  const body = b64(payload);
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: opts.key ?? chain.leafKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${signature.toString("base64url")}`;
}

function tx(over: Partial<AppleTransaction> = {}): AppleTransaction {
  return {
    bundleId: APPLE_BUNDLE_ID,
    productId: APPLE_PRODUCTS.monthly,
    originalTransactionId: "1000000000000001",
    expiresDate: NOW.getTime() + 30 * 86_400_000,
    environment: "Sandbox",
    signedDate: NOW.getTime(),
    ...over,
  };
}

// ── Signature ────────────────────────────────────────────────────────────────

test("a payload signed by the pinned chain verifies", () => {
  assert.deepEqual(verifyAppleJws(jws(tx()), TEST_ROOT), tx());
});

test("the same payload is refused under Apple's real root", () => {
  assert.throws(() => verifyAppleJws(jws(tx())), AppleVerifyError);
});

test("a payload signed by another key is refused", () => {
  assert.throws(() => verifyAppleJws(jws(tx(), { key: chain.otherKey }), TEST_ROOT), /bad signature/);
});

test("a changed payload is refused", () => {
  const [head, , signature] = jws(tx()).split(".");
  const forged = `${head}.${b64(tx({ productId: APPLE_PRODUCTS.lifetime }))}.${signature}`;
  assert.throws(() => verifyAppleJws(forged, TEST_ROOT), /bad signature/);
});

test("a chain whose leaf was not issued by the intermediate is refused", () => {
  // Root in the leaf's place: it is not signed by the intermediate.
  const x5c = [chain.x5c[2], chain.x5c[1], chain.x5c[2]];
  assert.throws(() => verifyAppleJws(jws(tx(), { x5c }), TEST_ROOT), /broken certificate chain/);
});

test("a short chain, another algorithm and garbage are refused", () => {
  assert.throws(() => verifyAppleJws(jws(tx(), { x5c: chain.x5c.slice(0, 2) }), TEST_ROOT), AppleVerifyError);
  assert.throws(() => verifyAppleJws(jws(tx(), { alg: "none" }), TEST_ROOT), AppleVerifyError);
  assert.throws(() => verifyAppleJws("not.a.jws", TEST_ROOT), AppleVerifyError);
  assert.throws(() => verifyAppleJws("", TEST_ROOT), AppleVerifyError);
});

test("a payload signed before the certificates existed is refused", () => {
  assert.throws(() => verifyAppleJws(jws(tx({ signedDate: 0 })), TEST_ROOT), /not valid at signing time/);
});

// ── What counts as a Clara Premium purchase ─────────────────────────────────

test("a purchase for another app, product or environment is refused", () => {
  assert.throws(() => readAppleTransaction(jws(tx({ bundleId: "com.other.app" })), TEST_ROOT), /another app/);
  assert.throws(() => readAppleTransaction(jws(tx({ productId: "coins.100" })), TEST_ROOT), /unknown product/);
  assert.throws(() => readAppleTransaction(jws(tx({ environment: "Xcode" })), TEST_ROOT), /environment/);
  assert.equal(readAppleTransaction(jws(tx()), TEST_ROOT).productId, APPLE_PRODUCTS.monthly);
});

// ── Row ─────────────────────────────────────────────────────────────────────

test("a subscription is PREMIUM/ACTIVE until its end date", () => {
  const row = appleRowFromTransaction(tx(), NOW);
  assert.equal(row.plan, "PREMIUM");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.appleExpiresAt?.getTime(), tx().expiresDate);
});

test("lifetime has no end date", () => {
  const row = appleRowFromTransaction(tx({ productId: APPLE_PRODUCTS.lifetime, expiresDate: undefined }), NOW);
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.appleExpiresAt, null);
});

test("a refunded purchase is CANCELED, lifetime included", () => {
  const refunded = { revocationDate: NOW.getTime() };
  assert.equal(appleRowFromTransaction(tx(refunded), NOW).status, "CANCELED");
  const lifetime = tx({ productId: APPLE_PRODUCTS.lifetime, expiresDate: undefined, ...refunded });
  assert.equal(appleRowFromTransaction(lifetime, NOW).status, "CANCELED");
});

test("a subscription with no end date is treated as over", () => {
  assert.equal(appleRowFromTransaction(tx({ expiresDate: undefined }), NOW).status, "CANCELED");
});

// ── Claiming ────────────────────────────────────────────────────────────────

type Stored = AppleRow & { accountId: string; source: "APPLE" };

function fakeDb(rows: Stored[] = []): AppleDb & { rows: Stored[] } {
  return {
    rows,
    subscription: {
      async findUnique({ where }) {
        return rows.find((r) => r.appleOriginalTransactionId === where.appleOriginalTransactionId) ?? null;
      },
      async findFirst({ where }) {
        return rows.find((r) => r.accountId === where.accountId) ?? null;
      },
      async upsert({ where, update, create }) {
        const i = rows.findIndex((r) => r.accountId === where.accountId_source.accountId);
        if (i >= 0) rows[i] = { ...rows[i], ...update };
        else rows.push(create);
      },
      async updateMany({ where, data }) {
        for (const [i, r] of rows.entries()) {
          if (r.appleOriginalTransactionId === where.appleOriginalTransactionId) rows[i] = { ...r, ...data };
        }
      },
    },
  };
}

test("a purchase is bound to the account that reports it", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx(), NOW);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].accountId, "acc_1");
  assert.equal(db.rows[0].status, "ACTIVE");
});

test("reporting the same purchase again changes nothing but its dates", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx(), NOW);
  const later = NOW.getTime() + 60 * 86_400_000;
  await claimAppleTransaction(db, "acc_1", tx({ expiresDate: later }), NOW);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].appleExpiresAt?.getTime(), later);
});

test("a second account cannot claim the same purchase", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx(), NOW);
  await assert.rejects(claimAppleTransaction(db, "acc_2", tx(), NOW), AppleOwnershipError);
  assert.equal(db.rows.length, 1);
});

test("a subscription never replaces a lifetime purchase", async () => {
  const db = fakeDb();
  const lifetime = tx({ productId: APPLE_PRODUCTS.lifetime, expiresDate: undefined, originalTransactionId: "L1" });
  await claimAppleTransaction(db, "acc_1", lifetime, NOW);
  await claimAppleTransaction(db, "acc_1", tx({ originalTransactionId: "S1" }), NOW);
  assert.equal(db.rows[0].appleProductId, APPLE_PRODUCTS.lifetime);
});

test("lifetime replaces a subscription", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx({ originalTransactionId: "S1" }), NOW);
  const lifetime = tx({ productId: APPLE_PRODUCTS.lifetime, expiresDate: undefined, originalTransactionId: "L1" });
  await claimAppleTransaction(db, "acc_1", lifetime, NOW);
  assert.equal(db.rows[0].appleProductId, APPLE_PRODUCTS.lifetime);
  assert.equal(db.rows[0].appleExpiresAt, null);
});

test("an old refunded purchase does not cancel a live different one", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx({ originalTransactionId: "S2" }), NOW);
  await claimAppleTransaction(db, "acc_1", tx({ originalTransactionId: "S1", revocationDate: 1 }), NOW);
  assert.equal(db.rows[0].appleOriginalTransactionId, "S2");
  assert.equal(db.rows[0].status, "ACTIVE");
});

// ── Notifications ───────────────────────────────────────────────────────────

test("a refund notice cancels the row that holds the purchase", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx(), NOW);
  await refreshAppleTransaction(db, tx({ revocationDate: NOW.getTime() }), NOW);
  assert.equal(db.rows[0].status, "CANCELED");
  assert.equal(db.rows[0].accountId, "acc_1");
});

test("a notice for a purchase nobody claimed changes nothing", async () => {
  const db = fakeDb();
  await claimAppleTransaction(db, "acc_1", tx(), NOW);
  await refreshAppleTransaction(db, tx({ originalTransactionId: "other", revocationDate: 1 }), NOW);
  assert.equal(db.rows[0].status, "ACTIVE");
});
