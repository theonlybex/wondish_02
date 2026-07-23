# Clara iOS Phase 2 — Auth, Networking, Account & Paywall

> **AMENDED 2026-07-22 (supersedes the specific steps it names; see the roadmap's two amendment blocks):**
>
> 1. **Tab wiring.** The shipped `RootTabView` (Clara `a466a68`) is `enum Tab { restaurants, fridge, chat, stats, account }` with `selection = .restaurants`; **there is no `.scan` case**. Everywhere this plan says "preserve `selection: Tab = .scan` and all four non-account tab bodies unchanged" (Task 5 and its Task-8 restatement), read: **preserve `selection: Tab = .restaurants` and the four non-account tab bodies unchanged**.
> 2. **AccountView is a mock, not a placeholder.** `Clara/Features/Account/AccountView.swift` already renders the signed-in layout (profile card, subscription card, Restore/Terms/Privacy rows, Sign Out, wordmark footer) with hardcoded demo data ("Becks" / "info@wondish.io" / Premium). Task 5 keeps that shipped card structure and replaces the demo data with the router (loading/signedOut/signedIn) + `AccountViewModel`; the demo constants are deleted, not preserved.
> 3. **Fix — schema sequencing (blocker).** Task 1's `serializeMe`/DELETE handler use the `subscriptions` one-to-many relation and `source` column that the original Task 6 migration creates, so 2a would not typecheck. **Move into Task 1's migration:** the `Subscription` relation rename (one row → `subscriptions Subscription[]`), the `source` column (`source SubscriptionSource @default(STRIPE)`, enum `STRIPE | APPLE | COUPON | ADMIN`), and `@@unique([accountId, source])` (dropping `accountId @unique`). Task 6's migration then adds only the Apple columns (`appleOriginalTransactionId`, `appleProductId`, `appleEnvironment`, …) and its partial unique.
> 4. **Fix — `appAccountToken` (blocker).** `Product.PurchaseOption.appAccountToken` takes a `UUID`; a Clerk id (`user_…`) can never equal it. Task 7's `purchase()` MUST set `.appAccountToken(UUID(uuidV5Namespace: claraNamespace, name: clerkUserId))` (deterministic UUIDv5; namespace constant shared in `AppConfig`), and D20's server assertion in `/api/iap/verify` compares against the **same derived UUIDv5**, computed in `lib/iap.ts` from the authenticated `userId` — never raw-id equality. Additionally, the verify route derives status from the **transaction JWS itself** (`expiresDate` vs now; offer type → `TRIALING`), not `mapAppleStatus`, which consumes notification-only fields and applies only to `/api/apple/notifications`.
> 5. **Fix — on-launch entitlement (blocker).** D21's "on-launch `/api/me` reconciliation" gains an implementer: `SessionStore.bootstrap()` fetches `GET /api/me` immediately after a signed-in Clerk `load()` (and on foreground re-entry after sign-in), storing the result as the app-level `MeDTO`. Without this, `EntitlementStore`'s server signal only exists after visiting the Account tab, and a web-Stripe premium user is gated as free on the (default) Restaurants tab.
> 6. **Fix — amendment seam.** Add `case restaurants` to `PaywallContext` and a `restaurantsPerDay` line to `FreemiumLimits` set to **unmetered during the Miracle Mile pilot** (constant present, enforcement off; the gate decision rides D1–D4 per the roadmap amendment §3).
> 7. **Light-mode lock.** Task 2's `project.yml` edit adds `UIUserInterfaceStyle: Light` to the Info.plist properties — tokens are fixed light-only hex.
> 8. Minor: `DELETE /api/me` gets the same `rateLimit` guard as GET (10/60s is fine); the `-UITestFixture paywall` fixture must specify how `PaywallView` is presented (present it as a sheet from the fixture branch in `ClaraApp`), since Task 4's fixtures only seed `phase`/`me`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each such task.**

**Goal:** Give the native **Clara** iOS app (`/Users/becks/Desktop/NewView/Clara`) its authentication + networking foundation and its money surface: wire the **Clerk iOS SDK** as Clara's first SPM dependency, build a `WondishAPIClient` (Bearer injection, JSON-401 re-mint-and-retry-once, redirect-is-never-success, typed error taxonomy) against the already-shipped web middleware, add the genuinely-required backend surface (`GET`/`DELETE /api/me`) in the web repo, replace `AccountPlaceholderView` with a real signed-out/signed-in **Account screen**, and decide + build the **freemium funnel**: StoreKit 2 in-app purchase as the sole in-app unlock path, a brand-styled `PaywallView`, and a **source-tagged, one-row-per-source** Apple↔DB `Subscription` reconciliation surface. A Stripe/coupon subscriber signs in and is premium with zero new billing surface; the StoreKit purchase path is a self-contained, independently-reviewable slice.

**Architecture:** The client depends on Clerk only through a `TokenProviding` protocol seam, so the networking core is unit-testable without a live Clerk session. `SessionStore` (`@Observable @MainActor`) owns Clerk bootstrap (`configure` + `load()`), the coarse auth state the Account tab gates on, **and the latest `MeDTO`** (the single app-level entitlement/identity holder that `EntitlementStore` reads). Premium is now modeled as **one `Subscription` row per source** (`@@unique([accountId, source])`, `source ∈ STRIPE | APPLE | COUPON | ADMIN`), OR-unioned by a new `accountHasActivePremium(subs[])`, so Apple and Stripe lifecycles are structurally independent and can never clobber each other. The client reads entitlement from two signals — the authoritative DB truth via `GET /api/me` and the immediate/offline StoreKit `Transaction.currentEntitlements` (drained into a cached `@Observable Bool`, never read synchronously) — OR'd in one pure resolver. Web changes live in `/Users/becks/Desktop/NewView/wondish_02` with pure logic extracted into `lib/*.ts` covered by the repo's `node --test` runner; iOS logic is covered by `ClaraTests` (XCTest) behind protocol/`URLProtocol` seams.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 target, XcodeGen, XCTest, Clerk iOS SDK (product/module `Clerk`; UI product `ClerkUI` for the prebuilt `AuthView`), StoreKit 2; web side: Next.js 14, TypeScript, Prisma/Postgres, Clerk v7 (`@clerk/nextjs ^7`), Stripe, `app-store-server-library` (Node), Anthropic SDK.

## Global Constraints

- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, separate from the web repo. Work on branch `phase2-auth-networking`. App/bundle id: `io.wondish.clara`.
- Web repo: `/Users/becks/Desktop/NewView/wondish_02`, on branch `clara-ios-phase2-backend` (branched from `main`).
- Swift + SwiftUI only; no UIKit-only screens (UIKit appearance/`Security.framework` bridging is allowed where SwiftUI has no equivalent). iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), portrait only.
- **Reuse the existing backend.** New server surface is added ONLY where genuinely required and is justified per-task. Phase 2 adds exactly: `GET`/`DELETE /api/me` (required — the Account screen cannot render without it), and the Apple IAP reconciliation surface (`POST /api/iap/verify`, `POST /api/apple/notifications`, a per-source `Subscription` migration, a Stripe-webhook downgrade guard). The macro-tracking "no new server surface" claim does **not** survive the Account screen or monetization; this is called out explicitly.
- English only, no dark mode (the ported design system is light-only). Reuse ported design tokens/components ONLY — **no new colors**, no new components except the two small, justified, token-only primitives in Task 5 (`Avatar`, `AccountRow`). Inter fonts only.
- Brand tokens are fixed: primary `#812549`, primary-light `#B75E78`, primary-dark `#5F1C35`, background `#F9F7ED`, secondary cream `#F5F1DD`, border `#EAE4CA`, text `#1E1A1A`, secondary text `#4F4A4A`, tertiary `#848181`, placeholder `#A8A4B5`, success `#00B9A6`, warning `#FDC221`, error `#EA5455`. **`WBadge(.info)` is a teal alias of `.success`** — never use it for plan/state discrimination; use `.primary`/`.warning`/`.error`/`.neutral`.
- Never store the bearer JWT in Clara's Keychain. Clerk session JWTs are ~60 s TTL; Clerk's SDK owns session-credential persistence in its own Keychain slots. `ClaraKeychain` stores only non-secret flags, never a JWT.
- The 401 re-mint/retry is bounded to **exactly one** re-mint and depends on the already-shipped middleware `wantsJson401` branch returning real JSON 401 (not a 307→HTML redirect). The client installs a redirect-suppressing `URLSessionTaskDelegate` for API calls so a followed redirect can **never** be decoded as a 200.
- iOS HIG: SF Symbols (no emoji icons), ≥44 pt touch targets, respect safe areas, Dynamic Type. A **"Restore Purchases"** affordance is mandatory (App Store approval). **In-app account deletion** (`DELETE /api/me`) is mandatory (Guideline 5.1.1(v)). **Full auto-renewal disclosure** adjacent to the purchase button is mandatory (Guideline 3.1.2).
- iOS test/verify: `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test` (discover the device via `xcrun simctl list devices available | grep iPhone`). Web test command: `npm test` (runs `node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts`; new tests must be `lib/*.test.ts` to be auto-picked).
- **Clerk-SDK symbols are pinned in this plan and re-confirmed at build time against the SDK's `Package.swift` + quickstart** (all localized to `ClerkTokenProvider` + `SessionStore` + `ClaraApp`, so no tested logic depends on them): product/module **`Clerk`** (import `Clerk`), **instance** config `Clerk.shared.configure(publishableKey:)` (sync) followed by `try await Clerk.shared.load()` in `bootstrap()`; `session.getToken(GetTokenOptions(skipCache: true))` for the force path; `Clerk.shared.signOut()`; the prebuilt UI lives in product **`ClerkUI`**.
- **Bearer acceptance is a hard, unverified dependency:** the shipped `clerkMiddleware`/`auth()` must validate the iOS session JWT from the `Authorization` header (correct `authorizedParties`/`azp` for `io.wondish.clara`). Task 8 adds a live smoke step that hits `/api/me` with a real iOS-minted Bearer and asserts **200**, not merely that the JSON-401 branch fires.

---

## Open product decisions (need sign-off) — each has a RECOMMENDED default so the plan is actionable now

| # | Decision | RECOMMENDED default (plan is written against this) |
|---|---|---|
| D1 | In-app unlock mechanism | **StoreKit 2 IAP only.** No external Stripe link inside the app (in-app digital content → Guideline 3.1.1; the US Epic injunction is US-only + under appeal — do not bet approval on it). Stripe/coupon premium is **honored** via sign-in (3.1.3(b)); Clara never *sells* Stripe. |
| D2 | Price point | **$14.99/mo** (Apple tiers can't hit exactly $15; web stays $15 Stripe). Read `product.displayPrice` at runtime — never hard-code. |
| D3 | Free trial | **7-day intro trial → `Subscription.status = TRIALING`.** Configured in App Store Connect + local `.storekit`. |
| D4 | Freemium limits (one constants file, trivially tunable) | Scan **3/day**, Fridge **1/day**, Chat **5/day**, Stats **today-only**, meal planner gating per **D14**. Rule table + `UsageMeter` built now; feature screens stay Phase 3–6 stubs. |
| D5 | Backend gate response standardization | **Client maps both** `402` (meal-log CUSTOM) and `403 {error:"Premium required"}` (meal-plan/taste) → `.premiumRequired`, **matching on a stable field the actual shipped bodies use (verified in Task 3 Step 0), not a human-facing string.** Optionally standardize the server on `402` later (out of scope). |
| D6 | Annual SKU | **Later.** Subscription group `wondish_premium` is created now to allow it. |
| D7 | Double-billing UX | **Suppress** the IAP CTA when `me.isPremium` is already true ("You're Premium via web"). This is cosmetic only — the *data* guard is D19. |
| D8 | Scope split (2a / 2b) | Ship Task 1 (`/api/me`) + Tasks 2–5 (auth/networking/Account/paywall **stub** render) as **2a**; the Apple reconciliation surface (Task 6) + live StoreKit purchase (Task 7) land as fast-follow **2b**. 2a is independently buildable because Task 5 ships against explicit stub types (see "Consumes (stubbed until 2b)" in Task 5). |
| D9 | App Store Connect provisioning (**human-only**, blocks live purchase testing — sandbox/local `.storekit` works meanwhile) | Create auto-renewable product `io.wondish.clara.premium.monthly` in group `wondish_premium`; **enroll in the Apple Small Business Program (15% tier) if Wondish is under $1M/yr** (halves commission — see D10); **decide Family Sharing = OFF** on the SKU (solo subscription; enabling it grants up-to-5 family members one purchase — see D18); create an App Store Connect API key (Issuer ID + Key ID + `.p8`) for JWS verification; register the Server Notifications V2 URL; **stamp the Clerk `userId` into `appAccountToken`** (D20 *verifies* it server-side). |
| D10 | **iOS pricing vs Apple commission** | **Absorb the margin at $14.99 for launch.** Net per iOS sub ≈ **$10.49 at 30%** / **$12.74 at 15% (Small Business Program)** vs ≈ $14.50 for $15 Stripe — a 12–28% haircut. Options for the human: (a) absorb at $14.99 [default], (b) raise iOS price to recover the cut, (c) accept web-parity. **Do not** build steering-to-web to dodge the cut (anti-steering forbids it). D9's Small Business enrollment moves every number here. |
| D11 | **Entitlement during Apple billing grace / retry** | **KEEP premium during Apple grace period.** `mapAppleStatus(DID_FAIL_TO_RENEW, GRACE_PERIOD) → {PREMIUM, status:"GRACE"}`; extend `hasActivePremium`'s active set to `{ACTIVE, TRIALING, INCOMPLETE, GRACE}` (Task 6 Step 0 changes the predicate + adds a test). Billing-retry *without* grace → `PAST_DUE` (no premium). This is a live entitlement decision — mapping grace to `PAST_DUE` would evict paying-but-retrying users. |
| D12 | **Account deletion vs an active subscription** | **Do not silent-delete over live billing.** On `DELETE /api/me`: if an active `STRIPE`/`COUPON` sub exists, **cancel-at-period-end via the Stripe API before deleting**; if an active `APPLE` sub exists, the server **cannot** cancel it — return `409 { error:"apple_subscription_active" }` and the client shows the App Store **Manage Subscriptions** deep link + requires explicit confirmation before a forced delete. Never delete an account while an Apple auto-renewable keeps charging with no in-app way to reach it. |
| D13 | **GDPR erasure vs financial-record retention + export** | **Surface for legal sign-off.** Phase 2 default: **hard-delete PII** (Patient/logs) but retain the `Subscription` row's non-PII financial fields (anonymized `accountId → NULL`-tombstone) for tax/accounting; **data export before erasure is deferred** (documented gap, not silently dropped). If legal requires full erasure, flip a documented flag. |
| D14 | **Flagship (meal-planner) gating strategy** — the core freemium bet | **Hard-lock the meal planner** behind premium for Phase 2 (highest conversion signal; teaser/first-plan-free is a later A/B). Called out as a first-class decision, not a buried table cell: the tradeoff is conversion vs top-of-funnel abandonment. |
| D15 | **Free daily quotas: server-enforced vs client-only** | **Client-only for Phase 2 (accepted honor-system leak).** `UsageMeter` is on-device (`UserDefaults`, `yyyy-MM-dd`); reinstall/date-change/clear-storage resets it. The backend enforces only the premium/free **binary** (402/403), never the daily allotment. This is an explicit, accepted revenue-leak decision — server-side quota enforcement is a later phase. |
| D16 | **`/membership` behavior for `source=APPLE` web visitors** | **In-scope minimal fix:** the web `/membership` must show **"Managed via the App Store"** (no Stripe controls, no "subscribe" prompt) when the account's active sub is `source=APPLE`. Full Apple management on web is deferred, but a broken/misleading Stripe UI is not acceptable. |
| D17 | **Trial-stacking across Apple + Stripe** | **Accept it for Phase 2, flagged.** Apple intro trials are per-Apple-ID and orthogonal to the Wondish account; a user can consume a web (Stripe) trial then an iOS (Apple) trial. Phase 2 does not attempt cross-platform trial suppression (Apple can't enforce per-your-account); the cost is acknowledged, not hidden. |
| D18 | Family Sharing on the SKU | **Disable** (solo-productivity subscription). Set at product creation in App Store Connect (D9). |
| D19 | **Both-source data guard (double-billing / clobber)** | With per-source rows (D-arch), an Apple `verify`/notification writes only the `(accountId, APPLE)` row and **can never overwrite an active `STRIPE`/`COUPON`/`ADMIN` row**; `shouldDowngradeOnStripeDelete` still guards the Stripe path. If a user ends up with two active sources, the app **warns them to cancel the duplicate** (Account + Paywall copy). |
| D20 | **IAP transaction→account binding** | **Server rejects mismatches.** `POST /api/iap/verify` and the notifications webhook assert `transaction.appAccountToken === <authenticated userId>` (or, for webhooks, resolve strictly by the stored binding) and **403** on mismatch. Prevents entitlement spoofing / shared-device hijack via a leaked or foreign JWS. |
| D21 | **Missed-notification reconciliation cadence** | **Verify-on-critical-action + on-launch `/api/me`** for Phase 2; a periodic `getAllSubscriptionStatuses` sweep (App Store Server API) is **deferred but named**. A dropped `EXPIRED`/`REVOKE` notification would otherwise leave a stale `ACTIVE` row; the accepted mitigation is the on-launch re-verify, not blind trust in webhook delivery. |

Until D9 lands, Task 7's purchase flow is verified against a committed local `Clara/Store/Products.storekit` in the simulator — no App Store Connect product and no live web backend required.

---

### Task 1: WEB — `GET`/`DELETE /api/me` + consolidated email-claim `getOrCreateAccount` (race-safe, verified-email-only claim)

**Repo:** `/Users/becks/Desktop/NewView/wondish_02`. Independent of the iOS tasks; must land before Task 5 consumes it.

**Files:**
- Create: `lib/me.ts`, `lib/me.test.ts`
- Create: `app/api/me/route.ts`
- Modify: `lib/auth.ts` (promote the email-claim `getOrCreateAccount`; make it race-safe; add `accountHasActivePremium`)
- Modify: `lib/auth.test.ts`
- Modify: `app/api/patient/profile/route.ts` (drop its local `getOrCreateAccount`, import the shared one)
- Modify: `.env.example` (document no new key here, but add a hand-off note; the `APPLE_IAP_*` keys land in Task 6)
- **No `middleware.ts` change** — `/api/me` is authenticated; do NOT add it to `isPublicRoute`.

**Interfaces:**
- Produces: `serializeMe(account, patient): MeDTO` — pure, no Prisma/auth. `{ id, email, firstName, lastName, photoUrl, onboardingComplete, isPremium, subscription: { plan, status, source, currentPeriodEnd, trialEndsAt, canceledAt } | null }`. `isPremium = accountHasActivePremium(account.subscriptions)`. The serialized `subscription` block is the **active** row if any (`subscriptions.find(hasActivePremium) ?? subscriptions[0] ?? null`). `onboardingComplete = patient ? isProfileComplete(patient) : false` (the raw column is a never-backfilled cache — trust the derived truth). `currentPeriodEnd` coalesces `stripeCurrentPeriodEnd ?? appleExpiresAt` (Apple field exists after Task 6).
- Produces: `resolveAccountClaim(existingByEmail, userId, emailVerified)` (pure) + `getOrCreateAccount(userId)` — **reconciles by email but only claims a `clerkId:null` row when the incoming Clerk email is `verified`** (unverified → create a distinct account; prevents takeover). Race-safe: `create` wrapped to catch `P2002` → re-read. Returns the account with `include: { subscriptions: true }`.
- Produces: `accountHasActivePremium(subs: SubRow[]) = subs.some(hasActivePremium)`; row-level `hasActivePremium(sub)` is unchanged in shape (its active set is extended in Task 6 Step 0 for D11).
- Justification (the required addition): no existing route returns identity + subscription for a Bearer client — `GET /api/patient/profile` omits `subscription`/`onboardingComplete`/`photoUrl` and ships a heavy `refData` catalog; `GET /api/stripe/checkout` 404s for coupon/admin premium. `serializeMe` is ~18 lines and reuses existing helpers.

- [ ] **Step 0: Create the branch + verify the paywall gate bodies (D5)**

```bash
cd /Users/becks/Desktop/NewView/wondish_02 && git checkout main && git pull && git checkout -b clara-ios-phase2-backend
```
Grep the shipped gate routes for the exact 402/403 bodies the client will key on (`grep -rn '402\|403\|Premium required' app/api/meal-log app/api/meal-plan app/api/taste`). Record the stable field/shape; Task 3's `APIError.from` matches **that**, not an assumed human string. Also `grep -rn 'getOrCreateAccount' app lib` to enumerate every importer of the arg-less lib version before changing its signature.

- [ ] **Step 1: Consolidate `getOrCreateAccount` (email-claim, verified-only), write its failing test**

Extract the claim decision as a pure helper. Add to `lib/auth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountClaim } from "./auth";

test("claims an existing unclaimed email row when the incoming email is verified", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: null, email: "x@y.com" }, "user_123", true),
    { action: "claim", accountId: "a1", clerkId: "user_123" });
});
test("does NOT claim an unclaimed row when the incoming email is unverified (takeover guard)", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: null, email: "x@y.com" }, "user_123", false),
    { action: "create" });
});
test("creates when no email row exists", () => {
  assert.deepEqual(resolveAccountClaim(null, "user_123", true), { action: "create" });
});
test("no-op when the email row already belongs to this clerk user", () => {
  assert.deepEqual(
    resolveAccountClaim({ id: "a1", clerkId: "user_123", email: "x@y.com" }, "user_123", true),
    { action: "none", accountId: "a1" });
});
```

Run: `node --import tsx --test lib/auth.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implement `resolveAccountClaim` + rewrite `getOrCreateAccount` (race-safe) + add `accountHasActivePremium`**

In `lib/auth.ts`: export `resolveAccountClaim(existingByEmail, userId, emailVerified)`. Rewrite `getOrCreateAccount(userId)`: read Clerk user (email/verified/name/photo — Clerk v7 `const client = await clerkClient(); const u = await client.users.getUser(userId)`), `findUnique({ where:{ clerkId:userId }, include:{ subscriptions:true } })`; if absent, `findUnique({ where:{ email } })` → `resolveAccountClaim`: `claim` → `update { clerkId }`; `create` → **wrap `account.create` (+ one FREE/ACTIVE `Subscription` `source:STRIPE`) in a `try/catch (P2002) → re-read by clerkId/email`** so concurrent launch/foreground/post-purchase first-hits can't 500 on `email @unique`. Always return with `include:{ subscriptions:true }`. Add `accountHasActivePremium`. Delete the local copy in `patient/profile/route.ts`, import the shared one; update any other importer found in Step 0 to pass `userId`.

Run: `node --import tsx --test lib/auth.test.ts` → Expected: PASS.

- [ ] **Step 3: Write failing `serializeMe` tests**

Create `lib/me.test.ts` — cover: premium/active (isPremium true, ISO `currentPeriodEnd`, `source` present), free/active (false), canceled premium (false), **no active row among several sources still finds the active one**, null-subscriptions (`subscription:null`, isPremium false), `onboardingComplete` reflects `isProfileComplete(patient)` not the raw column, no-patient → false, and a **key-set guard** asserting the subscription block is exactly `["canceledAt","currentPeriodEnd","plan","source","status","trialEndsAt"]` (no stripe secret / customerId leakage). Run → Expected: FAIL (`Cannot find module './me'`).

- [ ] **Step 4: Implement `lib/me.ts`**

```ts
import { hasActivePremium, accountHasActivePremium } from "@/lib/auth";
import { isProfileComplete, type ProfileCompletionInput } from "@/lib/onboarding";

export type MeSubscriptionDTO = {
  plan: string; status: string; source: string;
  currentPeriodEnd: string | null; trialEndsAt: string | null; canceledAt: string | null;
} | null;

export type MeDTO = {
  id: string; email: string; firstName: string; lastName: string;
  photoUrl: string | null; onboardingComplete: boolean; isPremium: boolean;
  subscription: MeSubscriptionDTO;
};

type SubRow = {
  plan: string; status: string; source: string;
  stripeCurrentPeriodEnd: Date | null; appleExpiresAt?: Date | null;
  trialEndsAt: Date | null; canceledAt: Date | null;
};

export function serializeMe(
  account: { id: string; email: string; firstName: string; lastName: string; photoUrl: string | null; subscriptions: SubRow[] },
  patient: ProfileCompletionInput | null
): MeDTO {
  const subs = account.subscriptions ?? [];
  const active = subs.find(hasActivePremium) ?? subs[0] ?? null;
  return {
    id: account.id, email: account.email,
    firstName: account.firstName, lastName: account.lastName, photoUrl: account.photoUrl,
    onboardingComplete: patient ? isProfileComplete(patient) : false,
    isPremium: accountHasActivePremium(subs),
    subscription: active ? {
      plan: active.plan, status: active.status, source: active.source,
      currentPeriodEnd: (active.stripeCurrentPeriodEnd ?? active.appleExpiresAt ?? null)?.toISOString() ?? null,
      trialEndsAt: active.trialEndsAt?.toISOString() ?? null,
      canceledAt: active.canceledAt?.toISOString() ?? null,
    } : null,
  };
}
```

> Note: until Task 6's migration, `subscriptions` is a one-element list (the single existing row read as an array via the relation rename). Task 6 makes it genuinely multi-row. Run: `node --import tsx --test lib/me.test.ts` → Expected: PASS.

- [ ] **Step 5: Write the thin route handlers (correct Clerk v7 delete + D12 billing guard)**

Create `app/api/me/route.ts`:

```ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrCreateAccount, accountHasActivePremium } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { serializeMe } from "@/lib/me";
import { cancelStripeAtPeriodEnd } from "@/lib/stripe-admin"; // reuse existing stripe client
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("me", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const account = await getOrCreateAccount(userId); // include: { subscriptions: true }
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  return NextResponse.json(serializeMe(account, patient));
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOrCreateAccount(userId);
  const active = account.subscriptions?.filter(s => s.status !== "CANCELED") ?? [];

  // D12: never delete over live Apple billing the server can't cancel.
  if (active.some(s => s.source === "APPLE")) {
    return NextResponse.json(
      { error: "apple_subscription_active",
        message: "Cancel your subscription in the App Store before deleting your account." },
      { status: 409 });
  }
  // D12: cancel live Stripe/coupon billing at period end before deletion.
  for (const s of active.filter(s => s.source === "STRIPE" || s.source === "COUPON")) {
    await cancelStripeAtPeriodEnd(s); // best-effort; logs on failure
  }

  // D5.1.1(v): delete Clerk identity FIRST so a failure can't leave a re-createable zombie.
  const client = await clerkClient();
  await client.users.deleteUser(userId);
  // Cascades to Subscription/Patient/AccountRole/CouponRedemption via onDelete: Cascade (confirmed).
  await prisma.account.deleteMany({ where: { clerkId: userId } });
  return NextResponse.json({ ok: true });
}
```

> D13 note: Phase 2 hard-deletes; if legal requires financial-row retention, replace the cascade delete of `Subscription` with an anonymizing tombstone. Flag to the human. If `cancelStripeAtPeriodEnd` needs a helper, add it to `lib/stripe-admin.ts` (thin wrapper over the existing Stripe client).

- [ ] **Step 6: Full web suite + `.env.example` hand-off + commit**

```bash
npm test   # all existing + new me/auth tests PASS
```
Report to the human that no new env key is required for Task 1 (the `APPLE_IAP_*` keys arrive in Task 6). Then:
```bash
git add lib/me.ts lib/me.test.ts app/api/me/route.ts lib/auth.ts lib/auth.test.ts app/api/patient/profile/route.ts lib/stripe-admin.ts
git commit -m "feat(api): GET/DELETE /api/me + race-safe verified-email getOrCreateAccount + accountHasActivePremium"
```

---

### Task 2: iOS — branch, Clerk SPM dependency, `AppConfig`, `ClaraKeychain`, app bootstrap

**Repo:** `/Users/becks/Desktop/NewView/Clara`. All remaining iOS tasks work here.

**Files:**
- Modify: `project.yml` (top-level `packages:` block; `dependencies:` under the `Clara` target; per-config `configFiles:` map; `info.properties` for `WONDISH_BASE_URL` / `CLERK_PUBLISHABLE_KEY`)
- Create: `Config/Debug.xcconfig`, `Config/Release.xcconfig` (committed; see D12/xcconfig note below)
- Create: `Clara/Core/Config/AppConfig.swift`
- Create: `Clara/Core/Session/ClaraKeychain.swift`
- Modify: `Clara/App/ClaraApp.swift` (`Clerk.shared.configure(publishableKey:)` in `init()`; inject `.environment(Clerk.shared)`)
- Create: `ClaraTests/ClaraKeychainTests.swift`, `ClaraTests/AppConfigTests.swift`

**Interfaces:**
- Produces: `enum AppConfig` — `static var baseURL: URL` (from `WONDISH_BASE_URL`; `fatalError` if absent/malformed), `static var clerkPublishableKey: String` (from `CLERK_PUBLISHABLE_KEY`). Consumed by Task 3's client + `ClaraApp`.
- Produces: `struct ClaraKeychain` — `set/data(for:)/remove/removeAll/verifyPersistenceAvailable`; `enum Item: String, CaseIterable { case firstRunComplete }`. Thin `SecItem*` wrapper over `kSecClassGenericPassword`, service `io.wondish.clara.session`. **Stores only non-secret flags — never a JWT.**
- Produces: an app that launches with Clerk configured and `Clerk.shared` in the environment.

- [ ] **Step 0: Create the branch**

```bash
cd /Users/becks/Desktop/NewView/Clara && git checkout -b phase2-auth-networking   # from the current Phase-1 tip
```

- [ ] **Step 1: Invoke the frontend design skills, then add the SPM dependency + config**

Invoke `Skill(ui-ux-pro-max:ui-ux-pro-max)` and `Skill(mobile-ios-design)` before touching any Swift/UI wiring. Edit `project.yml`:

```yaml
packages:
  Clerk:
    url: https://github.com/clerk/clerk-ios
    from: "0.1.0"          # confirm the actual current major against Package.swift at build time
targets:
  Clara:
    dependencies:
      - package: Clerk
        product: Clerk       # core APIs (import Clerk). ClerkUI product added in Task 5 for AuthView.
    configFiles:
      Debug: Config/Debug.xcconfig
      Release: Config/Release.xcconfig
    info:
      properties:
        WONDISH_BASE_URL: $(WONDISH_BASE_URL)
        CLERK_PUBLISHABLE_KEY: $(CLERK_PUBLISHABLE_KEY)
configs:
  Debug: debug
  Release: release
```

`Config/Debug.xcconfig` (**committed** — localhost + a *test* publishable key are non-secret and required for a green build/CI):
```
WONDISH_BASE_URL = http:/$()/localhost:3000
CLERK_PUBLISHABLE_KEY = pk_test_REPLACE_WITH_DEV_KEY
```
`Config/Release.xcconfig` (committed; **placeholder** live values — real `pk_live` injected by CI env, never committed):
```
WONDISH_BASE_URL = https:/$()/app.wondish.io
CLERK_PUBLISHABLE_KEY = $(CLERK_PUBLISHABLE_KEY_LIVE)
```
`package:` matches the `packages:` key, not the URL. Confirm the exact SPM product/module name (`Clerk`) against `Package.swift` at build time.

- [ ] **Step 2: Write `AppConfig.swift`**

```swift
import Foundation

enum AppConfig {
    static var baseURL: URL {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "WONDISH_BASE_URL") as? String,
              let url = URL(string: s) else { fatalError("WONDISH_BASE_URL missing/malformed in Info.plist") }
        return url
    }
    static var clerkPublishableKey: String {
        Bundle.main.object(forInfoDictionaryKey: "CLERK_PUBLISHABLE_KEY") as? String ?? ""
    }
}
```

- [ ] **Step 3: Write failing `ClaraKeychainTests` + `AppConfigTests`**

`ClaraKeychainTests`: set/data round-trip, unknown-key→nil, overwrite, remove, `verifyPersistenceAvailable()==true` in host, and the **intent guard** `testNoTokenAffordanceExists` (`Item.allCases` has no case whose rawValue contains "token"). `AppConfigTests`: assert `AppConfig.baseURL.scheme != nil` and the host resolves *a* value — **tolerate the exact string** (assert it parses, not that it equals `http://localhost:3000`) so a CI with a different injected base URL still passes. Run → Expected: compile FAILURE.

- [ ] **Step 4: Implement `ClaraKeychain.swift`**

`struct ClaraKeychain` over `Security.framework`, service `io.wondish.clara.session`, `enum Item: String, CaseIterable { case firstRunComplete }`. `set` = `SecItemAdd`/`SecItemUpdate`, `data(for:)` = `SecItemCopyMatching`, `remove`/`removeAll` = `SecItemDelete`. `verifyPersistenceAvailable()` writes+reads+deletes a sentinel and returns success. Lead with the doc comment: `"Bearer JWTs are never stored here; Clerk owns session-credential persistence."`

- [ ] **Step 5: Wire `ClaraApp` (Clerk configure + environment)**

```swift
import SwiftUI
import Clerk

@main
struct ClaraApp: App {
    init() {
        Clerk.shared.configure(publishableKey: AppConfig.clerkPublishableKey)
        // NOTE: UITabBarAppearance setup stays in RootTabView.init() (Phase 1) — do NOT move it here.
    }
    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(Clerk.shared)
        }
    }
}
```
(`SessionStore` + `WondishAPIClient` injection + `await Clerk.shared.load()` land in Task 4; this step only proves the SDK links and configures.)

- [ ] **Step 6: Regenerate, build, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(auth): add Clerk iOS SDK via SPM, AppConfig, committed xcconfig, ClaraKeychain, app bootstrap"
```
Expected: `BUILD SUCCEEDED` (Clerk resolves) + `TEST SUCCEEDED`. FAIL — any unresolved `Clerk` package or Keychain round-trip failure.

---

### Task 3: iOS — `WondishAPIClient` + shared test doubles + typed errors + `MeDTO` (with `source`) + redirect suppression

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 2.

**Files:**
- Create: `Clara/Core/Networking/TokenProviding.swift`
- Create: `Clara/Core/Networking/APIRequest.swift`
- Create: `Clara/Core/Networking/APIError.swift`
- Create: `Clara/Core/Networking/WondishAPIClient.swift`
- Create: `Clara/Core/Networking/RedirectBlockingDelegate.swift`
- Create: `Clara/Core/Networking/DTOs/MeDTO.swift`
- Create: `Clara/Core/Networking/Support/StubURLProtocol.swift` (**`#if DEBUG`, in the app target** so both `ClaraTests` and the `-UITestFixture` launch path can use it)
- Create: `ClaraTests/Support/StubTokenProvider.swift`
- Create: `ClaraTests/APIErrorTests.swift`, `ClaraTests/WondishAPIClientTests.swift`, `ClaraTests/MeDTODecodingTests.swift`

**Interfaces:**
- Produces: `protocol TokenProviding: Sendable { func token(forceRefresh: Bool) async throws -> String? }` — the seam that keeps `Clerk` out of tests.
- Produces: `struct APIRequest { let path: String; var method: HTTPMethod = .get; var body: Encodable? = nil; var query: [URLQueryItem] = [] }` + `enum HTTPMethod: String { case get, post, patch, delete }`.
- Produces: `enum APIError: Error, Equatable { case unauthorized, premiumRequired, offline, rateLimited(retryAfter: TimeInterval?), notFound, profileNotFound, server(status: Int), decoding, transport }` + pure mappers `from(statusCode:body:)` / `from(urlError:)`. Case-level `Equatable`.
- Produces: `actor WondishAPIClient` — `init(baseURL:tokens:session:)`; `send<T:Decodable>(_:as:)` / `send(_:)`. Injects `Authorization: Bearer <token(forceRefresh:false)>`; on `401` re-mints once via `token(forceRefresh:true)` and retries exactly once (`allowRetry:false` bounds it); a second `401` → `.unauthorized`; a `nil` re-minted token throws `.unauthorized` **without** sending `Bearer nil`; `402/403` matching the verified premium body → `.premiumRequired`; `404 {error:"Profile not found"}` → `.profileNotFound`; other `404` → `.notFound`; `429` → `.rateLimited`; `5xx` → `.server`. **A `RedirectBlockingDelegate` returns `nil` from `willPerformHTTPRedirection` so a followed 3xx can never decode as success.** `JSONDecoder.dateDecodingStrategy = .iso8601`. Registered via `EnvironmentKey \.apiClient`.
- Produces: `struct MeDTO: Decodable, Equatable` mirroring `serializeMe`, **including `let source: String?`** in the nested `SubscriptionDTO`.
- Produces (test doubles): `StubURLProtocol` (canned per-request `(Data, HTTPURLResponse)` queue, records requests) + `StubTokenProvider` (canned tokens, counts `forceRefresh` calls) — the seam the entire "unit-testable without live Clerk/backend" architecture rests on.

- [ ] **Step 0: (from Task 1 Step 0) confirm the paywall-gate body shape** the 402/403 mapper keys on. `APIError.from` matches a stable field, per D5.

- [ ] **Step 1: Invoke the frontend design skills, write failing `APIErrorTests`**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)`. Then:

```swift
import XCTest
@testable import Clara

final class APIErrorTests: XCTestCase {
    func body(_ s: String) -> Data { Data(s.utf8) }
    func test401MapsToUnauthorized() { XCTAssertEqual(APIError.from(statusCode: 401, body: nil), .unauthorized) }
    func test402WithPremiumBodyMapsToPremiumRequired() {
        XCTAssertEqual(APIError.from(statusCode: 402, body: body(#"{"error":"Premium required"}"#)), .premiumRequired) }
    func test403WithPremiumBodyMapsToPremiumRequired() {
        XCTAssertEqual(APIError.from(statusCode: 403, body: body(#"{"error":"Premium required"}"#)), .premiumRequired) }
    func test403WithOtherBodyIsNotPaywall() {
        XCTAssertNotEqual(APIError.from(statusCode: 403, body: body(#"{"error":"Forbidden"}"#)), .premiumRequired) }
    func test404ProfileNotFoundMapsToProfileNotFound() {
        XCTAssertEqual(APIError.from(statusCode: 404, body: body(#"{"error":"Profile not found"}"#)), .profileNotFound) }
    func test429MapsToRateLimited() { XCTAssertEqual(APIError.from(statusCode: 429, body: nil), .rateLimited(retryAfter: nil)) }
    func test500MapsToServer() { XCTAssertEqual(APIError.from(statusCode: 500, body: nil), .server(status: 500)) }
    func testNotConnectedMapsToOffline() { XCTAssertEqual(APIError.from(urlError: URLError(.notConnectedToInternet)), .offline) }
    func testTimedOutMapsToOffline() { XCTAssertEqual(APIError.from(urlError: URLError(.timedOut)), .offline) }
}
```
Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `APIError.swift`, `TokenProviding.swift`, `APIRequest.swift`** — case-level `Equatable`; the two pure `from(...)` mappers (decode `{ "error": String }` for 402/403/404 discrimination per Step 0; read `Retry-After`). Run `APIErrorTests` → Expected: PASS (9).

- [ ] **Step 3: Implement the shared test doubles, then write failing `WondishAPIClientTests`**

Write `StubURLProtocol` (app target, `#if DEBUG`) and `StubTokenProvider` (test target). Then the tests, **with real bodies** for the load-bearing behaviors:

```swift
import XCTest
@testable import Clara

final class WondishAPIClientTests: XCTestCase {
    func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: cfg)
    }
    struct Empty: Decodable {}

    func test401RemintsWithForceRefreshAndRetriesOnceThenSucceeds() async throws {
        StubURLProtocol.enqueue(status: 401, body: Data("{}".utf8))                 // 1st
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"ok":true}"#.utf8))      // 2nd (after re-mint)
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1")
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: tokens, session: makeSession())
        _ = try await client.send(APIRequest(path: "/api/me"))
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)                            // exactly one retry
        XCTAssertEqual(tokens.forceRefreshCount, 1)
        XCTAssertEqual(StubURLProtocol.recorded[1].value(forHTTPHeaderField: "Authorization"), "Bearer T1") // fresh, not stale
    }
    func testSecond401AfterRemintThrowsUnauthorizedAndDoesNotThirdRequest() async {
        StubURLProtocol.enqueue(status: 401, body: Data("{}".utf8))
        StubURLProtocol.enqueue(status: 401, body: Data("{}".utf8))
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"), session: makeSession())
        await XCTAssertThrowsErrorAsync(try await client.send(APIRequest(path: "/api/me"))) { XCTAssertEqual($0 as? APIError, .unauthorized) }
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)                            // no third
    }
    func testRedirectResponseIsNeverTreatedAsSuccess() async {
        StubURLProtocol.enqueue(status: 307, headers: ["Location": "https://x.test/login"], body: Data("<html>".utf8))
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"), session: makeSession())
        await XCTAssertThrowsErrorAsync(try await client.send(APIRequest(path: "/api/me"), as: MeDTO.self))
    }
    func testNon401ErrorDoesNotRetry() async {
        StubURLProtocol.enqueue(status: 500, body: Data("{}".utf8))
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"), session: makeSession())
        await XCTAssertThrowsErrorAsync(try await client.send(APIRequest(path: "/api/me")))
        XCTAssertEqual(StubURLProtocol.recorded.count, 1)
    }
    func testNilRemintedTokenThrowsUnauthorizedWithoutBearerNil() async {
        StubURLProtocol.enqueue(status: 401, body: Data("{}".utf8))
        let tokens = StubTokenProvider(fresh: "T0", refreshed: nil)
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: tokens, session: makeSession())
        await XCTAssertThrowsErrorAsync(try await client.send(APIRequest(path: "/api/me"))) { XCTAssertEqual($0 as? APIError, .unauthorized) }
        // second request, if any, must not carry a literal "Bearer nil"
        XCTAssertFalse(StubURLProtocol.recorded.contains { $0.value(forHTTPHeaderField: "Authorization") == "Bearer nil" })
    }
    func testInjectsBearerHeaderFromTokenProvider() async throws {
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"ok":true}"#.utf8))
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"), session: makeSession())
        _ = try await client.send(APIRequest(path: "/api/me"))
        XCTAssertEqual(StubURLProtocol.recorded[0].value(forHTTPHeaderField: "Authorization"), "Bearer T0")
    }
    func testNotConnectedThrowsOffline() async {
        StubURLProtocol.enqueueError(URLError(.notConnectedToInternet))
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"), session: makeSession())
        await XCTAssertThrowsErrorAsync(try await client.send(APIRequest(path: "/api/me"))) { XCTAssertEqual($0 as? APIError, .offline) }
    }
}
```
(Add a small `XCTAssertThrowsErrorAsync` helper in `ClaraTests/Support/`.) Run → Expected: compile FAILURE.

- [ ] **Step 4: Implement `WondishAPIClient.swift` + `RedirectBlockingDelegate.swift`**

`actor` with a pure `buildURLRequest(_:bearer:)` (join `baseURL`+path, method, JSON-encode `body`, set `Authorization`/`Content-Type`/`Accept: application/json`); `perform(_:allowRetry:)` maps `URLError`→`.offline`/`.transport`, switches on `HTTPURLResponse.statusCode`, recurses once with `allowRetry:false` on 401 **only after a non-nil re-mint**. Construct the `URLSession` with `RedirectBlockingDelegate` (a `URLSessionTaskDelegate` returning `nil` from `urlSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)` for API hosts). `send<T>` decodes with an ISO8601 decoder, wrapping decode failures as `.decoding`. Add:

```swift
private struct APIClientKey: EnvironmentKey { static let defaultValue: WondishAPIClient? = nil }
extension EnvironmentValues { var apiClient: WondishAPIClient? { get { self[APIClientKey.self] } set { self[APIClientKey.self] = newValue } } }
```
Run `WondishAPIClientTests` → Expected: PASS.

- [ ] **Step 5: Write `MeDTO.swift` (with `source`) + `MeDTODecodingTests`**

```swift
struct MeDTO: Decodable, Equatable {
    let id, email, firstName, lastName: String
    let photoUrl: String?
    let onboardingComplete, isPremium: Bool
    let subscription: SubscriptionDTO?
    struct SubscriptionDTO: Decodable, Equatable {
        let plan, status: String
        let source: String?                                  // present after Task 6; optional for forward-compat
        let currentPeriodEnd, trialEndsAt, canceledAt: Date?  // decoder.dateDecodingStrategy = .iso8601
    }
}
```
Tests (fixtures): premium-full (incl. `source:"STRIPE"`), free-active, fresh-signup (`subscription == nil`, `isPremium == false`, `onboardingComplete == false`), null `photoUrl`, unknown-extra-keys-ignored, missing-required-key-throws. Run → Expected: PASS.

- [ ] **Step 6: Regenerate, full test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(net): WondishAPIClient (Bearer inject, bounded 401 re-mint, redirect-blocked, typed errors), MeDTO, stub doubles"
```
Expected: `TEST SUCCEEDED`.

---

### Task 4: iOS — `SessionStore` (owns MeDTO), `ClerkTokenProvider` (@MainActor), launch-fixture harness, app-root wiring

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 3.

**Files:**
- Create: `Clara/Core/Session/SessionStore.swift`
- Create: `Clara/Core/Session/ClerkTokenProvider.swift`
- Create: `Clara/App/LaunchFixtures.swift` (**`#if DEBUG`** — parses `-UITestFixture <name>`, builds a `WondishAPIClient` over `StubURLProtocol` with a canned `MeDTO`, seeds `SessionStore.phase`/`me`)
- Modify: `Clara/App/ClaraApp.swift` (own + inject `SessionStore` + `WondishAPIClient`; `.task { await session.bootstrap() }`; consult `LaunchFixtures` under `#if DEBUG`)
- Modify: `project.yml` (add the `ClerkUI` product now so Task 5's `AuthView` resolves without a second regenerate)
- Create: `ClaraTests/SessionStoreTests.swift`

**Interfaces:**
- Produces: `@Observable @MainActor final class SessionStore: TokenProviding` — `enum Phase: Equatable { case loading, signedOut, signedIn }`; `private(set) var phase`; **`private(set) var me: MeDTO?` (the single app-level entitlement/identity holder written by `AccountViewModel` after each `/api/me` fetch, read by `EntitlementStore` in Task 7)**; `var user: Clerk.User? { Clerk.shared.user }`; `func bootstrap() async`; `func signOut() async`; `func setMe(_:)`. Conforms to `TokenProviding` by delegating to `ClerkTokenProvider`. The `(isLoaded, hasUser) → Phase` mapping is a **pure `static func phase(isLoaded:hasUser:) -> Phase`** so it's unit-testable without a Clerk session.
- Produces: `struct ClerkTokenProvider: TokenProviding` — `@MainActor func token(forceRefresh:)` (explicitly `@MainActor` because `Clerk.shared` is main-actor-isolated) → `try await Clerk.shared.session?.getToken(forceRefresh ? GetTokenOptions(skipCache: true) : GetTokenOptions())?.jwt`. Confirm the exact `getToken` overload/`GetTokenOptions` at build time.
- Produces: the app root injecting `session`, `\.apiClient`, `Clerk.shared`; the Account tab (Task 5) branches on `session.phase`.

- [ ] **Step 1: Invoke frontend design skills, write failing `SessionStoreTests`**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)`. Then:

```swift
import XCTest
@testable import Clara

final class SessionStoreTests: XCTestCase {
    func testPhaseIsLoadingWhenClerkNotLoaded() { XCTAssertEqual(SessionStore.phase(isLoaded: false, hasUser: false), .loading) }
    func testPhaseIsSignedOutWhenLoadedAndNoUser() { XCTAssertEqual(SessionStore.phase(isLoaded: true, hasUser: false), .signedOut) }
    func testPhaseIsSignedInWhenLoadedWithUser() { XCTAssertEqual(SessionStore.phase(isLoaded: true, hasUser: true), .signedIn) }
}
```
Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `SessionStore` + `ClerkTokenProvider`**

`bootstrap()`: **`try? await Clerk.shared.load()` as the first line** (session restore), then `phase = Self.phase(isLoaded: Clerk.shared.isLoaded, hasUser: Clerk.shared.user != nil)`. `signOut()`: `try? await Clerk.shared.signOut()` then `phase = .signedOut`, `me = nil`. `setMe(_:)` stores the latest `MeDTO`. `TokenProviding` conformance delegates to a held `ClerkTokenProvider` (main-actor). Confirm `Sendable` holds given `@MainActor` isolation. Run `SessionStoreTests` → Expected: PASS.

- [ ] **Step 3: Add the `ClerkUI` product to `project.yml`**

```yaml
dependencies:
  - package: Clerk
    product: Clerk
  - package: Clerk
    product: ClerkUI        # prebuilt AuthView used by Task 5 SignedOutView; confirm product name in Package.swift
```

- [ ] **Step 4: Wire the app root (share ONE SessionStore instance; no @State-read-in-init footgun)**

```swift
@main struct ClaraApp: App {
    @State private var session: SessionStore
    private let api: WondishAPIClient
    init() {
        Clerk.shared.configure(publishableKey: AppConfig.clerkPublishableKey)
        let store = SessionStore()                       // one instance, used for both state and client
        #if DEBUG
        if let fixture = LaunchFixtures.current {         // -UITestFixture <name>
            _session = State(initialValue: fixture.seed(store))
            api = fixture.makeClient(tokens: store)
        } else {
            _session = State(initialValue: store)
            api = WondishAPIClient(tokens: store)
        }
        #else
        _session = State(initialValue: store)
        api = WondishAPIClient(tokens: store)
        #endif
    }
    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(session)
                .environment(\.apiClient, api)
                .environment(Clerk.shared)
                .task { await session.bootstrap() }
        }
    }
}
```
`LaunchFixtures.current` reads `ProcessInfo` for `-UITestFixture`, returns a struct that seeds `phase`/`me` and builds a `WondishAPIClient` over `StubURLProtocol` with the canned `MeDTO` for `signedOut | signedInFree | signedInPremium | paywall`.

- [ ] **Step 5: Regenerate, build, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(auth): SessionStore (owns MeDTO) + @MainActor ClerkTokenProvider + launch-fixture harness + app-root injection"
```
Expected: `TEST SUCCEEDED`.

---

### Task 5: iOS — Account screen (signed-out value prop + signed-in profile/subscription), replaces `AccountPlaceholderView`

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 3, 4 (and Task 1's `/api/me`). **Frontend task — Step 1 invokes `ui-ux-pro-max` + `mobile-ios-design`.**

**Consumes (stubbed until 2b, so 2a is independently buildable):** `PaywallView` is a local `PaywallStubView` (a token-styled placeholder sheet) until Task 7 replaces it; `storeManager.restore()` is a no-op stub until Task 7; `SubscriptionCard` treats `subscription.source == nil` **and** `"STRIPE"/"COUPON"` as web-managed and `"APPLE"` as App-Store-managed.

**Files:**
- Create: `Clara/Features/Account/AccountView.swift`, `SignedOutView.swift`, `SignedInView.swift`, `AccountViewModel.swift`
- Create: `Clara/Features/Account/Components/ProfileHeader.swift`, `SubscriptionCard.swift`, `AccountRow.swift`, `Avatar.swift`
- Create: `Clara/Features/Paywall/PaywallStubView.swift` (2a placeholder; deleted/replaced in Task 7)
- Modify: `Clara/App/RootTabView.swift` (`.account` body: `AccountPlaceholderView()` → `AccountView()`; **preserve `selection: Tab = .scan` and all four non-account tab bodies unchanged**; keep `systemImage:"person.crop.circle"`, label `"Account"`)
- Delete: `Clara/Features/Account/AccountPlaceholderView.swift` (after `AccountView` lands)
- Create: `ClaraTests/AccountViewModelTests.swift`, `AvatarInitialsTests.swift`, `PlanBadgeMappingTests.swift`

**Interfaces:**
- Consumes: `WColor`/`WFont`/`WSpacing`/`WRadius`, `WButtonStyle`, `WBadge`, `.wCard()`, `BrandWordmark`, `WondishAPIClient`, `MeDTO`, `SessionStore`, `Clerk.shared`, `ClerkUI.AuthView`.
- Produces: `@Observable @MainActor final class AccountViewModel` — `enum State: Equatable { case idle, loading, loaded(MeDTO), failed(APIError) }`; `func load()`/`refresh()`; `var isPremium: Bool`. Fetches `GET /api/me`; **on success calls `session.setMe(me)`** (feeds `EntitlementStore`); a post-retry `401` → "session expired" + `session.signOut()`; `404/429`/`.offline` → `.failed` with Retry.
- Produces: `struct Avatar(url:name:size:)` — `AsyncImage` + initials fallback (first+last initial on `WColor.surfaceSecondary`, `WColor.primary` text), circular, a11y label = full name. Pure `Avatar.initials(from:) -> String`.
- Produces: `struct AccountRow(icon:title:trailing:action:)` — SF-Symbol-leading tappable grouped-list row, ≥44 pt, press highlight, text-inset dividers. Never icon-only.
- Produces: pure `planBadge(isPremium:status:) -> (text:String, variant:WBadge.Variant)` — FREE→`("Free", .warning)`, PREMIUM/ACTIVE/TRIALING/**GRACE**→`("Premium", .primary)`, PAST_DUE/CANCELED→`(…, .error)`; **never `.info`/`.success`**.

- [ ] **Step 1: Invoke the frontend design skills, then confirm the state machine + component map**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing SwiftUI. `AccountView` is a pure router: `session.phase == .loading` → branded `RestoringView` (no logged-out flash on cold launch); `.signedOut` → `SignedOutView`; `.signedIn` + `vm.state`: `.loading` → skeleton with optimistic header from `clerk.user`; `.loaded(me)` → `SignedInView`; `.failed` → header + inline error card + Retry (never a defaulted "Free"). Header identity comes from `clerk.user` immediately; `/api/me` supplies subscription/premium truth. Component map (reuse only): background `WColor.background`; sections `.wCard()`; badge via `planBadge(...)`; primary `WButtonStyle(.primary,.lg)`; secondary `.secondary,.lg`; rows via `AccountRow`; delete `.danger,.md`; header `BrandWordmark(size:32)`.

- [ ] **Step 2: Write failing tests**

`AccountViewModelTests` (inject `WondishAPIClient` over `StubURLProtocol`): `testLoadTransitionsLoadingToLoaded`, `testLoadWritesMeIntoSessionStore`, `testLoadMapsUnauthorizedToFailed`, `testLoadMapsOfflineToFailed`, `testPremiumUserIsPremiumTrue`, `testFreeUserIsPremiumFalse`. `AvatarInitialsTests`: `"Ada Lovelace"→"AL"`, `"Ada"→"A"`, `""→"?"`. `PlanBadgeMappingTests`: FREE→`.warning`, PREMIUM→`.primary`, **GRACE→`.primary`**, CANCELED→`.error`, and an assertion that no mapping returns `.info`/`.success`. Run → Expected: compile FAILURE.

- [ ] **Step 3: Implement `AccountViewModel` + the pure helpers** — VM per interface; `load()` sets `.loading` then `send(APIRequest(path:"/api/me"), as: MeDTO.self)` → `.loaded` + `session.setMe(me)` / `.failed`. Implement `Avatar.initials(from:)` and `planBadge(...)`. Run → Expected: PASS.

- [ ] **Step 4: Build `Avatar`, `AccountRow`, `ProfileHeader`, `SubscriptionCard`**

- `ProfileHeader` = `HStack { Avatar(size:56); VStack { name bold 18; email 14 secondary, middle-truncated } }.wCard()`.
- `SubscriptionCard(state:isPremium:)` — **FREE** → `Text("Plan")` + `WBadge("Free", .warning)`, upsell subtext, `Button("Upgrade to Premium") .primary/.lg` → presents `PaywallStubView` (2a) / real `PaywallView(.account)` (2b). **PREMIUM** → `WBadge("Premium", .primary)`, renewal line from `subscription.currentPeriodEnd` (`trialEndsAt` → "Trial ends …"; `status=="GRACE"` → "Payment issue — update in the App Store, access continues"; `canceledAt` → `WBadge("Canceling", .error)` + "Access until …"), `Button("Manage subscription") .secondary/.lg` — **`source=="APPLE"`** → Apple native manage-subscriptions sheet; **`"STRIPE"/"COUPON"`/`nil`** → "Managed on the web" + `/membership` Safari link, no purchase prompt. **If two active sources are detected in `me` (D19)** → subtle warning row "You have a duplicate subscription — cancel one". **loading** → shimmer; **failed** → error card + Retry.
- `onboardingComplete == false` → subtle `WBadge("Finish setup", .warning)` → web `/profile` via Safari (display only; driving `PATCH /api/patient/profile` is out of scope).

- [ ] **Step 5: Compose `SignedOutView`, `SignedInView`, `AccountView`; swap `RootTabView`**

- `SignedOutView`: `ScrollView { VStack(spacing:.xxl) { BrandWordmark(size:32); person glyph 56 in WColor.primary; headline "Your plan, your progress" (.inter(24,.extrabold)); subhead; 3 value bullets (SF Symbols in WColor.primary); pinned actions: Button("Sign in") .primary/.lg, Button("Create account") .secondary/.lg (both present `ClerkUI.AuthView()` via .sheet — auto-detects sign-in vs sign-up; comment that AuthView is not brand-styleable, accepted for Phase 2); Terms · Privacy ghost links → SFSafariViewController on the public /terms,/privacy } }`.
- `SignedInView`: `NavigationStack { ScrollView(.refreshable{ await vm.refresh() }) { VStack(spacing:.xl) { ProfileHeader; SubscriptionCard; SUPPORT .wCard(padding:0) with AccountRow("Restore purchases") (→ storeManager.restore(), stub in 2a), AccountRow("Terms of Service"), AccountRow("Privacy Policy"); Button("Sign out") .ghost/.md → session.signOut(); Divider; Button("Delete account") .danger/.md → confirmationDialog → send(APIRequest(path:"/api/me", method:.delete)); on 409 apple_subscription_active (D12) show the App Store Manage-Subscriptions deep link + a second explicit confirm; on success sign out; Text("Clara <version> (<build>)") } } .navigationTitle("Account") }`.
- `AccountView` routes over `session.phase × vm.state`; owns `AccountViewModel(api:)` from `@Environment(\.apiClient)`. Replace `.account` body in `RootTabView` with `AccountView()` (leave `selection = .scan` and the other tabs untouched); delete `AccountPlaceholderView.swift`.

- [ ] **Step 6: Regenerate, build, test, screenshot, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Then via `using-xcode-cli`: boot sim, install/launch `io.wondish.clara` with `-UITestFixture signedOut | signedInFree | signedInPremium`, screenshot each to the scratchpad.
```bash
git add -A && git commit -m "feat(account): signed-out value prop + signed-in profile/subscription, replace placeholder"
```
Expected: `TEST SUCCEEDED` + screenshots showing maroon `#812549`/cream `#F9F7ED`, Inter, ≥44 pt targets, correct plan badge.

---

### Task 6: WEB — Apple IAP reconciliation (per-source `Subscription` rows, bound verify, transfer-safe, grace-preserving) + Stripe downgrade guard

**Repo:** `/Users/becks/Desktop/NewView/wondish_02` (branch `clara-ios-phase2-backend`) — depends Task 1. **The honest server cost of monetization — the "no new server surface" claim does not survive StoreKit.**

**Files:**
- Modify: `prisma/schema.prisma` — change the `Account`↔`Subscription` relation from one-to-one to **one-to-many** (`subscriptions Subscription[]`); on `Subscription` add `source SubscriptionSource @default(STRIPE)`, `appleOriginalTransactionId String?`, `appleProductId String?`, `appleExpiresAt DateTime?`, `appAccountToken String?`; drop the sole-`accountId` unique, add `@@unique([accountId, source])` and `@@unique([source, appleOriginalTransactionId])`; `enum SubscriptionSource { STRIPE APPLE COUPON ADMIN }`; migration `add_subscription_source_apple_fields_and_per_source_rows`
- Modify: `lib/auth.ts` (extend `hasActivePremium` active set with `GRACE` — D11)
- Create: `lib/iap.ts` (pure `mapAppleStatus`, `shouldDowngradeOnStripeDelete`; `verifyAppleTransaction` via `app-store-server-library` `SignedDataVerifier`), `lib/iap.test.ts`
- Create: `app/api/iap/verify/route.ts`, `app/api/apple/notifications/route.ts`
- Modify: `middleware.ts` (add `"/api/apple/notifications"` to `isPublicRoute` — the ONLY new public route), `middleware.test.ts`
- Modify: `app/api/stripe/webhook/route.ts` (guard `customer.subscription.deleted` downgrade by source; write only the `(accountId, STRIPE)` row)
- Modify: `app/(…)/membership` page (D16: show "Managed via the App Store" for `source=APPLE`)
- Modify: `package.json` / `package-lock.json` (`npm install app-store-server-library`)
- Create: `certs/apple/AppleRootCA-G3.pem` (+ the other Apple root CAs `SignedDataVerifier` requires) — a **real committed asset**, path documented in `lib/iap.ts`
- Modify: `.env.example` (add `APPLE_IAP_BUNDLE_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_ENVIRONMENT`)

**Interfaces:**
- Produces: `mapAppleStatus(notificationType, subtype) → { plan:"FREE"|"PREMIUM"; status }` — active→`ACTIVE`, trial→`TRIALING`, **grace-period→`GRACE` (keeps premium, D11)**, billing-retry-without-grace→`PAST_DUE`, expired/revoked/refund→`CANCELED`/`FREE`.
- Produces: `shouldDowngradeOnStripeDelete(sub) === (sub.source === "STRIPE")` (false for APPLE/COUPON/**ADMIN**).
- Produces: per-source rows; `accountHasActivePremium` OR's across them. An Apple write **cannot** touch a Stripe/coupon/admin row (D19). Verify/notification enforce `appAccountToken === userId` (D20); the `@@unique([source, appleOriginalTransactionId])` + `subtype:"TRANSFER"` handling avoids the account-switch 500.

- [ ] **Step 0: Install the lib, commit Apple root certs, extend `hasActivePremium` for grace, write the failing predicate test**

`npm install app-store-server-library`. Commit the Apple root CA `.pem`(s) under `certs/apple/`. In `lib/auth.ts` extend the active set to `{ACTIVE, TRIALING, INCOMPLETE, GRACE}` and add a test in `lib/auth.test.ts` asserting `hasActivePremium({plan:"PREMIUM", status:"GRACE"}) === true`. **Document the pre-existing `INCOMPLETE`-grants-premium behavior** (technical #15) in a comment; Phase 2 keeps it server-side but the iOS resolver treats `me.isPremium` as authoritative. Report the five `APPLE_IAP_*` keys to the human (mirror Phase-1's env hand-off). Run `lib/auth.test.ts` → Expected: FAIL then PASS.

- [ ] **Step 1: Schema migration + Prisma client regen**

Change the relation to one-to-many, add the columns/enum/compound uniques. `@default(STRIPE)` keeps existing rows valid; the existing single row becomes the `(accountId, STRIPE)` row. Run `npx prisma migrate dev --name add_subscription_source_apple_fields_and_per_source_rows` (**this also regenerates the Prisma client** — required for `account.subscriptions`). Update every `account.subscription` reference in the codebase to `account.subscriptions` (grep-driven); update `lib/me.ts`'s `SubRow` to include `appleExpiresAt`/`source` and extend `lib/me.test.ts` to assert `source` round-trips.

- [ ] **Step 2: Write failing `lib/iap.test.ts`**

```ts
test("mapAppleStatus maps active/trial/grace/expired to the Subscription enum", () => {
  assert.equal(mapAppleStatus("DID_RENEW", null).status, "ACTIVE");
  assert.equal(mapAppleStatus("SUBSCRIBED", "INITIAL_BUY").status, "ACTIVE");
  assert.equal(mapAppleStatus("DID_FAIL_TO_RENEW", "GRACE_PERIOD").status, "GRACE");     // D11: keeps premium
  assert.equal(mapAppleStatus("DID_FAIL_TO_RENEW", "GRACE_PERIOD").plan, "PREMIUM");
  assert.equal(mapAppleStatus("DID_FAIL_TO_RENEW", null).status, "PAST_DUE");            // retry w/o grace
  assert.equal(mapAppleStatus("EXPIRED", null).plan, "FREE");
  assert.equal(mapAppleStatus("REFUND", null).plan, "FREE");
});
test("stripe delete downgrade only fires for STRIPE — every source pinned (D19)", () => {
  assert.equal(shouldDowngradeOnStripeDelete({ source: "STRIPE" }), true);
  assert.equal(shouldDowngradeOnStripeDelete({ source: "APPLE" }), false);
  assert.equal(shouldDowngradeOnStripeDelete({ source: "COUPON" }), false);
  assert.equal(shouldDowngradeOnStripeDelete({ source: "ADMIN" }), false);
});
```
Run → Expected: FAIL. (The live JWS-signature path uses Apple root certs; keep `iap.test.ts` to the pure helpers + a payload-shape guard — matching how `middleware.test.ts` declines to exercise the live-auth handler. The signature path is covered by sandbox verification in Task 8.)

- [ ] **Step 3: Implement `lib/iap.ts` + the two routes + the Stripe guard + `/membership` copy**

`lib/iap.ts`: the two pure helpers + `verifyAppleTransaction(signedTransaction)` wrapping `SignedDataVerifier` (env: `APPLE_IAP_BUNDLE_ID=io.wondish.clara`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_ENVIRONMENT`, root certs from `certs/apple/`).

`POST /api/iap/verify`: `auth()`→401; `getOrCreateAccount(userId)`; verify JWS; **assert `transaction.appAccountToken === userId` else 403 (D20)**; extract `productId`/`expiresDate`/`originalTransactionId`; **`prisma.subscription.upsert` keyed on `@@unique([accountId, source:"APPLE"])`** (`plan:"PREMIUM"`, `source:"APPLE"`, status from `mapAppleStatus`, apple columns, `appAccountToken`) — **never touches the STRIPE/COUPON/ADMIN row (D19)**; wrap the write to **catch the `[source, appleOriginalTransactionId]` unique violation and handle `TRANSFER`** (re-key ownership to the current account) rather than 500 (technical #3). Return `serializeMe(...)`.

`POST /api/apple/notifications`: verify `signedPayload` JWS, Redis idempotency on the notification UUID (reuse the Stripe-webhook pattern), resolve the row by `[source:"APPLE", appleOriginalTransactionId]`, apply `mapAppleStatus`; on `TRANSFER` re-key.

`stripe/webhook`: guard `customer.subscription.deleted` — `if (shouldDowngradeOnStripeDelete(sub)) { set the (accountId,STRIPE) row FREE/CANCELED } else { null only stripe ids }`; all Stripe writes target only the `(accountId, STRIPE)` row. `/membership`: when the account's active sub is `source=APPLE`, render "Managed via the App Store" instead of Stripe controls (D16). Add the public route to `middleware.ts` + assert in `middleware.test.ts` (`/api/apple/notifications` public, `/api/me` **not**).

Run: `npm test` → Expected: all PASS (incl. `iap` + updated `me`/`auth`/`middleware`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(iap): per-source Subscription rows, bound Apple verify, transfer-safe, grace-preserving + source-guarded Stripe downgrade"
```

---

### Task 7: iOS — StoreKit (`StoreManager`, cached `EntitlementStore`, `UsageMeter`, brand `PaywallView`)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 3, 4, 5, 6. **Frontend task — Step 1 invokes `ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/Store/StoreManager.swift`, `EntitlementStore.swift`, `FreemiumLimits.swift`, `UsageMeter.swift`, `AppleReceiptService.swift`
- Create: `Clara/Store/Products.storekit` (local StoreKit config)
- Create: `Clara/Features/Paywall/PaywallView.swift`
- Delete: `Clara/Features/Paywall/PaywallStubView.swift` (replaced)
- Modify: `project.yml` (define an explicit `schemes:` block wiring the StoreKit config — see Step 1)
- Modify: `Clara/App/ClaraApp.swift` (inject `.environment(storeManager)` and `.environment(entitlement)`; seed both before UI)
- Modify: `Clara/Features/Account/Components/SubscriptionCard.swift` (FREE → present real `PaywallView`; wire "Restore purchases")
- Create: `ClaraTests/PremiumStatusTests.swift`, `UsageMeterTests.swift`

**Interfaces:**
- Produces: `@Observable @MainActor final class StoreManager` — `loadProducts()` (`Product.products(for: ["io.wondish.clara.premium.monthly"])`); `purchase() async throws -> PurchaseOutcome { activated, pending, cancelled, failed(Error) }`; `restore() async` (`AppStore.sync()` + re-drain); **`private(set) var hasStoreKitEntitlement: Bool`** — a **cached** `@Observable` property (never a synchronous read of the async `Transaction.currentEntitlements`), seeded by draining `currentEntitlements` on launch **and after Clerk sign-in**, refreshed by a **detached `Transaction.updates` listener started in `init` before any UI**. On `.verified(txn)` → grant local entitlement immediately, then `AppleReceiptService.postToServer(txn)`; **`txn.finish()` ONLY on a successful server post** (a 401 while signed-out leaves it unfinished for re-delivery — technical #20).
- Produces: `struct PremiumStatus { static func isPremium(server:Bool, localEntitlement:Bool) -> Bool { server || localEntitlement } }`; `@Observable EntitlementStore` exposes `isPremium = PremiumStatus.isPremium(server: session.me?.isPremium ?? false, localEntitlement: storeManager.hasStoreKitEntitlement)` — **`me` comes from the app-level `SessionStore.me` set by `AccountViewModel` (Task 4/5), the named update path.**
- Produces: `enum FreemiumLimits { static let scanPerDay = 3, fridgePerDay = 1, chatPerDay = 5 }` (D4; one tunable file) + `@Observable UsageMeter` (`UserDefaults`-backed, keyed `yyyy-MM-dd`, resets on rollover; pure `UsageMeter.isNewDay(last:now:)`). **Client-only enforcement per D15.**
- Produces: `PaywallView` (tokens only) presented via `.sheet`/`.fullScreenCover`; `PaywallContext { scanLimit, mealPlanner, chatLimit, account }` swaps only headline copy.

- [ ] **Step 1: Invoke frontend design skills; write `Products.storekit` + the scheme wiring; write failing tests**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)`. Commit `Products.storekit` (auto-renewable `io.wondish.clara.premium.monthly`, group `wondish_premium`, $14.99, 7-day intro trial per D3, **Family Sharing OFF** per D18). Add an explicit scheme to `project.yml` (adding `schemes:` **replaces the implicit scheme**):

```yaml
schemes:
  Clara:
    build:
      targets: { Clara: all }
    run:
      config: Debug
      storeKitConfiguration: Clara/Store/Products.storekit   # confirm key against XcodeGen schema
    test:
      targets: [ClaraTests]
```
`PremiumStatusTests`: `server true→premium`, `local true→premium (offline path)`, `both false→not`, `server-only when local missing (Stripe/coupon sub, no StoreKit txn)`. `UsageMeterTests`: `isNewDay` rollover, increment caps at limit, reset clears count. Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `PremiumStatus`, `EntitlementStore`, `FreemiumLimits`, `UsageMeter`** — run their tests → Expected: PASS.

- [ ] **Step 3: Implement `StoreManager` + `AppleReceiptService`**

`StoreManager` per interface (cached entitlement, listener in `init`, finish-only-on-success, re-drain on sign-in). `AppleReceiptService.postToServer(_ txn:)` → `WondishAPIClient.send(APIRequest(path:"/api/iap/verify", method:.post, body:["signedTransaction": txn.jwsRepresentation]), as: MeDTO.self)` (reuses Bearer + 401 re-mint/retry), and on success `session.setMe(me)`. Inject `storeManager`/`entitlement` at the app root, seeded before UI.

- [ ] **Step 4: Build `PaywallView` (full subscription disclosure — D-Guideline 3.1.2)**

Tokens only, on `WColor.background`, top→bottom: `BrandWordmark()` + ghost dismiss (`xmark`); `WBadge("PREMIUM", .primary)` (**never `.info`**); context-driven headline `.inter(28,.extrabold)` + subhead; benefits `.wCard()` (SF Symbols in `WColor.primary`); price from `product.displayPrice` (never hard-code); **mandatory auto-renewal disclosure block adjacent to the CTA**: price, `1 month`, **auto-renews until cancelled**, **how to cancel (Settings > Apple ID > Subscriptions)**, and links to Terms/EULA + Privacy; `Button("Start Premium") .primary/.lg` → `storeManager.purchase()` (inline `ProgressView` while in-flight/`.pending`); footer `Button("Restore Purchases") .ghost/.sm` (**mandatory**). States: loading (skeleton), in-flight (spinner+disabled), `.pending` ("Waiting for approval"), success (dismiss + `AccountViewModel.refresh()`), `.cancelled` (silent), error (`WColor.error` inline). **Suppress the purchase CTA when `session.me?.isPremium == true` (D7)**; if a duplicate-source premium is detected, surface the D19 "cancel the duplicate" note. Wire `SubscriptionCard` FREE → present `PaywallView(.account)`; "Restore purchases" row → `storeManager.restore()`.

- [ ] **Step 5: Regenerate, build, test, screenshot, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Via `using-xcode-cli`: screenshot `PaywallView` over the local `.storekit` (runtime `displayPrice`, disclosure text, Restore visible) and signed-in PREMIUM (Upgrade suppressed).
```bash
git add -A && git commit -m "feat(store): StoreKit 2 StoreManager (cached entitlement, safe finish), usage gating, brand PaywallView with full disclosure"
```
Expected: `TEST SUCCEEDED` + screenshots.

---

### Task 8: VERIFY — build + both suites + live Bearer smoke + funnel screenshots

**Repo:** both — depends all. Uses `using-xcode-cli` for every simulator step. Account/paywall states use the `#if DEBUG -UITestFixture` harness (Task 4) over `StubURLProtocol`.

- [ ] **Step 1: Regenerate + build (iOS) + web typecheck**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
DEV=$(xcrun simctl list devices available | grep -m1 -o 'iPhone [0-9][^(]*' | xargs)
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" build
cd /Users/becks/Desktop/NewView/wondish_02 && npx tsc --noEmit
```
Expected: `BUILD SUCCEEDED` + clean typecheck.

- [ ] **Step 2: Unit tests (both suites)**

```bash
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" test
cd /Users/becks/Desktop/NewView/wondish_02 && npm test    # me, auth, iap, middleware
```
Expected: `TEST SUCCEEDED` / node `pass N  fail 0`.

- [ ] **Step 3: Live Bearer acceptance smoke (proves the middleware validates the iOS JWT — the hard dependency)**

With the dev web server running and a real iOS-minted session token, `curl -H "Authorization: Bearer <jwt>" http://localhost:3000/api/me` and assert **HTTP 200 + a valid `MeDTO` body** (not merely a JSON-401). If 401, stop and report: the mobile client's `azp`/`authorizedParties` is not accepted — a blocking config item, not a code bug.

- [ ] **Step 4: Boot + install + screenshot the four funnel states**

```bash
xcrun simctl boot "$DEV"; xcrun simctl bootstatus "$DEV" -b
xcrun simctl install "$DEV" <path-to-Clara.app>
xcrun simctl launch "$DEV" io.wondish.clara -UITestFixture signedOut
xcrun simctl io "$DEV" screenshot <scratchpad>/account-signedout.png
xcrun simctl launch --terminate-running-process "$DEV" io.wondish.clara -UITestFixture signedInFree
xcrun simctl io "$DEV" screenshot <scratchpad>/account-signedin-free.png
xcrun simctl launch --terminate-running-process "$DEV" io.wondish.clara -UITestFixture signedInPremium
xcrun simctl io "$DEV" screenshot <scratchpad>/account-signedin-premium.png
xcrun simctl launch --terminate-running-process "$DEV" io.wondish.clara -UITestFixture paywall
xcrun simctl io "$DEV" screenshot <scratchpad>/paywall.png
```

**Pass criteria:** `BUILD SUCCEEDED` + both suites green + live `/api/me` 200 + four screenshots showing: signed-out value prop + Sign in/Create account CTAs; signed-in FREE (`Free` `.warning` badge + Upgrade); signed-in PREMIUM (`Premium` `.primary` badge + Upgrade suppressed); `PaywallView` (runtime `displayPrice` + auto-renewal disclosure + Restore). Visually confirm maroon `#812549`, cream `#F9F7ED`, Inter, light-only, ≥44 pt targets. StoreKit purchase itself is exercised against the local `.storekit` — no App Store Connect product or live web backend needed to verify the flow.

- [ ] **Step 5: Commit the VERIFY report**

```bash
cd /Users/becks/Desktop/NewView/Clara && git commit --allow-empty -m "chore(verify): phase 2 build + tests + live Bearer smoke + funnel screenshots green"
```

---

## Out of scope for Phase 2 (deliberately)

- Custom brand-styled Clerk sign-in form — Phase 2 uses the prebuilt `AuthView()` from `ClerkUI`; a fully brand-styled auth form is deferred.
- Driving profile onboarding (`PATCH /api/patient/profile`) from iOS — the Account screen only *displays* `onboardingComplete`.
- Scan/Fridge/Chat/Stats feature clients, `MealLogDTOs`, `OfflineLogQueue`, `AddToLogService`, delta sync — Phases 3–6 (Phase 2 leaves the `actor` drain point + `APIError.offline` + the freemium rule table + `UsageMeter`, but no feature screens).
- **Server-side enforcement of the free daily quotas (D15)** — Phase 2 is client-only, an accepted leak.
- **Periodic `getAllSubscriptionStatuses` reconciliation sweep (D21)** — Phase 2 relies on webhooks + on-launch `/api/me` re-verify.
- **Cross-platform trial suppression (D17)** and **pre-erasure data export / financial-record anonymization (D13)** — surfaced, deferred to legal/product sign-off.
- Annual SKU, promotional/intro-offer plumbing beyond a single trial, Family-Sharing copy — later (group `wondish_premium` created to allow the annual SKU; Family Sharing disabled per D18).
- Standardizing the backend gate on `402` (client maps both `402/403` per D5).
- App icon, launch-screen artwork, camera permission strings, privacy manifest, real Terms/Privacy URLs, SVG→PDF wordmark export — App Store prep phase.

## Verification

- **iOS unit tests (XCTest, `@testable import Clara`, auto-picked under `ClaraTests/`; every unit isolates pure logic behind a `TokenProviding`/`URLProtocol` seam — no live Clerk/StoreKit/backend):** `ClaraKeychainTests`, `AppConfigTests` (T2); `APIErrorTests`, `WondishAPIClientTests` (**real bodies**: Bearer header exact, single-re-mint 401 retry with two-request count, second-401→`.unauthorized` with no third request, retry uses the fresh token, `nil` re-mint→`.unauthorized` without `Bearer nil`, redirect-never-success, no-retry-on-500, offline), `MeDTODecodingTests` (incl. `source`) (T3); `SessionStoreTests` (pure phase reducer) (T4); `AccountViewModelTests` (incl. writes-me-into-SessionStore), `AvatarInitialsTests`, `PlanBadgeMappingTests` (GRACE→`.primary`; never `.info`/`.success`) (T5); `PremiumStatusTests`, `UsageMeterTests` (T7).
- **Web unit tests (`node:test`, `lib/*.test.ts` glob, routes stay thin/untested per convention):** `lib/me.test.ts` (delegation, ISO dates, no secret leakage, `source` passthrough, active-row selection across sources), `lib/auth.test.ts` (`resolveAccountClaim` claim-vs-create, **verified-email-only claim**, `hasActivePremium` GRACE), `lib/iap.test.ts` (`mapAppleStatus` incl. grace→GRACE, `shouldDowngradeOnStripeDelete` pinned for **all four** sources), `middleware.test.ts` (public/protected). Run: `npm test`.
- **Build:** `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara … build` → `BUILD SUCCEEDED`; web `npx tsc --noEmit` clean.
- **Live dependency smoke:** `/api/me` returns **200** for a real iOS-minted Bearer (Task 8 Step 3) — the one dependency no unit test can prove.
- **Simulator screenshots (via `using-xcode-cli`, `#if DEBUG -UITestFixture`):** four states — signed-out value prop + auth CTAs, signed-in FREE, signed-in PREMIUM (Upgrade suppressed), `PaywallView` (runtime price + full auto-renewal disclosure + mandatory Restore). Confirm brand tokens, Inter, light-only, ≥44 pt targets.
- **Build-time confirmations (flagged, not guessed — all confined to `ClerkTokenProvider`/`SessionStore`/`ClaraApp`, so no tested logic depends on them):** the exact Clerk SDK product/module name (`Clerk`/`ClerkUI`), `Clerk.shared.configure` + `Clerk.shared.load()`, the `getToken`/`GetTokenOptions` force-refresh overload, `Clerk.shared.signOut()`, and the XcodeGen `storeKitConfiguration` scheme key — pinned in this plan, re-verified against the SDK's `Package.swift`/quickstart and XcodeGen's schema at implementation time.