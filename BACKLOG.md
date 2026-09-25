# BACKLOG — everything left to build

**This is the canonical list of outstanding work for wondish_02.** Start here.
Last consolidated: 2026-08-17. Beta-ready checklist (§0) added 2026-09-14 — **start there.**

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

## 0. Beta-ready checklist (2026-09-14)

The shortest path from where the code is to a running beta. Ordered; tick as
you go. Everything else in this file waits.

State on 2026-09-14: `feat/beta-hardening` (the 2026-09-13 concurrency pass,
16 tasks + review wave) is done — 1215/1215 tests, `tsc` clean — stacked on
`feat/beta-premium-coupons` → `feat/workbooks-tier2`, 73 commits ahead of
`main`, **none of the three pushed**. Every migration and data script is
already applied to the shared Neon DB, so landing is code-only. **[verified]**

### A. Land the code
- [ ] `npx next lint` on the whole project — the one gate in the hardening
      plan's final checklist not yet run.
- [ ] Manual check from the plan: `PREMIUM_GATES=on npm run dev`, as a coupon
      user send 3 Clara messages, generate a week, double-click "New week" —
      second click says "already being generated", weekly counter drops by one.
- [ ] Merge / PR the stack (`workbooks-tier2` → `beta-premium-coupons` →
      `beta-hardening`) into `main` and push.

### B. Beta environment (Vercel)
- [ ] **Promote Clerk to a `pk_live` instance** (§4, `docs/productionStage.md`
      §1). Dev instance = "login every time" churn and the sign-in-ticket
      redirect loop. Re-add the `io.wondish.clara` azp allowlist; update
      Vercel env and the Clara iOS configs.
- [x] ~~`PREMIUM_GATES=on` in the beta env (decided yes 2026-09-12).~~
      **REVERSED 2026-09-25 — leave it off, and do not turn it on.** The
      decision is no paywall: signing in gets you the whole app, and free users
      meet a per-feature allowance instead (`lib/ai-budget.ts` — 5 Clara
      messages a day, 1 new week a week, 2 swaps a day…). A spent allowance is
      the ONLY moment the app mentions Plus, and it does so with
      `<QuotaError>`'s "Upgrade for more →". Blocking whole screens is
      explicitly not wanted. Held by `lib/no-paywall.test.ts`: nothing may wrap
      the dashboard's children in a gate, and every metered surface must offer
      the upgrade. `components/PremiumGuard.tsx` stays as parked code with no
      callers.
- [ ] Upstash variables in Vercel — without them the AI spend and in-flight
      locks degrade to per-instance memory and the double-tap guards weaken.
- [ ] Create the cohort coupon codes at `/admin/coupons`
      (runbook `docs/billing/coupons.md`).
- [ ] Stripe, **only if beta users can buy**: `npx tsx
      scripts/stripe-sync-prices.ts` with the live key; webhook pinned to API
      2024-04-10 with the event list in `docs/billing/stripe-setup.md`;
      Customer Portal cancel/switch OFF. A coupon-only beta skips this.
- [ ] Anthropic live-key check at the release gate.

### C. Legal
- [ ] **`/terms`** — onboarding requires consent to a placeholder. Draft is
      in `scripts/seed-terms-2026-09-11.ts`; counsel reviews, then `--apply`.

### D. Verify live
- [ ] Per-release checklist (§6): `prisma migrate deploy` verified against
      prod · env vars present · unauthenticated probes of new routes return
      JSON 401 · one simulator sign-in.
- [ ] **Live prod smoke**: sign-up through `/r/claim` (cannot be exercised
      locally), then Meal Plan / Supplements / Journal grid / Account stats /
      Clara chat streaming on www.wondish.io.

### E. Know before inviting people (not blocking)
- Clinician review of the authored condition rules — 4,477 `REVIEW_REQUIRED`
  workbook-03 rows plus the `WB-*` backfills (§4 "Workbook follow-ups"). Beta
  users on those conditions get rules nobody has signed off on.
- `/restaurants` verdicts: `Verdict.caution` hard-coded false, Stockton
  ingredients AI-inferred (§2). Only matters if the beta promotes restaurants.
- iOS: SubscriptionCard reads "Renews <date>" for COUPON holders, should be
  "Access until" (§1). Clara repo has 7 unpushed commits and a Debug
  xcconfig pointing at prod (§4).

---

## 0b. Open QA defects (cycles 8-15, 2026-09-25)

Fifteen fix→test cycles ran against the live database, the last four verified by
two independent QA bots driving the browser. What those cycles FIXED is in the
commit log and in `docs/qa/beta-test-plan.md`'s cycle table. **This is what they
found and left open.** None of it blocks a beta on its own; §0 does.

Confidence: every line below was measured or observed by a QA bot on
`2e788d2` unless marked otherwise.

### Half-fixed — finish these first
- [ ] **cook-my-day's in-flight lock is never released.** `ai-cookday-inflight`
      is a 90-second rate limit taken at `app/api/pantry/cook-day/route.ts:133`
      and never cleared on completion, so after a SUCCESSFUL run the user is
      told "Clara is already cooking your day — give her a moment" for 90
      seconds. Cycle 15 fixed the ordering (quota is now checked before the
      lock, so a refused user no longer burns it) and not the release.

### Reported as fixed twice and still on screen
- [ ] **Unmeasurable amounts.** `0.37 tablespoons`, `1.03 tablespoons`,
      `1.03 teaspoons`, `0.51 tablespoons`, `4.7 ml`, `0.063 teaspoons` — 17
      rows in one week. `measurableAmount` (lib/dish-plausibility.ts) rounds to
      eighths but only runs inside `clampCookingFat`, so stored rows keep the
      old clamp's output and seasoning rows were never rounded at all. A
      backfill that normalises EVERY amount is the fix; sub-eighth spoon
      amounts should probably become "1 pinch" rather than rounding up, which
      would inflate sodium.

### Correctness
- [ ] **One dish's macros were not computed from its amounts.** "Sliced
      Tomatoes with Olive Oil and Oregano" declares 93 kcal / 3 g protein over
      food worth 72 kcal / 1.4 g. The tell is that its macros are all whole
      numbers (`3 / 9 / 5`) while every other dish carries the tenth-of-a-gram
      signature — and `3×4 + 9×4 + 5×9 = 93`, so it passes the internal
      self-consistency check while being wrong against food. Small harm; the
      value is that it proves the "computed from amounts" path has an escape.
      Finding every all-integer macro row is a one-query job.
- [ ] **A step tells the user to rinse raw chicken** ("Rinse the chicken breast
      and pat dry"), against USDA/FSIS advice — rinsing aerosolises pathogens.
      One instance in 18 meat dishes.
- [ ] **A dish titled "Large Eggs"** — the catalog row name used as a recipe
      name, under-describing six of its seven ingredients. Does not lie, so the
      title gate passes it.

### Copy and UI
- [ ] **Touch targets under 44px**, measured by hit-test (not bounding box):
      "Beta → Plus" 94.8×**30.8**, "Settings" 73.9×**30**, /meal-plan's "Cuisine
      for today" and "View full week" ×**16**, /overview's "+ Add" ×**20.8** and
      "FULL JOURNAL →" ×**16.8**, all 28 /pantry chips ×**32**, /profile's three
      selects ×**42**. The hamburger and the day pagers PASS — their
      `.touch-target::after` expanders work and an earlier 28×26 report was a
      measurement error.
- [ ] **"Once a day" is hardcoded** on the cook-my-day card
      (`PantryClient.tsx:850`). Beta gets 2, Plus gets 3. /pricing's Free column
      also never mentions Free's 1 cook-my-day.
- [ ] **The new-week refusal renders twice** — in the sidebar and again inside
      the unrelated amber "Your profile changed" banner, which then carries a
      quota error about something else. A screen reader announces it twice.
- [ ] **The banner's "New week" button is not blocked** when the basket is
      unready; the sidebar's equivalent is (`aria-disabled` +
      `aria-describedby`).

### Refused by design — listed so nobody re-opens them as bugs
Each was measured and left deliberately; the reason is the entry.
- **199 dishes with no quantity on any ingredient.** The largest single
  refusal. Cannot be repaired without inventing amounts.
- **29 that cook in a fat they never list** and cannot be priced after the oil
  row is added, so the repair that fixed 77 of them cannot reach these.
- **9 steps calling for unlisted salt** — ~118 mg each, and a third is poaching
  water that gets drained, so a fix would overstate sodium as often as correct
  it.
- **2 titles that omit their meat** ("Spaghetti with Tomato and Spinach Sauce"
  containing beef). A gate for it had a 50% false-positive rate over 2 real
  dishes.
- **1,083 rows show no prep/cook time.** The timing GATE reads their steps, so
  nothing slow slips through; filling the displayed field means inventing a
  total from steps that overlap.
- **347 curated rows** whose calories disagree with 4/4/9 of their own macros —
  measured nutrition data, where fibre and rounding make the arithmetic
  approximate. Generated rows are at 0.

### Known consequence, not a defect
- **2-3 days of 7 now read over 2,300 mg of sodium.** That is the true number
  replacing a false green: the rail counted added salt and compared it to the
  TOTAL-sodium guideline, so every day passed. The app had been under-counting
  by ~600 mg a day. The builder's ceiling pushes as low as the catalog allows;
  bread at 490 mg/100 g sets the floor.

### Process
- [ ] **Give each QA bot its own fixture account.** Both share
      `qa.bot1/bot2.0924@wondish.io`, and cycle 15's second bot arrived to find
      every allowance already spent — so it verified every refusal and not one
      success path. The swap's behaviour and Clara's answers went untested for
      that reason alone.
- [ ] **Freeze HEAD for the whole QA window, edits included.** Cycle 14 was
      invalidated by 11 commits landing mid-run. Cycle 15 froze commits but not
      the working tree, and the dev server hot-reloaded uncommitted edits into
      the bot's later measurements. It read the diffs and cleared them, but it
      should not have had to.

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
- [ ] **`feat/workbooks-tier2`** (32 commits from `main`, not pushed) —
      symptom journal, trigger trials, deployable workbook-03 rules, the six
      workbook-only conditions + five backfilled ones, and the pass-4 fixes
      (neutral calories for "Prefer not to say", pantry save race, diet-list
      gaps on every allergy and preference, plant-substitute and gluten-free
      false bans). Suite 1159/1159, tsc clean, seeds
      idempotent, verified end to end (see
      `docs/qa/feature-checklist-2026-09-11.md`, passes 1–5 + custom conditions). Migration
      `20260911120000_symptom_journal_trials` and the data scripts
      (`preference-rules-2026-09-11.ts`, `backfill-conditions-2026-09-11.ts`)
      are already applied to the shared DB. Decision pending: merge / PR / keep.
- [ ] **`feat/beta-premium-coupons`** (stacked on `feat/workbooks-tier2`,
      2026-09-12) — PREMIUM DB coupons restored for the beta: quantity
      (`maxUses`), redeem-by (`expiresAt`), access-until (`accessUntil` →
      COUPON row `stripeCurrentPeriodEnd`), "Extend access", "Premium ends
      soon" banner, paid subscribers refused, coupon holders can still buy,
      one `primarySubscriptionRow` rule for `/api/me` and the billing page.
      Admins have Premium by default via an `ADMIN`-source row written by
      `grantSuper()` (`lib/admin-grant.ts`); backfilled for both admins.
      Migration `20260912090000_coupon_access_until` applied to the shared DB.
      Runbook: `docs/billing/coupons.md`. **Manual before beta (user's call,
      decided yes on 2026-09-12):** set `PREMIUM_GATES=on` in the beta
      environment, create the cohort codes at `/admin/coupons`. iOS follow-up:
      SubscriptionCard says "Renews <date>" for COUPON source; should read
      "Access until".

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
      while onboarding requires consent to it. A plain-language draft now
      lives in `scripts/seed-terms-2026-09-11.ts` (dry-run prints it);
      `--apply` publishes it as the active version on the live site, so it
      waits for counsel's review and your go. **[verified 2026-09-11]**
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
- [x] **Scenario-pass observations (2026-09-11, pass 4) — fixed the same day**
      (taste deck, symptoms "Show fewer", heatmap clip, gluten-free bread on
      Keto, Clara protein-source line). Details in
      `docs/qa/feature-checklist-2026-09-11.md` (pass 5 tables).
- [x] **Extreme inputs (2026-09-11, pass 5).** Shared plausibility bounds in
      `lib/body-bounds.ts` (weight 50–700 lbs, height 90–250 cm, BMI 10–100,
      goal BMI 15–60) enforced by the profile API, the wizard, the settings
      form, the journal weigh-in and the caloric-profile read; names ≤100
      chars, journal notes ≤2000; partial `PATCH /api/patient/profile` no
      longer wipes omitted fields and relation lists.
- [x] **Custom health conditions — shipped 2026-09-11** (spec
      `docs/superpowers/specs/2026-09-11-custom-conditions-design.md`). A user
      adds a condition with ingredients to avoid (hard bans everywhere), a
      note for Clara (food-map guidance) and symptoms to track (journal),
      under Settings → My conditions, and (name, bans, symptoms) inline in
      the onboarding health step. Trigger trials: the user picks up to 8 of
      the 28 workbook categories and they appear on the Trials page as their
      own rules (`CUST-TR-*`, workbook schedule, their symptoms monitored).
      Reuses `HealthCondition` with `ownerPatientId` + `guidance`; migration
      `20260911180000_custom_conditions` applied to the shared DB.
- [x] **Kidney Disease stage 1-2: potassium/phosphorus rows → guidance**
      (2026-09-11, `scripts/kidney-stage12-rules-2026-09-11.ts`, 43 rows
      retired, 12 sodium/processed rows kept; CKD stage 3 unchanged). NKF/KDIGO
      restrict those by lab values, not by stage. **Authored, not
      client-supplied — clinician review still wanted**, same as the other
      backfills in "Workbook follow-ups".
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
