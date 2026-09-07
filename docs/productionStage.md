# Production Stage — path to full production

> **Rewritten 2026-09-06** after a full platform audit (five parallel code audits over all
> 87 API routes, lib/, and the frontend, plus item-by-item verification of the old version
> of this file). The complete verified bug list with file:line evidence lives in
> **`docs/bug-audit-2026-09-05.md`** — this file holds the production gaps and the fix plan.
> Of the old tracker's 16 items, **10 were already fixed**, 3 remain (folded in below),
> 3 are unverifiable-from-code ops items (§4).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## 1. Production blockers (not bugs — platform state)

- [ ] **Promote Clerk to a production instance.** www.wondish.io currently serves the
      `pk_test` dev instance (`real-mollusk-38.clerk.accounts.dev`) — verified live in the
      served HTML. Dev instances churn sessions ("login every time"), have lower limits, and
      run on clerk.accounts.dev. Create the `pk_live` instance on the real domain, re-add the
      `io.wondish.clara` azp allowlist, update Vercel env + Clara iOS configs.
- [ ] **Stripe is on test keys** (local certain; prod unverified — Vercel CLI token invalid,
      run `vercel login` to audit). Going live is blocked on the paywall decisions (§5) anyway.
- [ ] **Live prod smoke** — one interactive sign-in, then Meal Plan / Supplements / Journal
      grid / Account stats / chat streaming against www.wondish.io. Includes the still-pending
      **live sign-up test through `/r/claim`** (every new account routes through it; cannot be
      exercised locally).
- [ ] **Stockton pilot ingredients are AI-inferred** — must be human-confirmed before the
      restaurant verdicts can be trusted publicly (ops, not code).
- [ ] Anthropic key live-model check at release gate (local keys are placeholders by design).

## 2. Bug-fix plan — execute in order, one bug = one commit

Gate after **every** commit: `npm test` (1001 green) + `npx tsc --noEmit`; full
`npm run build` + Vercel preview deploy at each phase boundary. Local rendering is broken
(invalid Clerk key) — visual verification happens on preview deploys only.
Bug IDs reference `docs/bug-audit-2026-09-05.md`.

### Phase 0 — reset + make the gates trustworthy
- [ ] `git restore .` — drop the 39 half-edited files left by the aborted 2026-09-05 fix pass.
- [ ] Branch `fix/bug-audit`; nothing lands on `main` until its phase is verified.
- [ ] tsconfig `"target": "ES2017"` + delete `tsconfig.tsbuildinfo` (L24). Verified: takes tsc
      from 19 ignored errors to zero, making the typechecker a real gate for everything after.

### Phase 1 — API hardening (500→4xx conversions and gate-tightening only; no success-path changes)
- [ ] L1 `GET /api/admin/terms` + `requireAdmin()`
- [ ] L2 guard `req.json()` in meal-plan POST → 400 · L3 add its missing `rateLimit("regenerate")`
- [ ] M4 `taste/seen` null-check → 404
- [ ] M2 meal-log `recipeId` validation (MANUAL/PICTURE/FRIDGE/CLARA) — test-first in
      `lib/meal-log.ts` · L4 add the `isPublic` gate to RECIPE lookups
- [ ] L6 range caps on `supplements/history` + `journey` (reuse `validateRange`)
- [ ] M3 exchange "eat" → Serializable transaction (copy "resolve"'s pattern in the same file)

### Phase 2 — frontend error/race fixes (additive UI states; `next lint --file` each)
- [ ] Standalone components first (no ripple): DishTinder (M8, M9), JourneyDashboard (M13),
      GroceryListView (L15), AcceptInviteClient (M14), PortalDishForm (L13),
      PendingInviteBanner (L14), admin pages (M15, L22, L23)
- [ ] Request-race guards, one shared pattern (sequence-ref or AbortController):
      DailyMealPlanView navigate/setStartDate/rate (M11, M12, L11), WeeklyMealPlanGrid (L12),
      SwapMealModal (L10), IngredientPicker (L18)
- [ ] Date fixes: frozen-today cards (M7), DashboardHeader hydration (L19), server-TZ pages via
      the sanctioned client-snap pattern from DailyMealPlanView (L20)
- [ ] Navbar anchors on non-home pages (L21) · ProfileForm ft/in preview (L16) ·
      OrdersTable stat (L17)
- [ ] **Checkpoint:** build + preview deploy, click through dashboard / meal-plan / taste /
      journal / admin. Merge phases 1–2 to `main`, deploy — the safe ~30 items reach
      production before any behavior change is attempted.

### Phase 3 — logic changes, test-first, strictly one at a time
- [ ] L7 unify lb→kg constant · L8 journey DST denominator · L9 `computeWeeklyTarget` round-vs-floor
- [ ] M5 grocery aggregation keyed by ingredient+unit (check GroceryListView row keys too)
- [ ] M6 diet-match: apply `expandBanName` to exactBanned — riskiest small change (can shrink
      meal-plan pools); write "Wheat / Gluten" tests first, then spot-check pool sizes
- [ ] **H1 caution verdict**: `caution: false` → real boolean; empty/unverified ingredient list ⇒
      caution, never fits; exclude caution from "N of M fit"; update pinned tests; verify the
      third UI state on preview. Wire-compatible for iOS (field already exists). Gates public
      promotion of `/restaurants`.

### Phase 4 — journal MealLog merge (its own mini-release)
- [ ] H2/H2b/H2c: merge `MealLog` into the calendar (key by `localDate` string, name snapshot,
      rating null, dedupe vs JournalMeal), relax the 404-when-no-plan, extend the day-walk to
      `max(planEnd, today)`. Strictly additive response shape (iOS `allMeals=1` unchanged).
      Fix the dead journal CTA (M10) in the same release. Verify against real account data on
      the preview URL before promoting.

### Phase 5 — invite-email verification (H3)
- [ ] Enforce verified email in the acceptance path (mirror `resolveAccountClaim`); check the
      Clerk dashboard verify-at-sign-up setting to grade urgency; one live invite-flow test
      after deploy.

### Phase 6 — parked on decisions (do not code until decided — see §5)

### Phase 7 — release close-out
- [ ] cycle.md checklist (migrate status, env vars, azp allowlist, JSON-401 probes, simulator sign-in)
- [ ] Live sign-up test through `/r/claim` (also listed in §1)
- [ ] Confirm whether `scripts/backfill-meal-plan-weight.ts` still needs its one-time prod run

## 3. Keys & secrets hygiene (parked, from the 2026-09-05 key audit)

- [x] Verified: no `.env` ever committed; `.env.example` placeholders only; zero hardcoded keys
      in source.
- [ ] Remove + rotate legacy secrets from local `.env` (and Vercel if present): NextAuth/JWT,
      Gmail `EMAIL_*`, `GOOGLE_CLOUD_API_KEY` / search-engine id, `BEX_CLAUDE_PORTFOLIO_API_KEY`,
      atuvera AWS pair. Nothing in code reads the NextAuth/JWT/EMAIL vars.
- [ ] After `vercel login`: audit prod env for remaining test-stage server-side values
      (Stripe secret, webhook secret, Anthropic key).

## 4. Ops items not verifiable from code (carried over)

- [ ] `NEXT_PUBLIC_SENTRY_DSN` in Vercel (Prod+Preview) + redeploy — code is wired and no-ops
      without it. Optional: `SENTRY_ORG/PROJECT/AUTH_TOKEN`.
- [ ] Confirm Upstash rate-limit vars took effect in prod (near-certain: multiple deploys since
      2026-07-23; code path correct either way).
- [ ] GitHub Actions billing lock — CI never runs; fix in GitHub → Billing (Vercel builds cover
      deploys meanwhile).

## 5. Blocked on business/spec decisions (owner: Becks)

- [ ] **M1** — `JournalEntry` duplicates: requires a prod **dedupe backfill script first**, then
      the `@@unique([patientId, date])` migration on the shared Neon DB. Wrong order breaks the
      migration mid-flight.
- [ ] **M16 / WTBW formula** — inverts spec intent for elderly/no-goal profiles
      (`caloric-engine.ts:188`); changing it changes real users' calorie targets. Spec-owner call.
- [ ] **L5** — Stripe webhook claim-timing: claim-before-process can drop a crashed event for
      24 h; moving the claim risks double-processing. Pick a side.
- [ ] Paywall D1–D4 (+ App Store Connect D9), sign-up-discount Q1–Q4, D13 hard-delete sign-off —
      unchanged from `BACKLOG.md` §5.

## 6. On the record, not scheduled

- Latent kg-storage hazard: `mealPlanWeight` written raw, read with hard-coded lbs conversion —
  corrupts by 2.2× if kg storage ever ships (`lib/meal-plan.ts:492` / `lib/meal-log.ts:735`).
- Per-meal macro rounding can drift ±2 kcal from day totals (cosmetic).
- 3 marketing TODOs (Hero badge copy, one "Learn more" `href="#"`, unconnected food form).
- Dead code: `components/journal/JournalForm.tsx`, `MealRatingCard.tsx` (unimported).
- `scans` has rate-limit-not-dedup (L26) · `/r/claim` lacks `maxDuration` (L25) — small,
  slot into Phase 1 if desired.
- USD-only price copy convention — revisit before any non-USD market.
