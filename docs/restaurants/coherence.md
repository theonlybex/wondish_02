# Coherence Check — Restaurants Plan (whole-plan review)

*Reviewing Phases 1-7 as one system: do they connect, are there ordering problems or hidden dependencies, are both sides served at each stage? Findings below, each with the fix applied to the plan.*

## Verdict

The spine holds: **Phase 1 (matcher + data + onboarding) → Phase 2 (menu page) → Phase 3 (QR/signup) → Phase 4 (recommendations) → Phase 5 (rotation/ratings) → Phase 6 (self-serve/placement) → Phase 7 (geo/Clara).** Each phase's dependencies point strictly backward, and the ranking "seams" (`ratingBoost`, `sponsorBoost`, `distancePenalty`) defined zero-weight in Phase 4 and activated in 5/6/7 make the later phases additive rather than surgical. Seven issues needed fixing; all are addressed below.

## Findings & fixes

### 1. (Ordering / platform) The acquisition moment is web-first, which cuts against "mobile-first." — FIXED
The QR code sits on a restaurant table and is scanned by a **brand-new user who does not have the app yet.** So the *acquisition* path — scan → sign-up → "see what I can eat here" — happens on **web**, even though the product is mobile-first for daily use. If Phase 2/3 were read as "iOS first, web is an optional mirror," the pilot's actual first-touch surface would be under-built.
- **Fix:** the plan treats **web and iOS as two moments, not two mirrors** — *web = acquisition* (QR landing, sign-up, menu preview, app-install prompt), *iOS = retention* (the daily Restaurants tab). For the **pilot, the web consumer flow (scan → sign-up → menu) is pilot-critical**; the iOS Restaurants tab is a fast-follow retention surface (and is gated on Clara iOS Phase 2 anyway — see #2). Phase 2 and Phase 3 already contain the web path; this review elevates it from "mirror" to "acquisition surface," and the roadmap's pilot bar is defined on the **web** flow with iOS following. *(One clarifying line added to phase-2.md.)*

### 2. (Cross-roadmap dependency) The entire iOS side is gated on Clara iOS Phase 2, which is itself only planned. — FLAGGED + SEQUENCED
The iOS Restaurants surfaces (Phases 2, 3 in-app, 7) reuse `WondishAPIClient`/`SessionStore`/`EntitlementStore` — all delivered by **Clara iOS Phase 2 (auth/networking)**, which is *planned but not built*. The Restaurants iOS work cannot start until that lands.
- **Fix:** the restaurant iOS work is explicitly sequenced *after Clara iOS Phase 2* in the roadmap, and the **web-first framing (#1) removes iOS from the pilot critical path** — the pilot can launch on web while Clara Phase 2 (and then the iOS Restaurants tab) proceeds in parallel. No restaurant phase is blocked on unbuilt iOS infra for its *pilot-critical* portion.

### 3. (Touches existing product) Phase 1's matcher extraction changes behavior for meal-plan/taste, not just restaurants. — FLAGGED, with a safer sequencing option
Refactoring the five call sites onto the shared word-boundary matcher **gives alternatives/swap/taste allergy semantics they don't have today** (they currently do exact-only matching). That is a *fix* (a latent allergy-safety gap), but it changes results in the existing meal-plan product for current users.
- **Fix:** this is called out as the one place the feature modifies existing behavior. Recommendation: **land the matcher extraction + safety-alignment as its own small, well-tested change (a pre-Phase-1 "safety fix" PR)** — valuable on its own merits (closes the divergence for existing users), reviewed independently of the restaurant model, so the restaurant work builds on already-verified shared logic. Phase 1's data-model + onboarding then sit cleanly on top.

### 4. (Cross-cutting safety — MISSING owner) Nothing owned the allergy-safety disclaimer or menu staleness. — FIXED
The feature makes **allergy-relevant claims about third-party food.** Even with required structured ingredient lists (per D-INGREDIENTS), restaurants can be wrong (cross-contamination, hidden/changed ingredients, prep). No single phase owned this, and it's the highest-liability part of the product.
- **Fix (added as cross-cutting requirements):**
  - A **persistent safety disclaimer** on every verdict surface (Phase 2 onward): the Wondish verdict is a decision aid, *not a guarantee* — "always confirm with restaurant staff, especially for severe allergies." (Line added to phase-2.md.)
  - **Menu freshness:** `RestaurantDish` carries a `lastVerifiedAt`; stale menus are visibly flagged and de-emphasized in ranking. Self-serve (Phase 6) lets owners keep menus current; until then, staff-onboarded menus (Phase 1) get a periodic re-verify. This is an **operational requirement**, not just a schema field.
  - **Severe-allergy caution:** a dish is only ever marked `fits` on the *positive* evidence of its ingredient list; absent/unverified ingredients yield `caution`, never `fits`.

### 5. (Data density) Ratings & cuisine-rotation (Phase 5) depend on restaurant meals being logged/attributed — which many diners won't do. — FLAGGED
Phase 5 rotation/ratings draw on logged `RESTAURANT` meals; passive diners won't log every outing, so the signal can be sparse.
- **Fix:** attribution is fed by **multiple signals, not just manual logging** — the QR scan (Phase 3) and an explicit lightweight "I ate here" tap on the restaurant page both count as a visit for rotation, and the **post-visit rating prompt is triggered by any of them.** Ratings are gated on *some* visit signal (anti-brigading, Phase 5 open question) but not on a full meal log. Documented in phase-5.md's open questions.

### 6. (Deliberate deferral) "Going Out Tonight" (Phase 4) ships without distance; the brief implies "near me." — FLAGGED as intentional
Phase 4 ranks by diet-fit within the pilot `neighborhood` zone; true distance/near-me is Phase 7. For a walkable single-district pilot this is correct and keeps 1-4 lean.
- **Fix:** stated explicitly — Phase 4 is fit-ranked, zone-scoped; **pull Phase 7 (geo) earlier if the catalog spans multiple areas before v1.** The `distancePenalty` seam is already in Phase 4's ranking function (zero-weight), so activating geo is additive, not a rewrite.

### 7. (Business-model gating) The discount and placement mechanisms can't fully ship until business questions are answered. — BOUNDED
Phase 3's discount *delivery* and Phase 6's placement pricing + dish-discount reconciliation depend on unanswered business decisions.
- **Fix:** the plan **separates what's decision-independent from what's gated.** Attribution (who came from which restaurant), the `SignupDiscount`/`DiscountDelivery` records, and the ranking seams are all buildable now. Only the *redemption/settlement rail* and the *placement pricing model* wait on answers. Phase 3 can ship the full loop with a placeholder delivery (e.g. a code shown to staff) and swap in the chosen rail without reshaping. The open questions are surfaced in overview.md §8 and at point-of-use in phase-3.md / phase-6.md.

## Both-sides audit (users + restaurants at each stage)

| Phase | USER value | RESTAURANT value | Balanced? |
|---|---|---|---|
| 1 | none (foundation) | menu onboardable + scoreable | Restaurant-only — **acceptable as plumbing**; first user value is Phase 2 (roadmap bundles 1+2+3 as the pilot, never ships 1 alone as a user milestone) |
| 2 | see what fits at a restaurant | live diet-aware page | ✅ |
| 3 | scan → sign-up + discount → menu | attributed sign-ups; QR reason-to-place | ✅ |
| 4 | "where to eat tonight" | exposure to matched diners | ✅ |
| 5 | variety + quality signal | organic top-rated placement | ✅ |
| 6 | more/better restaurants; labeled sponsorship; dish discount | self-serve + paid growth + discount lever | ✅ |
| 7 | near-me + Clara help | nearby discoverability | ✅ |

**Conclusion:** every phase from 2 on serves both sides; Phase 1 is deliberately restaurant/plumbing-only and is never presented as a standalone user milestone. With fixes #1-7 applied, the plan holds together end-to-end.

## Net changes applied to the phase docs from this review
- **phase-2.md:** web restaurant page reframed as the QR *acquisition* landing surface (not just a mirror); persistent safety disclaimer added to verdict surfaces.
- **Cross-cutting requirements** (safety disclaimer, `lastVerifiedAt`/menu-freshness, `caution`-not-`fits` on unverified ingredients) recorded here and referenced from Phases 2/5/6.
- **Sequencing:** matcher extraction recommended as a standalone pre-Phase-1 safety fix; iOS work sequenced after Clara iOS Phase 2; pilot critical path defined on the web flow.
