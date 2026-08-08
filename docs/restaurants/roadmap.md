# Restaurants — Milestone Roadmap

*Ties the seven phases to outcomes: what ships for the Miracle Mile pilot, what a v1 launch needs, and what's post-launch. Grounded in the coherence review — notably that the **acquisition moment is web-first** (a QR scanner has no app yet), so the pilot critical path runs on web with iOS as retention fast-follow.*

## Milestone 0 — Safety fix (pre-work, ships on its own merits)

**Extract the shared diet-matcher and align allergy semantics across the existing product** (the `lib/diet-match.ts` extraction from Phase 1, landed as a standalone PR). Closes the current divergence where only the meal-plan generator has word-boundary allergy matching (`alternatives`/`swap`/`taste` do exact-only). Valuable for *existing* users independent of restaurants, and gives the restaurant work a verified foundation.
- **Outcome:** one tested matcher; every surface blocks `"peanut"` in `"peanut butter"`. No user-facing restaurant feature yet.

## Milestone 1 — Miracle Mile Pilot (web-first) 🎯

**The concrete early milestone: a handful of hand-onboarded Miracle Mile restaurants, a working scan→sign-up→"see what I can eat" loop.** Eldar's restaurant-owner route makes this the realistic first proof.

**Ships:**
- **Phase 1** — restaurant data model + staff onboarding (Wondish ops enters the pilot menus, each dish with its required structured ingredient list) + the evaluation API.
- **Phase 2 (web)** — the restaurant page with pass/fail highlighting (the acquisition landing surface) + directory + safety disclaimer.
- **Phase 3 (web)** — QR codes on tables → referral-attributed sign-up → welcome discount → land on the menu.

**Explicitly deferred for the pilot:** iOS Restaurants tab (retention, and gated on Clara iOS Phase 2 — proceeds in parallel), "Going Out Tonight," ratings, self-serve portal, paid placement, geo/near-me (the pilot is one walkable district — the `neighborhood` zone suffices).

**Gated on business answers (can ship attribution + placeholder delivery without them):** the sign-up discount % + delivery/redemption rail (overview.md §8 Q1-2).

- **USER outcome:** walk into a pilot restaurant, scan the table QR, sign up with a discount, and immediately see exactly what on the menu fits your diet. **RESTAURANT outcome:** a live diet-aware page + attributed sign-ups they can measure — the reason to place the QR and have staff promote Wondish.
- **Pilot success signals:** QR scans → sign-up conversion, dishes-viewed, repeat visits, restaurant-reported turnover/repeat diners.

## Milestone 2 — Pilot++ / Retention

**Make the pilot sticky and bring the primary (iOS) surface online.**

**Ships:**
- **Phase 4** — "Going Out Tonight" recommendations (web dashboard card + the ranking engine with its zero-weight seams).
- **iOS Restaurants tab** — Phase 2 + Phase 3 in-app (first/default tab, custom 6-item bar), **once Clara iOS Phase 2 (auth/networking) has shipped.** This is the retention surface.

- **USER outcome:** a personalized "where should I eat tonight?" and the daily app home is Restaurants. **RESTAURANT outcome:** organic exposure to matched, high-intent diners.

## Milestone 3 — v1 Launch

**A complete two-sided product: quality signal + restaurant self-service + monetization.**

**Ships:**
- **Phase 5** — cuisine rotation + ratings (activates `ratingBoost`; "top-rated per cuisine").
- **Phase 6** — restaurant self-serve portal (owners manage their own menus — scales past hand-onboarding), paid placement (activates capped, labeled `sponsorBoost`), and the recommended-dish discount + reconciliation.
  - *Status note:* the self-serve half shipped early as **Phase 6a** (portal M1–M4 + review workflow, merged 2026-08). Remaining 6a addendum: **ops direct staff assignment** (phase-6a design §4D) — admin attaches an existing account as OWNER/MANAGER of exactly one restaurant (e.g. a test account as the Dumpling U admin), no invite round-trip; needed for internal workflow testing before pilot invites go out.

**Gated on business answers:** paid-placement pricing/ranking model + dish-discount reconciliation rail (overview.md §8 Q3-4).

- **USER outcome:** curated variety, trustworthy ratings, honestly-labeled sponsored options, dish discounts. **RESTAURANT outcome:** full self-service, a paid growth lever, and the complete value prop — turnover, repeat customers, and a monetizable presence.

## Milestone 4 — Scale / Post-launch

**Geography and conversational discovery — needed once the catalog spans more than one district.**

**Ships:**
- **Phase 7** — geo (`latitude/longitude` populated, `distancePenalty` activated, "restaurants near me") + the Clara restaurant skill ("where should I eat tonight?", grounded in the same matcher). Clara-in-app needs **Clara iOS Phase 5**.
- **Pull earlier if** the catalog expands beyond Miracle Mile before v1 (the `distancePenalty` seam is already in the Phase-4 ranking, so it's additive).

- **USER outcome:** "what can I eat near me right now?" answered visually and via Clara. **RESTAURANT outcome:** discoverability by nearby matched diners.

## Milestone → phase map

| Milestone | Phases | Platform for the critical path | Blocking business Qs |
|---|---|---|---|
| 0 Safety fix | matcher extraction (from P1) | backend | — |
| **1 Pilot** 🎯 | **1, 2 (web), 3 (web)** | **web** | discount %/delivery (Q1-2) |
| 2 Pilot++ | 4 + iOS tab (P2/P3 in-app) | web + iOS (after Clara P2) | — |
| 3 v1 | 5, 6 | web (portal) + both (consumer) | placement/reconciliation (Q3-4) |
| 4 Scale | 7 | both (Clara-in-app needs Clara P5) | geocoding provider |

## Critical dependencies (one glance)

```
Milestone 0: matcher extraction (safety)
        │
Phase 1  (data model + onboarding + eval API)
        │
Phase 2 ─┼─ web page (PILOT: QR landing) ──────── Phase 3 web (QR→signup→discount)   ← Milestone 1 (web)
        │                                                    │
        └─ iOS tab  ── needs Clara iOS Phase 2 ─────────────┘   ← Milestone 2 (retention)
        │
Phase 4  (ranking engine + seams: rating/sponsor/distance = 0)   ← Milestone 2
        │
Phase 5  (ratings → ratingBoost)   Phase 6 (self-serve + sponsorBoost + dish discount)   ← Milestone 3
        │
Phase 7  (geo → distancePenalty; Clara skill needs Clara iOS Phase 5)   ← Milestone 4
```

**Two cross-cutting reminders (from coherence.md):** (a) the allergy-safety disclaimer + menu-freshness (`lastVerifiedAt`, `caution`-not-`fits` on unverified ingredients) are required from Phase 2 onward — non-negotiable given third-party allergy claims; (b) the iOS surfaces are gated on the separate, still-unbuilt Clara iOS roadmap (Phase 2 for the tab, Phase 5 for the Clara skill), which is exactly why the **pilot critical path is defined on web**.

## Open questions blocking nothing structural, but needed before the money flows
Answers to overview.md §8 (discount %, funding, delivery, placement pricing/ranking, reconciliation rail) don't block building the pilot's attribution and surfaces — they determine the *redemption/settlement* mechanism, which slots into the `DiscountDelivery` seam. Answer Q1-2 before the pilot goes live with a real discount; Q3-4 before Milestone 3.
