# BACKLOG — everything left to build

**This is the canonical list of outstanding work for wondish_02.** Start here.
Last consolidated: 2026-08-17.

It supersedes, and pulls the live items out of:

| Source | Status |
|---|---|
| `tasks/todo.md` | still the detailed record — history + root-cause notes. Live items are mirrored here. |
| `docs/productionStage.md` | **current as of 2026-09-06** — audited, rewritten; holds the production blockers + phased bug-fix plan (see §7). |
| `cycle.md` | per-release checklist, not features — see §6. |
| `docs/restaurants/roadmap.md` | the restaurant phase plan — see §3. |
| `docs/superpowers/plans/*.md` | executed plans. Unticked checkboxes there do **not** mean incomplete; this repo does not tick them during execution. |

Confidence is marked per item: **[verified]** checked against code this session ·
**[reported]** taken from an existing doc, not re-checked.

---

## 1. In flight — built but not landed

- [ ] **Merge + push `feat/restaurants-phase-3-attribution`** (11 commits) and the
      2 doc commits on `main`. Suite 1001/1001, tsc 19 pre-existing, build green.
      **[verified]**
      ⚠️ Pushing puts the sign-up redirect into production: every new account now
      routes through `/r/claim`. Do one live sign-up test first — that path cannot
      be exercised locally.
      ⚠️ The migration is already applied to the shared Neon DB, so those tables
      exist in prod ahead of the code.
- [ ] **Billing v2 on `feat/billing-v2`** (stacked on
      `feat/clara-generation-pantry-freemode`; plan:
      `docs/superpowers/plans/2026-09-10-billing-v2.md`). $20/mo + $100/6mo,
      in-app promo codes, instant activation, in-app switch/cancel/resume.
      **[verified]** Production needs, in order: `npx tsx scripts/stripe-sync-prices.ts`
      with the LIVE key; webhook endpoint pinned to API 2024-04-10 with the event
      list in `docs/billing/stripe-setup.md`; Customer Portal with cancel/switch
      OFF; then `PREMIUM_GATES=on` to start charging. Two migrations already
      applied to the shared Neon DB (`recipe_ingredient_note`,
      `subscription_cancel_at_period_end`). Manual test-mode pass (Task 14 of the
      plan) still to run — the Stripe CLI is not installed locally.
- [ ] **Wondish workbooks Tier 1 on `feat/workbooks-tier1`** (stacked on
      `feat/billing-v2`; plan: `docs/superpowers/plans/2026-09-10-workbooks-tier1.md`).
      Ingredient form ids + Big-9 groups + 470 unit conversions (phase A),
      author steps / quantities / sodium-sugar nutrition on 599 library recipes
      (phase B), component-based allergen bans, weekly purchase amounts on
      What-to-buy. **[verified]** Migration `20260911043642_workbooks_tier1`
      already applied to the shared Neon DB; import re-runs plan 0 changes
      (`npx tsx scripts/import-workbooks.ts --phase all`). Regression 2026-09-11
      (1,107 public recipes, additive only — nothing previously banned is
      released): Wheat now bans +168 dishes (workbook flags rolled oats and
      sliced bread as BIG9-WHEAT), Soy +60 (soybean oil in crushed tomatoes,
      mayonnaise), Eggs +7, Sesame +7. The workbook is deliberately
      conservative ("may contain", oil-derived soy) — product should confirm
      that is the intended strictness before launch.
      Known gap: Clara-generated dishes carry no quantities, so basket-mode
      plans (every new account) show no amounts yet — see Tier 2 below.

---

## 2. Safety gates — clear before promoting `/restaurants` publicly

The consumer restaurant pages are **already live in production**. These two decide
whether the verdicts on them can be trusted.

- [ ] **`Verdict.caution` is hard-coded `false`** (`lib/restaurants.ts`), so the
      rule "any absent/unverified ingredient ⇒ caution, never fits" is not
      enforced — a dish passes on the ingredient list as given. Phase-1 verdict
      logic; the UI already renders a third state. **[verified]**
- [ ] **Stockton pilot ingredients are AI-inferred**, pending ops confirmation
      (D-INGREDIENTS). The design resolved that no AI may sit in the verdict path;
      published lists must be human-confirmed. Ops work, not engineering.
      **[reported]**

---

## 3. Restaurant roadmap — the unbuilt phases

Shipped: Phase 1 (model + eval API), Phase 2 web (directory + menu), Phase 3
attribution slice (§1/§2/§5), Phase 6a (the whole owner portal).

- [ ] **Phase 3 §3 — the discount rail.** `SignupDiscount` + `DiscountDelivery`.
      Blocked on the business questions in §5 below. Lands as one more column plus
      a model; attribution already exists. **[verified]**
- [ ] **Phase 4 — ranking + "Going Out Tonight".** `lib/restaurant-ranking.ts` and
      a dashboard card. Unblocked by other work. **PAUSED 2026-08-20 during design.**
      Findings from that session, worth keeping: only **5 published restaurants**
      exist, so the ranking orders a very small set; the doc's cuisine-variety term
      has almost no data behind it (**2** `MealLog` rows carry a `restaurantDishId`,
      because nothing writes them yet — web has no "Add to today" and the iOS tab is
      unbuilt); and the `/restaurants` directory already shows "N of M dishes fit
      you" per restaurant, so the card's marginal value is smaller than the doc
      implies. Open decisions when resuming: which ranking signals for v1 (diet-fit
      alone vs also macro-fit); where the surface lives (dashboard grid card per the
      doc, vs leading the directory); and what a user with no diet profile sees.
      **[verified: all four counts]**
- [ ] **Phase 5 — cuisine rotation + ratings.** Activates `ratingBoost`.
      **[reported]**
- [ ] **Phase 6 — monetisation half.** Paid placement (`sponsorBoost`, capped and
      labelled) + recommended-dish discount + reconciliation. Blocked on §5.
      **[reported]**
- [ ] **Phase 7 — geo + Clara restaurant skill.** `latitude`/`longitude` exist but
      are nullable and unused; needs a geocoding provider. Clara-in-app needs
      Clara iOS Phase 5. **[verified: columns unused]**
- [ ] **Phase 2 iOS — Restaurants tab.** In the Clara repo
      (`~/Desktop/BeTech/Clara`), gated on Clara iOS Phase 2. The plan calls iOS
      the primary surface. **[reported]**

### Smaller restaurant gaps

- [ ] **`scans` has a rate limit, not a dedup** — link previews, crawlers and
      double-taps from distinct IPs still pad the conversion denominator.
      **[verified]**
- [ ] **`/r/claim` sets no `maxDuration`** around its Clerk call, on the sign-up
      hot path. **[verified]**
- [ ] **"Add to today" from a restaurant dish on web** — optional;
      `MealLogSource.RESTAURANT` already exists. **[verified]**

---

## 4. Product + engineering backlog

- [x] **QA findings of 2026-09-11 — fixed on `feat/workbooks-tier1`** (commit
      `8627d23` and follow-ups). Plain-salt hard bans removed from Hypertension,
      Heart Disease and Kidney Disease (sodium advice now reaches Clara via
      `CONDITION_GUIDANCE`); "Foods to avoid" expand to ingredient children
      (new `FoodToAvoidBannedIngredient`, 84 seeded, admin-editable); first-day
      greeting; taste tinder keeps its position; Clara dishes carry per-serving
      amounts; staples never reach What-to-buy. Full per-feature status:
      `docs/qa/feature-checklist-2026-09-11.md`. Data script (idempotent):
      `scripts/diet-rules-2026-09-11.ts`.
- [ ] **`/terms` is a placeholder** ("Terms of service will be published…")
      while onboarding requires consent to it. Content, not code.
      **[verified 2026-09-11]**
- [ ] **Clerk dev instance: first navigation after a sign-in ticket can loop**
      (`/taste → /login → /overview 307 → /taste`, React "Maximum update depth"
      in HandleRedirect, blank page). Reproducible only in the headless harness
      on the dev instance; going through `/overview` first avoids it. Real fix
      is the production Clerk instance. **[verified 2026-09-11]**
- [ ] **Wondish workbooks Tier 2 — health rules + conversion coverage.**
      (Clara quantities, formerly (a), shipped 2026-09-11; Celiac's deployable
      rows are covered by the BIG9-WHEAT component group since the condition
      audit — see `docs/qa/condition-audit-2026-09-11.md`.) (b) Map the
      remaining workbook-03 profile-factor ids onto our `HealthCondition` rows
      (the workbook carries ids only) and import the 231 DEPLOYABLE rules;
      the other 4,477 are `REVIEW_REQUIRED` and need a clinician pass. The 26
      conditions without ingredient rules reach Clara through the prompt only.
      Kidney Disease stage 1-2 keeps 394 of 1,200 library dishes (31 dinners):
      its potassium/phosphorus rules need per-ingredient nutrient data to be
      anything but blanket bans. (c) Per-ingredient conversion coverage: 470 (form,
      unit) pairs cover ~88% of a library week; the misses are
      teaspoon/tablespoon/cup on condiments and sweeteners. **[verified]**
- [ ] **Wondish workbooks Tier 3 — Trial Process (04) and Symptom Journal
      (05).** New data model (trial phases, reintroduction schedule, symptom
      entries) and UI; nothing in the app consumes them yet. **[reported]**
- [ ] **Clara repo drift — uncommitted, and one item is a real config change.**
      `~/Desktop/BeTech/Clara` has 7 unpushed commits plus 2 uncommitted files
      (noticed 2026-08-26). **[verified]**
      1. `Config/Debug.xcconfig` points the **Debug** build at production:
         `WONDISH_BASE_URL` localhost:3000 → `https://www.wondish.io`, and
         `CLERK_PUBLISHABLE_KEY` placeholder → the real `real-mollusk-38` test
         instance. Not made in this session — it was already in the tree. Anyone
         building Debug from this checkout now hits prod, not localhost. Decide
         whether that is intended before committing it.
      2. `Clara.xcodeproj/project.pbxproj` gained `DEVELOPMENT_TEAM = KG8MY6KKAW`
         from the 2026-08-15 signing setup (~200 other changed lines are Xcode
         re-sorting, not content). The project is generated by XcodeGen from
         `project.yml`, so regenerating wipes it and signing breaks again —
         moving it into `project.yml` makes it stick, at the cost of committing
         the team ID.
      Neither repo is broken; this is drift that will confuse the next build.


- [ ] **Journal shows "No history yet" despite logged meals.** `/api/journal/calendar`
      reads only `JournalMeal`; Meal Plan "Add to log", Restaurants "Add to today"
      and Fridge "Log it" all write `MealLog`, which the journal never reads. Fix:
      merge `MealLog` rows into the `allMeals=1` mode. Own mini-cycle. **[reported]**
- [ ] **Scan tab: real implementation** (currently a "coming soon" stub inside
      Cook). **[reported]**
- [ ] **Promote Clerk from the dev instance** (`real-mollusk-38`, `pk_test`) to a
      `pk_live` production instance — dev-instance session churn caused the
      "login every time" episode. **[reported]**
- [ ] **App Store prep** — `Assets.xcassets` / `AppIcon`. **[reported]**
- [ ] **Confirm `scripts/backfill-meal-plan-weight.ts`** still needs its one-time
      prod run. **[reported]**
- [ ] **Live prod smoke** — one interactive sign-in, then sweep Meal Plan /
      Supplements / Journal grid / Account stats / chat streaming against
      www.wondish.io. **[reported]**

### Accepted, on the record (not scheduled)

- [ ] Journal "today" frozen at VM init — midnight staleness. **[reported]**
- [ ] Session-expiry-while-foregrounded never flips the root gate. **[reported]**
- [ ] USD-only price copy convention. **[reported]**
- [ ] 3 cosmetic `TODO`s in marketing components (two unset "Learn more"
      destinations, one unconnected food-availability form). **[verified]**

---

## 5. Blocked on business decisions — not on code

- [ ] **Q1. Sign-up discount** — %, and what it applies to (the restaurant bill or
      the Wondish subscription). Different rails.
- [ ] **Q2. Who funds it, and how it is redeemed** at the table.
- [ ] **Q3. Paid placement pricing** and how the boost combines with organic rank.
- [ ] **Q4. Is Wondish ever in the money flow?** Determines whether reconciliation
      is in scope at all.
- [ ] **Paywall D1–D4** — StoreKit-only? $14.99? 7-day trial? quotas — plus App
      Store Connect setup (D9) and Apple root CA certs.
- [ ] **D13** — account hard-delete cascading Subscription rows; legal/product
      sign-off pending.

---

## 6. Per-release checklist (recurring, from `cycle.md`)

Not features — run these each release:
`prisma migrate deploy` verified against prod · required env vars present in
Vercel · Clerk `azp` allowlist includes `io.wondish.clara` · unauthenticated
probes of new routes return JSON 401 · one interactive simulator sign-in.

---

## 7. Needs an audit before it can be trusted

- [x] **Audit `docs/productionStage.md` against current code.** Done 2026-09-05:
      of its 16 items, 10 were already fixed, 3 still real, 3 unverifiable ops.
      The file was rewritten 2026-09-06 as the production path: verified blockers +
      the phased bug-fix plan. The complete verified bug list (3 high / 16 medium /
      26 low, file:line evidence) is `docs/bug-audit-2026-09-05.md`.
      **`docs/productionStage.md` is now current and trustworthy — start there for
      production work.** **[verified]**
