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
- [x] `npx next lint` on the whole project — the one gate in the hardening
      plan's final checklist not yet run.
      **2026-09-26:** clean, and run on every commit since.
- [x] Manual check from the plan: `PREMIUM_GATES=on npm run dev`, as a coupon
      user send 3 Clara messages, generate a week, double-click "New week" —
      second click says "already being generated", weekly counter drops by one.
      **2026-09-26:** obsolete (gates are off by decision); the double-click and the counters were verified on the production build instead.
- [x] Merge / PR the stack (`workbooks-tier2` → `beta-premium-coupons` →
      `beta-hardening`) into `main` and push.
      **2026-09-26:** the three branches are merged and gone. `main` is **47 commits ahead of origin — push is yours**.

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
- [x] Upstash variables in Vercel — without them the AI spend and in-flight
      locks degrade to per-instance memory and the double-tap guards weaken.
      **2026-09-26:** present as the Vercel integration's KV_REST_API_URL/TOKEN pair, which the code accepts. Recommended: also set `RATE_LIMIT_ENFORCE_BACKEND=1` in Production (kill switch verified on a real build).
- [ ] **Rename `NEXT_PUBLIC_SENTRY_DNS` → `NEXT_PUBLIC_SENTRY_DSN`** in Vercel
      (Production + Preview). The typo disabled production error reporting
      for 109 days; the code now accepts both spellings, so the next deploy
      reports either way — the rename is tidiness.
- [ ] **Stripe keys are not in Vercel** (`STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET` missing; only the publishable key). Needed only
      if beta users can buy. The whole money path was verified against the
      sandbox on a production build (checkout → Plus → cancel → free). Also
      in the Stripe dashboard: the public business name reads "Painless Food
      Corporation sandbox" on checkout.
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

## 0b. Open QA defects (cycles 8-20, 2026-09-25)

Twenty fix→test cycles against the live database. The cycle procedure is
`docs/qa/beta-test-plan.md` → "How a cycle runs"; this section is the list it
edits at the START of each one.

**This is the whole outstanding list.** It holds what was found and left open,
what was found and REFUSED on purpose (with the measurement that settled each,
so nobody re-opens them as bugs), what was seen once and could not be
reproduced, and what was never tested at all. The beta-blocking work is §0
above; nothing here blocks a beta on its own.

Confidence: every line was measured or observed, every `[x]` was re-measured
after the fix rather than assumed, and anything a bot could not pin down says
so in its own entry.

### Closed in cycle 16
- [x] **cook-my-day's in-flight lock is never released.** It was a rate limit,
      and a rate limit has no release: a day that cooked in eight seconds left
      the user refused for the other eighty-two. Now `SET NX EX` + `DEL`
      (`lib/in-flight-lock.ts`), released in a `finally` so the route's three
      early returns free it too. Verified on both backends and by reintroducing
      the bug against the test.
- [x] **Unmeasurable amounts** (open since cycle 13). 1,919 stored rows
      repaired; the audit reports 0 of 16,424. The rule was wrong as well as
      unapplied — it snapped to eighths, so a third of a cup was being
      "repaired" to a quarter. 1,340 pinch-sized seasoning rows became the
      `pinch` unit rather than rounding up to an eighth-teaspoon, which would
      have doubled the salt on every one of them.
- [x] **Decimals on the card.** A consequence of the above, fixed with it:
      snapping writes thirds, and a third has no exact float. `formatAmount`
      renders ⅓, ¾, 1½. Not a kitchen fraction → prints as a number.
- [x] **One dish's macros were not computed from its amounts.** The escape was
      an 80 kcal sanity floor in both repair scripts; "Sliced Tomatoes with
      Olive Oil and Oregano" prices at 75. `pricingMayOverwrite` now drops the
      floor to 40 at full coverage. Exactly two rows were affected.
- [x] **A step tells the user to rinse raw chicken.** 22 dishes, rewritten to
      keep the pat-dry. Also wired into generation, so new dishes cannot
      reintroduce it.
- [x] **A dish titled "Large Eggs".** 31 renamed from what their steps do —
      Scrambled, Poached, Fried, Baked, Omelette.
- [x] **Touch targets under 44px.** Measured 17 across five pages (nine more
      than QA listed), all fixed but the journal's step dots. Input and Select
      were fixed in the primitives.
- [x] **"Once a day" is hardcoded.** Reads from AI_LIMITS through the tier.
      /pricing's Free column now names its cook-my-day too.
- [x] **The new-week refusal renders twice.** Gated on which control asked.
- [x] **The banner's "New week" button is not blocked.** Same basket guard as
      the sidebar's.
- [x] **QA fixtures arrive with their allowances spent.** `npm run
      rate-limit:reset-user -- <email>` is the answer, and it now clears that
      user's in-flight LOCK as well as their counters — a bot whose previous
      run was killed mid-cook was meeting a 90-second "Clara is already
      cooking" and reporting a working feature as broken.

### Open — found by the cycle-16 bot pass (two bots, frozen `e5fed9e`)

Ranked by how badly each would hurt a beta tester. Everything here was measured
or reproduced; where a bot could not pin something down, it says so.

**The feature that hides itself**
- [x] **cook-my-day is unreachable with a well-stocked pantry.** Its card is the
      feature's only entry point (`PantryClient.tsx:793`) and renders only when
      `!cookable.dayCoverage.canFillDay`. With a normal 16-ingredient basket the
      API returns `canFillDay: true` and the whole feature — cuisine chips,
      allowance line, upgrade offer — is absent from the page, with no
      explanation anywhere. The bot had to strip its pantry to five items to
      reach it, and it vanished again on restocking. A metered, paid-for
      capability that disappears from the users most likely to use it.
      **Cycle 18:** the card renders whenever the basket has 3+ items, with its own copy when the library can already fill the day. Measured on screen with 17 ingredients: "Cook a fresh day with Clara", 12 chips at 44px on touch, the allowance line.

**The amount fix reached the backfill and not the write path**
- [x] **A freshly generated week contains `0.1 teaspoon` and `0.2 teaspoon`** —
      16 and 4 rows across 11 of 28 dishes, always pepper/salt/garlic powder,
      sitting on the same card as a correctly rendered `⅛ teaspoon`.
      `repairAmount` is called by the backfill and the audit and NOT at
      generation, so the catalog is clean and everything new is not. This is the
      cycle-13-to-15 shape exactly: the rule exists, the write path never calls
      it.
      **Cycle 18:** `repairForStorage` in `persistValidatedRecipes`, the one door for top-up, cook-my-day and Clara swap. A week generated after it: 18 sub-spoon rows stored as pinches, 0 new unmeasurable rows. The 2 `0.05 teaspoon pepper` rows it did carry were stored by the cycle-17 bots BEFORE the fix — see the backfill item below; they are repaired at render meanwhile.
- [x] **185 unmeasurable amounts are written into step PROSE**, in 115 dishes:
      "Season with 0.0625 teaspoon kosher salt", "Pour 0.33 cup of mung bean
      plant-based egg", "Spray with 0.25 gr of avocado oil". The amount repair
      only ever touched ingredient ROWS. A cook reads the steps.
      **Cycle 18:** `repairProseAmounts`/`readableProse`, at generation, at render (/meal-plan, /dishes) and in `scripts/repair-steps-and-titles.ts`. /dishes and a fresh week: 0 decimal amounts in prose. Stored rows wait on the backfill.
- [x] **`2 mediums`** — `formatAmount` pluralises "medium", which is an
      adjective ("2 medium eggs"), and the step prose says "Pour 2 medium large
      eggs into a bowl".
      **Cycle 18:** sizes never pluralise; "2 medium large eggs" → "2 large eggs" in prose. 0 on screen.

**The instructions exist twice**
- [x] **784 library rows carry the whole method a second time in
      `description`**, and 4 of them still tell the user to rinse raw fish
      ("Baked Trout" ×4). The rinse repair rewrote `steps`; `/dishes` renders
      `description`. My own verification query read `steps`, found zero, and
      would have reported the fix as landed — the bot read the screen.
      **Cycle 18:** the rinse and amount repairs run on `description` too (render + backfill). /dishes: 0 raw-meat rinses on the page.

**Titles**
- [x] **21 dishes still start with "Large Eggs", 7 more carry it mid-name**, and
      one reached a plan card as "Large Eggs with Bell Peppers and Carrots". The
      rename only fires when an egg-mentioning step names a method; these
      describe the method without using one of the words ("whisk … cook
      undisturbed"). Dropping the grading word alone — "Eggs with…" — is never
      wrong and was not done.
      **Cycle 18:** the grade goes when no method is named, and mid-name. /dishes: 0 "Large Eggs" titles or title-shaped descriptions; a fresh week's 5 egg dishes all titled by method.
- [x] **"Scrambled Eggs With Sautéed Tomatoes"** — a stray capital W, produced
      by the rename joining a method to a remainder that began with "With".
      **Cycle 18:** connector lowercased at the join, and on the 9 stored rows the first rename wrote. /dishes: 0.
- [x] **626 public dishes show their internal variant code** on `/dishes`
      ("2-Step Chicken , V1L- 6 oz chicken"). `displayDishName()` exists and is
      called on plan cards, the weekly grid, the pantry and swaps;
      `app/(main)/dishes/page.tsx:22` passes `r.name` raw. The marketing menu is
      the one surface showing the raw rows.
      **Cycle 18:** /dishes uses `displayDishName`, and the suffix regex learnt five shapes it never knew (`V1 S-`, `V2,3,4`, `V7, 11`). Descriptions that repeat the raw name show the repaired one. /dishes: 0 variant codes.

**Keyboard and interaction**
- [x] **The four dish rows on /meal-plan are keyboard-unreachable** — `<div
      onClick>` with no `role` and no `tabindex`. They are the only way to
      expand a dish, rate it, or open the swap modal, so the swap modal (whose
      focus trap and Escape handling both test clean) cannot be reached at all
      by keyboard. /meal-plan has 14 tab stops because of this.
      **Cycle 18:** role=button, tab stop, Enter/Space, aria-expanded, focus ring. Measured: first row 4 tabs from #main, Enter expands, Space collapses, Swap reached by keyboard, dialog opens and Esc closes it.
- [x] **`Button` drops out of the tab order for ~60s while loading.**
      `disabled={disabled || loading}` makes it natively disabled during a
      generation (measured 58s and 64s), which defeats the documented reason for
      using `aria-disabled` on that very button — a keyboard user can neither
      reach it nor hear its reason for the whole minute.
      **Cycle 18:** loading = aria-disabled + aria-busy, still focusable, activation swallowed (incl. Enter-to-submit). Measured on Save Profile mid-request: `disabled:false, aria-busy:true`.
- [x] **Save Profile double-submits** — three rapid clicks fired three
      `PATCH /api/patient/profile`; the button is never disabled in flight and
      shows no spinner.
      **Cycle 18:** ref guard + the Button change. Three rapid clicks: 1 PATCH.
- [x] **Swap modal touch targets**: `Close dialog` 32×32 and eleven cuisine
      chips at 24px tall, with no expander.
      **Cycle 18:** close 44×44, chips 44px tall with an 8px gap on a touch device. Measured.
- [x] **Profile errors are not tied to their fields.** `role="alert"` is
      present, but `aria-invalid` is never set, no `aria-describedby` links a
      field to its message, and focus stays on `BODY` instead of moving to the
      first invalid field.
      **Cycle 18:** the error renders under its field; aria-invalid, aria-describedby and focus all land on it. Measured with First Name cleared.
- [x] **Tab order inversion**: the header (`Beta → Plus`, `Settings`) is tabbed
      after the entire left nav, on /meal-plan and /profile.
      **Cycle 18:** DOM order is now header → nav → main (the sidebar is fixed, so nothing moved visually) plus a skip link. Measured: Skip → Plus → Settings → nav.
- [x] **0px gap between `lbs` and `kg`** on /profile; 4px between the /pantry
      tabs. The guideline asks 8px.
      **Cycle 18:** the pantry tabs are 8px apart. `lbs|kg` is REFUSED: it is one segmented control (radiogroup) of two 44×44 radios, where a gap would break the control's shape; the 8px rule is for separate targets.

**Numbers that argue with each other**
- [x] **"▲ 3% there" over "CURRENT WEIGHT 150.0 lbs"** — the ring reports
      PLANNED progress while the weight has not moved, and the visible label
      (`CaloricProfileCard.tsx:460`) disagrees with the component's own
      accessible name at `:436` ("3 percent through your plan"). The arithmetic
      also rounds 3.9% to 3.
      **Cycle 18:** the visible label says what the accessible name says: "9% through your plan". Measured.
- [x] **"▼ 0.39/wk" next to "week 1 of 21"** with a 10 lb gap — that is 26
      weeks at that rate. Explainable (the engine simulates an accelerating
      ramp) but nothing on screen says the rate changes.
      **Cycle 18:** reads "▼ 0.27/wk this week". Measured.
- [x] **A cooked day can under-deliver by 40% with no warning** — both
      cook-my-day runs filled all four slots and then showed 1160/1981 and
      963/1981 kcal. The "Clara filled X of Y meals" caveat only fires on
      missing SLOTS, never on an 800 kcal shortfall.
      **Cycle 18:** a fully-slotted day >15% under target says how far under and what to do. Not yet seen on screen — no cook-my-day was spent this pass.
- [x] **A Clara swap left the day at `Fat 86g of 53g · 162%`** with no flag on
      the swap that accepted it.
      **Cycle 18:** **the fat budget had been computed, commented and never read** — a fix that never took effect, again. `swapPushesDayFat` (tested) now refuses a candidate that takes the day past 130% unless it lowers the day's fat. Not yet exercised by a live swap.

**Smaller**
- [x] **`?date=2026-02-30` silently renders "Monday, March 2"** — an invalid day
      rolls into the next month with no indication the URL was corrected. (The
      other bad dates are handled well, and `?date=<script>` is safe.)
      **Cycle 18:** round-trip check on the page, like the API's. Measured: today.
- [x] **~89 library dishes have visibly broken prose** — "Add Tofu , cook 8-10
      minutes until done, flipping half wathroughou, remove from heat." Import
      noise, on a public page.
      **Cycle 21:** the mechanical part (a space before punctuation) is repaired everywhere prose is shown or written — /dishes now has 0. The garbled words ("wathroughou") need a person: `node --import tsx scripts/audit-library.ts` lists every flagged row (report only, CSV to /tmp).
      **Backfill 2026-09-26:** the audit's word check rebuilt against the system dictionary and read by hand: 26 dishes fixed by exact substring (scripts/repair-typos.ts) — "half wathroughou" ×10, "peacans" ×7, "remining" ×3, "parmesa", "isntructions", "Slicesalmon", "pasta:.". What the audit still lists are real words (shakshuka, microplane, nonstick).
- [x] **84 of 2,440 dishes declare under 60 kcal and 5 over 1,200**, including
      `Beef Pot Roast` at 0 kcal and `Air fryer French Fries` at 11. A
      25 kcal condiment ("Homemade Cashew parmesan cheese") was served as a
      SNACK slot. Library data, not the repriced macros — all 28 freshly priced
      dishes were within ±0.3% of 4P+4C+9F.
      **Cycle 21:** no longer servable (a slot's first dish, a snack and the day's top-up need 60 kcal; 0 kcal never chosen — test verified by reintroducing the bug) and no longer on /dishes. The stored numbers still need correcting; the audit script lists them.
      **Backfill 2026-09-26:** 17 repriced from their own amounts (scripts/repair-impossible-calories.ts; e.g. Scrambled Eggs 6 → 187, two pork dishes 1,239/1,386 → 556/715). Left on purpose: drinks (really ~0 kcal), 3 dishes whose 1,214-1,273 kcal is TRUE at full pricing coverage, and Beef Pot Roast (unpriceable, 0 kcal — never served, not on /dishes).
- [x] **A stray second click on "New week" spends a real allowance** with no
      confirmation step. The bot burned two of three weekly generations on one
      script click.
      **Cycle 18:** with a plan on screen the sidebar asks first ("Replace my week" / "Keep this week", focus on the first). Measured: Keep this week fired 0 requests. The empty-state control's stray second click during a build: 1 POST.
- [x] **The `stale` banner hides itself during generation** (`stale &&
      !newWeekLoading`), taking its own button's spinner with it, so the screen
      goes quiet for ~60s. Reported unconfirmed — the bot could not catch the
      window.
      **Cycle 18:** closed on reading, not a defect: while a build runs with a plan on screen, a `role="status"` card ("Building your new week… you can leave this page") takes the banner's place, so the screen is not quiet.

**Closed in cycle 17 (this pass's own regressions)**
- [x] **The journal step dots stole each other's taps.** My `-mx-[13px]
      px-[13px]` inside a 6px gap overlapped consecutive targets by 20px:
      tapping the second visible dot went to step three, the fourth to step
      five. Real width and a real gap now; the measurement checks OVERLAP as
      well as size.
- [x] **The touch-target expander only applied below 481px** — a phone in
      landscape is 844px wide. Now `(pointer: coarse)`, along with the four
      `sm:min-h-0` variants of the same width-for-pointer confusion. Measured
      clean at phone portrait, phone landscape and tablet.

**Open — found by the cycle-18 bot pass (frozen `03e78cb`, then its own fixes)**
- [x] **The stored rows still need the backfill, and it needs a human to run
      it.** The live-DB read that measures them was refused to the agent this
      cycle (production reads need explicit permission), so every data fix
      landed at the write path and at RENDER — the screen is right, the rows
      are not. Clara reads the rows. To finish it:
      `node --import tsx scripts/repair-steps-and-titles.ts` (report), then
      `--apply`; then `scripts/repair-amounts.ts` the same way (the rows the
      cycle-17 bots stored before the write-path fix, e.g. `0.05 teaspoon
      pepper`). Both write a backup to /tmp first.
      **Backfill 2026-09-26:** run (user-directed). repair-steps-and-titles: 772 step lists, 210 descriptions (4 raw-fish rinses), 23 egg titles — every one of 1,542 changed sentences scanned before applying, and three wording bugs fixed first (oil read as "1 g"; "a pinch of as written"; oil as "a pinch"). repair-amounts: 89 rows, salt now only rounds DOWN, 58 dishes repriced. Both re-run to 0. Backups in /tmp.
- [x] **A fresh week's fat is 30-41%**, three of seven days at or above the 38%
      top of the band cycle 15 claimed (Sep 29 38%, Sep 30 39%, Oct 1 41%, on
      days of 1401-1748 kcal). One week — per "report the range, not the run",
      two more are needed before tuning anything. Also worth reading: the same
      days sit 150-500 kcal under the 1895 kcal target.
      **Cycle 19:** three causes, fixed in turn and measured on 7 generated weeks. (1) sides/dessert/filler took the last tier's fat relaxation, meant only for an EMPTY slot; (2) that tier then chose as if fat did not matter — every day over the ceiling got there that way; (3) the ceiling was whole-day only, so breakfast and lunch spent it and dinner fell to the relaxed tier. Now paced by calories planned so far. qa.desktop: 103-170% of the fat target → 79-134% (mostly 98-119%, 25-32% of kcal), calories 86-105%. qa.variant (pescatarian, 2,959 kcal, 222 g protein) stays 113-134% fat and 49-62% protein: see the pool-bound item below.
- [x] **"Maintain — you're at a healthy weight" beside "TARGET WEIGHT 75 kg"
      and "CURRENT WEIGHT 80 kg"** on /overview (qa.nocond). Two statements on
      one card that cannot both be the plan. Needs a product answer first: does
      a healthy-BMI user with a lower goal weight get a deficit or not?
      **Cycle 19:** not a plan defect: with no goal set and a healthy BMI the engine maintains, and the tile labelled the ideal-weight DEFAULT as the target. A maintain plan's target now shows the current weight ("keep steady") on /overview and /profile, and /profile's "your plan targets less" follows the plan's direction. Measured on qa.nocond.
- [x] **An ENDED plan stranded the user.** Opening /meal-plan on Sep 25 with a
      plan for Sep 11-17 said "That day is beyond your current week" about
      TODAY, with no generate control anywhere on the page. The cycle-17 guard
      for `?date=2027-12-31` could not tell "paged past a running plan" from
      "the plan is over". Fixed in cycle 18 and measured: the same account now
      gets "Generate my whole week".
- [x] **The expanded dish's Swap, Not for me and Loved it buttons were 31-32px
      on touch** — never measured before because the rows could not be reached.
      44px now, measured; the ratings announce aria-pressed.
- [x] **cook-my-day's cuisine chips were 34px on touch.** 44px, measured.

**Open / found by cycle 19**
- [x] **The macro split reached Clara as "~0% protein, ~0% carbs, ~0% fat".**
      Both the catalog top-up and the swap prompt printed `Math.round()` of a
      FRACTION (0.30). Every generated dish and every swap, for as long as the
      line existed. `macroSplitLine` takes either form and is tested.
- [x] **The weight-unit toggle never persisted** — cycle 15's fix was a third
      fix that never took effect: Patient.weightUnit is the STORAGE unit and the
      server writes "lbs" on every save. /overview read kg from the height,
      /profile read lbs. One rule now, the toggle remembered on the device (and
      the control says so). Measured: both screens agree, both follow a toggle.
- [x] **A per-account weight-unit preference needs a column** (a migration on
      the production DB, so not the agent's to run). Until then the choice is
      per device.
      **Cycle 21:** built on branch `feat/weight-unit-pref` (worktree ../wondish_02-weight-unit): nullable `Patient.displayWeightUnit`, migration 20260925120000, one tested resolve rule, onboarding and the profile toggle save it. NOT merged — run the migration first (`npm run db:migrate:deploy`), then merge.
- [x] **A Clara swap that finds nothing still costs a swap.** Asked for
      "something rich and creamy" on a day with 27 g of fat left, Clara returned
      four dishes over it — even once the prompt states the room in grams. The
      422 now says so ("would take today past your fat target — try asking for
      something lighter") instead of blaming the slot. Refunding the allowance
      needs a decrement the sliding-window limiter does not have.
      **Cycle 21:** refunded (user decision). The swap allowance is charged only when a dish is saved; every model call is metered by a new `swapAttempt` cap (allowance + 3; beta + 2), finishing a two-phase design an earlier session left unused. Paid for by Plus Clara chat 25 → 20, keeping the $30 ceiling (test). Measured: two refused swaps spent 2 attempts and 0 swaps and said so; three delivered swaps spent one each.
- [x] **A high-target, narrow basket cannot reach its macros.** qa.variant:
      pescatarian, shellfish-free, 16 ingredients, 2,959 kcal with 222 g
      protein. Over 4 generated weeks protein landed at 49-62% of target and fat
      at 113-134%, calories 80-93%. The 1,000+ kcal lunches that basket allows
      are ~40% fat and ~50 g protein each; four slots of them cannot reach the
      target. Fixed what was the builder's (protein-light mains preferred
      against — "Brown Rice and Roasted Vegetables", 14.7 g, is no longer a
      dinner when tofu exists). What is left is the pool, and the honest
      options are product ones: fewer grams asked of a narrow basket, or Clara
      writing lean high-protein dishes to order.
      **Cycle 21:** Clara now writes lean, protein-forward dishes (user decision) when a slot has fewer than 4 lean dishes big enough for it, and mains prefer the diner's own protein share. qa.variant over 2 weeks: protein 52-65% → 57-77% of target, fat 118-138% → 106-124%, but calories 84-93% → 74-85%: Clara's lean lunches still come in at 700-840 kcal for a 1,035 kcal slot, and the fat ceiling then blocks the padding. The other two profiles are unharmed (fat 91-117%, calories 89-105%, protein 74-109%). The remainder is a real three-way conflict in that basket, recorded below rather than tuned against one account.
- [x] **Oatmeal padded a 7pm chicken dinner** (first free-tier week). Porridge
      is never a lunch/dinner side or filler now; test verified by
      reintroducing the bug.
- [x] **Onboarding left focus on Continue after a refused step**, and the body
      step's inputs had no ids, so their errors were not linked. Fixed and
      measured: every misinput in the test plan's list refused, with focus on
      the field. A typed negative weight said "please enter your weight" and
      now gives the range; the goal step's "never crash-dieting" line no
      longer sits under a refusal.
- [x] **"BMI 25.0 (Healthy)"** for 24.99 — truncated now, so the number and
      the class agree.
- [x] **"0/5 meals logged" over four meals** — it counts dishes, and says so.

**Cycle 20 — a phone sweep of 16 pages, and what cycle 18's render repair did**
- [x] **One dish had two names.** Cycle 18 renamed egg dishes at render on
      /meal-plan and /dishes only, so the weekly grid said "Large Eggs with
      Bell Peppers and Carrots" while the day view said "Baked Eggs with…".
      The grade-drop moved into displayDishName, which every screen and
      Clara's plan text use; the method rename stays with the stored rows.
      Measured: all five of a day's dishes read identically on the day view
      and the weekly grid.
- [x] **Touch targets on pages no cycle had swept**: search inputs (42px),
      the what-to-buy lens pills and /dishes filters (38-40px), date pickers
      (42px), and three text links (16-17px). The sweep of 16 pages at 390px
      on a touch device now reports 0 under 44, 0 overlaps, 0 horizontal
      overflow, 0 console errors.
- [x] **Seen once:** /meal-plan/weekly returned 500 ("Cannot read properties
      of null (reading 'useContext')") during a dev-server recompile. 3 of 3
      reloads were 200. Dev-only as far as can be told; watch for it on a
      production build.
- The porridge rule and the fat pacing, re-measured on a third profile (the
  free account, 1,725-1,931 kcal): fat 25-28% of calories on 7 of 7 days,
  88-106% of the gram target; calories 85-102%; no oat dish at lunch or
  dinner.
      **Closed 2026-09-26:** reproduced on the DEV server (2 of 40 loads): webpack's on-demand compile race in Next 14 ('Cannot read properties of undefined (reading \'call\')', then Next's own error boundary crashing). The production build: 120 of 120 loads clean, 0 errors in the log. Dev-only; nothing to fix in the app.

**Cycle 21**
- [x] **qa.variant eats 74-85% of its calories** since the lean-protein change:
      protein and fat both improved, and the lean lunches Clara writes are
      ~250 kcal smaller than the slot. Next lever, if wanted: let a lunch or
      dinner take a lean side when the slot is under 85% (today's filler waits
      for 70%). Not done blind — it adds a row to many profiles' days.
      **Tried and measured in cycle 21: no effect** (2 weeks, still 74-84%) —
      every filler candidate breaks the day's fat ceiling, so a lower threshold
      finds nothing to add; reverted. What is left is a nutrition decision:
      for a high-protein target on a fatty basket, is 80% of calories at
      ~113-122% of fat the right trade, or should the fat ceiling give way?
      **Cycle 22:** the fat ceiling was relaxed (user decision) and MEASURED:
      no gain for qa.variant, healthy profiles fattier — reverted. The
      builder's own log then showed the real blocker is SODIUM (the day's
      top-up refused every right-sized snack on sodium, 7 of 7 days). Sodium
      is now paced like fat and a relaxed tier takes the least-salty dish:
      qa.variant 77-87% of calories (from 69-88%), healthy profiles at their
      best yet (qa.desktop 94-104% kcal, 23-30% fat, sodium 1,554-2,052 mg).
      The rest of qa.variant's gap is blocked by fat AND sodium together; only
      relaxing the 2,300 mg sodium guideline could close it — a health call
      not taken. The day shows the gap as "N kcal free".
      **Closed 2026-09-26:** as far as the basket and the health limits allow. Clara's snacks now carry no added salt, and a short day's calorie top-up may take fat to 135% with a lean snack (owner: calories over fat). qa.variant 79-90% of calories over two weeks; healthy profiles unchanged (85-105% kcal, 90-119% fat). The builder log shows the rest of the gap refused on SODIUM on every day — only relaxing the 2,300 mg guideline could close it, and the owner kept it.
- [x] **Generated dishes were briefed "~0% protein"** (fixed in cycle 19);
      re-measured here: Clara's lean dishes come back at 23-31% protein.
- Development responses now carry what the top-up asked for and kept
  (`debug` on /api/meal-plan/new-week, rejection reasons on a swap 422). A
  quarter of every generated batch is rejected as out-of-basket (7 of 28) —
  the next place to win acceptance.

**Cycle 23 — the first production build (`next build && next start`)**
- [x] **The diet matchers threw in production.** /api/pantry/cookable and
      /api/pantry/to-buy answered 500 on the minified build only: SWC inlined
      template constants in lib/diet-match.ts and re-escaped `\\b` as a
      backslash + BACKSPACE, invalid under the regex `u` flag. Twenty cycles
      on the dev server could not see it. Fixed (no `\b` in string-built
      patterns), a unit test, and `scripts/check-build.mjs` now fails
      `npm run build` on a mangled escape — verified by running it against
      the broken build (exit 1) and the fixed one (pass).
- [x] **Production sweep**: 16 pages at phone size, 0 failed requests, 0
      console or server errors. New week 200 in 63 s; Clara's first words
      3.1 s; cook-my-day 4/4; the development-only `debug`/`rejections`
      fields confirmed absent from production responses.
- [x] **The rate-limit kill switch, verified** for the first time on a real
      build: `RATE_LIMIT_ENFORCE_BACKEND=1` with no Upstash → nothing served
      (500 everywhere); with Upstash → normal. Default (unset) serves and
      reports `degraded`, by the 2026-09-17 decision. **Ready to set in Vercel
      Production.**
- [x] **A swap started while a new week builds** answered a bare "Menu not
      found". Rows are locked during the build; the 404 now says the dish was
      just replaced.
- [x] Admin routes logged Next's own dynamic-rendering signal as "[admin]
      unhandled error" six times per build; given back, 0 now.
- [x] **A failed cook-my-day still spends the allowance** (a free user's only
      one of the day, lost to a model failure — seen once in production:
      422 then 200 on retry). Refunding it the way swaps are refunded does
      not fit the $30 Plus ceiling without trimming something. Needs a call.
      **Closed 2026-09-26:** refunded like swaps: the allowance is read, each model call is a cookDayAttempt, and cookDay is charged only when a day is saved. Free (one a day) gets one retry; premium's attempts equal its allowance so the $30 ceiling holds (test). Verified on the production build: a delivered day spent one attempt and one plan.

**Final system bot (2026-09-26, production build, 64 checks)**
Platform, public pages ×3 languages, a brand-new sign-up through onboarding,
taste, pantry and a first week, the meal plan, pantry and cook-my-day, Clara,
profile, journal and meal log, Stripe checkout → Plus → cancel, and a phone
sweep of every page. First run 50/64, all failures triaged: 3 were the bot's
own mistakes, and the rest found and fixed —
- [x] meal-log row edit/delete at 32×32 (only present once something is
      logged, so no sweep had seen them); taste quiz "Start over" 55×17 and
      Back/Next at 40px — all 44 now.
- [x] **cook-my-day charged the allowance before calling Clara**, so a model
      error said "Nothing was used up" while it had been used. Now charged
      only when Clara answers (budget unchanged); a filtered-out day says it
      counted; refusal reasons are logged. Strict profile afterwards: 3/3.
- Known, recorded, not blocking: a brand-new narrow basket's week ran
  76-93% of calories, and one day 2,407 mg of sodium (107 over) — the
  last-tier relaxation, which takes the least-salty dish when the only
  alternative is an empty slot.
- Stripe and Clerk are live-keyed in production (owner, 2026-09-26) — the
  launch items for them are closed.

**Stripe experience run (2026-09-26, sandbox, production build, 41/41)**
Every buyer path on real hosted Checkout with the `stripe listen` forwarder
(503 webhooks, all 200): abandon; declined card then retry; unknown and valid
promo (discount carried to the first invoice); 3-D Secure fail then pass;
already-subscribed; plan upgrade needing bank confirmation → Stripe invoice
page → 6-month; downgrade scheduled, then Keep; cancel/resume; card portal
and return; past due → banner → recovered; ended → free; a beta coupon
holder upgrading and falling back to beta. Found and fixed —
- [x] **A leftover checkout attempt overwrote a paying subscription.** Every
      declined/abandoned checkout leaves an incomplete subscription whose late
      events (a payment failure; expiry ~23h later) were synced onto the
      account's one row — a member who paid after a decline dropped to
      INCOMPLETE, and on expiry would drop to Free. Only a paying
      subscription may now replace a live row (`lib/billing/sync.ts`, tests).
- [x] **A declined first payment granted Plus** (INCOMPLETE counted as
      premium) — `lib/auth.ts`, test.
- [x] **Monthly → 6-month with a card the bank wants confirmed made the
      member past due** (and so lost Plus). Now `pending_if_incomplete`: they
      stay on their paid plan and the panel links to Stripe's invoice page to
      confirm; a hard decline returns a clear 402.
- [x] **A past-due member loses Plus at once, while the banner said "keep Plus".**
      Owner's call (2026-09-26): they drop to the free allowance at once and
      keep what they have, like ChatGPT/Claude plans. The banners now say so,
      and a refusal reads "...new weeks are paused until your card is
      updated" with **Update your card →** (/membership), not the upgrade.
      Verified on the production build: a past-due buyer's "Generate a new
      week" shows exactly that; a free buyer's shows "New weeks are part of
      Plus — Free comes with your first week..." with Upgrade → /pricing.
- [x] **New weeks became monthly** (owner, 2026-09-26): Free has its first
      week only, Beta 2 a month, Plus 4 a month; a profile-change rebuild is
      its own allowance (1 a week, Plus 2) so Free can apply a new allergy.
      Pricing en/es/ru, membership panels and FAQ updated. Stripe run after
      the change: 44/44. Note: the iOS app, if it calls POST
      /api/meal-plan or /regenerate for an existing plan, now meets Free's 0.
- [ ] **Owner:** the sandbox's public business name is "Painless Food
      Corporation sandbox" (shown on Checkout and invoices) — check the live
      account's name before launch.

**Still open from before**
- [x] **The journal's five step dots are 32px wide** (44 tall). Five 44px
      targets need 220px inside a 46px control; fixing it properly means
      redesigning that progress row.
      **Cycle 19:** 44x44 on a coarse pointer — they fit after all (5x44 + 4x8 = 252px). Measured at phone, landscape and tablet: no overlap, every tap selects the dot tapped.
- [x] **es and ru pricing copy is a different, older feature list.** A Spanish
      reader is shown allowances that are not the ones enforced. Needs a real
      translation pass, not a guess.
      **Cycle 19:** rewritten in both, and all three languages now take the numbers from AI_LIMITS (ICU plurals; Russian one/few/many). A test formats every locale with the enforced limits; /pricing checked with NEXT_LOCALE=en|es|ru.
- [x] **A stale plan can read 166% of its fat target** (101 g against 61 g).
      The fat ceiling landed in cycle 15, so weeks built before it keep their
      numbers. A freshly generated week still needs measuring against the
      25-38% band.
      **Cycle 20:** a week built before the fat fixes keeps its numbers until the next New week; weeks built since measure 25-32% of calories across three profiles. Known consequence, not a defect.

### Seen once, not reproduced — kept so a second sighting is recognised

Neither bot could make these happen again, and both said so rather than
claiming them. They are recorded because the expensive version of this is the
second person to see it having no idea it was seen before.

- [x] **The pantry selection changed on its own.** Between two scripts a bot's
      basket went from the 5 items it had chosen to a 13-item plan-derived set:
      `celery`, `zucchini`, `eggs`, `ground beef`, `Ground turkey` gone,
      `Large eggs` and `Unsalted butter` present, neither ever tapped. A
      follow-up test of three reloads with no clicks showed the selection
      perfectly stable and zero non-GET `/api/pantry` calls, so its own
      clicking is a plausible cause. Worth looking at regardless: the catalog
      holds both `eggs` and `Large eggs` as separate ingredients, which is how
      a basket could appear to swap one for the other.
      **Cycle 21:** found: layout shift under the finger. The Selected list sat above the categories and wrapped, so a tap could push the chips below by 52px (once 264px) and a quick second tap landed on a different ingredient; the double-tap reproduction took 26 → 24. Fixed (one fixed-height scrolling row; chips keep their width) and measured at 0px across seven taps. The save path was verified sound: 10 machine-speed taps, each +1, screen = server after reload.
- [x] **An ingredient count jumped by two.** Tapping `★ Cauliflower` left the
      count at 9, then `★ Carrots` moved it 9 → 11. Self-corrected, not
      reproducible; possibly a 1s poll racing an optimistic update.
      **Cycle 21:** same mechanism as above, same fix.
- [x] **The `stale` banner hides itself during generation.** (Closed on reading in cycle 18 — see above.) `stale &&
      !newWeekLoading` removes the whole banner — including its own button's
      spinner — so pressing "New week" there makes the screen go quiet for the
      ~60s the build takes. The bot saw the banner still present at its 250ms
      sample and could not pin the window.

### Smaller, and still true
- [x] **An `aria-disabled` button is a silent no-op on activation.** Pressing
      Enter on the blocked "Generate a new week" fires no request, shows no new
      message and updates no live region. The reason IS permanently rendered
      beside it and wired with `aria-describedby`, so a screen reader hears it
      on focus — but anyone who did not notice the static line gets a dead tap.
      **Cycle 18:** pressing a blocked New week now fills a live region with the reason and bolds the static line. Code-read and typed; not yet pressed by a bot (both fixtures had ready baskets).
- [x] **Two daily calorie targets on one card**: "1895 KCAL/DAY · Today's
      target" above "easing toward 1788 kcal/day". Both are correct (1981 − 1788
      = 193 kcal/day = 0.386 lb/wk) and the card never says why they differ.
      **Cycle 18:** the pill reads "today, moving gradually to 1688 kcal/day". Measured.
- [x] **Some ingredient rows lost their unit** and render as a bare `2` or `½`.
      **Cycle 19:** a counted food (eggs, bread) gets its unit at render. A bare "½" beside rice is REFUSED: the unit is unknowable, and inventing one is the "199 dishes with no quantity" case.
- [x] **`View full week`'s expander overlaps `Next day` by 40×6px** on
      /meal-plan. `Next day` is later in the DOM and wins that band, so it costs
      `View full week` ~6px of its own hit area and steals nothing — the only
      overlap left after cycle 17, and the reason the measurement now reports
      overlaps rather than just sizes.
      **Cycle 19:** the row clears it. A phone hit-test of /meal-plan: 8 controls, 0 overlaps, 0 under 44 (the dish rows themselves were 42-43 and are 44 now).

### Not tested — the coverage gaps this pass leaves behind

The next cycle starts here. None of this is a clean bill of health; it is
untouched ground.

- [x] **The FREE tier's own strings were never exercised.** Both fixture
      accounts are on coupons, so `tier: "beta"` answered every guard: the
      pantry card was verified as "Twice a day" (correct for beta, and it did
      match what the guard enforced at 2), and "your 1 free cook-my-day plan"
      was never rendered. A genuinely free fixture is needed — see the process
      item below.
      **Cycle 19:** a genuinely free account (qa.free.20260925@wondish.io, Clerk dev instance, no coupon) went through the whole cold start. "Once a day" on cook-my-day; the 2nd week refused "You've used your 1 free new week for this week. Plus gives you 5 a week." + /pricing; the 6th Clara message refused "…5 free Clara messages for today. Plus gives you 25 a day." + /pricing.
- [x] **The empty-state "Generate my whole week" control.** Both accounts had an
      active plan, so only two of the three new-week controls were exercised.
      The third is verified by reading the code, not by pressing it.
      **Cycle 18:** pressed by the cycle-18 pass: 200, 32 dishes, 62s.
- [x] **/dish-checker in conversation.** Only its 4 resting controls were
      audited; no Clara messages were sent, so its in-conversation surfaces,
      streaming states and refusals are unaudited.
      **Cycle 19:** a real question answered against the profile; a blank message sends nothing; prompt injection declined ("My instructions are for me to follow, not to share"); Spanish answered in Spanish; first words in 3-5 s once warm (15-19 s was dev compile).
- [x] **Fraction rendering on a live card.** `formatQuantity` is covered by
      unit tests and was confirmed on generated dishes by bot 1, but ⅓/⅔ —
      the values the backfill actually wrote — appear on repaired CATALOG rows,
      and no bot reached a plan built from those.
      **Cycle 20:** seen on live cards: ⅛-¾ rendered 23 times on one cooked day, 0 decimals.
- [x] **cook-my-day's result cards** list ingredient names only, with no amounts
      and no steps, so they could not be used to check either the amount or the
      rinse repairs.
      **Cycle 20:** each card has a "How to make it" disclosure (native details/summary, 44px, opens by keyboard) with amounts and steps through readableProse. Measured on a live Japanese day: 23 kitchen fractions, 0 decimals, no rinse, no "mediums".
- [x] **A freshly generated week has never been measured against the 25-38% fat
      band** that cycle 15 claimed. The one week that was measured (166%) was
      built before the ceiling landed.
      **Cycle 18:** MEASURED, and it does not hold — see the new open item.

- [x] **Cycle 18's fixes that no bot has exercised live**: a Clara swap under
      the new fat rule (the rule is unit-tested, the route is not); a
      cook-my-day that comes in under target (the caveat has never rendered);
      a blocked New week pressed with an unready basket (both fixtures were
      ready). Each costs an allowance, so each wants its own fixture.
      **Cycle 19:** exercised. Blocked New week (qa.desktop's basket cut to 5 and restored exactly): the live region says "Can't build a week yet. Add 7 more ingredients.", 0 requests. cook-my-day: 4/4, 3008/2817 kcal (over, so the under-target caveat still has not rendered — it is typed and read, not seen). Clara swap: see the new items.

### Refused by design — listed so nobody re-opens them as bugs
Each was measured and left deliberately; the reason is the entry.
- **867 of 1,487 generated dishes are titled after a catalog row.** Most are
  fine English — "Ground Beef with Rice and Broccoli" is a dish. Only the cases
  where the shopping form and the cooked form are genuinely different words
  (the egg grades) were repaired; rewriting the rest would be a mass rename of
  good names to catch a grading word.
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
- [x] **One fixture per TIER, not just one per bot.** Giving each bot its own
      account fixed cycle 15's problem (a bot arriving to find every allowance
      already spent) and exposed the next one: both fixtures hold coupons, so
      every guard answered `tier: "beta"` and the free tier's own copy and
      limits went untested two cycles running. Needed: a free fixture, a beta
      fixture and a paid fixture, each reset with `npm run rate-limit:reset-user`
      before a run.
      **Cycle 20:** free: qa.free.20260925@wondish.io (no coupon, created in the Clerk dev instance, onboarded through the app); beta: qa.desktop (coupon); premium: qa.variant (Stripe). Reset with `npm run rate-limit:reset-user -- <clerk id>`.
- [x] **Freeze HEAD for the whole QA window, edits included.** Cycle 14 was
      invalidated by 11 commits landing mid-run. Cycle 15 froze commits but not
      the working tree, and the dev server hot-reloaded uncommitted edits into
      the bot's later measurements. It read the diffs and cleared them, but it
      should not have had to.
      **Closed 2026-09-26:** practised from cycle 18 on: every bot run was preceded by a commit and, from cycle 23, ran against a production build that cannot hot-reload.

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
