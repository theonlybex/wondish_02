# Logic-Audit Fixes Implementation Plan (2026-07-24)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Critical/Important findings from the 2026-07-24 whole-webapp logic audit, code-only.

**Architecture:** Four waves ordered by risk: (1) allergen-matcher correctness in `lib/diet-match.ts` + fridge scan (shared engine — one fix lands on all six food surfaces), (2) small high-blast security fixes (admin mass-assignment, checkout linkage, coupon hardening), (3) billing/entitlement robustness (webhook mapping, COUPON-source row, delete-cancel, rate-limit policy), (4) perimeter-route correctness (start-date gates, journal, dates, profile validation, seed safety). Every task is TDD against the existing Vitest suite (baseline 529/529).

**Tech Stack:** Next.js App Router, Prisma (client only — see constraints), Vitest, Clerk, Stripe, Upstash.

## Global Constraints

- **NO database contact of any kind**: no `prisma migrate` (not even `diff`), no seed execution, no queries against prod/Neon, no schema.prisma changes (a schema change would desync the generated client from the live DB on deploy). Fixes requiring schema/data changes are listed in **Deferred — needs a DB window** at the bottom.
- **NO key/env changes**: do not create/edit any `.env*`, do not touch Vercel env, do not add `authorizedParties` values (release-gated with the user).
- **Branch `audit-fixes` off `main` (830d921). NEVER merge/push to `main`** — main auto-deploys prod on Vercel. Merge only on explicit user go-ahead.
- Every task: RED test first, then fix, then full `npm test` green + `npm run build` green before commit. One commit per task.
- Repo conventions govern: pure lib logic carries the tests (no route harness); thin routes over lib functions; `rateLimit(name, userId, limit, windowSec)` from `lib/rate-limit.ts`.
- Safety direction rule (standing): when a matcher change is ambiguous, over-blocking is acceptable, under-blocking is not.

---

## Wave 1 — Dietary-safety spine (audit findings 1–5)

### Task 1: Plural-aware allergy stemming (`-ies` / `-oes` / `-ches|-shes|-xes|-zes|-ses`)

**Files:**
- Modify: `lib/diet-match.ts` (buildDietMatchers, ~line 92)
- Test: `lib/diet-match.test.ts`

**Defect:** `replace(/(?<!s)s$/, "")` mis-stems irregular plurals: "Strawberries" → `strawberrie`, so `\bstrawberrie(?:s|es)?\b` never matches "strawberry". Same for Tomatoes, Anchovies. False-pass on every surface.

**Fix:** Introduce a `singularize(name)` helper and build the matcher as a union of `{original, singular(+s|es)}` so both directions always match:

```ts
// lib/diet-match.ts
export function singularize(w: string): string {
  if (/[a-z]ies$/.test(w)) return w.replace(/ies$/, "y");      // strawberries → strawberry
  if (/[a-z]oes$/.test(w)) return w.replace(/oes$/, "o");      // tomatoes → tomato
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.replace(/es$/, ""); // dishes → dish, classes → class
  if (/[^su]s$/.test(w)) return w.replace(/s$/, "");           // peanuts → peanut; keep "hummus", "ss"
  return w;
}
```

Matcher body becomes `(?:${escapeRe(sing)}(?:s|es)?|${escapeRe(lowered)})` where `lowered` is the trimmed lowercase original and `sing = singularize(lowered)` (dedupe when equal). Existing semantics must hold: "peanut" still matches "peanuts"/"peanut butter"; "egg" still does NOT match "eggplant".

- [ ] RED tests: allergy "Strawberries" matches ingredient "strawberry compote"; "Tomatoes" matches "tomato"; "Anchovies" matches "anchovy paste"; regression pins: "peanut"↔"peanuts", "egg" ∤ "eggplant", "hummus" unchanged.
- [ ] Implement `singularize` + matcher union; export `singularize` for Task 2's reuse.
- [ ] Full suite + build green. Commit `fix(diet-match): plural-aware allergy stemming (-ies/-oes/-es classes)`.

### Task 2: Unicode/punctuation-safe boundaries + `/`-split multi-term names

**Files:**
- Modify: `lib/diet-match.ts` (matcher construction), `lib/fridge.ts` (exactPatterns ~186-193), `lib/food-map.ts` (if it builds `\b` patterns — check `collectBannedTerms` consumers)
- Modify: `app/api/admin/banned-ingredients/[entityType]/[id]/route.ts` (write-time normalization)
- Test: `lib/diet-match.test.ts`, `lib/fridge.test.ts`

**Defect:** JS `\b` is ASCII-`\w` based → terms with punctuation or accented edges ("Nuts (tree)", "msg.", "œufs") build unsatisfiable regexes and are silently inert. Multi-word slash names ("Wheat / Gluten") stem as one unmatched phrase.

**Fix:** (a) Central boundary helper in `lib/diet-match.ts`, used by every pattern builder (allergy matchers, fridge exact patterns):

```ts
// Unicode-aware word boundary: \b fails when a term starts/ends with a
// non-ASCII letter or punctuation. Lookarounds on Unicode letters/digits
// behave identically to \b for plain ASCII terms.
export const boundaryPattern = (body: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");
```

(b) In `buildDietMatchers`, before stemming, expand each raw name into terms: split on `/`, strip leading/trailing non-letter/digit chars from each piece, drop pieces < 2 chars. "Wheat / Gluten" → ["wheat", "gluten"]; "Nuts (tree)" → ["nuts (tree)"] (interior punctuation kept — lookaround boundaries make it matchable) **plus** the outer-stripped variant if different. (c) Fridge `applyAllergenFilter` exact patterns switch from `\b…\b` to `boundaryPattern`. (d) Banned-ingredients admin route: trim + collapse inner whitespace + reject names that contain no letter/digit at all (400); keep accepting punctuation since matchers now handle it; reject length-1 names (400) so they aren't silently dropped by the ≥2 filter.

- [ ] RED tests: exact ban "Nuts (tree)" matches text "nuts (tree) mix" in fridge filter; allergy "œufs" matches "œufs brouillés"; allergy "Wheat / Gluten" matches ingredient "Wheat flour wrapper" AND "Bun (gluten)"; regression: "butter" still ∤ "butternut"; escaped specials still safe (existing tests stay green); banned-ingredients route 400s on `"("`, `"x"`, `"  "`.
- [ ] Implement helper + call-site swaps + route validation.
- [ ] Full suite + build green. Commit `fix(diet-match): unicode/punctuation-safe boundaries, slash-split terms, write-time name validation`.

### Task 3: Fridge filter scans `description` (and all model-authored text)

**Files:**
- Modify: `lib/fridge.ts` (`recipeSearchText`, ~175-179)
- Test: `lib/fridge.test.ts`

**Defect:** Only name/usesIngredients/missingIngredients/steps are scanned; model-generated `description` ships unfiltered — "crispy tofu fried in peanut oil" reaches a peanut-allergic user in a 200.

**Fix:** Add `recipe.description` (and `recipe.mealType` if present on `FridgeRecipe`) to `recipeSearchText`'s field list. One-line change plus tests.

- [ ] RED test: recipe whose only allergen mention is in `description` is dropped by `applyAllergenFilter` (both an allergy matcher and an exactBanned phrase variant).
- [ ] Implement; full suite + build green. Commit `fix(fridge): allergen-scan model-generated description`.

### Task 4: Exact-ban phrase matching on DB surfaces (kill the equality under-block)

**Files:**
- Modify: `lib/diet-match.ts` (`evaluateDishAgainstProfile` exact-ban comparison, ~131-135)
- Modify: `lib/meal-plan.ts` (candidate-pool exact-name SQL exclusion → in-memory filter), `app/api/taste/dishes/route.ts`, `app/api/meal-plan/alternatives/route.ts` (same pattern; `swap` inherits via `evaluateDishAgainstProfile`)
- Test: `lib/diet-match.test.ts`, `lib/meal-plan.test.ts`

**Defect:** Exact bans use whole-string equality on ingredient names: condition-ban "sugar" passes ingredient "brown sugar" in meal-plan/taste/alternatives/swap while fridge phrase-blocks it. Under-block on the health-condition source.

**Fix:** (a) `evaluateDishAgainstProfile` compares via `boundaryPattern(escapeRe(banned.name))` against the ingredient name instead of `===` (safety-widening; "sugar" now flags "brown sugar"; per-source attribution unchanged — build the per-ban regex once per call, not per ingredient). (b) Where routes push `name notIn [...]`-style exact exclusions into SQL for candidate pools, widen the pool (drop the exact-name predicate, keep the allergy predicates as-is) and apply the same in-memory `evaluateDishAgainstProfile`-based rejection after fetch — this is the established E2 pattern (wider pool + in-memory filter). Keep existing buffer/candidate headroom; bump fetch counts if attrition tests show starvation. **Verdict semantics on restaurants surface change deliberately** (more cautions/fails) — that is the fix, and the iOS wire contract is shape-stable (no shape change).

- [ ] RED tests: condition-ban "sugar" fails a dish with ingredient "brown sugar" via `evaluateDishAgainstProfile`; foodToAvoid "egg" fails ingredient "eggs" (plural via Task 1 union — exact bans get the same variant treatment ONLY at the boundary-regex level, no stemming of the ban name itself beyond what Task 1 provides to allergy names; pin with a test that "rice" still passes "rice vinegar"? NO — "rice" phrase-matches "rice vinegar" and that is the intended over-block; instead pin "corn" ∤ "acorn squash" as the boundary regression).
- [ ] Meal-plan pool tests: recipe with ingredient "brown sugar" excluded from generated plan for a "sugar"-banned profile; pool-attrition test proving a full plan still assembles from the widened pool fixture.
- [ ] Full suite + build green. Commit `fix(diet-match): word-boundary exact-ban matching on all DB surfaces`.

### Task 5: Allergy synonym data — authored only, NOT executed

**Files:**
- Create: `scripts/seed-allergen-synonyms.ts`
- Modify: `app/api/admin/seed/route.ts` (seed `FoodAllergyBannedIngredient` children alongside the allergies)
- Test: none (data script; validated by tsc + a dry-run mode printing the plan)

**Defect (the Critical):** No `FoodAllergyBannedIngredient` rows exist anywhere, so allergy matching falls back to display names — "Shellfish" passes "Shrimp", "Fish" passes "Tuna", "Tree nuts" passes "Walnuts" on the live prod menus.

**Fix:** Author an idempotent synonym seeder (find-allergy-by-name → createMany children with per-pair existence check, `--dry-run` flag default ON, `--execute` required to write) covering at minimum: Shellfish → shrimp, prawn, crab, lobster, crayfish, scallop, clam, mussel, oyster, squid, calamari, octopus; Fish → tuna, salmon, cod, tilapia, anchovy, sardine, bass, trout, halibut, mackerel, fish sauce, fish broth; Tree nuts → almond, walnut, cashew, pecan, pistachio, hazelnut, macadamia, brazil nut, pine nut, nut butter; Wheat/Gluten → wheat, gluten, flour, bread, breadcrumbs, panko, pasta, noodle (wheat), soy sauce, wrapper, bun, tortilla (flour), seitan; Peanut → peanut, groundnut, peanut oil, peanut butter; Egg → egg, mayonnaise, aioli, meringue; Dairy/Milk → milk, cheese, butter, cream, yogurt, ghee, whey, casein; Soy → soy, soybean, tofu, edamame, soy sauce, miso, tempeh. Mirror the same children into the admin seed route so future seeds are complete. **DO NOT RUN the script — no DB contact. Tell the user it's ready and what `npx tsx scripts/seed-allergen-synonyms.ts --execute` will do when they choose to run it.**

- [ ] Author script + admin-seed additions; `npx tsc --noEmit` green; build green. Commit `feat(seed): allergen synonym children (authored, not executed)`.

---

## Wave 2 — High-blast security fixes (findings 6–8)

### Task 6: Kill mass-assignment in admin bodies (restaurants + recipes + zip-codes)

**Files:**
- Modify: `app/api/admin/restaurants/route.ts` (POST ~44-70), `app/api/admin/restaurants/[id]/route.ts` (PATCH ~22-39), `app/api/admin/recipes/route.ts:42`, `app/api/admin/recipes/[id]/route.ts:18`, `app/api/admin/zip-codes/route.ts:19,30`
- Test: `lib/admin-restaurants.test.ts` (add allowlist unit) — extract a pure `pickRestaurantFields(body)` into `lib/admin-restaurants.ts` so it's testable per repo convention.

**Defect:** `...rest` spread into `prisma.*.create/update` accepts arbitrary Prisma keys including nested relation writes — `{"dishes":{"update":{...,"data":{"status":"PUBLISHED","ingredients":{"deleteMany":{}}}}}}` bypasses the publish gate and its row lock; a zero-ingredient PUBLISHED dish computes `passed: true` for every user.

**Fix:** Replace every spread with an explicit scalar-field allowlist (enumerate from `prisma/schema.prisma` model — e.g. for Restaurant: `description, address, neighborhood, phone, website, hours, ethnicId, imageUrl` — implementer copies the exact scalar list, excluding `id`, `slug` (handled separately), relation keys, timestamps). Unknown keys are silently dropped (matches PATCH-tolerant convention); relation keys can never reach Prisma. Same allowlist pattern for recipes and zip-codes routes.

- [ ] RED test: `pickRestaurantFields({ name:"X", dishes:{create:[...]}, id:"evil" })` returns only allowlisted scalars.
- [ ] Implement across all five handlers; full suite + build green. Commit `fix(admin): field allowlists replace body spreads (publish-gate bypass closed)`.

### Task 7: Checkout account linkage goes through `getOrCreateAccount`

**Files:**
- Modify: `app/api/stripe/checkout/route.ts` (~20-55)
- Test: `lib/auth.test.ts` already covers claim logic; add a pin that the route module imports `getOrCreateAccount` (grep-level assertion in an existing route-convention test if present; otherwise rely on tsc + manual trace, repo precedent)

**Defect:** Bespoke linkage uses first (unverified) Clerk email and re-points `clerkId` with no `clerkId: null` guard → account takeover; `""` email collides.

**Fix:** Delete the bespoke find/update/create block; call `getOrCreateAccount(userId)` (lib/auth.ts — already race-safe, verified-email-only claim, typed conflict) and map `AccountClaimConflictError` → 409 `email_conflict` exactly as `app/api/me/route.ts:12-20` does. Behavior change: an attacker-shaped Clerk user now gets 409 instead of silently capturing the row.

- [ ] Implement; full suite + build green. Commit `fix(checkout): route account linkage through race-safe getOrCreateAccount`.

### Task 8: Harden `/api/coupon/redeem`

**Files:**
- Modify: `app/api/coupon/redeem/route.ts`
- Test: extract redemption core into `lib/coupon.ts` with unit tests (repo thin-route convention) — `redeemCoupon(tx, coupon, accountId)` pure-ish logic + a `classifyCouponFailure()` that always yields one generic message.

**Defect:** No rate limit on an endpoint whose ADMIN coupons mint the permanent SUPER role (brute-force → root); error copy distinguishes invalid/expired/exhausted (enumeration aid); `maxUses` check is read-then-write outside the tx (overshoot race); unguarded `req.json()`; P2002 on double-redeem → 500.

**Fix:** (a) `const { success } = await rateLimit("coupon-redeem", userId, 5, 3600);` → 429. (b) All failure modes (not found / expired / exhausted / wrong state) return the same body: `{ error: "Invalid or unavailable code" }` 404. (c) Atomic cap: inside the tx, `updateMany({ where: { id, OR: [{ maxUses: null }, { usedCount: { lt: maxUses } }] }, data: { usedCount: { increment: 1 } } })`; if `count === 0` throw → generic 404 (no overshoot). (d) Wrap `req.json()` → 400 on parse failure. (e) Catch P2002 from the accountRole/coupon-redemption unique → 409 `{ error: "Already redeemed" }`. **Do not change what ADMIN coupons grant** (product decision — flagged separately to the user).

- [ ] RED tests in `lib/coupon.test.ts`: cap race (two sequential redeems at `usedCount = maxUses - 1` → second fails), generic-message invariance across failure classes.
- [ ] Implement; full suite + build green. Commit `fix(coupon): rate limit, atomic maxUses, generic errors, guarded parse`.

---

## Wave 3 — Billing/entitlement robustness (findings 11–13, 19)

### Task 9: Honest Stripe status mapping + P2025 tolerance + period-end backstop

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`, `lib/auth.ts` (`hasActivePremium`)
- Test: `lib/auth.test.ts`; extract the status map to `lib/stripe.ts` as `mapStripeStatus(s: string): SubscriptionStatus` with unit tests.

**Defect trio:** (1) `checkout.session.completed` maps any non-trialing status to ACTIVE (async-payment-failure → free premium); (2) `unpaid`/`paused`/`incomplete_expired` collapse to INCOMPLETE, which `hasActivePremium` counts as premium → perpetual premium after dunning; (3) `subscription.update` on a cascaded-away row throws P2025 → 500 → 3 days of Stripe retries; no expiry backstop if a webhook is missed.

**Fix:** (a) Shared `mapStripeStatus`: `active→ACTIVE, trialing→TRIALING, past_due→PAST_DUE, unpaid→PAST_DUE, paused→PAST_DUE, canceled→CANCELED, incomplete→INCOMPLETE, incomplete_expired→CANCELED, default→CANCELED` (existing enum only — no schema change; default-CANCELED is the fail-safe direction for entitlement). `checkout.session.completed` uses it too (plan stays PREMIUM; status carries the truth). (b) Every `prisma.subscription.update` in the webhook → `updateMany` (0 rows = tolerated no-op, log once). (c) `hasActivePremium` backstop: for rows with a non-null `stripeCurrentPeriodEnd`, return false when `stripeCurrentPeriodEnd < Date.now() - 24h` regardless of status (24h grace covers renewal-webhook lag; coupon/admin rows have null periodEnd → unaffected). Keep INCOMPLETE-counts-as-premium for fresh checkouts (its documented purpose) — the backstop plus honest mapping bounds the abuse window.

- [ ] RED tests: `mapStripeStatus` table; `hasActivePremium` false for `{plan:PREMIUM,status:ACTIVE,stripeCurrentPeriodEnd: 3 days ago}`, true for null periodEnd, true within grace.
- [ ] Implement; full suite + build green. Commit `fix(stripe): honest status mapping, P2025-tolerant webhook writes, period-end entitlement backstop`.

### Task 10: Coupon premium writes the COUPON-source row

**Files:**
- Modify: `app/api/coupon/redeem/route.ts` (or `lib/coupon.ts` from Task 8)
- Test: `lib/coupon.test.ts`

**Defect:** PREMIUM redemption upserts the STRIPE row and nulls `stripeSubscriptionId` → breaks the delete-time cancel path (billing orphan) and lets any later Stripe webhook clobber coupon premium.

**Fix:** `SubscriptionSource.COUPON` already exists in the enum (verified). Upsert `where: { accountId_source: { accountId, source: "COUPON" } }` with `plan: PREMIUM, status: ACTIVE`; **never touch the STRIPE row**. `accountHasActivePremium` already ORs across rows (verify with a test: account with `STRIPE/FREE` + `COUPON/PREMIUM-ACTIVE` rows → premium). Webhooks key on `accountId_source: STRIPE` so they can no longer clobber coupon grants; `stripeSubscriptionId` survives for deletion-time cancel.

- [ ] RED tests: redemption creates/updates COUPON row, leaves an existing STRIPE row byte-identical; multi-row premium resolution.
- [ ] Implement; full suite + build green. Commit `fix(coupon): premium grants live on the COUPON-source row`.

### Task 11: DELETE /api/me — Stripe cancel becomes blocking

**Files:**
- Modify: `app/api/me/route.ts` (~74-84), `lib/stripe-admin.ts`
- Test: `lib/me.test.ts` (or stripe-admin unit): cancel-failure propagates.

**Defect:** Cancel is best-effort; on Stripe API failure deletion proceeds and cascades away the only copy of `stripeSubscriptionId` → user billed forever with no server-side handle.

**Fix:** If the account has a non-null `stripeSubscriptionId` and the cancel call throws, abort deletion with 502 `{ error: "billing_cancel_failed" }` (client retries later). Null/absent sub id → proceed as today. Clerk-first ordering unchanged.

- [ ] RED test: cancel-throw path returns the error and performs no Clerk/DB deletion (assert via stub call-order).
- [ ] Implement; full suite + build green. Commit `fix(me): abort account deletion when Stripe cancel fails`.

### Task 12: Coherent rate-limit failure policy

**Files:**
- Modify: `lib/rate-limit.ts`
- Test: `lib/rate-limit.test.ts`

**Defect:** Upstash rejection is unhandled → 500s on every gated route (fail-closed-by-crash), while the client library's timeout path fails open — incoherent; missing env silently voids all limits in prod.

**Fix:** (a) try/catch around the limiter call: on error, `console.error("[rate-limit] backend error — failing open", err)` and return `{ success: true }` (pinned policy: availability over enforcement; matches the library's own timeout behavior; freemium economics accept a bounded leak during a Redis outage). (b) When falling back to the in-memory store while `process.env.NODE_ENV === "production"`, log one loud warning per process (`console.warn`, module-level once-flag). No env writes.

- [ ] RED tests: throwing stub limiter → success:true (not a throw); once-per-process warning flag.
- [ ] Implement; full suite + build green. Commit `fix(rate-limit): explicit fail-open policy + loud prod fallback warning`.

---

## Wave 4 — Perimeter correctness (findings 14–19)

### Task 13: `/api/meal-plan/start-date` gets its siblings' gates

**Files:**
- Modify: `app/api/meal-plan/start-date/route.ts`
- Test: none new beyond lib (route-harness absent per repo precedent); the date-validation branch gets a lib-level test if logic is extracted, else inspection at review.

**Defect:** No rate limit, no premium gate, no profileCompleted check, no date validation → free-user paywall bypass + garbage date poisons `mealPlanStatus`.

**Fix:** Mirror `regenerate/route.ts:19-54` exactly: `rateLimit("regenerate", userId, 10, 60)` (same bucket — both trigger the same expensive rebuild), `accountHasActivePremium(account.subscriptions) || isAdmin` → 402, `profileCompleted` → 422, and `const start = new Date(startDate); if (Number.isNaN(start.getTime())) → 400 { error: "Invalid startDate" }` before `setHours`.

- [ ] Implement; full suite + build green. Commit `fix(meal-plan): start-date route gains regenerate's gate set`.

### Task 14: Journal writes stop destroying ratings; validate inputs

**Files:**
- Modify: `app/api/journal/route.ts` (POST), `app/api/journal/log-meal/route.ts`
- Test: extract validation to `lib/journal.ts` (`validateJournalPayload`) with unit tests, per thin-route convention.

**Defect:** The tx unconditionally `deleteMany`s the day's JournalMeals and recreates only `if (meals?.length)` → mood/weight-only save wipes log-meal ratings. Plus: garbage `date` → 500, NaN/negative `weight` stored (and synced into patient BMI), `rating` unvalidated.

**Fix:** (a) Only touch JournalMeals when the client sent the key: `if (meals !== undefined) { deleteMany; if (meals.length) createMany; }` — omitted `meals` preserves existing rows; explicit `meals: []` still clears (intentional). (b) `validateJournalPayload`: `date` must parse via the local-date pattern (400 otherwise); `weight` if present must be finite and in (0, 1500) → else 400; `rating` if present must be an integer 1–5 → else 400; `mealType` non-empty string. log-meal route gets the same date guard and rating rule.

- [ ] RED tests: payload with `meals: undefined` → meal-preserving branch (unit on the extracted decision fn: `shouldReplaceMeals(body) === false`); validation table.
- [ ] Implement; full suite + build green. Commit `fix(journal): meals-key-aware replacement + input validation`.

### Task 15: Local-date parsing for `/api/journey`, `/api/grocery-list`, `/api/provider/meal-plans`

**Files:**
- Modify: `app/api/journey/route.ts:19-20`, `app/api/grocery-list/route.ts:17-18`, `app/api/provider/meal-plans/route.ts:15`
- Test: existing local-date helpers already tested; add range-edge test in `lib/journey-data.test.ts` if a helper is added there.

**Defect:** `new Date("YYYY-MM-DD")` UTC-parses then local `setHours` shifts the window a day on negative-offset servers — the exact bug already fixed in journal routes.

**Fix:** Reuse the repo's existing local-date helper (`parseLocalDateOnly` pattern at `app/api/journal/route.ts:18-23` / `lib/local-date.ts`) in all three routes; invalid input → 400 (not NaN-date → Prisma 500). Journey's no-param default (`new Date()`) stays as-is (server-clock default is accepted).

- [ ] Implement; full suite + build green. Commit `fix(dates): local-date parsing on journey/grocery-list/provider windows`.

### Task 16: Profile numeric validation + goalWeight staleness + gender-fallback parity

**Files:**
- Modify: `app/api/patient/profile/route.ts` (~107-197), `app/api/patient/caloric-profile/route.ts` (~39-51), `lib/prediction-data.ts` (~45-50), `app/(dashboard)/meal-plan/page.tsx` (~73-74), `lib/meal-plan.ts` (export the sex-resolution helper, ~29-37)
- Test: `lib/meal-plan.test.ts` (exported resolver), route-level validation via extracted `lib/profile-validation.ts` unit tests.

**Defect:** Negative/NaN weight/height accepted (NaN → engine NaN → misleading EmptyPlanError; negative height → wrong-but-plausible BMR); `goalWeight` changes never mark the plan stale despite driving ramp direction; the gender fallback (`sexAtBirth || gender.name`) exists in the plan path but not caloric-profile (422s), prediction (vanishes), or the meal-plan SSR page.

**Fix:** (a) `lib/profile-validation.ts`: each of `weight, height, heightFt, heightIn, goalWeight` if present must be finite and > 0 (with sane caps: weight < 1500 lb, height < 300 cm / ft ≤ 9 / in < 12) → 400 listing the offending field; NaN from `parseFloat` rejected. (b) Add `goalWeight` to `mealPlanFieldsChanged` (~line 187), and fix the omitted-field comparison so `undefined` (omitted) never counts as a change. (c) Export `resolveSexForCalcs(patient)` from `lib/meal-plan.ts` and use it in caloric-profile route, `lib/prediction-data.ts`, and the SSR page — the 422 fires only when BOTH sexAtBirth and gender are absent.

- [ ] RED tests: validation table incl. `"abc"`, `"-170"`, `0`; `mealPlanFieldsChanged` true on goalWeight change, false on omission; resolver parity table (sexAtBirth only / gender only / both / neither).
- [ ] Implement; full suite + build green. Commit `fix(profile): numeric validation, goalWeight staleness, gender-fallback parity`.

### Task 17: Seed safety — idempotent + non-destructive (authored only)

**Files:**
- Modify: `app/api/admin/seed/route.ts` (~363-366), `scripts/seed-restaurants.ts` (~824-880)
- Test: tsc/build only (scripts run against DBs we are not touching).

**Defect:** Admin seed duplicates 20 recipes per run (`skipDuplicates` no-ops without a unique); restaurant seed on re-run force-publishes archived restaurants, wipes admin menu edits via deleteMany+recreate, severs MealLog provenance (SetNull), and has a mid-run empty-menu window.

**Fix:** (a) Admin seed: fetch existing recipe names first, `createMany` only the missing ones. (b) `seed-restaurants.ts`: restaurant upsert sets `status: "PUBLISHED"` only in `create` (never overrides an admin's status on update); replace deleteMany+recreate with per-dish reconcile — match existing dish by `(restaurantId, section, name)`, update matched, create missing, **never delete** unmatched (preserves admin additions and MealLog provenance); wrap each restaurant's reconcile in a `$transaction`. Header comment updated to describe the reconcile semantics. **DO NOT RUN either seed.**

- [ ] Implement; `npx tsc --noEmit` + build green. Commit `fix(seed): idempotent recipes, non-destructive restaurant reconcile (authored, not executed)`.

### Task 18: Minor-batch (cheap, high-value)

**Files:** as listed per item.
**Scope (each a small commit or one batched commit, TDD where lib-level):**
- `app/api/fridge/route.ts`: move the patient-profile 404 BEFORE the daily-credit charge (burst → validate → profile → premium → daily-credit → model) so missing-profile requests stop burning quota. Pin with an ordering comment; daily-charge-before-model stays (anti-race, correct).
- `app/api/meal-plan/[menuId]/swap/route.ts`: guard `req.json()` (400), require `recipeId` string (400), add `isPublic: true` to the recipe fetch.
- `app/api/taste/swipe/route.ts`: validate `liked` boolean + `recipeId` string (400); FK-miss → 404 not 500.
- `lib/admin.ts:24`: 500 bodies become generic `{ error: "Internal error" }`; full error server-logged.
- `lib/meal-log.ts`: cap `note` at 2000 chars and `clientRequestId` at 128 (400 beyond), matching the 120-name precedent.
- `lib/restaurants.ts:88-93`: `?limit=` empty/whitespace string falls back to DEFAULT_LIMIT (treat `Number("")===0` sentinel as absent).
- `app/api/orders/route.ts:14-15`: NaN/negative `page`/`limit` → clamped defaults, never Prisma.
- `middleware.ts`: add `/api/set-locale` to the public-route list (locale switching for signed-out visitors; the route itself only sets a cookie).
- `app/api/taste/set-cookie/route.ts`: constrain `next` to same-origin relative paths (`next.startsWith("/") && !next.startsWith("//")`, else `/`).
- `lib/auth.ts:153`: auto-created accounts set `agreedTerms: false` (record only real consent).
- [ ] Implement batch; full suite + build green. Commit(s) `fix(perimeter): minor-batch hardening from logic audit`.

---

## Deferred — needs a DB window (user-scheduled; NOT in this plan's scope)

1. **Run `scripts/seed-allergen-synonyms.ts --execute`** (Task 5 output) against prod — until then, prod allergy verdicts on name-only allergies remain wrong. Highest-priority DB action.
2. **`@@unique([patientId, date])` on JournalEntry** + route upsert refactor (schema change + migration + code must land together with a deploy+migrate window).
3. **Webhook `event.created` ordering guard** (needs a `lastEventAt` column on Subscription).
4. **Journal duplicate-day cleanup** (data dedupe before the unique constraint can apply).

## Deferred — product decisions (user)

- **ADMIN coupons granting permanent SUPER**: keep (now rate-limited + generic errors per Task 8) or replace with explicit admin provisioning?
- **Provider routes tenant scoping**: needs a provider-role/company model; today they are admin-only tools exposing all patients. Scope by `companyId`?
- **Clerk `authorizedParties`**: release-gated with deploy work (explicitly out of scope per no-keys constraint).
- **Upload magic-byte sniffing**: worth a small lib if user uploads open to non-admins broadly.

## Execution order & verification

Wave order is dependency-aware: Task 1 → 2 → 3 → 4 (each builds on the matcher helpers), Task 8 → 10 (coupon lib), rest independent. After each wave: full `npm test` + `npm run build`; after Wave 1 additionally re-run the fridge/diet-match suites in isolation. Final gate: whole-branch review (repo convention) before asking the user about merging — **merge to main = prod deploy, user-authorized only**.
