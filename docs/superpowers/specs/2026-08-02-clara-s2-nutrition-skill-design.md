# Clara S2 — Nutrition & Targets Skill (design)

**Status: user-approved 2026-08-02** (tool set, empty-day semantics, cross-skill fix).
Second skill cycle on the C0 runtime; program spec:
`docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md` (§3 S2).
Wave order holds — S1 went live 2026-08-01, far below the §8 Q12 re-rank threshold
(≥14 days live and ≥20 distinct users), so demand data cannot override yet.

## Goal

Clara can interpret intake against the user's goals, read-only, on both surfaces:

- "How many calories do I have left?" → real target − real totals, same numbers as
  the dashboard.
- "Did I go over yesterday?" → any-day envelope, not just today.
- "Am I hitting my protein this week?" → range adherence honest about unlogged days.
- "What are my targets and why?" → the current daily targets plus their basis.

This is the cycle that makes S1 conversational ("that ramen leaves you 480 kcal") and
retires the `gap_report(NUTRITION)` workaround S1 shipped for "calories left" asks.

## Resolved decisions (user, 2026-08-02)

1. **Tool set: 3 tools, day generalized.** The program sketch's `nutrition_remaining_today`
   becomes `nutrition_day(date?)` — `getDayEnvelope` works for any date and "did I go
   over yesterday" must not fall through to gap_report.
2. **Empty days: excluded from averages, but reported.** Range averages/adherence are
   computed over logged days only; `daysInRange` vs `daysLogged` and per-day rows let
   Clara say "across the 5 days you logged … 2 days had no logs". Counting unlogged
   days as zero would read as "you undereat" — misleading-advice territory.
3. **Cross-skill fix via the tie-breaker table.** S1's logs fragment sentence steering
   "calories left" to gap_report is deleted; the tie-breaker "calories LEFT" row in
   `registry.ts` becomes nutrition-aware. Rule-8 amendment recorded below.

## The skill

One file `lib/clara/skills/nutrition.ts` + one `ALL_SKILLS` entry, per the C0 contract.
**Read-only**: no confirm protocol, no write rate cap, no migration, no premium gate
(the route-level freemium chat quota already applies). Skill name / `CLARA_SKILLS`
token: `nutrition`.

All target/remaining logic reuses `lib/meal-log.ts` (`getDayEnvelope`, `getDayTarget`,
`computeRemaining`) and `lib/macros.ts` (`sumMealLogs`); the skill contains **no
nutrition math of its own** — a duplicated formula is a review failure (program §1).
Handlers follow the `makeLogsHandlers(deps)` factory pattern (`NutritionDeps`:
`getEnvelope`, `getTarget`, `findSlimRows`) so every path unit-tests without a DB.

### Tools (3)

| Tool | Contract |
|---|---|
| `nutrition_day` | Input: `date` ("YYYY-MM-DD", defaults `ctx.today`; `parseLocalDateStrict`). Returns `getDayEnvelope` verbatim — `dayTotals` (incl. fiber + `incomplete`), `dayTarget` (nullable `DailyTargets`: calories/protein/carbs/fat + `basis`), `remaining` (nullable, signed) — plus the echoed `date` (the S1 lesson: echoing resolved dates is how users catch a bad date assumption). Plan-ramp aware, so the numbers match the dashboard for the same day byte-for-byte. `dayTarget: null` (incomplete caloric profile) is `ok:true` with a narratable note, never an error. |
| `nutrition_range_summary` | Inputs: `fromDate`/`toDate` (required, validated like `logs_search`: strict format, from ≤ to, NaN-safe gap check, **capped at 31 days**). Returns per-day rows `{date, totals, incomplete}` for **logged days only**, `daysInRange`, `daysLogged`, server-computed `avgPerLoggedDay`, one steady-state `target` (`getDayTarget(…, usePlanRamp=false)` — the Stats precedent for multi-day reads), and `avgRemaining` = target − average (null when target is null). Per-day totals via `sumMealLogs` per `localDate` group over slim rows — canonical rounding, no drift from the dashboard (the S1 Critical lesson). Empty range result is `ok:true` with `daysLogged: 0`. |
| `nutrition_targets` | No inputs. Returns today's `DailyTargets` (plan-ramp aware): calories, protein/carbs/fat grams, `basis` ("plan-ramp" vs "steady-state"), macro-profile name — so Clara can explain *what* the targets are and *where they come from*. Null target → `ok:true` with `target: null` + "profile incomplete — finish setup in the app" note. Deeper "why is my TDEE X" explanation is Clara's general knowledge over these numbers, not more tool surface. |

**Boundaries.** The 31-day cap is deliberate scope: multi-month questions are trend
analysis and belong to S11 Progress — those asks file `gap_report(PROGRESS)`. Targets
carry no fiber (engine limitation): `dayTotals` includes fiber, `remaining` does not;
descriptions and fragment say so, so Clara never invents a fiber target.
`nutrition_update`-style writes (changing targets/goals) are excluded by program §7
(Body & goals writes) — refuse and hand off to the app.

### Recognition (spec §4 obligations)

- **Domain boundary in descriptions:** `logs_*` owns "what/how much did I *eat*";
  `nutrition_*` owns anything involving *targets, remaining, left, enough, hitting,
  over/under*. `nutrition_day` says explicitly it is NOT for listing what was eaten
  (`logs_day_summary` does that) — S1's fixture must not regress.
- **Tie-breaker "calories LEFT" row becomes nutrition-aware** (3 states): nutrition
  active → `nutrition_*` tools; logs-only → S1's current text (totals +
  gap_report NUTRITION); neither → plain gap_report. Same dark-launch discipline as
  S1 amendment 6 — a row must never name tools that are not in the request.
- **Logs fragment trimmed:** the sentence "It has no goals or targets: … call
  gap_report (category NUTRITION) because the remaining/target part is not available
  yet" leaves `logs.ts` — with nutrition active it is false and steers Clara away
  from the new tools. The "calories left" ownership now lives solely in the
  (conditional) tie-breaker table.
- **Nutrition prompt fragment:** when to use which of the three tools; "never compute
  remaining by mental math over logs results — nutrition_day returns it"; the fiber
  caveat; refusal edge for goal/target *changes* (hand off to the app).
- **Routing fixture: +10–15 utterances**, including the adversarial neighbours:
  "how much protein have I had today" must stay `logs_day_summary`; "how much protein
  do I have *left*" → `nutrition_day`; "do I have room for a burger tonight" →
  `nutrition_day`; "am I hitting my protein this week" → `nutrition_range_summary`;
  "what are my macros supposed to be" → `nutrition_targets`; "am I on track for my
  goal weight" → `gap_report(PROGRESS)`; "change my calorie target" →
  `gap_report(BODY_GOALS)` / refusal. Audit re-runs the WHOLE accumulated fixture;
  ≥90% top-1 or Critical.
- `CATEGORY_TO_SKILL` gains `NUTRITION: "nutrition"` so FLAGGED_OFF detection works
  for this skill (C0 post-merge ticket 5, this skill's row).
- S1 fixture rows expecting `gap_report(NUTRITION)` for "calories left"-type asks
  **flip to expecting `nutrition_*` tools** — the ledger stops recording NUTRITION
  as a gap because it no longer is one.

### Round budget

Every S2 ask is 1 tool round + answer — comfortably inside the 2-round free budget.
Nothing in S2 needs multi-round tool use.

## Rule-8 amendment (program §6.8) — cross-skill touches, recorded

S2 edits, beyond its own file + registry line + tests:

1. `lib/clara/skills/logs.ts` — **delete one sentence** from `promptFragment` (the
   stale gap_report(NUTRITION) instruction). No handler, tool, or schema change.
2. `lib/clara/registry.ts` — the tie-breaker "calories LEFT" row branches on
   nutrition's active state (the table lives in the registry by S1 precedent; this is
   maintenance of shared C0 surface, not loop surgery).
3. `lib/clara/gap.ts` — one `CATEGORY_TO_SKILL` entry (mandated per-cycle by C0
   ticket 5).

`lib/clara/loop.ts` is untouched.

## Surface impact

**None — explicit no-client-change declaration (program §1).** Both clients already
send `clientDate`/`tzOffsetMinutes` (web since C0, iOS since S1); tool output reaches
users as prose in the existing stream. No new DTOs, no badges, no iOS work this cycle.
The Clara iOS repo is not touched.

## Out of scope (S2)

Goal/target writes (post-S6 per program §7) · fiber targets (engine has none) ·
multi-month trends & predictions (S11) · "what should dinner look like to stay on
target" beyond remaining-macros prose (meal *suggestions* from remaining budget are
Clara's general knowledge, fine — plan manipulation is S3) · any plan reads (S3).

## Error taxonomy (typed `ToolResult`, C0 contract)

`INVALID_INPUT` (bad date format, from > to) · `OUT_OF_RANGE` (range > 31 days,
message says the cap and suggests narrowing) · `FAILED` (unexpected; logged
server-side, narratable). Incomplete caloric profile is **not** an error anywhere —
it is `ok:true` with null target and a note, because "finish your profile" is an
answer, not a failure.

## Testing

- Handler unit tests via injected deps: day envelope pass-through + date default/echo;
  range grouping (multi-row days, `incomplete` propagation, rounding vs a hand-summed
  fixture), empty-day exclusion + counts, cap enforcement incl. the NaN guard;
  targets null-profile path; every `ok:false` edge.
- Tool-schema contract test (three defs; names, required fields, no identity params).
- Loop-integration cases on the C0 stub: "calories left" → `nutrition_day` →
  narrated answer, single round; null-target narration.
- Registry tests: flag off (`CLARA_SKILLS="profile,logs"`) hides the tools AND the
  tie-breaker row falls back to S1 text; logs-off/nutrition-on combination emits a
  coherent table.
- Routing eval at audit over the whole fixture (real key — release-gate machine);
  score to the ledger.
- No migration, no iOS suite this cycle (no surface change).

## Process

Per cycle.md: this spec → plan doc `docs/superpowers/plans/2026-08-02-clara-s2-nutrition.md`
→ engine tasks (wondish_02 only, branch `cycle-clara-s2-nutrition`) → per-task reviews →
final review → audit → merge. Post-merge: watch `/admin/clara-gaps` — NUTRITION rows
should collapse to ~zero; if they don't, recognition is failing in production.
