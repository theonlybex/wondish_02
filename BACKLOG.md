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

- [x] `feat/restaurants-phase-3-attribution`, `feat/clara-generation-pantry-freemode`,
      `feat/billing-v2` and `feat/workbooks-tier1` — all fast-forwarded into
      `main` on 2026-09-11 (`b7740e6`) and pushed. Production still needs, in
      order: `npx tsx scripts/stripe-sync-prices.ts` with the LIVE key; the
      webhook endpoint pinned to API 2024-04-10 with the event list in
      `docs/billing/stripe-setup.md`; Customer Portal with cancel/switch OFF;
      Upstash variables in Vercel; then `PREMIUM_GATES=on` to start charging.
      Every migration is already applied to the shared Neon DB.
- [ ] **`feat/workbooks-tier2`** (24 commits from `main`, not pushed) —
      symptom journal, trigger trials, deployable workbook-03 rules, the six
      workbook-only conditions + five backfilled ones, and the pass-4 fixes
      (neutral calories for "Prefer not to say", pantry save race, diet-list
      gaps, plant-substitute false bans). Suite 1144/1144, tsc clean, seeds
      idempotent, verified end to end (see
      `docs/qa/feature-checklist-2026-09-11.md`, passes 1–4). Migration
      `20260911120000_symptom_journal_trials` and the data scripts
      (`preference-rules-2026-09-11.ts`, `backfill-conditions-2026-09-11.ts`)
      are already applied to the shared DB. Decision pending: merge / PR / keep.

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
- [x] **Wondish workbooks Tier 2 + 3 — shipped 2026-09-11 on
      `feat/workbooks-tier2`** (spec `docs/superpowers/specs/2026-09-11-workbooks-tier2-3-design.md`,
      plan `docs/superpowers/plans/2026-09-11-workbooks-tier2-3.md`). Symptom
      journal (05: 273 items on 30 mapped conditions), trigger trials (04: 45
      rules, 34-day schedule, plan-enforced), deployable 03 rules (31 rows).
      Seeds: `import-workbooks.ts --phase c`, `import-condition-rules.ts`.
- [ ] **Workbook follow-ups still open.** (a) 4,477 `REVIEW_REQUIRED`
      workbook-03 rules and the nine held-back Fatty Liver rows need a
      clinician/client sign-off; nutrient budgets (sodium 1,500 mg/day etc.)
      need per-recipe sodium/potassium data (we hold sodium on 50 recipes).
      (b) The six workbook-only conditions (IBS-M, Hypertriglyceridemia,
      Pregnancy, Leaky Gut, Autoimmune, AERD) were added 2026-09-11 with their
      symptoms, IBS-M's 10 trials and 11 deployable rules. The five of ours
      with no workbook factor (kidney ×2, thyroid, PCOS, recovering) were
      backfilled the same day from NKF/NIDDK/NHS/PMC sources
      (`scripts/backfill-conditions-2026-09-11.ts`, rows coded `WB-*`,
      input sources `*_BACKFILL`): 76 symptom/lab items, CKD stage 3 inherits
      the stage 1-2 bans, PCOS gets a low-glycemic ban list and a
      HIGH_GLYCEMIC_PATTERN trial. **Authored, not client-supplied — needs the
      same clinician review as the REVIEW_REQUIRED workbook rows.** (c) Objective/lab
      tracking items (49) are imported but have no UI. (d) Clara chat does not
      read symptom history. (e) Conversion coverage for condiments/sweeteners
      (teaspoon/tablespoon/cup). Kidney Disease stage 1-2 still keeps ~394 of
      1,200 library dishes.
- [ ] **Scenario-pass observations (2026-09-11, pass 4) — open, small.**
      (a) The taste deck filters by allergies/avoid rules only, so a
      Pescatarian still swipes sirloin/ribeye cards (dishes are filtered
      correctly) — apply preference children to the deck. (b) Vegan + Kidney
      1-2 keeps 5 protein ingredients in the library (tofu-dominated): decide
      whether kidney's legume/nut bans should soften for vegans or the library
      needs low-potassium plant proteins. (c) Symptoms step: add "Show fewer"
      and consider remembering the items a user actually logs — a
      five-condition account gets 53 items. (d) Overview activity heatmap
      clips its last column at 390 px.
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


- [x] **Journal shows "No history yet" despite logged meals.** Fixed 2026-09-11:
      `/api/journal/calendar` merges `MealLog` rows (unrated, `source: "log"`)
      into every day; the web day view shows them with a ✓. iOS `allMeals=1`
      gets the same rows.
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
