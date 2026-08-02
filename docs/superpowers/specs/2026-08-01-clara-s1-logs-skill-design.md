# Clara S1 — Logs Skill (design)

**Status: user-approved 2026-08-01** (Q3 decision + design sections). First skill cycle
on the C0 runtime; program spec:
`docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md` (§3 S1).
Wave order holds — the gap ledger is hours old, far below the §8 Q12 re-rank threshold.

## Goal

Clara can read and write the user's meal-log (intake) history from chat, on both
surfaces, through the C0 skill runtime:

- "What did I eat two weeks ago?" → searches `MealLog` rows and answers.
- "How much protein have I had today?" → day summary with real totals.
- "Log that ramen for lunch" → conversational confirm → a `CLARA` row.
- "Delete the snack I logged twice" → search, confirm, tombstone.

## Resolved: Q3 — the Clara-logged write shape (user decision 2026-08-01)

**New `MealLogSource` value `CLARA`** (additive migration), registered as a
caller-supplied-macro source. **Clara's stated estimate is the stored snapshot**: the
numbers she says in the confirm sentence ("That's about 550 kcal — want me to log it?")
are exactly what `logs_create` writes; absent macros store NULL + `incomplete: true`,
identical to MANUAL semantics. Never recomputed. Provenance is clean: journal surfaces
can badge Clara-logged rows, analytics can measure the skill, and a bad estimate is
traceable to its source.

## The skill

One file `lib/clara/skills/logs.ts` + one `ALL_SKILLS` entry, per the C0 contract.
All validation and write logic reuses `lib/meal-log.ts` (`parseMealLogInput`,
`buildMealLogCreateData`, `serializeMealLog`, `MAX_*` bounds); the skill contains **no
macro logic of its own**. Handlers follow the `gap.ts` factory pattern
(`makeLogsHandlers(deps)`) so every effect is injectable and tested.

### Tools (4 — `logs_update` deliberately deferred)

| Tool | Contract |
|---|---|
| `logs_search` | Inputs: `fromDate`/`toDate` ("YYYY-MM-DD", resolved by Clara against the prompt date; validated `parseLocalDateStrict`; range capped at 90 days), optional `text` (case-insensitive match on `name`, bounded length), optional `mealType`. Returns ≤50 serialized rows (existing `serializeMealLog` DTO shape), soft-deleted rows excluded, plus a `truncated` flag. Empty result is `ok:true` with an empty list — "nothing found" is an answer, not an error. |
| `logs_day_summary` | Input: `date` (defaults to `ctx.today`). Returns the day's non-deleted items + summed totals (calories/protein/carbs/fat/fiber, `incompleteCount`). **Totals only — no targets, no "remaining".** Interpreting against goals is S2's boundary; keeping it out of S1 is what makes S2 a cheap read-only cycle. |
| `logs_create` ✍️ | Behind conversational confirm (C0 rule 6: never on the turn the meal is first mentioned). Inputs: `name`, `mealType`, `date`, `servings`, optional per-serving `calories/protein/carbs/fat/fiber` (Clara's stated estimate), optional `note`. Server clamps via the existing bounds; source is forced `CLARA` server-side (not a tool input). Idempotency: `clientRequestId = "clara:" + toolUseId` — a retried round cannot double-log. |
| `logs_delete` ✍️ | Behind confirm. Input: `logId` — which Clara can only have obtained from a prior `logs_search`/`logs_day_summary` in the same conversation. Handler verifies the row belongs to `ctx.patientId` and is not already deleted; soft-delete (`deletedAt` tombstone, the existing cross-device-sync convention). When the user's description matches several rows, Clara returns to them with the list — `AMBIGUOUS` is a question, never a guess. |

**`logs_update` deferred (recorded, not forgotten):** "change that to 2 servings" needs
fuzzy row-resolution machinery create/delete don't; it was not in the approved v1 scope;
`gap_report` (LOGS) measures real demand for it.

### Recognition (spec §4 obligations)

- **The cross-skill tie-breaker table enters `buildSystemPrompt` this cycle** — the first
  with two confusable domains. Minimum rows: intake questions → `logs_*`; "what's
  for dinner / planned" → NOT logs (gap_report MEAL_PLAN); mood/energy/weight → NOT logs
  (gap_report JOURNAL); "calories left / targets" → NOT logs in S1 (gap_report
  NUTRITION); dish-check questions → no tool.
- Tool descriptions state what each tool is NOT for (search vs summary; logged vs
  planned).
- **~15 routing-fixture utterances** appended, including the adversarial neighbours
  ("what did I eat Tuesday" must not route to journal; "what's for dinner tomorrow"
  must not route to `logs_search`). Audit re-runs the WHOLE accumulated fixture;
  ≥90% top-1 or Critical.
- `CATEGORY_TO_SKILL` gains `LOGS: "logs"` so FLAGGED_OFF detection works for this skill.
- C0's fixture rows expecting `gap_report` for logs asks ("what did I eat two weeks
  ago?", "log that ramen for lunch") **flip to expecting `logs_*` tools** — the ledger
  stops recording LOGS as a gap because it no longer is one.

### Confirm flow (worked example, fits the 2-round free budget)

Turn 1 — "log that ramen for lunch": no tool; Clara estimates and proposes
("Ramen with pork, about 550 kcal — want me to log it for lunch?").
Turn 2 — "yes": round 1 narrates + calls `logs_create`; round 2 confirms in prose.
Search turns are 1 tool round + answer. Nothing in S1 needs more than 2 rounds.

## Surface impact

- **iOS (T1, small):** `source` decodes as a plain `String` and
  `StatsViewModel.sourceBadge` already tolerates unknown values via `default:`
  (renders "Clara", neutral) — verified 2026-08-01, no decode risk. T1 adds the
  deliberate badge (`case "CLARA": ("Clara", .info)`), a fixture row exercising it, and
  the badge test. No wire change, no new files (pbxproj untouched).
- **Web:** meal-log surfaces render `source`-agnostically (verify in-cycle; expected
  no-op).
- Chat itself is the primary surface and needs no client change.

## Out of scope (S1)

Targets/remaining (S2) · plan completion "I ate the planned dish" (S3 owns
`plan_mark_done`; in S1 those asks file gap_report MEAL_PLAN) · `logs_update` ·
batch writes · custom-ingredient logging (S13, premium).

## Error taxonomy (typed `ToolResult`, C0 contract)

`INVALID_INPUT` (bad date/bounds) · `OUT_OF_RANGE` (range > 90 days) · `NOT_FOUND`
(delete id gone or someone else's) · `FAILED` (unexpected; logged server-side,
narratable). Note: delete ambiguity ("the snack" matching several rows) is resolved in
*conversation* — Clara searches, sees several candidates, and asks — not by the handler,
which only ever receives a concrete `logId`. The prompt fragment carries that rule.

## Testing

- Handler unit tests via injected deps (the `gap.ts` pattern): search filters/bounds/
  truncation, day-summary sums incl. `incomplete` handling, create → exact
  `buildMealLogCreateData` shape with source `CLARA` + derived `clientRequestId`,
  delete ownership/tombstone/already-deleted.
- Migration byte-checked against `prisma migrate diff` (additive: one enum value).
- Loop-integration cases on the C0 stub: search→answer single round;
  propose→confirm→create across turns; AMBIGUOUS delete narration.
- Routing eval at audit over the whole fixture (real key — release-gate machine).
- iOS: badge test + fixture render; full suite on iPhone 17 Pro.

## Process

Per cycle.md: this spec → plan doc `docs/superpowers/plans/2026-08-01-clara-s1-logs.md`
→ engine tasks (wondish_02) ∥ T1 (Clara iOS, file-disjoint) → per-task reviews → final
review → audit → merge both repos. Post-merge: watch `/admin/clara-gaps` — LOGS rows
should collapse to ~zero; if they don't, recognition is failing in production.

## AMENDMENT 2026-08-01 (post-review) — corrections of record

1. **ConfirmSpec was never built; the confirm rule is prompt-enforced only.** The
   program spec's C0 layout listed a `ConfirmSpec` type and §6 rule 6 states the
   write-confirm invariant; S1 shipped it as tool-description + fragment text with NO
   structural guard. A first-turn `logs_create` is possible if the model ignores the
   prompt — a risk RAISED by the adaptive-thinking amendment (models reach for tools
   more readily). Accepted for S1 with two mitigations: the routing eval's first-turn
   case now asserts the reply PROPOSES (kcal figure + question), and writes carry an
   hourly rate cap. A structural guard is a candidate for the next write-skill cycle.
2. **Idempotency honesty.** `clara:<toolUseId>` dedupes an exact tool-call replay only.
   A user re-sending "yes" after a dropped stream yields a NEW id and a second row.
   Cross-retry idempotency would need a content-derived key; deliberately not built.
3. **PATCH semantics decided.** A CLARA row is macro-editable (it is in
   `CALLER_SUPPLIED_SOURCES`, so the API allowed it already); the web modal now permits
   editing CLARA rows like MANUAL ones. The row keeps `source: CLARA` after an edit —
   provenance means "Clara created this", not "these numbers are untouched". Analytics
   measuring estimate quality must read rows where `updatedAt ≈ createdAt`.
4. **"Web is source-agnostic" was wrong.** Web's badge map was an allowlist that fell
   back to "Manual" — a false provenance label. Fixed (CLARA + the long-missing
   RESTAURANT entry).
5. **Calories-left position unified** (was self-contradictory between table and
   fragment): answer with the day's totals AND file gap_report (NUTRITION) for the
   remaining/targets half. Supersedes §Recognition's "NOT logs in S1" line.
6. **Dark launch fixed:** tie-breaker rows naming a skill's tools are emitted only when
   that skill is active; otherwise they steer to gap_report (LOGS).
7. **Writes are rate-capped:** `clara-logs-write`, 30/hour per patient, create+delete
   shared — the only hard ceiling given (1) and premium's uncapped chat.
