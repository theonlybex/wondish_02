# Logic-engine fixes (ops audit, 2026-07-02)

> **See `/BACKLOG.md` for the canonical list of outstanding work.** This file
> stays as the detailed record — root causes, fix notes, commit refs. Its live
> items are mirrored there.

> Previous plan (Meal-Plan Reliability Phase A) is fully executed and shipped; superseded by this list.

Working one by one. TDD (node:test via `npm test`) where the logic is pure; DB-coupled files get minimal surgical changes gated by `npm run build` + lint.

- [x] 1. Meal plan can exceed its own calorie target by up to 35% — day-level budget cap (d06e0d8)
- [x] 2. Failed regeneration retry doubles a plan version — purge same-version rows before insert (b02b055)
- [x] 3. Editing height/heightUnit/birthday never marked meal plan stale (fe77d04)
- [x] 4. estimateDaysToGoalWeight landmine removed + stale parity comment fixed (90bc6ed)
- [x] 5. Projections now adapt TDEE + severity cap to simulated weight (06422d5)

- [x] 6. WTBW underweight for short users — clampGoalToHealthyBand floors every resolved target at BMI 18.5
- [x] 7. Goal-driven direction (product decision: goal-driven, healthy-clamped; BMI class only when no goal set) + goalWeight/birthday validation in profile PATCH
- [x] 8. Allergy bans now word-boundary matched w/ singular/plural stem (product decision; "egg" ≠ "eggplant"); non-allergy bans stay exact
- [x] 9. Journey engagement now divided by days-in-window (route + SSR page); minCal comment corrected; underweight schedule unified on gradualDailyCals

## Follow-on fixes (meal-plan review, 2026-07-02)

- [x] Generator speed-up: single recipe-pool load, in-memory filters, algorithm unchanged (old 255s → new 9.2s for the verify run; all 7 checks pass)
- [x] Anchor race: mealPlanWeight now stamped from the builder's own patient read (BuildResult.builtForWeight)
- [x] Menu dates: start normalized to midnight before build, rows match stored mealPlanStartDate
- [x] Run scripts/backfill-meal-plan-weight.ts — applied to dev DB (8 accounts, 2026-07-02); verified gg.bex.abdi progress 0% → 54.2%. STILL NEEDED: one-time run against the production DB on deploy.

## Clara dish-checker fixes (review 2026-07-02, items pending)

- [x] C1. ANTHROPIC_API_KEY missing from local .env (only in .env.example) — Clara cannot run in local dev; user adds the key themselves; verify prod host has it set. RESOLVED 2026-07-23: key confirmed ALREADY SET in Vercel prod env; local .env pulled via `vercel env pull` (gitignored).
- [x] C2. Client sends the canned assistant greeting as messages[0] — API requires first message to be user → 400 on every conversation. Strip greeting client-side (history.slice(1)) or drop leading assistant messages in the route (app/api/dish-checker/route.ts) (7b2ddbb)
- [x] C3. Route swallows mid-stream API errors: try/finally with no catch closes the stream as if successful → client gets HTTP 200 with empty body. Add catch → controller.error()/friendly message + typed Anthropic error handling (429/529) before streaming (7b2ddbb)
- [x] C4. Client TextDecoder without { stream: true } — multi-byte chars (Clara's ✅/❌) split across chunks decode as � (components/dish-checker/DishCheckerClient.tsx) (7b2ddbb)
- [x] C5. History message COUNT unbounded (per-message 4000-char cap only) — cost/abuse vector; cap to last ~20 messages in the route (7b2ddbb)
- [x] C6. claude-sonnet-5 upgrade shipped earlier (51e3724); adaptive thinking now explicitly disabled for chat latency via `thinking: { type: "disabled" }` (8c76dc0)

Note: C2+C3 together mean Clara has likely never completed a conversation — the 400 fires on every send and is masked as an empty reply.

## Unit-test sweep findings (2026-07-12, suite at 239 tests — suspected source bugs pinned as current behavior in the .test.ts files, not fixed)

Security/correctness first:

- [x] T1. middleware.ts matcher: extension exclusion is not anchored to end-of-path, so page routes containing an excluded extension mid-path (e.g. /blog/why-node.js, /some.js/route) bypass Clerk middleware entirely. API routes stay covered via matcher[1]. Same root cause also excludes prefix extensions (.jsx via `js(?!on)`, .csvx via `csv`) and `_next`-prefixed root paths like /_next-steps. (middleware.test.ts) FIXED e2a1985 — matcher exclusions anchored to end-of-path; note: a path genuinely ENDING in an asset extension (e.g. /blog/why-node.js) remains excluded by design.
- [x] T2. lib/rate-limit.ts memoryLimit: first request is always allowed even with limit=0 (entry created with count=1 before the compare); fallback key `${name}:${identifier}` lets ("x","y:z") and ("x:y","z") collide. Dev-only (Upstash path unaffected). (lib/rate-limit.test.ts) FIXED 0d85af6 — limit<1 blocks all requests; fallback key is JSON tuple (collision-free).
- [x] T3. lib/journey.ts: a meal with skipped=true AND preparation="cooked" is double-counted in both mealSourceBreakdown buckets; a truthy non-numeric mood string charts as { mood: NaN } (chart-breaking) while avgMood correctly excludes it; mood "0" excluded from average yet still charted; fmt() renders date-only ISO strings as the previous day in negative-UTC-offset timezones. (lib/journey.test.ts) FIXED 27f1fb6 — exclusive buckets, numeric-only moods (chart+avg unified), date-only strings pass through fmt untouched.
- [x] T4. lib/prediction-data.ts: BMI-25 float boundary (1.6*1.6 = 2.5600000000000005) classifies a nominally-overweight profile as healthy → null estimate; an activityLevel what-if override BELOW the profile level returns null instead of a longer ETA (Journey what-if card may surprise users if it offers lower levels); resolveSex does not trim whitespace. (lib/prediction-data.test.ts) FIXED 07b6c1f — classifyCBMI float-rounded (1e-6); what-if walks a profile recomputed at the overridden activity level (below-profile → longer finite ETA); resolveSex trims.
- [x] T5. lib/caloric-engine.ts: calcAge returns negative ages for future birthdays (no clamp); calcIBW has no floor, so heights under ~108 cm yield negative IBW (healthy-band clamp rescues tbwKg downstream); computeAllMetrics reads real Date.now() with no injectable clock. (lib/caloric-engine.test.ts) FIXED b5741d6 — calcAge/calcIBW clamped at 0; computeAllMetrics(input, now?) injectable clock.
- [x] T6. lib/meal-plan.ts:292: when no meal type named "snack" exists, calorie top-up falls back to the last sorted meal type and stamps top-up rows with it (e.g. lunch) — looks semi-intentional, needs a product-level look. (lib/meal-plan.test.ts) FIXED 4e7d531 — product decision 2026-07-20: no snack meal type → skip top-up entirely (never mislabel rows, never fail the build).

Cosmetic / cleanup:

- [x] T7. lib/recipeEmoji.ts: plural "Overnight Oats" never matches the singular-only oat pattern (falls to fallback); sushi pattern includes bare "roll" so "Cinnamon Roll" gets 🍣; standalone "burger" is captured by the earlier beef pattern (🍔 only reachable via "cheeseburger"/"slider"). (lib/recipeEmoji.test.ts) FIXED 5c279ee — oats pluralized, bare 'roll' dropped from sushi, 'burger' moved out of beef pattern.
- [x] T8. lib/onboarding.ts isProfileComplete: weight=0 / height=0 pass the `!= null` presence check and an Invalid Date birthday counts as complete — validation assumed upstream. (lib/onboarding.test.ts) FIXED de14ec1 — zero/negative measurements and Invalid Date rejected; 5ft-0in valid; heightFt must be >0.
- [x] T9. lib/admin-params.ts is only `export { prisma } from "@/lib/db"` — filename suggests param parsing but there is none; likely a leftover/placeholder. FIXED 8c76dc0 — re-export deleted, sole importer redirected to @/lib/db.
- [x] T10. data/dishes.ts: dishes 7 and 10 use emojis 🫙 (jar) and 🫚 (ginger) that don't match "Mediterranean Quinoa Bowl" / "Tuna Nicoise Salad". FIXED 5c279ee — dish 7 → 🥗, dish 10 → 🐟.

Testability refactors (would unlock unit tests for currently DB-bound logic):

- [x] T11. Extract getPredictionProfileInput's post-query normalization (lib/queries.ts:54-77 — goal-weight unit conversion, goal>=weight null-out, unit fallbacks) into a pure function taking the patient row. FIXED 59c966f — pure normalizePredictionPatient in lib/prediction-profile.ts, 14 unit tests.
- [x] T12. lib/meal-plan-runner.ts regeneratePlan: accept prisma (or a repository interface) as a parameter so claim-lock/empty-plan/version-flip ordering becomes testable. FIXED 1f07364 — deps param (prisma+builder) with real defaults; claim-lock/empty-plan/ordering covered, 4 tests.

## Review

- **d06e0d8** day budget cap: worst-case day is now ~105% of target (was ~135%); also fixed calMax-only queries silently dropping their filter. TDD'd via capWindowToDayBudget.
- **b02b055** duplicate-version purge: reproduced with a sentinel row in scripts/verify-meal-plan.ts (239 active vs 238 generated), purge fixes it; all 7 verify checks pass against dev DB.
- **fe77d04** stale detection: height/heightUnit/birthday now flag mealPlanStale like weight/activity/sex.
- **90bc6ed** removed estimateDaysToGoalWeight (unit-mismatched maxDeficit param, unused, diverged from the live estimators).
- **06422d5** adaptive projections: TDEE + severity cap re-derived from simulated weight each day. Reference profile (100→60kg female): ETA ~320d → 580d @ 0.48 kg/wk avg. 11/11 tests, build clean.

## Out of scope (later phases — agreed earlier, unchanged)
- Generator speed-up (single recipe-pool load) — suggestion-only, algorithm must stay unchanged.
- Neon pooled (PgBouncer) connection string; reference-data + recipe-catalog caching.
- Auto-retry on FAILED; stuck-job sweeper cron; Sentry.
- Journal → calendar redesign — its own brainstorm/spec. (DONE 2026-07-25: iOS journal calendar grid cycle, Clara main 8eef7fb.)

# Remaining work (2026-07-27, distilled from .superpowers/sdd/progress.md)

All build cycles through Journal Grid are complete, merged, and pushed; prod is deployed
(migrations applied, routes verified JSON-401). What's left:

## Active

- [ ] Live prod smoke (user, in progress): one interactive sim sign-in, then sweep
      Meal Plan / Supplements / Journal grid / Account stats / chat streaming against
      www.wondish.io.
- [ ] Journal shows "No history yet" despite logged meals (found 2026-07-26 during smoke).
      Root cause: /api/journal/calendar reads only JournalMeal rows, which are created
      solely by the like/dislike rating flow (POST /api/journal/log-meal) and the web
      journal form. Meal Plan "Add to log", Restaurants "Add to today", and Fridge
      "Log it" all write the separate MealLog table, which the journal never reads;
      supplement history likewise only returns days with intake rows. Fix (own mini-cycle):
      in the allMeals=1 iOS mode of /api/journal/calendar, merge MealLog rows
      (deletedAt: null, grouped by localDate) into each day's meals — also unlocks real
      logged-kcal for the day-detail ring (currently target vs plan max).

## Blocked on user decisions

- [ ] Paywall (Cycle 2b): monetization decisions D1-D4 (StoreKit-only? $14.99? 7-day
      trial? quotas) + App Store Connect product setup (D9) + Apple root CA certs.
- [ ] D13: account hard-delete cascades Subscription rows — legal/product sign-off pending.
- [x] Orphaned Account rows when a Clerk user is deleted out-of-band (found 2026-08-08,
      hit live on itsbebox@gmail.com). Account.clerkId still pointed at a deleted Clerk
      user, so `getAccount` (lookup BY clerkId) returned null and the dashboard gate read
      that as "not onboarded" → endless "complete your profile"; saving the profile then
      called getOrCreateAccount, which found the row by email, saw a different clerkId,
      and returned `conflict` → "failed to create account". Two misleading errors, no
      self-service recovery, and a stranded restaurant OWNER row silently leaves a
      restaurant ownerless. Repaired by hand (repointed clerkId to the live Clerk user;
      profile/role/staff row all came back — nothing was recreated).
      Causes: (1) deleting a user in the CLERK DASHBOARD, which bypasses the app's
      cleanup — this is what happened, during testing; (2) a crash between the two
      deletes in DELETE /api/me (Clerk user deleted first by design, then the Account
      row) — narrow window but real in prod; (3) any out-of-band Clerk deletion.
      Proposed fix (cheapest, recommended over a webhook): in resolveAccountClaim's
      `conflict` branch ONLY, check whether the stored clerkId still exists in Clerk —
      if it doesn't, the row is orphaned and a verified-email user may re-claim it.
      Zero cost on the happy path (fires only in an already-failing case), no webhook or
      Clerk config needed, and the takeover guard stays intact (still requires a verified
      email AND a genuinely absent previous owner).
      FIXED 2026-08-14 (fcd97a9, branch feat/restaurants-phase-3-attribution, NOT yet
      merged): resolveAccountClaim takes previousOwnerExists; getOrCreateAccount asks
      Clerk ONLY in the branch that was already going to fail, so a verified email can
      re-claim a row whose Clerk owner is gone. Takeover guard intact (verified email
      AND confirmed-absent owner; any non-404 Clerk error counts as present). 5 unit
      tests. The gotcha below still applies until this merges.
      OPERATIONAL GOTCHA until then: delete accounts through the app, never from the
      Clerk dashboard.
- [ ] Scan tab: real implementation (currently the "coming soon" stub inside Cook).
- [ ] Stockton pilot ingredients are AI-inferred pending ops confirmation (D-INGREDIENTS)
      — confirm/correct real menus before leaning on verdicts publicly.

## Pre-launch gates (not needed for the smoke)

- [ ] Promote Clerk from dev instance (real-mollusk-38, pk_test) to a pk_live production
      instance — dev-instance session churn caused the "login every time" episode.
- [ ] App Store prep: Assets.xcassets / AppIcon (deferred since Cycle 1; build setting
      already expects "AppIcon").
- [ ] Confirm whether scripts/backfill-meal-plan-weight.ts still needs its one-time prod
      run (dev DB done 2026-07-02; prod Neon went live 2026-07-23 — may be moot for
      accounts created after the fix).

## Deferred niceties (accepted, on the record)

- [ ] Journal "today" frozen at VM init — midnight staleness until the hub rebuilds
      (future scenePhase refresh).
- [ ] Session-expiry-while-foregrounded never flips the root gate (pre-existing posture).
- [ ] USD-only price copy convention (revisit before any non-USD market).
