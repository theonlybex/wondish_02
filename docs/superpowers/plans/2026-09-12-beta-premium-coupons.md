# Beta Premium Coupons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin mint premium coupon codes with a use quantity, a redeem-by deadline and an access-end date, so beta testers can unlock Premium with a code and lose it automatically when the beta ends.

**Architecture:** Entitlement stays exactly where it is today: a `Subscription` row per `(account, source)` in Postgres, read by `hasActivePremium` / `accountHasActivePremium` in every gate, by `/api/me` (iOS), and by the billing panel. Redeeming a PREMIUM coupon upserts the `COUPON`-source row with `plan=PREMIUM, status=ACTIVE, stripeCurrentPeriodEnd=<coupon.accessUntil>`; the existing period-end backstop in `hasActivePremium` then expires the grant with no cron, no webhook and no new code path. Clerk is **not** involved: it authenticates, it does not hold entitlement (see Design → "Why not Clerk"). The retired PREMIUM branch of billing v2 is re-enabled behind the same atomic-redemption code that already protects ADMIN codes.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma + Neon Postgres, Clerk (auth only), next-intl, `node --import tsx --test` for tests.

**Spec:** This document, §Design. Requirements came from the user on 2026-09-12: coupons are the main beta mechanism; admin creates codes; each code has a quantity of uses, an expiry (redeem-by) deadline, and a date when the granted access stops.

## Global Constraints

- Entitlement source of truth is the `Subscription` table. No premium state in Clerk metadata, cookies or JWT claims.
- Never expose `stripeCustomerId`, `stripeSubscriptionId` or promotion-code ids to the client (existing billing v2 rule).
- Redemption stays atomic: `(couponId, accountId)` unique + single conditional `updateMany` for the cap (existing lib/coupon.ts invariants). Do not reintroduce a read-then-write cap check.
- Every pre-transaction failure (not found / inactive / expired / capped) returns the one generic message `GENERIC_COUPON_ERROR` (existing anti-enumeration rule).
- Premium gates remain governed by `PREMIUM_GATES=on`. **Do not** set it in any environment as part of this plan; that is a manual deploy step the user performs (see §Rollout).
- Local dev and `prisma migrate deploy` hit the **shared production Neon DB**. The migration in Task 1 is a single nullable column add and is safe, but run it once and deliberately.
- Never run `npm run build` while `next dev` is running (it clobbers `.next`).
- Copy in `messages/{en,es,ru}.json` gets real translations, not placeholders.
- Frontend tasks (Task 7, Task 8): invoke the `ui-ux-pro-max:ui-ux-pro-max` skill before editing any component, per the user's global CLAUDE.md.
- Tests: `npm test` (runs `lib/*.test.ts`, `lib/billing/*.test.ts`, …). Pure logic gets unit tests; Prisma/Clerk are never called from tests.
- Commit after every task with the attribution trailers in effect for this session.

---

## Design

### Why not Clerk

| Option | Where premium lives | Read by gates | Read by iOS | Verdict |
|---|---|---|---|---|
| **Postgres `Subscription` row (chosen)** | `COUPON`-source row | already (`accountHasActivePremium`) | already (`/api/me`) | One source of truth; expiry handled by the existing period-end backstop; Stripe/Apple rows untouched. |
| Clerk `publicMetadata.premiumUntil` | Clerk user object | would need a new lookup or a session-claim template | would need a new field in `/api/me` copied from Clerk | Second source of truth; session token caches claims for up to 60 s; every gate, the billing panel and iOS would need a second code path; admin edits would need the Clerk backend API. Nothing gained. |
| Stripe 100%-off promotion code | Stripe subscription | already | already | Requires Checkout (asks for a card even at 100% off unless `payment_method_collection: "if_required"`), creates a real subscription that bills at full price after a `once` coupon, and puts a tester's premium behind webhook delivery. Wrong tool for a beta. |

Clerk continues to do exactly what it does now: identify the caller (`auth()` → `userId` → `Account.clerkId`).

### Data model

`Coupon` already has: `code`, `type` (PREMIUM | ADMIN), `maxUses` (-1 = unlimited), `usedCount`, `expiresAt`, `isActive`, `note`. Add one column:

| Field | Meaning | Required |
|---|---|---|
| `maxUses` (existing) | Quantity: how many distinct accounts may redeem. `-1` = unlimited. | yes |
| `expiresAt` (existing) | **Redeem-by** deadline. After this instant the code is "unavailable". | optional |
| `accessUntil` (**new**, `DateTime?`) | **Access-end** instant. The premium granted by this code ends here. | required for PREMIUM, forbidden for ADMIN |

Rules enforced by the validator (Task 3): both dates must be in the future at creation; `expiresAt` must not be after `accessUntil` (a code you could redeem after its access already ended is a mistake); a date-only string from `<input type="date">` is normalised to `23:59:59.999Z` of that day so "access until Dec 31" includes Dec 31.

### Grant semantics

- Redeeming a PREMIUM coupon upserts the account's `COUPON` row: `plan=PREMIUM, status=ACTIVE, canceledAt=null, stripeCurrentPeriodEnd=accessUntil`.
- `hasActivePremium` already returns false once `stripeCurrentPeriodEnd + 24h < now`. That 24 h grace is acceptable for a beta and needs no change.
- **Second coupon on the same account never shortens access.** `mergeGrantEnd(existingRow, incoming)` keeps the later date (Task 2). If the existing grant is not active any more (already expired), the incoming date simply replaces it.
- **A renewing paid subscriber cannot redeem a PREMIUM code.** If the account's STRIPE or APPLE row currently grants premium *and is not scheduled to cancel*, the route answers 409 "You already have Premium — no code needed." Stripe would keep billing regardless, so the code would only burn a use. A subscriber who has already cancelled at period end may redeem: nothing is wasted and the coupon carries them past the period end. `hasPaidPremium(subs)` (Task 2) is the predicate.
- **A code whose access-until has passed is "unavailable"** even if still active and under cap: redeeming it would grant an already-expired row. `classifyCoupon` checks `accessUntil` alongside `expiresAt`.
- **Coupon holders can still buy.** The pricing page redirects to /membership only for *paid* premium (and admins); the billing card for coupon premium links to /pricing with "Subscribe to keep Premium after <date>".
- **Extending a beta is one admin action.** "Extend access" on a code moves its `accessUntil` later and lifts every redeemer's grant that ends earlier (never shortens, revives expired ones).
- **The paid row is always the one shown.** When an account holds an active coupon grant *and* an active Stripe/Apple subscription (tester redeems, later pays), the billing page and `/api/me` must describe the paid one, or the user loses the card / invoices / cancel controls behind a "Premium · coupon" card. `primarySubscriptionRow(rows)` (Task 6) encodes the order: active paid → active any → Stripe → any.
- **Deactivating a coupon does not revoke access already granted.** `accessUntil` is the revocation mechanism. This keeps the admin toggle safe to use mid-beta.
- After expiry the `COUPON` row stays `ACTIVE/PREMIUM` with a past period end. `loadSubscriptionView` already prefers the STRIPE row in that case (free card). `serializeMe` does not yet, so Task 6 aligns it, otherwise iOS would see `plan: PREMIUM` next to `isPremium: false`.
- `/api/me` DELETE already iterates `COUPON` rows through `cancelStripeAtPeriodEnd`, which returns immediately when there is no `stripeSubscriptionId`. No change.

### Scenario matrix

Every row below is either covered by a task (named) or an accepted limitation (marked *accepted*).

| # | Scenario | Outcome | Where |
|---|---|---|---|
| 1 | Tester redeems code A (until Oct 31), later code B (until Dec 31) | Access until Dec 31. Both codes burn one use. | `mergeGrantEnd`, Task 2 |
| 2 | Same as 1 but B first, then A | Stays Dec 31. A second code never shortens. | Task 2 |
| 3 | Code A's access already ended, tester redeems B | B's date replaces the dead grant. Premium back on next page load. | Task 2 |
| 4 | Tester redeems B during the 24 h grace after A ended | Treated as "A still active" → later date wins → B's date. | Task 2 |
| 5 | Tester enters the **same** code twice | 409 "already redeemed". A redemption is permanent, so the same code cannot be re-used to extend after its access ended; a new code is needed. | existing unique constraint |
| 6 | Tester redeems on web, opens iOS | `/api/me` reports `isPremium:true`, source COUPON, `currentPeriodEnd` = access end. iOS card says "Managed on the web". *Known cosmetic:* the iOS renewal line reads "Renews <date>" for a coupon; one-line iOS follow-up (not in this plan). | Task 6 |
| 7 | Code whose **access-until has already passed** but is still active (admin set a short date, or time went by) | Refused with the generic "Invalid or unavailable code" — it would otherwise grant nothing and burn a use. | `classifyCoupon`, Task 2 |
| 8 | Paying Stripe/Apple subscriber (renewing) redeems a PREMIUM code | 409 "You already have Premium — no code needed." Use count untouched. | `hasPaidPremium`, Tasks 2/5 |
| 9 | Paying subscriber who has **cancelled at period end** redeems a PREMIUM code | Allowed: Stripe will not bill again, so nothing is wasted. Coupon row sits beside the Stripe row; access continues past the Stripe period end. | `hasPaidPremium` ignores `cancelAtPeriodEnd` rows, Task 2 |
| 10 | Former subscriber (Stripe row CANCELED/lapsed) redeems | Allowed. Billing page shows "Premium · coupon". | Task 2, Task 6 |
| 11 | Tester with a live coupon wants to **pay** before it ends | Pricing page no longer redirects coupon-only premium to /membership; billing page shows "Subscribe to keep Premium after <date>". Checkout already allows it (it only diverts to the portal when the *Stripe* row is live). | Task 6 |
| 12 | Tester with live coupon subscribes → both rows live | Paid row shown everywhere (card, invoices, cancel). Coupon grant sits behind until its date. | `primarySubscriptionRow`, Task 6 |
| 13 | Tester in 12 cancels Stripe before the coupon ends | Premium continues until the later of the two dates. Once the Stripe period lapses the coupon row becomes the primary row. | Task 6 |
| 14 | Tester in 12 has a failed Stripe payment while the coupon is live | Past-due banner shows (correct: fix the card); access continues via the coupon. | existing |
| 15 | Admin (SUPER) redeems a PREMIUM code | Allowed (useful for testing the flow). Admin bypasses gates anyway; the row is harmless. | *accepted* |
| 16 | Same person, two accounts (two emails) | Two redemptions, two uses. `maxUses` is the only bound. | *accepted* |
| 17 | Admin **deactivates** a code after some testers redeemed | New redemptions stop. Existing grants run to their date. | existing |
| 18 | **Beta extended**: admin wants everyone on code X to keep access two more weeks | "Extend access" on the code: updates the code's date and every redeemer's grant that ends earlier. Never shortens anyone. Revives grants that already ended. | Task 10 |
| 19 | Admin wants to **cut one tester off early** or shorten everyone | Not supported in the UI. Manual DB edit of that account's COUPON row. | *accepted*, noted in runbook |
| 20 | Tester deletes their account | Redemption row cascades away; `usedCount` stays consumed, so the slot is not recycled. Admin list shows `usedCount`, not the redemption count, so numbers stay honest. | Task 7 |
| 21 | Access ends while the tester is mid-session | Already-rendered pages keep working until the next navigation; premium API calls start returning 403 / Clara 402 paywall; next page load shows the gate. Nothing is deleted. | existing gates |
| 22 | Access-until "Dec 31" — when exactly? | End of Dec 31 UTC + 24 h grace ≈ late Jan 1 UTC. | existing backstop |
| 23 | Tester mistypes the code 10 times in an hour | 429 for the rest of the hour (rate limit). | Task 5 |
| 24 | Two testers race for the last use | Exactly one wins; the other gets the generic message. | existing atomic cap |
| 25 | Admin creates a code with redeem-by after access-until | Rejected at creation. | Task 3 |

### Column naming

`stripeCurrentPeriodEnd` is a Stripe-ish name carrying a source-agnostic meaning ("entitlement ends here"). `hasActivePremium`, `buildSubscriptionView`, `serializeMe` and the Apple path already treat it that way. Renaming the column would touch the webhook, the sync module and iOS DTO tests for no behavioural gain, so this plan reuses it and documents the meaning in code comments.

### Out of scope (deliberate)

- Per-redemption durations ("30 days from redemption"). The beta ends on a date; absolute dates are simpler to reason about and to display. Add a `accessDays` column later if needed.
- Bulk generation of unique single-use codes. One code with `maxUses=N` covers a beta cohort.
- iOS redeem UI. iOS shows "Managed on the web" for `COUPON` source already; testers redeem on the web.
- Revoking already-granted access when a code is deactivated, or shortening / cutting off individual testers (manual DB edit; see runbook).
- A warning **email** before access ends (the banner is Task 11).
- iOS copy tweak ("Renews <date>" → "Access until <date>" for COUPON source). One-line follow-up in the Clara repo.
- Turning `PREMIUM_GATES` on. Manual step for the user.

### File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260912090000_coupon_access_until/migration.sql` | `Coupon.accessUntil` |
| `lib/coupon.ts` (+test) | Pure: `classifyCoupon` (now also checks `accessUntil`), `couponCapWhere`, `couponPremiumUpsertArgs(accountId, accessUntil)`, `mergeGrantEnd`, `hasPaidPremium`, `extendGrantsWhere` |
| `app/(main)/pricing/page.tsx` | Redirect to /membership only for paid premium / admins |
| `app/api/admin/coupons/route.ts` (PATCH) | "Extend access": moves the code's date and lifts redeemers' grants |
| `lib/coupon-admin.ts` (+test) **new** | Pure: `validateCouponInput` for the admin create endpoint |
| `app/api/coupon/redeem/route.ts` | PREMIUM grant path restored; returns `accessUntil` |
| `app/api/admin/coupons/route.ts` | Uses the validator; lists redeemers |
| `lib/auth.ts` (+test) | `primarySubscriptionRow(rows)`: paid beats coupon, live beats expired |
| `lib/me.ts` (+test), `lib/billing/load-view.ts` | Both use `primarySubscriptionRow` so iOS and the billing page agree |
| `components/billing/BillingPanel.tsx` | "Access until …" line for non-Stripe premium |
| `app/(dashboard)/admin/coupons/page.tsx` | Type selector back, two date fields, redeemers list |
| `components/dashboard/DashboardHeader.tsx`, `messages/{en,es,ru}.json` | Success copy with the access-end date |
| `components/CouponRedeem.tsx` | **deleted** (unused) |
| `docs/billing/coupons.md` **new**, `BACKLOG.md`, `.env.example` | Beta runbook |

---

### Task 1: `Coupon.accessUntil` column

**Files:**
- Modify: `prisma/schema.prisma:1185-1196`
- Create: `prisma/migrations/20260912090000_coupon_access_until/migration.sql`

**Interfaces:**
- Produces: `Coupon.accessUntil: Date | null` on the Prisma client, consumed by Tasks 2, 4, 5, 7.

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, change the `Coupon` model to:

```prisma
model Coupon {
  id          String             @id @default(cuid())
  code        String             @unique
  type        CouponType         @default(PREMIUM)
  maxUses     Int                @default(1)
  usedCount   Int                @default(0)
  // Redeem-by deadline: after this instant the code is "unavailable".
  expiresAt   DateTime?
  // Access-end instant for PREMIUM codes: written to the COUPON-source
  // Subscription.stripeCurrentPeriodEnd on redemption, which hasActivePremium
  // already enforces. null only for ADMIN codes (SUPER role has no end).
  accessUntil DateTime?
  isActive    Boolean            @default(true)
  note        String?
  createdAt   DateTime           @default(now())
  redemptions CouponRedemption[]
}
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260912090000_coupon_access_until/migration.sql`:

```sql
-- Beta premium coupons: the instant at which access granted by a PREMIUM
-- code ends. Nullable and additive; existing rows are ADMIN codes (null).
ALTER TABLE "Coupon" ADD COLUMN "accessUntil" TIMESTAMP(3);
```

- [ ] **Step 3: Apply and regenerate**

Run:

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration found … applied` and `Generated Prisma Client`. (This targets the shared Neon DB; the change is additive.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260912090000_coupon_access_until/migration.sql
git commit -m "feat(coupons): Coupon.accessUntil — when a premium code's access ends"
```

---

### Task 2: Pure grant helpers in `lib/coupon.ts`

**Files:**
- Modify: `lib/coupon.ts:29-47`
- Test: `lib/coupon.test.ts`

**Interfaces:**
- Consumes: `hasActivePremium(sub)` from `lib/auth.ts` (already importable from tests; `lib/me.test.ts` does the same).
- Produces:
  - `couponPremiumUpsertArgs(accountId: string, accessUntil: Date | null)` → Prisma upsert args for the COUPON row.
  - `mergeGrantEnd(existing: { plan: string; status: string; stripeCurrentPeriodEnd: Date | null } | null, incoming: Date | null): Date | null`
  - `hasPaidPremium(subs: Array<{ source: string; plan: string; status: string; stripeCurrentPeriodEnd?: Date | null; cancelAtPeriodEnd?: boolean }>): boolean` — true when a STRIPE or APPLE row currently grants premium **and is not scheduled to cancel**.
  - `CouponState` gains `accessUntil: Date | null`; `classifyCoupon` returns "unavailable" when it is in the past.
  - `extendGrantsWhere(accountIds: string[], newEnd: Date)` → Prisma `updateMany` where-clause for lifting redeemers' COUPON grants that end before `newEnd`.

- [ ] **Step 0: Extend `classifyCoupon` tests for access-until**

In `lib/coupon.test.ts`, add `accessUntil: null as Date | null` to the `coupon()` fixture defaults, then add:

```ts
test("classifyCoupon: a code whose access-until already passed is unavailable", () => {
  assert.equal(classifyCoupon(coupon({ accessUntil: new Date("2026-07-01") }), NOW), "unavailable");
  assert.equal(classifyCoupon(coupon({ accessUntil: new Date("2026-08-01") }), NOW), "ok");
  assert.equal(classifyCoupon(coupon({ accessUntil: null }), NOW), "ok"); // ADMIN codes
});
```

- [ ] **Step 1: Replace the old upsert test and add merge tests**

In `lib/coupon.test.ts`, add `mergeGrantEnd`, `hasPaidPremium` and `extendGrantsWhere` to the import and replace the last test (`couponPremiumUpsertArgs targets the COUPON row…`) with:

```ts
// ─── 2026-09-12 beta premium coupons ────────────────────────────────────────
//
// PREMIUM redemption writes the COUPON-source row with the coupon's access
// end in stripeCurrentPeriodEnd (the source-agnostic "entitlement ends here"
// column hasActivePremium already enforces). It never touches Stripe ids.

const UNTIL = new Date("2026-12-31T23:59:59.999Z");
const LATER = new Date("2027-03-31T23:59:59.999Z");

test("couponPremiumUpsertArgs targets the COUPON row, sets the access end, never touches Stripe ids", () => {
  const args = couponPremiumUpsertArgs("acc1", UNTIL);
  assert.deepEqual(args.where, { accountId_source: { accountId: "acc1", source: "COUPON" } });
  assert.equal(args.create.source, "COUPON");
  for (const shape of [args.update, args.create] as Array<Record<string, unknown>>) {
    assert.equal("stripeSubscriptionId" in shape, false);
    assert.equal("stripeCustomerId" in shape, false);
    assert.equal(shape.plan, "PREMIUM");
    assert.equal(shape.status, "ACTIVE");
    assert.equal(shape.stripeCurrentPeriodEnd, UNTIL);
  }
  assert.equal(args.update.canceledAt, null);
});

test("couponPremiumUpsertArgs with null access end writes a null period end (lifetime)", () => {
  const args = couponPremiumUpsertArgs("acc1", null);
  assert.equal(args.update.stripeCurrentPeriodEnd, null);
  assert.equal(args.create.stripeCurrentPeriodEnd, null);
});

test("mergeGrantEnd: no existing row → incoming", () => {
  assert.equal(mergeGrantEnd(null, UNTIL), UNTIL);
});

test("mergeGrantEnd: existing active grant keeps the later date", () => {
  const row = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(row, UNTIL), LATER);
  const shorter = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: UNTIL };
  assert.equal(mergeGrantEnd(shorter, LATER), LATER);
});

test("mergeGrantEnd: lifetime on either side wins", () => {
  assert.equal(mergeGrantEnd({ plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null }, UNTIL), null);
  assert.equal(mergeGrantEnd({ plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: UNTIL }, null), null);
});

test("mergeGrantEnd: an expired or non-premium existing row is replaced by incoming", () => {
  const expired = { plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };
  assert.equal(mergeGrantEnd(expired, UNTIL), UNTIL);
  const free = { plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(free, UNTIL), UNTIL);
  const canceled = { plan: "PREMIUM", status: "CANCELED", stripeCurrentPeriodEnd: LATER };
  assert.equal(mergeGrantEnd(canceled, UNTIL), UNTIL);
});

test("hasPaidPremium: only a live STRIPE or APPLE premium row counts", () => {
  const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  const appleLive = { source: "APPLE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
  const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
  const stripeLapsed = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };
  const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER };
  assert.equal(hasPaidPremium([stripeLive]), true);
  assert.equal(hasPaidPremium([appleLive]), true);
  assert.equal(hasPaidPremium([stripeFree, couponLive]), false);
  assert.equal(hasPaidPremium([stripeLapsed]), false);
  assert.equal(hasPaidPremium([]), false);
});

test("hasPaidPremium: a paid row already scheduled to cancel does not block a coupon", () => {
  const canceling = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: LATER, cancelAtPeriodEnd: true };
  assert.equal(hasPaidPremium([canceling]), false);
});

test("extendGrantsWhere: lifts only COUPON rows of the given accounts that end before the new date", () => {
  assert.deepEqual(extendGrantsWhere(["a1", "a2"], UNTIL), {
    source: "COUPON",
    accountId: { in: ["a1", "a2"] },
    stripeCurrentPeriodEnd: { lt: UNTIL },
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test lib/coupon.test.ts`
Expected: FAIL — `mergeGrantEnd` is not exported; the upsert test fails on `stripeCurrentPeriodEnd`.

- [ ] **Step 3: Implement**

In `lib/coupon.ts`, add the import at the top, extend `CouponState` / `classifyCoupon` (lines 10-22), and replace `couponPremiumUpsertArgs` (lines 29-47):

```ts
import { hasActivePremium } from "@/lib/auth";
```

```ts
export interface CouponState {
  isActive: boolean;
  expiresAt: Date | null; // redeem-by
  accessUntil: Date | null; // access end (PREMIUM); null for ADMIN
  maxUses: number; // -1 = unlimited
  usedCount: number;
}

export function classifyCoupon(coupon: CouponState | null, now: Date): "ok" | "unavailable" {
  if (!coupon || !coupon.isActive) return "unavailable";
  if (coupon.expiresAt && coupon.expiresAt < now) return "unavailable";
  // A code whose access window already closed would grant an expired row
  // and burn a use for nothing.
  if (coupon.accessUntil && coupon.accessUntil < now) return "unavailable";
  if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) return "unavailable";
  return "ok";
}
```

```ts
// Upsert args for a PREMIUM coupon grant. Targets the COUPON-source row
// (2026-07-24 audit Task 10): the old STRIPE-row write nulled
// stripeSubscriptionId — erasing the only cancel handle, so a deleted
// account could keep being billed — and any later Stripe webhook (which
// keys on the STRIPE row) silently clobbered coupon-granted premium.
// accountHasActivePremium ORs across rows, so a COUPON/PREMIUM row grants
// premium regardless of the STRIPE row's state.
//
// `accessUntil` lands in stripeCurrentPeriodEnd: despite the name, that is
// the source-agnostic "entitlement ends here" column — hasActivePremium
// enforces it (+24h grace) for every source, so the grant expires on its
// own with no cron. null = no end (never for beta codes; validator requires
// a date for PREMIUM).
export function couponPremiumUpsertArgs(accountId: string, accessUntil: Date | null) {
  return {
    where: { accountId_source: { accountId, source: "COUPON" as const } },
    update: {
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
      canceledAt: null,
      stripeCurrentPeriodEnd: accessUntil,
    },
    create: {
      accountId,
      source: "COUPON" as const,
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
      stripeCurrentPeriodEnd: accessUntil,
    },
  };
}

// A second coupon never shortens access the account already has. If the
// existing COUPON row still grants premium, keep the later end (null =
// lifetime wins); if it is expired/free/canceled, the new coupon replaces it.
export function mergeGrantEnd(
  existing: { plan: string; status: string; stripeCurrentPeriodEnd: Date | null } | null,
  incoming: Date | null
): Date | null {
  if (!existing || !hasActivePremium(existing)) return incoming;
  const current = existing.stripeCurrentPeriodEnd;
  if (current === null || incoming === null) return null;
  return current > incoming ? current : incoming;
}

// A renewing paid subscriber gains nothing from a PREMIUM code (Stripe/Apple
// keep billing; premium is already ORed across rows) and would only burn a
// use — the redeem route refuses with a clear 409. A subscriber who already
// cancelled at period end is let through: nothing is wasted and the coupon
// carries them past the period end.
export function hasPaidPremium(
  subs: Array<{
    source: string;
    plan: string;
    status: string;
    stripeCurrentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
  }>
): boolean {
  return subs.some(
    (s) => (s.source === "STRIPE" || s.source === "APPLE") && hasActivePremium(s) && !s.cancelAtPeriodEnd
  );
}

// Where-clause for "Extend access" on a code: every redeemer's COUPON row
// that ends before the new date gets lifted to it (updateMany with
// `data: { stripeCurrentPeriodEnd: newEnd }`). Rows ending later (another
// code) or with no end (null fails `lt`) are untouched — never shortens.
// Expired rows satisfy `lt`, so extending a finished beta revives them.
export function extendGrantsWhere(accountIds: string[], newEnd: Date) {
  return {
    source: "COUPON" as const,
    accountId: { in: accountIds },
    stripeCurrentPeriodEnd: { lt: newEnd },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test lib/coupon.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/coupon.ts lib/coupon.test.ts
git commit -m "feat(coupons): grant helpers — access end on the COUPON row, never shorten an active grant, paid-premium predicate"
```

---

### Task 3: Admin input validator `lib/coupon-admin.ts`

**Files:**
- Create: `lib/coupon-admin.ts`
- Test: `lib/coupon-admin.test.ts` (picked up by `npm test` via `lib/*.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export type CouponInput = {
    code: string;
    type: "PREMIUM" | "ADMIN";
    maxUses: number;           // -1 or ≥ 1
    expiresAt: Date | null;    // redeem-by
    accessUntil: Date | null;  // access end; non-null iff type === "PREMIUM"
    note: string | null;
  };
  export function validateCouponInput(input: unknown, now: Date): { ok: true; value: CouponInput } | { ok: false; error: string };
  export function parseDeadline(raw: unknown): Date | null | "invalid";
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/coupon-admin.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeadline, validateCouponInput } from "./coupon-admin";

const NOW = new Date("2026-09-12T12:00:00Z");

function premium(overrides: Record<string, unknown> = {}) {
  return {
    code: "beta-2026",
    type: "PREMIUM",
    maxUses: 50,
    expiresAt: "2026-10-31",
    accessUntil: "2026-12-31",
    note: "Beta cohort 1",
    ...overrides,
  };
}

test("parseDeadline: date-only strings become end of that day (UTC)", () => {
  assert.equal(parseDeadline("2026-12-31")?.toString(), new Date("2026-12-31T23:59:59.999Z").toString());
});

test("parseDeadline: full ISO strings are kept; empty is null; garbage is invalid", () => {
  assert.equal((parseDeadline("2026-12-31T10:00:00.000Z") as Date).toISOString(), "2026-12-31T10:00:00.000Z");
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline(null), null);
  assert.equal(parseDeadline(undefined), null);
  assert.equal(parseDeadline("not a date"), "invalid");
  assert.equal(parseDeadline(42), "invalid");
});

test("valid PREMIUM input: code upper-cased, dates normalised to end of day", () => {
  const r = validateCouponInput(premium(), NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.code, "BETA-2026");
  assert.equal(r.value.type, "PREMIUM");
  assert.equal(r.value.maxUses, 50);
  assert.equal(r.value.expiresAt?.toISOString(), "2026-10-31T23:59:59.999Z");
  assert.equal(r.value.accessUntil?.toISOString(), "2026-12-31T23:59:59.999Z");
  assert.equal(r.value.note, "Beta cohort 1");
});

test("PREMIUM requires accessUntil", () => {
  const r = validateCouponInput(premium({ accessUntil: "" }), NOW);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /access/i);
});

test("ADMIN must not carry accessUntil, and works without one", () => {
  const bad = validateCouponInput(premium({ type: "ADMIN" }), NOW);
  assert.equal(bad.ok, false);
  const good = validateCouponInput(premium({ type: "ADMIN", accessUntil: "" }), NOW);
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.accessUntil, null);
});

test("expiresAt is optional for PREMIUM", () => {
  const r = validateCouponInput(premium({ expiresAt: "" }), NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.expiresAt, null);
});

test("dates must be in the future", () => {
  assert.equal(validateCouponInput(premium({ accessUntil: "2026-09-01" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ expiresAt: "2026-09-01" }), NOW).ok, false);
});

test("redeem-by must not be after access end", () => {
  const r = validateCouponInput(premium({ expiresAt: "2027-01-15", accessUntil: "2026-12-31" }), NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /redeem/i);
});

test("code shape: 4–24 chars of A-Z 0-9 _ -", () => {
  assert.equal(validateCouponInput(premium({ code: "abc" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: "has space" }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: "x".repeat(25) }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ code: " ok_code-1 " }), NOW).ok, true);
});

test("maxUses: -1 or a positive integer", () => {
  assert.equal(validateCouponInput(premium({ maxUses: -1 }), NOW).ok, true);
  assert.equal(validateCouponInput(premium({ maxUses: 1 }), NOW).ok, true);
  assert.equal(validateCouponInput(premium({ maxUses: 0 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: -2 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: 2.5 }), NOW).ok, false);
  assert.equal(validateCouponInput(premium({ maxUses: "10" }), NOW).ok, false);
});

test("unknown type and non-object bodies are rejected; note is capped at 200 chars", () => {
  assert.equal(validateCouponInput(premium({ type: "GOLD" }), NOW).ok, false);
  assert.equal(validateCouponInput(null, NOW).ok, false);
  assert.equal(validateCouponInput(premium({ note: "n".repeat(201) }), NOW).ok, false);
  const r = validateCouponInput(premium({ note: "" }), NOW);
  if (r.ok) assert.equal(r.value.note, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test lib/coupon-admin.test.ts`
Expected: FAIL — cannot find module `./coupon-admin`.

- [ ] **Step 3: Implement**

Create `lib/coupon-admin.ts`:

```ts
// Validation for admin-created DB coupons (PREMIUM beta grants and ADMIN
// SUPER-role codes). Pure, so the shape rules are unit-tested; the route only
// translates a valid input into a prisma.coupon.create.
export type CouponInput = {
  code: string;
  type: "PREMIUM" | "ADMIN";
  maxUses: number; // -1 = unlimited, else ≥ 1
  expiresAt: Date | null; // redeem-by deadline
  accessUntil: Date | null; // access end; non-null iff type === "PREMIUM"
  note: string | null;
};

const CODE_RE = /^[A-Z0-9_-]{4,24}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 200;

// <input type="date"> sends "YYYY-MM-DD". Read as end of that day (UTC) so
// "access until Dec 31" includes Dec 31. Full ISO strings pass through.
export function parseDeadline(raw: unknown): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const s = raw.trim();
  if (!s) return null;
  const iso = DATE_ONLY_RE.test(s) ? `${s}T23:59:59.999Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export function validateCouponInput(
  input: unknown,
  now: Date
): { ok: true; value: CouponInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Body must be an object" };
  const b = input as Record<string, unknown>;

  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) return { ok: false, error: "Code must be 4–24 letters, digits, _ or -" };

  const type = b.type;
  if (type !== "PREMIUM" && type !== "ADMIN") return { ok: false, error: "type must be PREMIUM or ADMIN" };

  const maxUses = b.maxUses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || (maxUses !== -1 && maxUses < 1)) {
    return { ok: false, error: "maxUses must be -1 (unlimited) or a positive integer" };
  }

  const expiresAt = parseDeadline(b.expiresAt);
  if (expiresAt === "invalid") return { ok: false, error: "expiresAt is not a valid date" };
  if (expiresAt && expiresAt <= now) return { ok: false, error: "Redeem-by date must be in the future" };

  const accessUntil = parseDeadline(b.accessUntil);
  if (accessUntil === "invalid") return { ok: false, error: "accessUntil is not a valid date" };
  if (type === "PREMIUM" && !accessUntil) return { ok: false, error: "Premium codes need an access end date" };
  if (type === "ADMIN" && accessUntil) return { ok: false, error: "Admin codes don't take an access end date" };
  if (accessUntil && accessUntil <= now) return { ok: false, error: "Access end date must be in the future" };
  if (expiresAt && accessUntil && expiresAt > accessUntil) {
    return { ok: false, error: "Redeem-by date must not be after the access end date" };
  }

  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (rawNote.length > NOTE_MAX) return { ok: false, error: `Note must be at most ${NOTE_MAX} characters` };

  return {
    ok: true,
    value: { code, type, maxUses, expiresAt, accessUntil, note: rawNote || null },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test lib/coupon-admin.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/coupon-admin.ts lib/coupon-admin.test.ts
git commit -m "feat(coupons): pure validator for admin-created codes (quantity, redeem-by, access end)"
```

---

### Task 4: Admin API — create PREMIUM codes again, list redeemers

**Files:**
- Modify: `app/api/admin/coupons/route.ts`

**Interfaces:**
- Consumes: `validateCouponInput` (Task 3), `Coupon.accessUntil` (Task 1).
- Produces (for Task 7):
  - `GET` → `Coupon[]` where each item also carries `accessUntil: string | null`, `_count: { redemptions: number }`, and `redemptions: { redeemedAt: string; account: { email: string } }[]` (newest first, max 100).
  - `POST` body `{ code, type: "PREMIUM" | "ADMIN", maxUses, expiresAt?, accessUntil?, note? }` → 201 `Coupon` or 400 `{ error }`.
  - `PATCH { id, isActive }` unchanged.

- [ ] **Step 1: Rewrite GET and POST**

Replace the `GET` and `POST` handlers in `app/api/admin/coupons/route.ts` with:

```ts
import { validateCouponInput } from "@/lib/coupon-admin";

// GET /api/admin/coupons — every code, newest first, with who redeemed it.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { redemptions: true } },
      redemptions: {
        orderBy: { redeemedAt: "desc" },
        take: 100,
        select: { redeemedAt: true, account: { select: { email: true } } },
      },
    },
  });

  return NextResponse.json(coupons);
}

// POST /api/admin/coupons — create a code. PREMIUM codes grant Premium on the
// COUPON-source Subscription row until `accessUntil`; ADMIN codes grant the
// SUPER role. Shape rules live in lib/coupon-admin.ts.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = validateCouponInput(await req.json().catch(() => null), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const existing = await prisma.coupon.findUnique({ where: { code: v.code } });
  if (existing) {
    return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
  }

  const coupon = await prisma.coupon.create({
    data: {
      code: v.code,
      type: v.type,
      maxUses: v.maxUses,
      expiresAt: v.expiresAt,
      accessUntil: v.accessUntil,
      note: v.note,
      isActive: true,
    },
  });

  return NextResponse.json(coupon, { status: 201 });
}
```

Leave `assertAdmin` and `PATCH` as they are. Remove the now-unused `type = "ADMIN" as const` line and the "PREMIUM coupons are retired" branch (they are inside the replaced POST).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke test against the dev server (needs a SUPER account session)**

With `npm run dev` running and logged in as a SUPER user in the browser, open DevTools console on any dashboard page and run:

```js
await (await fetch("/api/admin/coupons", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "PLANTEST1", type: "PREMIUM", maxUses: 2, expiresAt: "2026-10-31", accessUntil: "2026-12-31", note: "plan smoke" }) })).json()
```

Expected: 201 with `accessUntil: "2026-12-31T23:59:59.999Z"`. Then:

```js
await (await fetch("/api/admin/coupons", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "PLANTEST2", type: "PREMIUM", maxUses: 2 }) })).json()
```

Expected: 400 `{ error: "Premium codes need an access end date" }`.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/coupons/route.ts
git commit -m "feat(coupons): admin API creates PREMIUM codes with access end; lists redeemers"
```

---

### Task 5: Redeem route — restore the PREMIUM grant

**Files:**
- Modify: `app/api/coupon/redeem/route.ts`

**Interfaces:**
- Consumes: `couponPremiumUpsertArgs(accountId, accessUntil)`, `mergeGrantEnd`, `hasPaidPremium` (Task 2).
- Produces (for Task 8): `200 { success: true, type: "PREMIUM" | "ADMIN", accessUntil: string | null, message: string }`. Errors: 400/401/404 (generic)/429 unchanged; 409 now covers both "already redeemed this coupon" and "already have Premium" (paid subscriber redeeming a PREMIUM code).

- [ ] **Step 1: Rewrite the route**

Replace the whole file with:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  classifyCoupon,
  couponCapWhere,
  couponPremiumUpsertArgs,
  hasPaidPremium,
  mergeGrantEnd,
  GENERIC_COUPON_ERROR,
} from "@/lib/coupon";

// Thrown when the atomic cap-enforcing increment matches no row (cap reached
// or coupon deactivated between the pre-check and the transaction).
class CouponUnavailableError extends Error {}

function genericUnavailable() {
  return NextResponse.json({ error: GENERIC_COUPON_ERROR }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Brute-force guard: ADMIN-type coupons grant the permanent SUPER role, so
  // unthrottled guessing here would be privilege escalation to full admin.
  // 10/h leaves room for a beta tester's typos; codes are ≥4 chars of a
  // 36-symbol alphabet, so the guess space is still out of reach.
  const { success } = await rateLimit("coupon-redeem", userId, 10, 3600);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawCode = (body as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ error: "Coupon code is required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: {
      id: true,
      subscriptions: {
        select: { source: true, plan: true, status: true, stripeCurrentPeriodEnd: true, cancelAtPeriodEnd: true },
      },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: { redemptions: { where: { accountId: account.id } } },
  });

  // One generic outcome for not-found/inactive/expired/capped — distinct
  // copy was an enumeration aid (see lib/coupon.ts).
  if (!coupon || classifyCoupon(coupon, new Date()) === "unavailable") {
    return genericUnavailable();
  }

  if (coupon.redemptions.length > 0) {
    // The caller already knows this code is valid (they redeemed it), so a
    // distinct message leaks nothing.
    return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
  }

  // A renewing Stripe/Apple subscriber gains nothing from a PREMIUM code and
  // would only burn a use; refuse before touching usedCount. (Checked after
  // the generic gate so an invalid code still reads as merely invalid. A
  // subscriber who already cancelled at period end passes — see
  // hasPaidPremium.)
  if (coupon.type === "PREMIUM" && hasPaidPremium(account.subscriptions)) {
    return NextResponse.json({ error: "You already have Premium — no code needed." }, { status: 409 });
  }

  // The access end actually written (may be later than the coupon's own
  // accessUntil when the account already holds a longer grant). ADMIN → null.
  let grantEnd: Date | null;

  try {
    grantEnd = await prisma.$transaction(async (tx): Promise<Date | null> => {
      // Record redemption first — the (couponId, accountId) unique aborts a
      // concurrent double-redeem by the same account (P2002 → 409 below).
      await tx.couponRedemption.create({
        data: { couponId: coupon.id, accountId: account.id },
      });

      // Atomic cap enforcement: predicate + increment in ONE UPDATE
      // statement, so last-slot races can't overshoot maxUses.
      const capped = await tx.coupon.updateMany({
        where: couponCapWhere(coupon),
        data: { usedCount: { increment: 1 } },
      });
      if (capped.count === 0) throw new CouponUnavailableError();

      if (coupon.type === "ADMIN") {
        const role = await tx.role.upsert({
          where: { name: "SUPER" },
          update: {},
          create: { name: "SUPER" },
        });
        await tx.accountRole.upsert({
          where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
          update: {},
          create: { accountId: account.id, roleId: role.id },
        });
        return null;
      }

      // PREMIUM: grant on the COUPON-source row until the coupon's access
      // end; a second code never shortens an active grant.
      const existing = await tx.subscription.findUnique({
        where: { accountId_source: { accountId: account.id, source: "COUPON" } },
        select: { plan: true, status: true, stripeCurrentPeriodEnd: true },
      });
      const end = mergeGrantEnd(existing, coupon.accessUntil);
      await tx.subscription.upsert(couponPremiumUpsertArgs(account.id, end));
      return end;
    });
  } catch (err) {
    if (err instanceof CouponUnavailableError) return genericUnavailable();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrent double-redeem by the same account lost the unique race.
      return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 409 });
    }
    throw err;
  }

  const accessUntil = grantEnd ? grantEnd.toISOString() : null;
  const message =
    coupon.type === "ADMIN"
      ? "Admin access granted — you now have unlimited access."
      : accessUntil
        ? `Premium activated until ${new Date(accessUntil).toLocaleDateString("en-US")}.`
        : "Premium access activated — enjoy all features!";

  return NextResponse.json({ success: true, type: coupon.type, accessUntil, message });
}
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Smoke test the grant (dev server, ordinary user session)**

Log in as a non-admin QA account. In DevTools:

```js
await (await fetch("/api/coupon/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "plantest1" }) })).json()
```

Expected: `{ success: true, type: "PREMIUM", accessUntil: "2026-12-31T23:59:59.999Z", message: "Premium activated until 12/31/2026." }`.

Then confirm entitlement:

```js
await (await fetch("/api/me")).json()
```

Expected: `isPremium: true`, `subscription.source: "COUPON"`, `subscription.currentPeriodEnd: "2026-12-31T23:59:59.999Z"`.

Redeem the same code again → 409 "You have already redeemed this coupon". Redeem `NOPE1234` → 404 "Invalid or unavailable code". As an account with a live Stripe subscription (the billing v2 test-mode account), redeem a fresh PREMIUM code → 409 "You already have Premium — no code needed." and the code's `usedCount` is unchanged on `/admin/coupons`.

- [ ] **Step 4: Commit**

```bash
git add app/api/coupon/redeem/route.ts
git commit -m "feat(coupons): redeem PREMIUM codes again — COUPON row granted until the code's access end"
```

---

### Task 6: One rule for "which subscription row describes this account"

**Files:**
- Modify: `lib/auth.ts` (append after `accountHasActivePremium`)
- Modify: `lib/me.ts:51`
- Modify: `lib/billing/load-view.ts:25-27`
- Modify: `components/billing/BillingPanel.tsx:94-105`
- Test: `lib/auth.test.ts`, `lib/me.test.ts`

**Interfaces:**
- Consumes: `hasActivePremium` (unchanged).
- Produces: `primarySubscriptionRow<T extends { source: string; plan: string; status: string; stripeCurrentPeriodEnd?: Date | null }>(rows: T[]): T | null` in `lib/auth.ts` — order: active STRIPE/APPLE → any active → STRIPE row → first row → null. Used by `serializeMe` and `loadSubscriptionView`.

Two bugs share this fix. (a) After a coupon expires, `serializeMe` could report the dead `PREMIUM/ACTIVE` coupon row to iOS next to `isPremium:false`. (b) An account with a live coupon *and* a live Stripe subscription could get the coupon row on `/membership`, hiding the card, invoices and cancel controls.

- [ ] **Step 1: Write the failing helper test**

Append to `lib/auth.test.ts` (it already imports from `./auth`; add `primarySubscriptionRow` to that import):

```ts
// ─── 2026-09-12 primarySubscriptionRow ───────────────────────────────────────

const FUTURE = new Date("2100-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const stripeLapsed = { source: "STRIPE", plan: "PREMIUM", status: "CANCELED", stripeCurrentPeriodEnd: PAST };
const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const couponDead = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: PAST };

test("primarySubscriptionRow: live paid row beats a live coupon row regardless of order", () => {
  assert.equal(primarySubscriptionRow([couponLive, stripeLive]), stripeLive);
  assert.equal(primarySubscriptionRow([stripeLive, couponLive]), stripeLive);
});

test("primarySubscriptionRow: live coupon beats a free Stripe row", () => {
  assert.equal(primarySubscriptionRow([stripeFree, couponLive]), couponLive);
});

test("primarySubscriptionRow: dead coupon never wins over the Stripe row", () => {
  assert.equal(primarySubscriptionRow([couponDead, stripeFree]), stripeFree);
  assert.equal(primarySubscriptionRow([couponDead, stripeLapsed]), stripeLapsed);
});

test("primarySubscriptionRow: falls back to the first row, then null", () => {
  assert.equal(primarySubscriptionRow([couponDead]), couponDead);
  assert.equal(primarySubscriptionRow([]), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test lib/auth.test.ts`
Expected: FAIL — `primarySubscriptionRow` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `lib/auth.ts` right after `accountHasActivePremium`:

```ts
// The one row that best describes an account's billing state, shared by
// /api/me (iOS) and the billing page so they never disagree. A live paid
// row wins over a live coupon grant (the user must see card/invoices/cancel,
// not "Premium · coupon"); any live row wins over dead ones; the Stripe row
// (lapsed / past-due state) beats an expired coupon row; else whatever is
// first. Prisma returns rows in unspecified order — never rely on rows[0].
export function primarySubscriptionRow<
  T extends { source: string; plan: string; status: string; stripeCurrentPeriodEnd?: Date | null },
>(rows: T[]): T | null {
  return (
    rows.find((r) => (r.source === "STRIPE" || r.source === "APPLE") && hasActivePremium(r)) ??
    rows.find(hasActivePremium) ??
    rows.find((r) => r.source === "STRIPE") ??
    rows[0] ??
    null
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test lib/auth.test.ts`
Expected: all PASS.

- [ ] **Step 5: Write the failing `serializeMe` tests**

Append to `lib/me.test.ts`, using the file's existing `account(subs)` and `sub(overrides)` helpers (defined at the top of that file):

```ts
// ─── 2026-09-12 beta premium coupons ────────────────────────────────────────

test("expired COUPON grant listed first, free STRIPE row second: STRIPE row is reported, isPremium false", () => {
  const me = serializeMe(
    account([
      sub({ source: "COUPON", stripeCurrentPeriodEnd: new Date("2020-01-01T00:00:00.000Z") }),
      sub({ source: "STRIPE", plan: "FREE", stripeCurrentPeriodEnd: null }),
    ]),
    null
  );
  assert.equal(me.isPremium, false);
  assert.equal(me.subscription?.source, "STRIPE");
  assert.equal(me.subscription?.plan, "FREE");
});

test("live COUPON grant is the reported subscription with its end date", () => {
  const until = new Date("2099-12-31T23:59:59.999Z");
  const me = serializeMe(
    account([
      sub({ source: "STRIPE", plan: "FREE", stripeCurrentPeriodEnd: null }),
      sub({ source: "COUPON", stripeCurrentPeriodEnd: until }),
    ]),
    null
  );
  assert.equal(me.isPremium, true);
  assert.equal(me.subscription?.source, "COUPON");
  assert.equal(me.subscription?.currentPeriodEnd, until.toISOString());
});

test("live COUPON grant plus live STRIPE subscription: the paid row is reported", () => {
  const me = serializeMe(
    account([
      sub({ source: "COUPON", stripeCurrentPeriodEnd: new Date("2099-12-31T23:59:59.999Z") }),
      sub({ source: "STRIPE" }),
    ]),
    null
  );
  assert.equal(me.isPremium, true);
  assert.equal(me.subscription?.source, "STRIPE");
});
```

- [ ] **Step 6: Run to verify failure**

Run: `node --import tsx --test lib/me.test.ts`
Expected: the first and third new tests FAIL (`subs[0]` / first active row wins).

- [ ] **Step 7: Use the helper in `serializeMe` and `loadSubscriptionView`**

In `lib/me.ts`, change the import and replace line 51:

```ts
import { accountHasActivePremium, primarySubscriptionRow } from "@/lib/auth";
```

```ts
  // Shared with lib/billing/load-view.ts so iOS and the billing page always
  // describe the same row (paid beats coupon; live beats dead; Stripe beats
  // an expired coupon row).
  const active = primarySubscriptionRow(subs);
```

(`hasActivePremium` is no longer used in `lib/me.ts`; drop it from the import.)

In `lib/billing/load-view.ts`, change the import and replace lines 25-27:

```ts
import { primarySubscriptionRow } from "@/lib/auth";
```

```ts
  // One rule with /api/me (lib/auth.ts primarySubscriptionRow): live paid
  // row → any live row → Stripe row (PAST_DUE / cancelled still shows) → any.
  const row = primarySubscriptionRow(rows);
```

- [ ] **Step 8: Run to verify pass**

Run: `node --import tsx --test lib/me.test.ts lib/auth.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 9: Coupon holders can still buy — billing card link and pricing redirect**

In `components/billing/BillingPanel.tsx`, directly after the `{isStripe && ( <p …>…</p> )}` block that ends at line 105, add:

```tsx
        {!isStripe && view.periodEnd && (
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            Access until {fmtDate(view.periodEnd)}
          </p>
        )}
        {view.source === "COUPON" && view.isPremium && (
          <div className="mt-5">
            <Link
              href="/pricing"
              className="min-h-[44px] px-5 rounded-xl bg-white text-[#5F1C35] font-semibold text-sm inline-flex items-center"
            >
              Subscribe to keep Premium{view.periodEnd ? ` after ${fmtDate(view.periodEnd)}` : ""} →
            </Link>
          </div>
        )}
```

(`fmtDate` and `Link` already exist in this file.)

In `app/(main)/pricing/page.tsx`, the redirect at line 52 currently sends *any* active-premium account to /membership, which strands a coupon holder who wants to pay. Change the import and the condition:

```ts
import { hasPaidPremium } from "@/lib/coupon";
```

```ts
    // Paid premium (and admins) manage their plan on /membership. Coupon-only
    // premium may still buy: the coupon ends on a date, a subscription doesn't.
    if (isAdmin || hasPaidPremium(account?.subscriptions ?? [])) {
      redirect("/membership");
    }
```

(`accountHasActivePremium` becomes unused in that file; drop it from the import.) `POST /api/billing/checkout` already only diverts to the Customer Portal when the *Stripe* row is live, so a coupon holder reaches Checkout normally.

- [ ] **Step 10: Typecheck, then eyeball /membership as the QA user who redeemed in Task 5**

Run: `npx tsc --noEmit`
Expected: no errors. The plan card reads "Premium · coupon / Full access / Access until Dec 31, 2026 / [Subscribe to keep Premium after Dec 31, 2026 →]". Clicking it lands on /pricing (no redirect). As the Stripe test-mode subscriber, /membership still shows the Stripe card with card, invoices and cancel controls, and /pricing still redirects to /membership.

- [ ] **Step 11: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts lib/me.ts lib/me.test.ts lib/billing/load-view.ts components/billing/BillingPanel.tsx "app/(main)/pricing/page.tsx"
git commit -m "fix(billing): one rule for the primary subscription row; coupon holders can still subscribe"
```

---

### Task 7: Admin coupons page — type, two dates, redeemers

> Invoke `ui-ux-pro-max:ui-ux-pro-max` before editing (user's global CLAUDE.md). Keep the page's existing visual language (`fieldClass`, `labelClass`, `.ov` reveal, 44 px tap targets).

**Files:**
- Modify: `app/(dashboard)/admin/coupons/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/admin/coupons` shapes from Task 4.

- [ ] **Step 1: Extend the client `Coupon` type and form state**

Replace the `Coupon` interface (lines 6-17) with:

```ts
interface Coupon {
  id: string;
  code: string;
  type: "ADMIN" | "PREMIUM";
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  accessUntil: string | null;
  note: string | null;
  createdAt: string;
  _count: { redemptions: number };
  redemptions: { redeemedAt: string; account: { email: string } }[];
}
```

Add a helper under `randomCode()`:

```ts
// Default access end for a new premium code: 90 days out, as YYYY-MM-DD for
// <input type="date">. The server reads date-only values as end of day UTC.
function plusDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

Replace the `useState` form initialiser (lines 42-48) with:

```ts
  const [form, setForm] = useState({
    code: randomCode(),
    type: "PREMIUM" as "ADMIN" | "PREMIUM",
    maxUses: "50",
    expiresAt: "",
    accessUntil: plusDays(90),
    note: "",
  });
  const [openId, setOpenId] = useState<string | null>(null);
```

- [ ] **Step 2: Send the new fields**

In `handleCreate`, replace the `body: JSON.stringify({...})` object with:

```ts
      body: JSON.stringify({
        code: form.code,
        type: form.type,
        maxUses: form.maxUses === "-1" ? -1 : Number(form.maxUses),
        expiresAt: form.expiresAt || null,
        accessUntil: form.type === "PREMIUM" ? form.accessUntil || null : null,
        note: form.note || null,
      }),
```

and the success reset with:

```ts
      setForm({ code: randomCode(), type: "PREMIUM", maxUses: "50", expiresAt: "", accessUntil: plusDays(90), note: "" });
```

- [ ] **Step 3: Replace the read-only Type field with a selector, and add the Access-until field**

Replace the `{/* Type */}` block (lines 148-153) with:

```tsx
            {/* Type */}
            <div>
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "ADMIN" | "PREMIUM" })}
                className={fieldClass}
              >
                <option value="PREMIUM">Premium — beta / gift access until a date</option>
                <option value="ADMIN">Admin — full unlimited access (SUPER role)</option>
              </select>
            </div>
```

Change the existing `{/* Expires */}` label text from `Expires (optional)` to `Redeem by (optional)`, and add directly after that block:

```tsx
            {/* Access until (PREMIUM only) */}
            {form.type === "PREMIUM" && (
              <div>
                <label className={labelClass} style={{ color: "#ABA6A6" }}>Access until (required)</label>
                <input
                  type="date"
                  value={form.accessUntil}
                  onChange={(e) => setForm({ ...form, accessUntil: e.target.value })}
                  className={fieldClass}
                  required
                />
                <p className="mt-1.5 text-[11px]" style={{ color: "#ABA6A6" }}>
                  Premium switches off at the end of this day for everyone who used the code.
                </p>
              </div>
            )}
```

Update the header helper copy (line 107) to:

```tsx
              Premium codes unlock Premium until a date you set. Admin codes grant the SUPER role. Stripe promo codes (above) discount paid checkout.
```

and the create card heading (line 123) from `New Admin Code` to `New Code`.

- [ ] **Step 4: Show both dates and the redeemers in the list**

Replace the `<div className="flex items-center gap-3 flex-wrap" style={{ color: "#ABA6A6" }}> … </div>` meta row (lines 279-289) with:

```tsx
                    <div className="flex items-center gap-3 flex-wrap" style={{ color: "#ABA6A6" }}>
                      {/* usedCount is the cap that matters; redemption rows cascade away
                          when an account is deleted, so _count can lag behind it. */}
                      <span className="text-xs">
                        {c.usedCount}/{c.maxUses === -1 ? "∞" : c.maxUses} uses
                      </span>
                      {c.expiresAt && (
                        <span className="text-xs">· Redeem by {new Date(c.expiresAt).toLocaleDateString()}</span>
                      )}
                      {c.accessUntil && (
                        <span className="text-xs">· Access until {new Date(c.accessUntil).toLocaleDateString()}</span>
                      )}
                      {c.note && <span className="text-xs">· {c.note}</span>}
                      {c.redemptions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setOpenId(openId === c.id ? null : c.id)}
                          className="text-xs underline underline-offset-2 min-h-[44px] sm:min-h-0"
                          style={{ color: "#812549" }}
                        >
                          {openId === c.id ? "Hide" : "Who used it"}
                        </button>
                      )}
                    </div>
                    {openId === c.id && (
                      <ul className="mt-2 space-y-1">
                        {c.redemptions.map((r) => (
                          <li key={`${r.account.email}-${r.redeemedAt}`} className="text-xs font-mono" style={{ color: "#4A4E5C" }}>
                            {r.account.email} · {new Date(r.redeemedAt).toLocaleDateString()}
                          </li>
                        ))}
                      </ul>
                    )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint --file "app/(dashboard)/admin/coupons/page.tsx"`
Expected: clean.

- [ ] **Step 6: Verify in the browser as SUPER**

Open `/admin/coupons`. Create a PREMIUM code with 5 uses, redeem-by next month, access until end of year. It appears in the list with both dates. Switch type to Admin: the Access-until field disappears. Submit a PREMIUM code with an empty access date: the form's `required` blocks it; if bypassed, the API's 400 copy is shown under the form.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/admin/coupons/page.tsx"
git commit -m "feat(admin): coupons page mints premium codes — quantity, redeem-by, access until, redeemers"
```

---

### Task 8: Header redeem box copy, i18n, dead component

> Invoke `ui-ux-pro-max:ui-ux-pro-max` before editing.

**Files:**
- Modify: `components/dashboard/DashboardHeader.tsx:18-49`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ru.json` (`dashboardHeader` block)
- Delete: `components/CouponRedeem.tsx`

**Interfaces:**
- Consumes: `POST /api/coupon/redeem` → `{ success, type, accessUntil }` (Task 5).

- [ ] **Step 1: Add the three copy keys to every locale**

Inside the `"dashboardHeader"` object of each file, after `"redeemCouponTitle"`, add:

`messages/en.json`
```json
    "premiumActivatedUntil": "Premium activated until {date}",
    "premiumActivated": "Premium activated",
    "adminActivated": "Admin access granted",
```

`messages/es.json`
```json
    "premiumActivatedUntil": "Premium activado hasta el {date}",
    "premiumActivated": "Premium activado",
    "adminActivated": "Acceso de administrador concedido",
```

`messages/ru.json`
```json
    "premiumActivatedUntil": "Премиум активирован до {date}",
    "premiumActivated": "Премиум активирован",
    "adminActivated": "Доступ администратора предоставлен",
```

- [ ] **Step 2: Use them in `CouponInput`**

In `components/dashboard/DashboardHeader.tsx`, replace the success branch of `handleSubmit` (lines 39-43) with:

```ts
      } else {
        const until = data.accessUntil ? new Date(data.accessUntil).toLocaleDateString() : null;
        const message =
          data.type === "ADMIN"
            ? t("adminActivated")
            : until
              ? t("premiumActivatedUntil", { date: until })
              : t("premiumActivated");
        setResult({ success: true, message });
        setCode("");
        // Layout is server-rendered; refresh re-reads the Subscription rows so
        // PremiumGuard (when gates are on) lets the user through immediately.
        setTimeout(() => { router.refresh(); onClose(); }, 1500);
      }
```

- [ ] **Step 3: Delete the unused component**

```bash
git rm components/CouponRedeem.tsx
```

Run: `grep -rn "CouponRedeem" --include='*.ts' --include='*.tsx' . | grep -v node_modules | grep -v .next`
Expected: no output.

- [ ] **Step 4: Typecheck and verify the flow end to end (gates on, locally)**

Add `PREMIUM_GATES=on` to `.env.local`, restart `next dev`. As a fresh non-admin user:
1. The dashboard shows the Premium gate; the avatar menu still offers "Redeem coupon".
2. Enter the PREMIUM code from Task 7 → green "✓ Premium activated until 12/31/2026", the page refreshes, the gate is gone.
3. `/membership` shows "Premium · coupon · Access until Dec 31, 2026".

Then remove `PREMIUM_GATES=on` from `.env.local` and restart dev (free mode is the committed default).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/DashboardHeader.tsx messages/en.json messages/es.json messages/ru.json
git commit -m "feat(coupons): header redeem box reports the access end; drop unused CouponRedeem"
```

---

### Task 9: Runbook, backlog, env docs

**Files:**
- Create: `docs/billing/coupons.md`
- Modify: `.env.example:36`
- Modify: `BACKLOG.md` (branch-status section the repo keeps at the top; add one entry)

- [ ] **Step 1: Write the runbook**

Create `docs/billing/coupons.md`:

```markdown
# Coupons (beta premium access)

Two kinds of code exist. Both are created at `/admin/coupons` by a SUPER user.

| Kind | What it grants | Where it lives | Use for |
|---|---|---|---|
| **Premium coupon** (DB, type `PREMIUM`) | Premium on the account's `COUPON`-source `Subscription` row until **Access until** | Postgres `Coupon` | Beta testers, gifts, partners |
| **Admin coupon** (DB, type `ADMIN`) | The SUPER role, permanently | Postgres `Coupon` | Team members only |
| Stripe promo code | A discount on paid checkout | Stripe | Marketing discounts |

## Fields on a premium coupon

- **Code** — 4–24 chars, `A-Z 0-9 _ -`. Testers type it in the avatar menu → "Redeem coupon".
- **Max uses** — how many distinct accounts can redeem. `-1` = unlimited. One account can redeem a given code once.
- **Redeem by** (optional) — after this day the code is refused with the generic "Invalid or unavailable code".
- **Access until** (required) — Premium switches off at the end of this day (UTC, plus a 24 h grace built into `hasActivePremium`). Applies to everyone who used the code.

## Behaviour to know

- Deactivating a code stops **new** redemptions only. Access already granted runs to its Access-until date.
- A tester who redeems a second code keeps the **later** end date; access is never shortened. The same code cannot be redeemed twice by one account, even after its access ended: hand out a new code.
- A code whose Access-until date has passed is refused like an invalid code, even if still active.
- A renewing Stripe/Apple subscriber is refused ("You already have Premium — no code needed") and the code's use count is untouched. A subscriber who already cancelled at period end may redeem.
- A tester who holds a coupon can still subscribe: the billing page shows "Subscribe to keep Premium after <date>", and the pricing page stays reachable. After they pay, the **paid** subscription is what the billing page and the app show; the coupon grant sits behind it until its end date.
- **Extending the beta:** use "Extend access" on the code. It moves the code's date and lifts every redeemer's grant that ends earlier (including grants that already ended). It never shortens anyone.
- **Cutting one tester off early** is not in the UI: set that account's `COUPON` subscription row `stripeCurrentPeriodEnd` to now in the database.
- Deleting an account does not free up the code's slot (`usedCount` stays).
- When access ends the user is not warned in advance (no email, no banner). They see the Premium gate on the next page load; nothing is deleted. Access ends at the end of the Access-until day in UTC plus a 24-hour grace.
- Ten wrong codes in an hour lock the redeem box for the rest of the hour.
- iOS: the subscription card says "Managed on the web" for a coupon grant and, for now, "Renews <date>" instead of "Access until <date>" (cosmetic, tracked as an iOS follow-up).
- After the end date the account falls back to Free automatically (no cron). The billing page shows the Free card; `/api/me` reports `isPremium:false`.
- Stripe and Apple rows are never touched by coupons. A tester who later subscribes gets a normal STRIPE row alongside.
- Clerk is not involved; it only identifies the user.

## Turning gates on for the beta

Premium features are gated only when `PREMIUM_GATES=on` is set in the environment (Vercel → Project → Environment Variables). Without it every account already has every feature and coupons change nothing visible. Set it in the environment the beta runs in, redeploy, and confirm a fresh account sees the Premium gate before handing out codes.

## Redemption endpoint

`POST /api/coupon/redeem { code }` → `{ success, type, accessUntil }`. Rate limit 10/hour per user. iOS has no redeem UI; testers redeem on the web and the app picks it up via `/api/me`.
```

- [ ] **Step 2: Document the flag next to its default**

In `.env.example`, replace line 36 with:

```
# Premium gates. "on" = free accounts see the Premium gate and need a paid plan
# or a premium coupon (docs/billing/coupons.md). Anything else = free mode.
PREMIUM_GATES=off
```

- [ ] **Step 3: Backlog entry**

Add to the branch-status block at the top of `BACKLOG.md`:

```markdown
- **Beta premium coupons** (this branch, 2026-09-12): PREMIUM DB coupons restored with quantity / redeem-by / access-until; runbook in docs/billing/coupons.md. **Manual before beta:** set `PREMIUM_GATES=on` in the beta environment (user's call), create the codes at /admin/coupons.
```

- [ ] **Step 4: Full verification**

Run:

```bash
npm test
npx tsc --noEmit
npx next lint
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/billing/coupons.md .env.example BACKLOG.md
git commit -m "docs(coupons): beta premium coupon runbook; PREMIUM_GATES note"
```

---

### Task 10: "Extend access" on a code (beta extension)

> Invoke `ui-ux-pro-max:ui-ux-pro-max` before the UI step.

**Files:**
- Modify: `app/api/admin/coupons/route.ts` (PATCH)
- Modify: `app/(dashboard)/admin/coupons/page.tsx`

**Interfaces:**
- Consumes: `extendGrantsWhere(accountIds, newEnd)` (Task 2), `parseDeadline` (Task 3).
- Produces: `PATCH /api/admin/coupons` accepts either `{ id, isActive }` (unchanged) **or** `{ id, accessUntil }` → `200 { id, accessUntil, extendedGrants: number }` or 400 `{ error }`.

- [ ] **Step 1: Extend the PATCH handler**

Replace the `PATCH` handler in `app/api/admin/coupons/route.ts` with:

```ts
import { extendGrantsWhere } from "@/lib/coupon";
import { parseDeadline } from "@/lib/coupon-admin";

// PATCH /api/admin/coupons
//   { id, isActive }    — toggle new redemptions (never touches granted access)
//   { id, accessUntil } — "Extend access": move the code's date later and lift
//                         every redeemer's COUPON grant that ends earlier.
//                         Never shortens; revives grants that already ended.
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { isAdmin } = await assertAdmin(userId);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; isActive?: unknown; accessUntil?: unknown }
    | null;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });

  if (typeof body.isActive === "boolean") {
    const coupon = await prisma.coupon.update({ where: { id: body.id }, data: { isActive: body.isActive } });
    return NextResponse.json(coupon);
  }

  const newEnd = parseDeadline(body.accessUntil);
  if (newEnd === "invalid" || newEnd === null) {
    return NextResponse.json({ error: "accessUntil must be a date" }, { status: 400 });
  }
  if (newEnd <= new Date()) return NextResponse.json({ error: "Access end date must be in the future" }, { status: 400 });

  const coupon = await prisma.coupon.findUnique({
    where: { id: body.id },
    select: { id: true, type: true, accessUntil: true, redemptions: { select: { accountId: true } } },
  });
  if (!coupon) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  if (coupon.type !== "PREMIUM") return NextResponse.json({ error: "Only premium codes have an access end" }, { status: 400 });
  if (coupon.accessUntil && newEnd <= coupon.accessUntil) {
    return NextResponse.json({ error: "New date must be later than the current access end" }, { status: 400 });
  }

  const extendedGrants = await prisma.$transaction(async (tx) => {
    await tx.coupon.update({ where: { id: coupon.id }, data: { accessUntil: newEnd } });
    const ids = coupon.redemptions.map((r) => r.accountId);
    if (ids.length === 0) return 0;
    const res = await tx.subscription.updateMany({
      where: extendGrantsWhere(ids, newEnd),
      data: { stripeCurrentPeriodEnd: newEnd },
    });
    return res.count;
  });

  return NextResponse.json({ id: coupon.id, accessUntil: newEnd.toISOString(), extendedGrants });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the UI on each PREMIUM row**

In `app/(dashboard)/admin/coupons/page.tsx`, add state next to `openId`:

```ts
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extendMsg, setExtendMsg] = useState("");
```

Add a handler under `toggleActive`:

```ts
  async function extendAccess(id: string) {
    setExtendMsg("");
    const res = await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, accessUntil: extendDate }),
    });
    const data = await res.json();
    if (!res.ok) {
      setExtendMsg(data.error);
      return;
    }
    setExtendMsg(`Extended. ${data.extendedGrants} account${data.extendedGrants === 1 ? "" : "s"} lifted to the new date.`);
    setExtendId(null);
    setExtendDate("");
    load();
  }
```

In the list row, inside the `{/* Toggle */}` area, wrap the existing Deactivate/Activate button and a new button in a flex container:

```tsx
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.type === "PREMIUM" && (
                      <button
                        type="button"
                        onClick={() => { setExtendId(extendId === c.id ? null : c.id); setExtendDate(""); setExtendMsg(""); }}
                        className="text-xs font-bold px-4 py-1.5 rounded-xl border transition-colors min-h-[44px] sm:min-h-0"
                        style={{ borderColor: "rgba(129,37,73,0.3)", color: "#5F1C35", background: "rgba(129,37,73,0.04)" }}
                      >
                        Extend access
                      </button>
                    )}
                    {/* existing Deactivate / Activate button stays here unchanged */}
                  </div>
```

And directly under the row's meta block (after the redeemers `<ul>`), add the inline extend form:

```tsx
                    {extendId === c.id && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); void extendAccess(c.id); }}
                        className="mt-3 flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="date"
                          value={extendDate}
                          onChange={(e) => setExtendDate(e.target.value)}
                          className={fieldClass + " max-w-[180px]"}
                          required
                        />
                        <button type="submit" className="bg-primary text-white text-xs font-bold px-4 py-2.5 rounded-xl min-h-[44px] sm:min-h-0">
                          Move access end
                        </button>
                        <span className="text-[11px]" style={{ color: "#ABA6A6" }}>
                          Lifts everyone who used this code to the new date. Never shortens.
                        </span>
                      </form>
                    )}
                    {extendMsg && extendId === null && (
                      <p className="mt-2 text-xs" style={{ color: "#5F1C35" }}>{extendMsg}</p>
                    )}
```

- [ ] **Step 4: Typecheck, lint, verify**

Run: `npx tsc --noEmit && npx next lint --file "app/(dashboard)/admin/coupons/page.tsx"`
Expected: clean.

In the browser as SUPER: on the PREMIUM code the QA user redeemed in Task 5, click "Extend access", pick a date two weeks after the current one, submit. Expected: "Extended. 1 account lifted to the new date."; the row shows the new Access-until. As the QA user, /membership shows the new date and `/api/me` returns the new `currentPeriodEnd`. Try a date earlier than the current one → the 400 copy appears.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/coupons/route.ts "app/(dashboard)/admin/coupons/page.tsx"
git commit -m "feat(admin): extend a premium code's access end and lift every redeemer's grant"
```

---

### Task 11: "Premium ends soon" banner (decided 2026-09-12: yes)

**Files:**
- Modify: `lib/coupon.ts` (append), `lib/coupon.test.ts` (append)
- Create: `components/billing/CouponEndingBanner.tsx`
- Modify: `app/(dashboard)/layout.tsx:8,13,139`

**Interfaces:**
- Consumes: `hasActivePremium`, `hasPaidPremium` (Task 2).
- Produces: `couponEndingSoon(subs, now, withinDays = 7): Date | null` — the coupon grant's end when it is the account's only live premium and ends within `withinDays`; else null.

- [ ] **Step 1: Write the failing tests**

Append to `lib/coupon.test.ts` (add `couponEndingSoon` to the import):

```ts
test("couponEndingSoon: only-premium coupon ending within 7 days returns its end", () => {
  const now = new Date("2026-12-27T12:00:00Z");
  const end = new Date("2026-12-31T23:59:59.999Z");
  const subs = [
    { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null, cancelAtPeriodEnd: false },
    { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: end, cancelAtPeriodEnd: false },
  ];
  assert.equal(couponEndingSoon(subs, now), end);
});

test("couponEndingSoon: null when far away, already ended, lifetime, or a paid row is live", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const end = new Date("2026-12-31T23:59:59.999Z");
  const coupon = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: end, cancelAtPeriodEnd: false };
  assert.equal(couponEndingSoon([coupon], now), null); // 30 days out
  assert.equal(couponEndingSoon([{ ...coupon, stripeCurrentPeriodEnd: new Date("2020-01-01") }], now), null);
  assert.equal(couponEndingSoon([{ ...coupon, stripeCurrentPeriodEnd: null }], now), null);
  const paid = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2100-01-01"), cancelAtPeriodEnd: false };
  assert.equal(couponEndingSoon([coupon, paid], new Date("2026-12-27T12:00:00Z")), null);
  assert.equal(couponEndingSoon([], now), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test lib/coupon.test.ts`
Expected: FAIL — `couponEndingSoon` not exported.

- [ ] **Step 3: Implement**

Append to `lib/coupon.ts`:

```ts
// Drives the dashboard "Premium ends soon" banner: the coupon grant's end
// when it is the account's only live premium and ends within `withinDays`.
// A live paid row means the banner would be noise; an already-ended grant
// shows the gate instead, not a warning.
export function couponEndingSoon(
  subs: Array<{
    source: string;
    plan: string;
    status: string;
    stripeCurrentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
  }>,
  now: Date,
  withinDays = 7
): Date | null {
  if (hasPaidPremium(subs)) return null;
  const row = subs.find((s) => s.source === "COUPON" && hasActivePremium(s));
  const end = row?.stripeCurrentPeriodEnd ?? null;
  if (!end || end <= now) return null;
  return end.getTime() - now.getTime() <= withinDays * 24 * 60 * 60 * 1000 ? end : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --import tsx --test lib/coupon.test.ts`
Expected: all PASS.

- [ ] **Step 5: Banner component and layout wiring**

Create `components/billing/CouponEndingBanner.tsx`:

```tsx
import Link from "next/link";

// Dashboard-wide notice in the last days of a coupon grant. Only rendered
// when premium gates are on (in free mode losing the grant changes nothing).
export default function CouponEndingBanner({ endsAt }: { endsAt: Date }) {
  const date = endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div role="status" className="px-5 py-2.5 text-sm text-center" style={{ background: "#F5F1DD", color: "#5F1C35" }}>
      Your Premium access ends on {date} —{" "}
      <Link href="/pricing" className="underline font-semibold">subscribe to keep it</Link>.
    </div>
  );
}
```

In `app/(dashboard)/layout.tsx`: add the imports

```ts
import CouponEndingBanner from "@/components/billing/CouponEndingBanner";
import { couponEndingSoon } from "@/lib/coupon";
```

and, directly after the `PastDueBanner` line (139), add:

```tsx
        {premiumGatesEnabled() && (() => {
          const endsAt = couponEndingSoon(account?.subscriptions ?? [], new Date());
          return endsAt ? <CouponEndingBanner endsAt={endsAt} /> : null;
        })()}
```

- [ ] **Step 6: Typecheck and verify**

Run: `npx tsc --noEmit`
Expected: no errors. With `PREMIUM_GATES=on` in `.env.local`, as the QA user whose grant ends within 7 days (use "Extend access"/a fresh code with access-until = 3 days out), the banner shows above the dashboard; with a far-off date it does not.

- [ ] **Step 7: Commit**

```bash
git add lib/coupon.ts lib/coupon.test.ts components/billing/CouponEndingBanner.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat(coupons): 'Premium ends soon' banner in the last 7 days of a coupon grant"
```

---

## Rollout (manual, after merge)

1. Merge the branch; `prisma migrate deploy` already ran in Task 1 against the shared DB, so production code and schema agree.
2. In the beta environment on Vercel set `PREMIUM_GATES=on` and redeploy. **User decision, not part of the code work.**
3. As SUPER, create the cohort code(s) at `/admin/coupons` with the beta's end date as Access until.
4. Verify with a throwaway account: gate visible → redeem → gate gone → `/membership` shows the end date.
5. Hand codes out. Watch "Who used it" on the admin page for uptake.

## Self-review notes

- Requirements → tasks: quantity = `maxUses` (Task 3/4/7); redeem deadline = `expiresAt` (Task 3/4/7); access stop = `accessUntil` → `stripeCurrentPeriodEnd` (Tasks 1, 2, 5); admin creation UI (Task 7); "do we need Clerk" answered in §Design (no).
- Names used consistently: `couponPremiumUpsertArgs(accountId, accessUntil)`, `mergeGrantEnd(existing, incoming)`, `hasPaidPremium(subs)`, `extendGrantsWhere(accountIds, newEnd)`, `primarySubscriptionRow(rows)`, `validateCouponInput(input, now)`, `parseDeadline(raw)`, response field `accessUntil`.
- Scenario matrix rows 1–25 each name a task or are marked accepted; Task 10 is the only task added purely from the matrix (beta extension).
- Task ordering: Task 9 (docs) references Task 10's "Extend access"; execute 10 before 9 or update the runbook wording after 10. Recommended order: 1, 2, 3, 4, 5, 6, 7, 10, 8, 9.
- The existing test asserting `stripeCurrentPeriodEnd` is absent from the upsert shape is intentionally replaced in Task 2; the invariant that matters (no Stripe *ids*) is still asserted.
