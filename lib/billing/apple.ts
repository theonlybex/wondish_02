// Apple in-app purchases (StoreKit 2) for the Clara iOS app.
//
// The app sends the signed transaction StoreKit hands it; Apple also posts
// signed notifications when a subscription renews, lapses or is refunded.
// Both are JWS (ES256) carrying their own certificate chain in the header.
// A signature counts only when that chain ends at Apple's root certificate,
// which is pinned here by fingerprint, so nothing has to be downloaded and no
// other party can mint a purchase.
import { X509Certificate, verify as verifySignature } from "node:crypto";

export const APPLE_BUNDLE_ID = "io.wondish.clara.app";

export const APPLE_PRODUCTS = {
  monthly: "io.wondish.clara.app.premium.monthly",
  yearly: "io.wondish.clara.app.premium.yearly",
  lifetime: "io.wondish.clara.app.premium.lifetime",
} as const;

const KNOWN_PRODUCTS: ReadonlySet<string> = new Set(Object.values(APPLE_PRODUCTS));

// "Apple Root CA - G3", SHA-256. Checked on 2026-11-23 against the copy in
// macOS's own root store (security find-certificate -c "Apple Root CA - G3" -Z).
export const APPLE_ROOT_G3_SHA256 = "63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179";

// TestFlight, App Review and sandbox testers all buy in "Sandbox" (no money
// moves); the store itself is "Production". "Xcode" purchases are signed by
// the developer's Mac, not Apple, and fail the chain check anyway.
const ACCEPTED_ENVIRONMENTS: ReadonlySet<string> = new Set(["Production", "Sandbox"]);

export class AppleVerifyError extends Error {}
/** This Apple purchase already belongs to a different account. */
export class AppleOwnershipError extends Error {}

export type AppleTransaction = {
  bundleId: string;
  productId: string;
  originalTransactionId: string;
  /** Milliseconds. Absent for the lifetime purchase. */
  expiresDate?: number;
  /** Milliseconds. Set when Apple refunded or revoked the purchase. */
  revocationDate?: number;
  environment?: string;
  signedDate?: number;
};

function fingerprint(cert: X509Certificate): string {
  return cert.fingerprint256.replace(/:/g, "").toUpperCase();
}

function decodePart(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new AppleVerifyError("not a signed Apple payload");
  }
}

/**
 * Verifies a JWS from Apple and returns its payload. Throws AppleVerifyError
 * unless the certificate chain in the header ends at the pinned root, every
 * certificate was valid when the payload was signed, and the signature is the
 * leaf certificate's.
 */
export function verifyAppleJws<T extends { signedDate?: number }>(
  jws: string,
  rootSha256: string = APPLE_ROOT_G3_SHA256,
  now: Date = new Date()
): T {
  const parts = typeof jws === "string" ? jws.split(".") : [];
  if (parts.length !== 3) throw new AppleVerifyError("not a signed Apple payload");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart(headerPart) as { alg?: unknown; x5c?: unknown };
  if (header.alg !== "ES256") throw new AppleVerifyError("unexpected signing algorithm");
  const x5c = Array.isArray(header.x5c) ? header.x5c.filter((c): c is string => typeof c === "string") : [];
  // Leaf, intermediate, root: Apple always sends all three.
  if (x5c.length !== 3) throw new AppleVerifyError("unexpected certificate chain");

  let certs: X509Certificate[];
  try {
    certs = x5c.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  } catch {
    throw new AppleVerifyError("unreadable certificate");
  }
  const [leaf, intermediate, root] = certs;
  if (fingerprint(root) !== rootSha256.toUpperCase()) throw new AppleVerifyError("chain does not end at Apple's root");
  if (!root.ca || !intermediate.ca) throw new AppleVerifyError("issuer is not a certificate authority");
  if (!root.verify(root.publicKey) || !intermediate.verify(root.publicKey) || !leaf.verify(intermediate.publicKey)) {
    throw new AppleVerifyError("broken certificate chain");
  }

  const valid = verifySignature(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signaturePart, "base64url")
  );
  if (!valid) throw new AppleVerifyError("bad signature");

  const payload = decodePart(payloadPart) as T;
  // Certificates are judged at the moment Apple signed, so an old but genuine
  // transaction still verifies after its leaf certificate has rolled over.
  const at = typeof payload?.signedDate === "number" ? new Date(payload.signedDate) : now;
  for (const cert of certs) {
    if (at < new Date(cert.validFrom) || at > new Date(cert.validTo)) {
      throw new AppleVerifyError("certificate not valid at signing time");
    }
  }
  return payload;
}

/** Verifies a signed transaction and checks it is a Clara Premium purchase. */
export function readAppleTransaction(jws: string, rootSha256?: string): AppleTransaction {
  const tx = verifyAppleJws<AppleTransaction>(jws, rootSha256);
  if (tx.bundleId !== APPLE_BUNDLE_ID) throw new AppleVerifyError("purchase is for another app");
  if (!KNOWN_PRODUCTS.has(tx.productId)) throw new AppleVerifyError("unknown product");
  if (typeof tx.originalTransactionId !== "string" || !tx.originalTransactionId) {
    throw new AppleVerifyError("transaction has no id");
  }
  if (!ACCEPTED_ENVIRONMENTS.has(tx.environment ?? "")) throw new AppleVerifyError("unexpected environment");
  return tx;
}

export type AppleRow = {
  plan: "PREMIUM";
  status: "ACTIVE" | "CANCELED";
  appleOriginalTransactionId: string;
  appleProductId: string;
  /** Null for lifetime: it never lapses. */
  appleExpiresAt: Date | null;
  canceledAt: Date | null;
};

/** Pure: what the APPLE subscription row should say for this transaction. */
export function appleRowFromTransaction(tx: AppleTransaction, now: Date = new Date()): AppleRow {
  const base = {
    plan: "PREMIUM" as const,
    appleOriginalTransactionId: tx.originalTransactionId,
    appleProductId: tx.productId,
  };
  const expiresAt = typeof tx.expiresDate === "number" ? new Date(tx.expiresDate) : null;
  if (typeof tx.revocationDate === "number") {
    return { ...base, status: "CANCELED", appleExpiresAt: expiresAt, canceledAt: new Date(tx.revocationDate) };
  }
  if (tx.productId === APPLE_PRODUCTS.lifetime) {
    return { ...base, status: "ACTIVE", appleExpiresAt: null, canceledAt: null };
  }
  // A subscription with no end date is malformed: treat it as already over.
  if (!expiresAt) return { ...base, status: "CANCELED", appleExpiresAt: null, canceledAt: now };
  // A lapsed subscription keeps its row (status ACTIVE, end in the past):
  // hasActivePremium cuts access a day after the end, which covers a renewal
  // notice that arrives late.
  return { ...base, status: "ACTIVE", appleExpiresAt: expiresAt, canceledAt: null };
}

export function isLiveLifetime(row: { status: string; appleProductId?: string | null } | null | undefined): boolean {
  return !!row && row.status === "ACTIVE" && row.appleProductId === APPLE_PRODUCTS.lifetime;
}

type ExistingRow = {
  accountId: string;
  status: string;
  appleOriginalTransactionId: string | null;
  appleProductId: string | null;
};

export type AppleDb = {
  subscription: {
    findUnique(args: { where: { appleOriginalTransactionId: string } }): Promise<ExistingRow | null>;
    findFirst(args: { where: { accountId: string; source: "APPLE" } }): Promise<ExistingRow | null>;
    upsert(args: {
      where: { accountId_source: { accountId: string; source: "APPLE" } };
      update: AppleRow;
      create: AppleRow & { accountId: string; source: "APPLE" };
    }): Promise<unknown>;
    updateMany(args: { where: { appleOriginalTransactionId: string }; data: AppleRow }): Promise<unknown>;
  };
};

/**
 * A purchase the signed-in person's phone reported: binds it to their account.
 * One Apple purchase belongs to one account; a second account presenting the
 * same purchase gets AppleOwnershipError. A lifetime purchase already on the
 * account is never replaced by a subscription.
 */
export async function claimAppleTransaction(db: AppleDb, accountId: string, tx: AppleTransaction, now = new Date()) {
  const holder = await db.subscription.findUnique({ where: { appleOriginalTransactionId: tx.originalTransactionId } });
  if (holder && holder.accountId !== accountId) throw new AppleOwnershipError("purchase belongs to another account");
  const current = await db.subscription.findFirst({ where: { accountId, source: "APPLE" } });
  const row = appleRowFromTransaction(tx, now);
  const sameTransaction = current?.appleOriginalTransactionId === tx.originalTransactionId;
  if (isLiveLifetime(current) && !sameTransaction) return;
  // An older, dead transaction never overwrites a live different one.
  if (current && !sameTransaction && current.status === "ACTIVE" && row.status !== "ACTIVE") return;
  await db.subscription.upsert({
    where: { accountId_source: { accountId, source: "APPLE" } },
    update: row,
    create: { ...row, accountId, source: "APPLE" },
  });
}

/** A notification from Apple: updates the row that holds this purchase, if any. */
export async function refreshAppleTransaction(db: AppleDb, tx: AppleTransaction, now = new Date()) {
  await db.subscription.updateMany({
    where: { appleOriginalTransactionId: tx.originalTransactionId },
    data: appleRowFromTransaction(tx, now),
  });
}
