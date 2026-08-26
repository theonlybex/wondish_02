# Production Stage — Improvement Tracker

> ⚠️ **STALE — unaudited as of 2026-08-17.** Some items here are already fixed
> (e.g. it claims the engine has no unit tests; `lib/caloric-engine.test.ts` has 92).
> Others are still real (two different lb→kg constants). Do not treat this as a live
> risk list until it has been audited item by item — see `/BACKLOG.md` §7.

Consolidated list of everything surfaced during the algorithm review + load
assessment (June 2026). Grouped by area and ordered by priority. Check items off
as they're done.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## A. Calorie engine — algorithm correctness

The math primitives (Harris-Benedict BMR, Deurenberg body-fat, activity
multipliers, 4/4/9 macro math, 7700 kcal/kg) are all correct. The findings below
are about consistency between the plan builder and the display surfaces, plus
some unguarded edge cases.

Files: `lib/caloric-engine.ts`, `lib/meal-plan.ts`, `lib/prediction-data.ts`,
`app/api/meal-plan/route.ts`, `app/(dashboard)/meal-plan/page.tsx`,
`app/api/journal/calendar/route.ts`.

### Priority 1 — user-visible wrong numbers

- [ ] **Underweight users: displayed calorie target diverges from the actual plan and grows without bound.**
  The plan builder uses the flat weekly surplus (`weeklyDailyCals`,
  `meal-plan.ts:305-307`, +300/week capping at +400) for non-overweight users,
  but all three display surfaces use `gradualDailyCals` for *every* BMI class
  (`app/api/meal-plan/route.ts:45`, `app/(dashboard)/meal-plan/page.tsx:93`,
  `app/api/journal/calendar/route.ts:134`). For underweight, `gradualDailyCals`
  (`caloric-engine.ts:519-521`) adds the cumulative ramp with **no cap**: day 1
  shows TDEE+43 while menus were built for TDEE+300; by day 28 the display says
  TDEE+1300 vs the plan's TDEE+400, climbing ~400 kcal/week forever.
  *Fix direction:* make the display call the same schedule the builder used for
  that BMI class (route display through one shared helper so they can't drift).

### Priority 2 — cheap guards

- [ ] **No guard when goal weight ≥ current weight in the plan builder.**
  `prediction-data.ts:61` returns null in this case, but `buildMealPlanMenus`
  doesn't. An obese user who enters a goal weight above current weight gets
  `maintenanceFloor > TDEE`; the ramp loop never fires and every day is clamped
  to the floor — i.e. fed *above* maintenance for the whole plan.

- [ ] **Fallback `minCal` is wrong for males.** When the caloric profile can't
  compute (`meal-plan.ts:235`), `minCal` is set to 1200 even for males, whose
  spec floor is 1500.

### Priority 3 — needs a product/spec decision

- [ ] **WTBW formula can invert the spec's intent.** `WTBW = IBW × WTBMI / IBMI`
  (`caloric-engine.ts:167`) only lands at the intended target BMI if IBW÷height²
  equals IBMI, but IBW is the Broca formula (cm−105/108) which doesn't track BMI.
  Worst case age ≥ 65: a 150 cm woman at BMI 26 should target BMI 27 (keep/gain),
  but the formula produces 45.4 kg = BMI 20.2 (a large *loss* target — opposite of
  intent). Tall users skew the other way. If this formula is verbatim from the
  Wondish spec, the spec carries the flaw — confirm with spec owner before changing.

- [ ] **No ceiling on the deficit.** The ramp adds 300–400 kcal/day each week,
  stopped only by the goal-weight floor or the 1200/1500 minimum. A high-TDEE
  obese user can reach a 2000+ kcal/day deficit; clinical guidance caps ~500–1000.
  Decide whether to add an absolute daily-deficit cap.

- [ ] **Healthy-BMI users' goal weight is silently ignored.** BMI < 25 → no
  deficit ever applied and prediction returns null, so a BMI-23 user wanting to
  lose 4 kg gets pure maintenance with no explanation. May be by design, but the
  profile UI accepts a goal weight from these users. Decide: honor it, or tell
  the user why it's ignored.

### Priority 4 — hygiene

- [ ] **No unit tests for any of the engine.** It's pure functions — trivial to
  cover, and findings 1–3 above would all have been caught. Add a small test
  suite (note: `npm test` is referenced in CLAUDE.md but no test script exists yet).
- [ ] **Two different lb→kg constants** (0.45359237 in the engine, 0.453592 in
  `prediction-data.ts`). Harmless but unify to one constant.
- [ ] **No input validation in the engine.** Height under 105/108 cm yields a
  *negative* IBW and target weight; it relies entirely on upstream form validation.
- [ ] **TDEE is held fixed at current weight for the whole journey**, so
  day-to-goal estimates run optimistic (real TDEE falls as weight falls). The
  goal-weight floor partially compensates. Internally consistent — documented here
  so it's a known modeling choice, not a surprise.

---

## B. Scaling / load — "would it break at 1000 users?"

Verdict: 1000 registered users on organic usage is fine (Vercel fans out per
request; `DATABASE_URL` is the pooled Neon host; concurrency is safe via the
blue/green swap + claim-lock). The one pressure point is meal-plan generation
under a burst.

- [ ] **Verify production rate limiting is actually live.** Upstash env vars were
  added to Vercel ~June 2, but the redeploy was pending. Env vars only apply on a
  fresh deploy — if no deploy has happened since, prod is still on the ineffective
  in-memory fallback. Check Vercel deploy history; redeploy if needed.

- [ ] **Meal-plan generation is a serial query storm (deferred optimization).**
  `buildMealPlanMenus` issues ~700–2,000 sequential `recipe.findMany` calls per
  generation (~10–30 s each within a 60 s limit). One user is fine; a launch-day
  burst of dozens of simultaneous first-plan generations would slow Neon, cross
  the 60 s ceiling, and pile up FAILED/stuck jobs. Blast radius is contained (old
  plans stay active, users get a retry banner, rest of site is unaffected) — it
  degrades rather than crashes. **Fix with leverage:** load the candidate recipe
  pool once per generation and filter in memory (turns 1,000+ queries into a
  handful). *Previously parked pending explicit OK — do not start without sign-off.*

---

## C. Production-readiness ops items (carried over, user-only)

From the May/June prod-readiness scan. These are manual ops, no code.

- [ ] **Drop 2 orphan tables** in Neon: `npx prisma db push --accept-data-loss`
  (preview MUST be exactly `DROP TABLE PasswordResetToken` + `DROP TABLE
  VerificationToken`, nothing else). Schema already clean; tables still physical.
- [ ] **Add `NEXT_PUBLIC_SENTRY_DSN`** to Vercel (Prod+Preview), then **redeploy**
  (it's a public build-time var). Optional: `SENTRY_ORG`, `SENTRY_PROJECT`,
  `SENTRY_AUTH_TOKEN` for readable stack traces. (Upstash vars already set.)
- [ ] **Remove + rotate stale secrets** from local `.env` and Vercel: the legacy
  NextAuth/JWT/EMAIL/GOOGLE/BEX/WONDISH_PLANNER keys (`.env.example` is the
  authoritative real-key list).

---

## D. CI / GitHub

- [ ] **CI is blocked by a GitHub billing lock** ("account is locked due to a
  billing issue"). The workflow never runs — this is not a code failure. Fix in
  GitHub → Settings → Billing (update payment method or raise spending limit), then
  re-run the workflow. Not urgent (Vercel runs its own build on deploy), but worth
  fixing before the launch-scale work so every push gets a red/green signal.
  Making the repo public would also make Actions minutes free and sidestep this.

---

## Suggested order of work

1. **A-P1** underweight display/plan mismatch (wrong numbers shown to real users).
2. **A-P2** cheap guards (goal ≥ current; male fallback floor).
3. **B** verify rate-limiting redeploy (quick check, possibly already fine).
4. **C** ops items (orphan tables, Sentry DSN + redeploy, rotate secrets).
5. **D** CI billing (5 min, unblocks the safety net).
6. **A-P3** spec decisions (WTBW, deficit cap, healthy-BMI goal) — need sign-off.
7. **A-P4** tests + hygiene.
8. **B** recipe-pool optimization — only on explicit OK, ideally before a launch spike.
