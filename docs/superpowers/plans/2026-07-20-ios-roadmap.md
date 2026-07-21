# Clara iOS — Build Roadmap (Phases 1–6)

> **Index doc.** Each phase has its own self-contained plan (linked below) written in the
> Superpowers plan format (Goal · Architecture · Global Constraints · Open decisions ·
> dependency-ordered Tasks with Create/Modify/Produces/Steps · Out of scope · Verification).
> This file is the map, the dependency chain, and the rolled-up cross-cutting decisions.
> It is not itself an executable plan — implement from the per-phase docs.

## Overview

**Clara** is a native SwiftUI companion app (iPhone-only, iOS 17) to the Wondish web
meal-planning product, living in its **own repo** at `/Users/becks/Desktop/NewView/Clara`
(separate from the web repo `/Users/becks/Desktop/NewView/wondish_02`). It ships a 5-tab HIG
shell — **Scan · Fridge · Chat · Stats · Account**, with **Scan the default tab** (Picture
Mode is zero taps from launch). The app reuses the existing Wondish backend over Clerk Bearer
auth; every network call goes through one hardened `WondishAPIClient` (Bearer injection,
one-shot 401 re-mint, redirect-is-never-success, typed errors), and premium is metered on
device (`UsageMeter` + `EntitlementStore`) with a StoreKit 2 paywall.

**Build strategy:** each phase is an independently reviewable, independently shippable slice
that replaces one placeholder screen wholesale and layers on the shared foundation from Phases
1–2. Phases 1 and 2 are the foundation (design system, then auth/networking/money); Phases 3–6
are the feature tabs. Two phases (3 Scan, 4 Fridge) require **net-new** Anthropic-backed web
endpoints; two (5 Chat, 6 Stats) ride **already-shipped** backends. All work is TDD-covered:
iOS logic behind `URLProtocol`/protocol seams in `ClaraTests` (XCTest), web logic extracted to
pure `lib/*.ts` under `node --test`.

## The six phases

| Phase | Tab / deliverable | New web backend? | Key dependencies | Plan doc |
|---|---|---|---|---|
| **1** | Project scaffold + ported design system + 5-tab shell (placeholders) + Clara backend bug-fixes (C1–C5) | Bug-fixes only | — | `2026-07-19-ios-phase1-setup-design-system.md` ✅ **done** |
| **2** | Auth + networking (`WondishAPIClient`, Clerk SDK, Keychain, `SessionStore`, `EntitlementStore`, `UsageMeter`), **Account** screen, StoreKit paywall | **Yes** — `GET`/`DELETE /api/me` + Apple↔DB per-source `Subscription` reconciliation | Phase 1 | `2026-07-20-ios-phase2-auth-account-paywall.md` 📝 planned |
| **3** | **Scan** (Picture Mode): capture/pick a dish photo → vision verdict + macro estimate → one-tap log | **Yes** — `POST /api/picture` (Anthropic vision, stateless) | Phase 2 | `2026-07-20-ios-phase3-scan-picture-mode.md` 📝 planned |
| **4** | **Fridge**: ingredient chips (+ optional photo) → generated recipes (allergy-constrained) → log | **Yes** — `POST /api/fridge` (Anthropic generation, stateless) | Phase 2; Phase 3 (reuses image capture if photo input enabled) | `2026-07-20-ios-phase4-fridge.md` 📝 planned |
| **5** | **Chat (Clara)**: streaming AI dish-checker conversation | **No** — reuses shipped `POST /api/dish-checker` | Phase 2 | `2026-07-20-ios-phase5-chat-clara.md` 📝 planned |
| **6** | **Stats**: offline-capable macro dashboard (ring, tiles, charts) + daily meal-log UI + sync engine | **No** — reuses shipped `/api/journey` + `/api/meal-log` (macro-tracking backend) | Phase 2; shipped macro-tracking backend | `2026-07-20-ios-phase6-stats-sync.md` 📝 planned |

## Critical dependency chain

```
Phase 1 (design system + shell)
        │
        ▼
Phase 2 (auth + WondishAPIClient + EntitlementStore + UsageMeter + PaywallView)  ← GATE for everything below
        │
        ├──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
   Phase 3 Scan    Phase 5 Chat   Phase 6 Stats   (Phase 4 needs 3)
        │                                          
        ▼ (image-capture module)                   
   Phase 4 Fridge                                  
```

- **Everything after Phase 2 depends on Phase 2.** Phases 3–6 all call `WondishAPIClient`,
  gate on `EntitlementStore`, meter with `UsageMeter`, and present the Phase-2 `PaywallView`.
  None can start until the auth/networking foundation lands.
- **Phase 4 depends on Phase 3** *only if* the fridge photo-input option is enabled — it
  reuses Phase 3's `ImageEncoder` + capture layer. The typed-chips path is independent, so
  Phase 4 can ship chips-only ahead of Phase 3 if that decision is taken (see decisions below).
- **Phase 6 depends on the shipped macro-tracking backend** (`MealLog` model, `/api/meal-log`
  + delta sync, `/api/journey` macroStats — already merged on `clara-backend-fixes`). No new
  server surface; the work is the iOS dashboard + offline outbox/sync engine.
- **Phases 3, 5, 6 are mutually independent** given Phase 2 — they can be built in parallel or
  in any order after the foundation.

## Cross-cutting open decisions (rolled up — need sign-off)

These span multiple phases; resolving them early avoids rework. Each per-phase plan carries its
own "Open decisions" callout with recommended defaults, summarized here.

1. **Monetization mechanism (Phase 2, D1).** *Recommended:* **StoreKit 2 IAP only** for in-app
   unlock (App Store Guideline 3.1.1); existing Stripe/coupon subscribers are **honored** on
   sign-in but Clara never *sells* Stripe in-app. Drives the per-source `Subscription` model.
2. **Price / trial (Phase 2, D2–D3).** *Recommended:* **$14.99/mo** (Apple can't hit exactly
   $15; read `displayPrice` at runtime) with a **7-day intro trial** → `status = TRIALING`.
3. **Cross-platform entitlement.** A web Stripe subscriber must **not** be forced to
   re-purchase on iOS. Handled by per-source `Subscription` rows OR-unioned server-side and by
   the app trusting DB truth (`/api/me`) as well as StoreKit `currentEntitlements`.
4. **Freemium limits (Phase 2 constants file; enforced per tab).** *Recommended:* Scan **3/day**,
   Fridge **1/day**, Chat **5/day**, Stats **today-only** (history/trends premium). One tunable
   constants file; each feature phase wires `UsageMeter` + `PaywallView` to it.
5. **New AI endpoints + Anthropic cost (Phases 3 & 4).** Picture (`/api/picture`, vision) and
   Fridge (`/api/fridge`, generation) are net-new `claude-sonnet-5` calls. Both are **stateless**
   (opaque `pictureResultId`/`fridgeRecipeId`, no new Prisma model) and add a **server-side hard
   daily rate-limit backstop** as a cost ceiling in addition to the client UX cap. Fridge
   generation is **strictly allergy/avoid-constrained** (safety-critical) via the shared
   `lib/patient-context.ts` / `lib/food-map.ts` food-map extracted from `dish-checker`.
6. **Phase 4 photo input.** *Recommended:* include it, taking the Phase 3 → Phase 4 dependency;
   alternatively ship Fridge chips-only first and add photo after Phase 3.
7. **Phase 6 offline persistence engine.** *Recommended:* a versioned **Codable file-backed
   `OutboxStore`** (not SwiftData/Core Data) for the sync outbox — simplest to unit-test behind a
   protocol seam and to reason about for the coalescing/tombstone reconciliation rules.

## Status snapshot

- **Phase 1:** implemented (Clara repo through commit `25247bf`; 5-tab shell + design system).
- **Phase 2:** planned (doc committed `a0233c1`).
- **Phases 3–6:** planned (this batch).
- **Shared backend prerequisite for Phase 6:** shipped on `clara-backend-fixes` (macro-tracking).
- **User action items carried from earlier work:** set `ANTHROPIC_API_KEY` locally + verify in
  prod (Clara chat can't run without it); apply the `MealLog` Prisma migration once `DATABASE_URL`
  exists. Phase 2 additionally requires App Store Connect product setup + Apple root CA certs for
  server-side StoreKit transaction verification.
