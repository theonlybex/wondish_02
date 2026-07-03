# Logic-engine fixes (ops audit, 2026-07-02)

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

- [ ] C1. ANTHROPIC_API_KEY missing from local .env (only in .env.example) — Clara cannot run in local dev; user adds the key themselves; verify prod host has it set
- [ ] C2. Client sends the canned assistant greeting as messages[0] — API requires first message to be user → 400 on every conversation. Strip greeting client-side (history.slice(1)) or drop leading assistant messages in the route (app/api/dish-checker/route.ts)
- [ ] C3. Route swallows mid-stream API errors: try/finally with no catch closes the stream as if successful → client gets HTTP 200 with empty body. Add catch → controller.error()/friendly message + typed Anthropic error handling (429/529) before streaming
- [ ] C4. Client TextDecoder without { stream: true } — multi-byte chars (Clara's ✅/❌) split across chunks decode as � (components/dish-checker/DishCheckerClient.tsx)
- [ ] C5. History message COUNT unbounded (per-message 4000-char cap only) — cost/abuse vector; cap to last ~20 messages in the route
- [ ] C6. Optional: consider claude-sonnet-5 upgrade (near-Opus, intro pricing through 2026-08); must disable adaptive thinking for chat latency. Defer.

Note: C2+C3 together mean Clara has likely never completed a conversation — the 400 fires on every send and is masked as an empty reply.

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
- Journal → calendar redesign — its own brainstorm/spec.
