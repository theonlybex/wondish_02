# Restaurants Phase 3 — QR Attribution + Ops Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A diner scans a restaurant's table QR code, signs up, and that account is permanently attributed to that restaurant — and Wondish ops can see the resulting scans, sign-ups and conversion at `/admin/referrals`.

**Architecture:** `GET /r/[token]` is a public route that counts the scan and either records the referral (already signed in) or drops a short-lived httpOnly cookie and sends the visitor to sign-up. Because the register page hard-codes Clerk's `forceRedirectUrl`, the cookie — not a query param — is the carrier across the sign-up round-trip; a new `GET /r/claim` becomes the post-sign-up destination, redeems the cookie, and forwards to the restaurant menu (or to normal onboarding when there is no cookie). Attribution is one `RestaurantReferral` row, unique per (account, restaurant). Every decision rule is a pure function in `lib/restaurant-referrals.ts` with unit tests; DB-coupled writes get stub-based tests using the established `globalThis.prisma` technique.

**Tech Stack:** Next.js 14 App Router (server components + route handlers), Prisma 5 + Postgres (Neon), Clerk, Tailwind, `node:test` via `npm test`.

## Global Constraints

- **Spec of record:** `docs/restaurants/phase-3.md` §1, §2, §5. The discount rail (§3, `SignupDiscount`, `DiscountDelivery`) is **explicitly out of scope** — blocked on the open business questions.
- **Ops-only reporting.** `/admin/referrals` and all referral APIs use `requireAdmin` (SUPER). Restaurant owners get nothing new in the portal.
- **Attribution is single-issue:** `@@unique([accountId, restaurantId])` on `RestaurantReferral`. Re-scanning must never create a second row or double-count a sign-up.
- **Funnel status is derived, never stored** — it is computed from `Account.onboardingComplete` so it cannot drift.
- **Never run `npm run build` while a dev server is running** — it clobbers `.next` and the site renders unstyled. Use `npm test` + `npx tsc --noEmit`; build only with the dev server stopped.
- **Migrations are additive.** Follow the existing naming: `prisma/migrations/YYYYMMDDHHMMSS_snake_name/migration.sql`.
- **Baseline before starting:** suite 977 passing, `npx tsc --noEmit` reports 19 pre-existing errors (all in `*.test.ts` files: `data/dishes.test.ts`, `lib/meal-plan.test.ts`, `lib/plan-exchanges.test.ts`). Do not "fix" those; do not let the count rise.
- **Commit style:** `feat(restaurants):` / `fix(restaurants):` / `test(restaurants):`, body explains *why*, ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Created:**
- `prisma/migrations/20260813000000_restaurant_qr_referrals/migration.sql` — the two new tables
- `lib/restaurant-referrals.ts` — pure rules: funnel state, conversion rate, token validation
- `lib/restaurant-referrals.test.ts` — unit tests for the above
- `lib/restaurant-referrals-server.ts` — `recordReferral`, `resolveQrToken`, `mintQrCode`, `listReferrals`
- `lib/restaurant-referrals-server.test.ts` — stub-based tests for the write path
- `app/r/[token]/route.ts` — public scan entry point
- `app/r/claim/route.ts` — post-sign-up cookie redemption
- `app/api/admin/restaurants/[id]/qr-codes/route.ts` — GET list, POST mint
- `app/api/admin/restaurants/[id]/qr-codes/[codeId]/route.ts` — PATCH active toggle
- `app/api/admin/referrals/route.ts` — ops list + aggregates
- `app/(dashboard)/admin/referrals/page.tsx` — the ops screen
- `components/admin/QrCodePanel.tsx` — QR tab on the restaurant admin page

**Modified:**
- `prisma/schema.prisma` — two models + back-relations on `Account` and `Restaurant`
- `middleware.ts` — `isPublicRoute` gains `/r/(.*)`
- `app/(auth)/register/[[...rest]]/page.tsx` — `forceRedirectUrl` → `/r/claim`
- `app/(dashboard)/admin/restaurants/[id]/page.tsx` — mount the QR tab
- `components/dashboard/DashboardSidebar.tsx` — admin "Referrals" entry
- `messages/en.json`, `messages/es.json`, `messages/ru.json` — `sidebar.referrals`
- `docs/restaurants/phase-3.md` — as-built note

---

### Task 1: Schema + migration for QR codes and referrals

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260813000000_restaurant_qr_referrals/migration.sql`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: Prisma models `RestaurantQrCode { id, restaurantId, token, label, active, scans, signups, createdAt }` and `RestaurantReferral { id, accountId, restaurantId, restaurantQrCodeId, signedUpAt }`, both available as `prisma.restaurantQrCode` / `prisma.restaurantReferral`.

- [ ] **Step 1: Add the models to `prisma/schema.prisma`**

Append after the `RestaurantDishRevision` model:

```prisma
// Phase 3 §1 — a scannable code placed in a restaurant. One code or one per
// table; `label` is how ops tells them apart ("Table 7", "Front window").
// Counters are denormalised so the ops strip needs no aggregate scan.
model RestaurantQrCode {
  id           String     @id @default(cuid())
  restaurantId String
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  token        String     @unique // the value encoded in the QR image
  label        String
  active       Boolean    @default(true)
  scans        Int        @default(0)
  signups      Int        @default(0)
  createdAt    DateTime   @default(now())

  referrals RestaurantReferral[]

  @@index([restaurantId, active])
}

// Phase 3 §2 — the attribution spine: which restaurant earned which account.
// Unique per (account, restaurant) so a re-scan can never double-attribute.
// The QR code is nullable and SetNull: deleting a retired code must not erase
// the sign-ups it earned.
model RestaurantReferral {
  id                 String            @id @default(cuid())
  accountId          String
  account            Account           @relation(fields: [accountId], references: [id], onDelete: Cascade)
  restaurantId       String
  restaurant         Restaurant        @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  restaurantQrCodeId String?
  qrCode             RestaurantQrCode? @relation(fields: [restaurantQrCodeId], references: [id], onDelete: SetNull)
  signedUpAt         DateTime          @default(now())

  @@unique([accountId, restaurantId])
  @@index([restaurantId, signedUpAt])
}
```

- [ ] **Step 2: Add the back-relations**

In `model Account`, add to the relation block (after `restaurantStaff RestaurantStaff[]`):

```prisma
  restaurantReferrals RestaurantReferral[]
```

In `model Restaurant`, add after `dishRevisions RestaurantDishRevision[]`:

```prisma
  qrCodes   RestaurantQrCode[]
  referrals RestaurantReferral[]
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260813000000_restaurant_qr_referrals/migration.sql`:

```sql
-- Phase 3 §1/§2 (docs/restaurants/phase-3.md). Additive only: QR codes and
-- the referral attribution spine. No existing table is altered.

CREATE TABLE "RestaurantQrCode" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scans" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantQrCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantQrCode_token_key" ON "RestaurantQrCode"("token");
CREATE INDEX "RestaurantQrCode_restaurantId_active_idx"
  ON "RestaurantQrCode"("restaurantId", "active");

ALTER TABLE "RestaurantQrCode"
  ADD CONSTRAINT "RestaurantQrCode_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantReferral" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "restaurantQrCodeId" TEXT,
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantReferral_accountId_restaurantId_key"
  ON "RestaurantReferral"("accountId", "restaurantId");
CREATE INDEX "RestaurantReferral_restaurantId_signedUpAt_idx"
  ON "RestaurantReferral"("restaurantId", "signedUpAt");

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_restaurantQrCodeId_fkey"
  FOREIGN KEY ("restaurantQrCodeId") REFERENCES "RestaurantQrCode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate the client and apply the migration**

Run: `npx prisma generate && npx prisma migrate deploy`
Expected: `All migrations have been successfully applied.`

Then run: `npx prisma migrate status`
Expected: `Database schema is up to date!`

> **Note:** local `DATABASE_URL` points at the same Neon database as production. These statements are additive (`CREATE TABLE` / `CREATE INDEX` only), so this is safe, but say so in the commit.

- [ ] **Step 5: Verify the tables are queryable**

Run: `npx tsx -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.restaurantQrCode.count().then(n=>{console.log('qr codes:',n);return p.restaurantReferral.count()}).then(n=>{console.log('referrals:',n);return p.\$disconnect()})"`
Expected: `qr codes: 0` and `referrals: 0`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(restaurants): Phase 3 schema — QR codes + referral attribution

Additive migration: RestaurantQrCode (token, label, active, scans/signups
counters) and RestaurantReferral, unique per (account, restaurant) so a
re-scan can never double-attribute. The QR pointer is nullable + SetNull:
retiring a code must not erase the sign-ups it earned.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure referral rules

**Files:**
- Create: `lib/restaurant-referrals.ts`
- Test: `lib/restaurant-referrals.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ReferralFunnelState = "signed_up" | "profile_complete"`
  - `referralFunnelState(account: { onboardingComplete: boolean }): ReferralFunnelState`
  - `conversionRate(scans: number, signups: number): number | null`
  - `formatConversionRate(rate: number | null): string`
  - `isValidQrToken(raw: unknown): raw is string`
  - `QR_TOKEN_LENGTH: number` (= 12)

- [ ] **Step 1: Write the failing test**

Create `lib/restaurant-referrals.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  referralFunnelState,
  conversionRate,
  formatConversionRate,
  isValidQrToken,
  QR_TOKEN_LENGTH,
} from "./restaurant-referrals";

// Phase 3 §5. Funnel state is DERIVED from the account, never stored — a
// stored copy would drift from the account it describes.
describe("referralFunnelState", () => {
  it("is signed_up before onboarding completes", () => {
    assert.equal(referralFunnelState({ onboardingComplete: false }), "signed_up");
  });

  it("is profile_complete once onboarding completes", () => {
    assert.equal(referralFunnelState({ onboardingComplete: true }), "profile_complete");
  });
});

// The pilot's headline number. Zero scans is "no data", NOT 0% — reporting a
// hard zero for a code nobody has scanned would read as a failing code.
describe("conversionRate", () => {
  it("is null when nothing has been scanned", () => {
    assert.equal(conversionRate(0, 0), null);
  });

  it("computes signups over scans", () => {
    assert.equal(conversionRate(10, 3), 0.3);
  });

  it("is 0 for scans that produced no signups", () => {
    assert.equal(conversionRate(10, 0), 0);
  });

  // Defensive: counters are incremented by separate code paths, so a signup
  // recorded without its scan must not render as 250%.
  it("clamps above 1 rather than reporting an impossible rate", () => {
    assert.equal(conversionRate(2, 5), 1);
  });

  it("treats negative counters as no data", () => {
    assert.equal(conversionRate(-1, 3), null);
  });
});

describe("formatConversionRate", () => {
  it("renders a dash when there is no data", () => {
    assert.equal(formatConversionRate(null), "—");
  });

  it("renders whole percents", () => {
    assert.equal(formatConversionRate(0.3), "30%");
  });

  it("rounds to the nearest percent", () => {
    assert.equal(formatConversionRate(0.336), "34%");
  });
});

// The token comes off a URL a stranger controls, so it is validated before it
// ever reaches a query.
describe("isValidQrToken", () => {
  it("accepts a well-formed token", () => {
    assert.equal(isValidQrToken("a".repeat(QR_TOKEN_LENGTH)), true);
  });

  it("rejects the wrong length", () => {
    assert.equal(isValidQrToken("abc"), false);
  });

  it("rejects non-alphanumeric characters", () => {
    assert.equal(isValidQrToken("../".padEnd(QR_TOKEN_LENGTH, "a")), false);
  });

  it("rejects non-strings", () => {
    assert.equal(isValidQrToken(null), false);
    assert.equal(isValidQrToken(123), false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --import tsx --test lib/restaurant-referrals.test.ts`
Expected: FAIL — `Cannot find module './restaurant-referrals'`

- [ ] **Step 3: Write the implementation**

Create `lib/restaurant-referrals.ts`:

```ts
// Phase 3 — pure rules behind QR attribution and the ops reporting screen
// (docs/restaurants/phase-3.md §5). Kept out of routes and JSX so the numbers
// ops judges the pilot on are unit-tested.

export type ReferralFunnelState = "signed_up" | "profile_complete";

/// Derived, never stored: a stored copy would drift from the account.
export function referralFunnelState(account: { onboardingComplete: boolean }): ReferralFunnelState {
  return account.onboardingComplete ? "profile_complete" : "signed_up";
}

/// null means "no data" — a code nobody has scanned has no conversion rate,
/// and rendering 0% for it would read as a code that is failing.
export function conversionRate(scans: number, signups: number): number | null {
  if (!Number.isFinite(scans) || !Number.isFinite(signups)) return null;
  if (scans <= 0) return null;
  if (signups <= 0) return 0;
  // Counters are bumped by separate paths (scan on /r/[token], signup on
  // claim); a lost scan must not surface as an impossible >100% rate.
  return Math.min(signups / scans, 1);
}

export function formatConversionRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export const QR_TOKEN_LENGTH = 12;

const TOKEN_RE = /^[A-Za-z0-9]+$/;

/// The token arrives from a URL under a stranger's control. Validate shape
/// before it reaches a query.
export function isValidQrToken(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length === QR_TOKEN_LENGTH && TOKEN_RE.test(raw);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --import tsx --test lib/restaurant-referrals.test.ts`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add lib/restaurant-referrals.ts lib/restaurant-referrals.test.ts
git commit -m "feat(restaurants): pure referral rules — funnel state, conversion rate

Funnel state is derived from the account rather than stored, so it cannot
drift. conversionRate returns null for zero scans (no data, not 0%) and
clamps above 1, because scans and signups are incremented by different
code paths and a lost scan must not surface as 250%.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Referral write path (server lib)

**Files:**
- Create: `lib/restaurant-referrals-server.ts`
- Test: `lib/restaurant-referrals-server.test.ts`

**Interfaces:**
- Consumes: `isValidQrToken`, `QR_TOKEN_LENGTH` from Task 2; Prisma models from Task 1
- Produces:
  - `generateQrToken(): string`
  - `resolveQrToken(token: string): Promise<{ id, restaurantId, restaurantSlug, active } | null>`
  - `recordReferral(args: { accountId, qrCodeId, restaurantId }): Promise<"created" | "already">`
  - `recordScan(qrCodeId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `lib/restaurant-referrals-server.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --import tsx --test lib/restaurant-referrals-server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `lib/restaurant-referrals-server.ts`:

```ts
// Phase 3 §1/§2 — the QR scan and attribution write path.
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidQrToken, QR_TOKEN_LENGTH } from "@/lib/restaurant-referrals";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/// Ambiguous glyphs (0/O, 1/l/I) are omitted: these get printed on a table
/// tent and occasionally typed by hand.
export function generateQrToken(): string {
  const bytes = randomBytes(QR_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < QR_TOKEN_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export interface ResolvedQrCode {
  id: string;
  restaurantId: string;
  restaurantSlug: string;
}

export async function resolveQrToken(token: string): Promise<ResolvedQrCode | null> {
  if (!isValidQrToken(token)) return null;
  const row = await prisma.restaurantQrCode.findUnique({
    where: { token },
    select: { id: true, restaurantId: true, active: true, restaurant: { select: { slug: true } } },
  });
  if (!row || !row.active) return null;
  return { id: row.id, restaurantId: row.restaurantId, restaurantSlug: row.restaurant.slug };
}

export async function recordScan(qrCodeId: string): Promise<void> {
  await prisma.restaurantQrCode.update({
    where: { id: qrCodeId },
    data: { scans: { increment: 1 } },
  });
}

/// Idempotent by design: re-scanning is normal behaviour. A second call must
/// neither create a duplicate row nor inflate the pilot's signup count.
export async function recordReferral(args: {
  accountId: string;
  qrCodeId: string;
  restaurantId: string;
}): Promise<"created" | "already"> {
  const existing = await prisma.restaurantReferral.findUnique({
    where: { accountId_restaurantId: { accountId: args.accountId, restaurantId: args.restaurantId } },
    select: { id: true },
  });
  if (existing) return "already";

  try {
    await prisma.restaurantReferral.create({
      data: {
        accountId: args.accountId,
        restaurantId: args.restaurantId,
        restaurantQrCodeId: args.qrCodeId,
      },
    });
  } catch (err) {
    // Lost a race with a concurrent claim — the other request already
    // attributed this account, so the outcome is the same.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "already";
    if ((err as { code?: string })?.code === "P2002") return "already";
    throw err;
  }

  await prisma.restaurantQrCode.update({
    where: { id: args.qrCodeId },
    data: { signups: { increment: 1 } },
  });
  return "created";
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --import tsx --test lib/restaurant-referrals-server.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Verify the tests have teeth (mutation check)**

Temporarily change `if (existing) return "already";` to `if (false) return "already";`, re-run the test file, and confirm the idempotency test FAILS. Restore the line and confirm the suite passes again.

- [ ] **Step 6: Commit**

```bash
git add lib/restaurant-referrals-server.ts lib/restaurant-referrals-server.test.ts
git commit -m "feat(restaurants): QR resolve + idempotent referral write

recordReferral is idempotent on both the read check and a P2002 race: a
re-scan is normal behaviour and must neither duplicate the attribution row
nor inflate the pilot's signup counter. Tokens avoid ambiguous glyphs —
these get printed on table tents and sometimes typed by hand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `GET /r/[token]` — the public scan entry point

**Files:**
- Create: `app/r/[token]/route.ts`
- Modify: `middleware.ts` (add `/r/(.*)` to `isPublicRoute`)

**Interfaces:**
- Consumes: `resolveQrToken`, `recordScan`, `recordReferral` (Task 3)
- Produces: the cookie contract `wondish_ref` = the QR token, httpOnly, `sameSite: "lax"`, `maxAge` 1800s — read by Task 5.

- [ ] **Step 1: Add the route to the public matcher**

In `middleware.ts`, inside `isPublicRoute`'s array, after the `/restaurants(.*)` entry:

```ts
  // Phase 3: the QR scan entry point. The whole point is that a diner with no
  // account can scan a table code — this must never redirect to login.
  "/r/(.*)",
```

- [ ] **Step 2: Write the route**

Create `app/r/[token]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import {
  resolveQrToken,
  recordScan,
  recordReferral,
} from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — the QR scan entry point (docs/restaurants/phase-3.md).
// Public by design: the visitor has no account yet. Two outcomes:
//   signed in  -> attribute now, drop them on the menu
//   signed out -> remember the code in a cookie, send them to sign up
// The cookie (not a query param) is the carrier because the register page
// hard-codes Clerk's forceRedirectUrl, so a redirect_url would be discarded.
export const dynamic = "force-dynamic";

export const REFERRAL_COOKIE = "wondish_ref";
const REFERRAL_COOKIE_MAX_AGE = 30 * 60; // 30 minutes — one sitting

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const code = await resolveQrToken(params.token);

  // Unknown or retired code: send them to the directory rather than a dead
  // end. A stale table tent should still land somewhere useful.
  if (!code) return NextResponse.redirect(new URL("/restaurants", _req.url));

  await recordScan(code.id);

  const { userId } = await auth();
  if (userId) {
    const account = await getOrCreateAccount(userId);
    await recordReferral({
      accountId: account.id,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
    });
    return NextResponse.redirect(new URL(`/restaurants/${code.restaurantSlug}`, _req.url));
  }

  const res = NextResponse.redirect(new URL("/register", _req.url));
  res.cookies.set(REFERRAL_COOKIE, params.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `19` (the pre-existing baseline — no new errors)

- [ ] **Step 4: Verify the route by hand**

With the dev server running (`npm run dev`), mint a code directly:

```bash
npx tsx -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.restaurant.findFirst({where:{status:'PUBLISHED'},select:{id:true,slug:true}}).then(r=>
  p.restaurantQrCode.create({data:{restaurantId:r.id,token:'TESTTOKEN123',label:'Table 1'}})
).then(c=>{console.log('token:',c.token);return p.\$disconnect()})"
```

Then run: `curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/r/TESTTOKEN123`
Expected: `307 -> http://localhost:3000/register`

Run it again and confirm the scan counter advanced:
`npx tsx -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.restaurantQrCode.findUnique({where:{token:'TESTTOKEN123'}}).then(c=>{console.log('scans:',c.scans);return p.\$disconnect()})"`
Expected: `scans: 2`

Also check an unknown token redirects to the directory:
`curl -s -o /dev/null -w "%{redirect_url}\n" http://localhost:3000/r/NOSUCHTOKEN1`
Expected: `http://localhost:3000/restaurants`

- [ ] **Step 5: Commit**

```bash
git add app/r middleware.ts
git commit -m "feat(restaurants): GET /r/[token] — QR scan entry point

Public route: the visitor has no account yet, which is the entire point.
Signed in, it attributes immediately and drops them on the menu; signed
out, it remembers the code in an httpOnly cookie and sends them to sign
up. The cookie carries the referral rather than a query param because the
register page hard-codes Clerk's forceRedirectUrl, which discards one.

An unknown or retired token redirects to the directory instead of 404ing —
a stale table tent should still land somewhere useful.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `GET /r/claim` — redeem the cookie after sign-up

**Files:**
- Create: `app/r/claim/route.ts`
- Modify: `app/(auth)/register/[[...rest]]/page.tsx:10` (`forceRedirectUrl`)

**Interfaces:**
- Consumes: `REFERRAL_COOKIE` (Task 4), `resolveQrToken` / `recordReferral` (Task 3)
- Produces: nothing later tasks depend on

> **Route ordering note:** `app/r/claim/route.ts` is a static segment and takes
> precedence over the dynamic `app/r/[token]/route.ts`, so `/r/claim` never
> resolves as a token. `claim` is 5 characters and `QR_TOKEN_LENGTH` is 12, so
> it could not be a valid token anyway.

- [ ] **Step 1: Write the route**

Create `app/r/claim/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import { resolveQrToken, recordReferral } from "@/lib/restaurant-referrals-server";
import { REFERRAL_COOKIE } from "@/app/r/[token]/route";

// Phase 3 §2 — where Clerk lands EVERY new sign-up (the register page's
// forceRedirectUrl). If a QR cookie is present the account is attributed and
// dropped on that restaurant's menu; otherwise this is a pass-through to the
// normal onboarding destination.
//
// Because every sign-up flows through here, it must never be able to break
// sign-up: any failure falls through to the normal destination.
export const dynamic = "force-dynamic";

const FALLBACK = "/profile?onboarding=true";

export async function GET(req: NextRequest) {
  const fallback = NextResponse.redirect(new URL(FALLBACK, req.url));

  try {
    const token = req.cookies.get(REFERRAL_COOKIE)?.value;
    if (!token) return fallback;

    const { userId } = await auth();
    if (!userId) return fallback;

    const code = await resolveQrToken(token);
    if (!code) {
      fallback.cookies.delete(REFERRAL_COOKIE);
      return fallback;
    }

    const account = await getOrCreateAccount(userId);
    await recordReferral({
      accountId: account.id,
      qrCodeId: code.id,
      restaurantId: code.restaurantId,
    });

    const res = NextResponse.redirect(new URL(`/restaurants/${code.restaurantSlug}`, req.url));
    res.cookies.delete(REFERRAL_COOKIE);
    return res;
  } catch (err) {
    // Attribution is worth less than a working sign-up.
    console.error("[referrals] claim failed; falling through to onboarding", err);
    return fallback;
  }
}
```

- [ ] **Step 2: Point sign-up at it**

In `app/(auth)/register/[[...rest]]/page.tsx`, change:

```tsx
        forceRedirectUrl="/profile?onboarding=true"
```

to:

```tsx
        // Phase 3: every sign-up lands on /r/claim, which redeems a QR
        // referral cookie when present and otherwise forwards to onboarding.
        forceRedirectUrl="/r/claim"
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `19`

- [ ] **Step 4: Verify the pass-through case (no cookie)**

Run: `curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/r/claim`
Expected: `307 -> http://localhost:3000/profile?onboarding=true`

This is the important one: a signed-out visitor with no cookie must reach the normal onboarding destination, because every sign-up now passes through this route.

- [ ] **Step 5: Verify the attribution case end to end (manual, browser)**

1. Sign out.
2. Visit `http://localhost:3000/r/TESTTOKEN123` → lands on `/register`.
3. Complete sign-up with a fresh email.
4. Expect to land on `/restaurants/<slug>` for the seeded restaurant.
5. Confirm the row and the counter:

```bash
npx tsx -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.restaurantReferral.findMany({include:{account:{select:{email:true}},restaurant:{select:{name:true}}}})
 .then(r=>{console.log(JSON.stringify(r.map(x=>({email:x.account.email,restaurant:x.restaurant.name})),null,2));
 return p.restaurantQrCode.findUnique({where:{token:'TESTTOKEN123'}})})
 .then(c=>{console.log('scans',c.scans,'signups',c.signups);return p.\$disconnect()})"
```

Expected: exactly one referral row for the new email, and `signups` = 1.

6. Visit `/r/TESTTOKEN123` again while signed in as that user; confirm `signups` is **still 1** (idempotent) and `scans` incremented.

- [ ] **Step 6: Commit**

```bash
git add app/r/claim "app/(auth)/register"
git commit -m "feat(restaurants): /r/claim — redeem the QR referral after sign-up

Every sign-up now lands here (register's forceRedirectUrl). With a QR
cookie it attributes the account and drops them on that restaurant's menu;
without one it forwards to the normal onboarding destination.

Because the whole sign-up flow passes through this route, every failure
path falls through to onboarding — attribution is worth considerably less
than a working sign-up.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Admin QR-code management

**Files:**
- Create: `app/api/admin/restaurants/[id]/qr-codes/route.ts`
- Create: `app/api/admin/restaurants/[id]/qr-codes/[codeId]/route.ts`
- Create: `components/admin/QrCodePanel.tsx`
- Modify: `app/(dashboard)/admin/restaurants/[id]/page.tsx` (mount the tab)

**Interfaces:**
- Consumes: `generateQrToken` (Task 3)
- Produces: `GET/POST /api/admin/restaurants/[id]/qr-codes`, `PATCH .../[codeId]`

- [ ] **Step 1: Write the list + mint endpoint**

Create `app/api/admin/restaurants/[id]/qr-codes/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { generateQrToken } from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — ops mints and labels the codes that go on tables.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const codes = await prisma.restaurantQrCode.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, token: true, label: true, active: true, scans: true, signups: true, createdAt: true },
    });
    return NextResponse.json({ codes });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 60) {
      return NextResponse.json({ error: "A label is required (max 60 characters)" }, { status: 400 });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const code = await prisma.restaurantQrCode.create({
      data: { restaurantId: params.id, token: generateQrToken(), label },
      select: { id: true, token: true, label: true, active: true, scans: true, signups: true, createdAt: true },
    });
    return NextResponse.json({ code }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 2: Write the activate/deactivate endpoint**

Create `app/api/admin/restaurants/[id]/qr-codes/[codeId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

// Codes are deactivated, never deleted: the referrals they earned point at
// them, and the pilot's history should stay readable.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; codeId: string } }
) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { active?: unknown } | null;
    if (typeof body?.active !== "boolean") {
      return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
    }
    const updated = await prisma.restaurantQrCode.updateMany({
      where: { id: params.codeId, restaurantId: params.id },
      data: { active: body.active },
    });
    if (updated.count === 0) return NextResponse.json({ error: "QR code not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 3: Build the panel**

Create `components/admin/QrCodePanel.tsx`. Model it on `components/admin/RestaurantStaffPanel.tsx` — same load-on-mount, same `Button`/`Badge` imports, same error/notice state. It must render, for each code: the label, the full scan URL (`{origin}/r/{token}`) with a copy button, `scans` / `signups` / conversion (via `formatConversionRate(conversionRate(scans, signups))` from `lib/restaurant-referrals`), an Active/Inactive badge, and a toggle calling `PATCH`. Above the list, a single-field form (label) that POSTs to mint a new code.

Requirements to honour: every interactive control has a `min-h-[44px]` tap target and a `focus-visible:ring-2` ring; the deactivate toggle is a `Button variant="secondary"` (deactivating is reversible, so it needs no confirm modal); a `catch` around each `fetch` sets `"Network error — try again."` without masking a server `body.error`.

- [ ] **Step 4: Mount it on the restaurant admin page**

In `app/(dashboard)/admin/restaurants/[id]/page.tsx`, add a "QR codes" tab beside the existing Staff tab, rendering `<QrCodePanel restaurantId={params.id} />`. Follow exactly how `RestaurantStaffPanel` is mounted there.

- [ ] **Step 5: Verify**

Run: `npm test` → expect all passing (no new tests in this task)
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect `19`

In the browser as a SUPER user, open `/admin/restaurants/<id>`, mint a code labelled "Table 9", confirm it appears with a copy-able URL, then paste that URL into a signed-out window and confirm it redirects to `/register`.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/restaurants components/admin/QrCodePanel.tsx "app/(dashboard)/admin/restaurants"
git commit -m "feat(restaurants): admin QR code minting and management

Ops mints, labels, and deactivates the codes that go on tables, and sees
each code's scans/signups/conversion. Codes deactivate rather than delete:
the referrals they earned point at them, and the pilot's history should
stay readable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `/admin/referrals` — the ops reporting screen

**Files:**
- Create: `app/api/admin/referrals/route.ts`
- Create: `app/(dashboard)/admin/referrals/page.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx` (admin block)
- Modify: `messages/en.json`, `messages/es.json`, `messages/ru.json`

**Interfaces:**
- Consumes: `referralFunnelState`, `conversionRate`, `formatConversionRate` (Task 2)
- Produces: `GET /api/admin/referrals?restaurantId=&search=` → `{ totals: { scans, signups, conversion }, rows: Array<{ id, accountId, email, name, restaurantId, restaurantName, qrLabel, status, signedUpAt }> }`

- [ ] **Step 1: Write the API**

Create `app/api/admin/referrals/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { referralFunnelState, conversionRate } from "@/lib/restaurant-referrals";

// Phase 3 §5 — ops-only referral reporting. Two halves, because a scan is
// anonymous: aggregate counters on top, one row per referred ACCOUNT below.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const restaurantId = searchParams.get("restaurantId")?.trim() || null;
    const search = searchParams.get("search")?.trim() || null;

    const where = {
      ...(restaurantId ? { restaurantId } : {}),
      ...(search
        ? { account: { email: { contains: search, mode: "insensitive" as const } } }
        : {}),
    };

    const [rows, counters] = await Promise.all([
      prisma.restaurantReferral.findMany({
        where,
        orderBy: { signedUpAt: "desc" },
        take: 200,
        select: {
          id: true,
          signedUpAt: true,
          accountId: true,
          account: { select: { email: true, firstName: true, lastName: true, onboardingComplete: true } },
          restaurantId: true,
          restaurant: { select: { name: true } },
          qrCode: { select: { label: true } },
        },
      }),
      prisma.restaurantQrCode.aggregate({
        where: restaurantId ? { restaurantId } : {},
        _sum: { scans: true, signups: true },
      }),
    ]);

    const scans = counters._sum.scans ?? 0;
    const signups = counters._sum.signups ?? 0;

    return NextResponse.json({
      totals: { scans, signups, conversion: conversionRate(scans, signups) },
      rows: rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        email: r.account.email,
        name: [r.account.firstName, r.account.lastName].filter(Boolean).join(" ") || null,
        restaurantId: r.restaurantId,
        restaurantName: r.restaurant.name,
        qrLabel: r.qrCode?.label ?? null,
        status: referralFunnelState(r.account),
        signedUpAt: r.signedUpAt,
      })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 2: Build the page**

Create `app/(dashboard)/admin/referrals/page.tsx` as a client component, modelled on `app/(dashboard)/admin/users/page.tsx` (same page shell, `Select`/`Badge`/`Button` imports, same load-on-mount + search pattern).

It renders, in order:
1. An `h1` "Referrals" with a one-line description.
2. **The aggregate strip** — three tiles: Scans, Sign-ups, Conversion (`formatConversionRate(totals.conversion)`). Tiles use `tabular-nums`.
3. **Filters** — a restaurant `Select` (populated from `GET /api/admin/restaurants`) and an email search input.
4. **The table** — columns: Customer (name over email), Restaurant, QR code (`qrLabel ?? "—"`), Status, Signed up. Status renders `<Badge variant="success">Profile complete</Badge>` for `profile_complete` and `<Badge variant="neutral">Signed up</Badge>` for `signed_up`.
5. An empty state: "No referrals yet — mint a QR code on a restaurant's page and put it on a table."

Requirements: the table must scroll inside its own `overflow-x-auto` container so the page never scrolls horizontally on mobile; all controls get `min-h-[44px]` and `focus-visible:ring-2`.

- [ ] **Step 3: Add the sidebar entry and i18n keys**

In `components/dashboard/DashboardSidebar.tsx`, add to `adminItems` after the restaurants entry:

```tsx
    { href: "/admin/referrals", label: t("referrals"), icon: "📈" },
```

Add `"referrals"` to the `sidebar` object in all three message files, immediately after `"restaurants"`:
- `messages/en.json`: `"referrals": "Referrals",`
- `messages/es.json`: `"referrals": "Referencias",`
- `messages/ru.json`: `"referrals": "Рефералы",`

- [ ] **Step 4: Verify**

Run: `npm test` → all passing
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `19`
Run: `for f in en es ru; do python3 -c "import json;print('$f', json.load(open('messages/$f.json'))['sidebar']['referrals'])"; done`
Expected: the three labels above.

In the browser as SUPER, open `/admin/referrals`: the strip shows the scan/signup counts from Task 5's manual test, and the referral created there appears as a row with the right restaurant and status. Filter to that restaurant and confirm the strip recalculates.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/referrals "app/(dashboard)/admin/referrals" components/dashboard/DashboardSidebar.tsx messages
git commit -m "feat(restaurants): /admin/referrals — ops QR reporting

Attribution nobody can read is not attribution. Aggregate strip (scans,
sign-ups, conversion) over the active filter, plus one row per referred
account: customer, restaurant, which QR code earned it, funnel state.

A scan is anonymous, so 'scanned' is a counter rather than a row. Status
is derived from onboardingComplete at read time so it cannot drift.
Ops-only (requireAdmin) — owners get nothing new in the portal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Clean up the test fixture, document as-built, full verification

**Files:**
- Modify: `docs/restaurants/phase-3.md`

- [ ] **Step 1: Remove the manual test QR code**

```bash
npx tsx -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.restaurantQrCode.deleteMany({where:{token:'TESTTOKEN123'}})
 .then(r=>{console.log('deleted test codes:',r.count);return p.\$disconnect()})"
```

Leave any `RestaurantReferral` row created during testing — it is real attribution for a real test account, and deleting it would misrepresent the counters.

- [ ] **Step 2: Add the as-built note**

At the end of `docs/restaurants/phase-3.md` §5, add a block recording: what shipped (§1, §2, §5), that the discount rail (§3) is still unbuilt and why, that the referral carrier is a cookie because `forceRedirectUrl` is hard-coded, and that every sign-up now routes through `/r/claim` with a fall-through to onboarding on any failure.

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all passing, ~999 tests (977 baseline + 15 from Task 2 + 7 from Task 3)

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `19`

Stop the dev server, then run: `npm run build`
Expected: `✓ Compiled successfully`, with `/r/[token]`, `/r/claim`, `/admin/referrals` in the route table.

Restart the dev server with `rm -rf .next && npm run dev` and confirm a page's CSS chunk returns 200 with real bytes.

- [ ] **Step 4: Commit**

```bash
git add docs/restaurants/phase-3.md
git commit -m "docs(restaurants): Phase 3 attribution slice as-built

Records what shipped (§1 QR codes, §2 attribution, §5 ops reporting), that
the discount rail stays unbuilt pending the business questions, and the
two decisions a reader would otherwise have to reverse-engineer: the
referral rides a cookie because register hard-codes forceRedirectUrl, and
every sign-up now routes through /r/claim with a fall-through on failure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (phase-3.md §1, §2, §5):**
- §1 `RestaurantQrCode` model, token/label/active/counters → Task 1 ✅
- §1 `GET /r/[token]` resolve + record scan + cookie + route to sign-up → Task 4 ✅
- §1 middleware `isPublicRoute` gains `/r/(.*)` → Task 4 ✅
- §1 admin mint/label endpoints → Task 6 ✅
- §2 referral carry-through across sign-up → Tasks 4 + 5 ✅
- §2 `RestaurantReferral` written on first sign-up, `@@unique` double-attribution guard → Tasks 1 + 3 ✅
- §2 post-signup redirect to `/restaurants/[slug]` → Task 5 ✅
- §5 ops-only `/admin/referrals`, aggregate strip + per-account table, derived status, restaurant + email filters, sidebar entry → Task 7 ✅
- §5 QR codes tab on the restaurant admin page → Task 6 ✅
- §3 discount rail → **intentionally out of scope** (Global Constraints)

**Deliberately not covered (and why):** iOS deep-link handling (§4 iOS) — the Clara repo, gated on Clara iOS Phase 2. `GET /api/me/discounts` — belongs with the discount rail.

**Type consistency:** `resolveQrToken` returns `{ id, restaurantId, restaurantSlug }` in Task 3 and is destructured as `code.id` / `code.restaurantId` / `code.restaurantSlug` in Tasks 4 and 5 ✅. `recordReferral(args: { accountId, qrCodeId, restaurantId })` is called with exactly those keys in both ✅. `referralFunnelState` takes `{ onboardingComplete }` and Task 7 passes `r.account`, which selects that field ✅. `REFERRAL_COOKIE` is exported from Task 4 and imported in Task 5 ✅.

**Known risk to watch during execution:** Task 5 changes the destination of **every** sign-up. The fall-through is the mitigation, and Task 5 Step 4 tests the no-cookie path first for exactly this reason. If anything about `/r/claim` looks shaky in review, revert `forceRedirectUrl` and land attribution via a lazy claim instead — the rest of the plan is unaffected.
