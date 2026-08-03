# Clara S4 — Journal Skill (design)

**Status: user-approved 2026-08-03** (toolbox tripwire, weight cascade, tool set).
Fourth skill cycle on the C0 runtime. Program spec:
`docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md` (§3 S4).
Wave order holds (ledger still under the §8 Q12 threshold).

## Goal

Clara reads and writes the user's journal from chat, on both surfaces:

- "When did I last note bloating?" → notes search over real entries.
- "How was my energy last week?" → field search, narrated on the app's own scale.
- "I weighed 181 this morning" → confirmed weigh-in with the app's FULL cascade.
- "Note that I slept badly" / "mood's been great today" → confirmed field upsert
  that never wipes the rest of the day's entry.

## Resolved decisions (user, 2026-08-03)

1. **Toolbox: ship always-on with a hard tripwire.** S4 takes the always-on
   toolbox from 14 to 18 defs, past program §4.2's "~15" Stage-B trigger. That
   number was a guess made with zero data; the routing eval exists to replace
   it. S4 ships always-on. **Tripwire (binding):** if the S4 audit eval scores
   <90% on the accumulated fixture OR any S1–S3 case regresses, Stage B
   (tiered disclosure) becomes its own runtime cycle **C1, before S5**. This
   amends the program spec's trigger from "~15 defs" to "measured recognition
   degradation, checked at every audit".
2. **`journal_log_weight` runs the app's full cascade.** The existing journal
   POST syncs the latest-dated weigh-in into `Patient.weight`, recomputes BMI,
   and flags `mealPlanStale` at ≥5 lbs drift from the plan-build weight.
   Clara's weigh-in behaves identically (extracted shared helper; parity
   first). A Clara weigh-in that skipped the sync would silently desync the
   dashboard — the supersession of the program sketch's "stops at the journal
   row" line is recorded here. `Patient.goalWeight` stays untouched, ever
   (program §7 exclusion holds).
3. **`journal_upsert_entry` is a field-preserving merge** — deliberate
   divergence from the POST route's replace-all-scalars semantics (the web
   client always sends the full form; Clara sends single fields, and "log my
   mood" must not null the day's notes). Recorded as a Clara-vs-route
   behavioral difference; the route is NOT changed for its own clients.

## The skill

One file `lib/clara/skills/journal.ts` + one `ALL_SKILLS` entry. Skill name /
`CLARA_SKILLS` token: `journal`. Injected-deps factory (`makeJournalHandlers`).
**No migration.**

### Vocabulary (pinned from the web form — the app's only scales)

- `mood`: `"1"`(Bad) `"2"`(Meh) `"3"`(Good) `"4"`(Great)
- `energyLevel`: `"1"`(Very Low) `"2"`(Low) `"3"`(Moderate) `"4"`(High)
- `activityLevel`: `"none" | "light" | "moderate" | "intense"`
- `weight`: lbs, `0 < w < 1500` (`MAX_WEIGHT_LBS`, the route's bound)
- `notes`: free text, capped 2000 chars

Tool descriptions carry the mapping ("great" → mood "4"); an off-vocabulary
value is `INVALID_INPUT` with the scale in the message, so Clara re-asks.

### Tools (4)

| Tool | Contract |
|---|---|
| `journal_search` | Inputs: `fromDate`/`toDate` (required, calendar-strict, ≤**365 days**), optional `noteText` (case-insensitive contains on `notes`, ≤80 chars), optional `field` filter (`"weight" \| "mood" \| "energy" \| "activity"` — entries where that field is non-null). Returns ≤**30** slim entries `{date, mood, weight, energyLevel, activityLevel, notes}` newest-first + `truncated`. Empty result is `ok:true`. |
| `journal_get_day` | Input: `date?` (defaults `ctx.today`). The day's entry (all scalar fields) + meal rows `{mealType, skipped, rating}`. No entry → `ok:true, entry: null`. |
| `journal_upsert_entry` ✍️ | Inputs: `date?` (defaults today, calendar-strict), any subset of `mood`, `energyLevel`, `activityLevel`, `notes`. At least one field required. Merge semantics (decision 3): unsent fields keep their values; `notes` REPLACES the day's notes (say so in the description so Clara appends by restating). Never touches meals or weight. |
| `journal_log_weight` ✍️ | Inputs: `weightLbs` (route bound), `date?` (defaults today, calendar-strict). Full cascade via the extracted helper (decision 2): merge weight into the day's entry (other fields preserved), then latest-weigh-in sync → `Patient.weight` + `weightUnit: "lbs"` + BMI + `mealPlanStale` at ≥5 lbs drift. Returns `{entryDate, weightLbs, synced: {currentWeight, bmi?, planFlaggedStale}}` so Clara narrates the side effect. |

### Reuse via extraction (S3 E1 pattern, parity first)

New helper in `lib/journal.ts`: `applyWeighIn(patientId, {date, weightLbs}, db?)`
— the journal-row weight merge + the POST route's entire latest-weigh-in sync
block (lines 114-144 today), injected-port tested. The POST route is refactored
to call it for the sync half; its own replace-all entry semantics stay put.
`upsertMealCompletion` (S3) is untouched. The upsert handler reuses
`parseLocalDateStrict` + a field-merge against the existing entry (same
day-window convention as the route).

### Writes

Shared cap `clara-journal-write`, 30/h, budget-first, fail-open (house shape).
Both writes `isWrite: true` (S3 guard). No `clientRequestId` machinery: both
writes are per-day-field upserts, naturally idempotent on retry — recorded so
a reviewer doesn't flag the "missing" dedupe key.

### Recognition (program §4 obligations)

- **FELT tie-breaker row becomes conditional**: journal on → flow-framed
  ("mood, energy, sleep, symptoms, notes, weigh-ins → journal_ tools; for
  writes PROPOSE first, the write only after their yes" — S3 lesson: rows
  steer to flows, never bare write tools); off → today's gap_report (JOURNAL)
  text.
- **Boundaries in descriptions**: "how did I FEEL" vs "what did I EAT" (logs)
  vs "am I TRENDING toward my goal" (`gap_report(PROGRESS)`, S11).
  `journal_get_day` names `logs_day_summary` as the intake owner;
  `journal_search` says it does NOT search food (logs_search does).
- **"Mark dinner as skipped" stays a gap** (`JOURNAL` category): not in the
  program sketch's S4 tool set; ledger demand decides. S3's fragment line
  stays true. Recorded so S5+ doesn't re-litigate.
- **Weight boundary**: "I weighed 181" → `journal_log_weight`; "change my goal
  weight" → `gap_report(BODY_GOALS)` refusal (program §7).
- **Fixture: +12–14 cases** incl. flips ("when did I last note feeling
  bloated?", "how was my energy this week?" from gap → journal tools), a
  history-seeded confirm case for each write, and adversarial neighbours
  ("how were my calories this week" stays `nutrition_range_summary`; "what
  did I eat yesterday" stays `logs_search`; "am I on track to reach my goal
  weight" stays `gap_report`). Whole-fixture eval at audit; the tripwire
  (decision 1) is judged on this run.
- `CATEGORY_TO_SKILL` gains `JOURNAL: "journal"`.

### Round budget

Every S4 ask is 1 round + answer; write flows are read→propose (turn 1) then
write (turn 2). Nothing needs more than the free budget.

## Surface impact

**None — explicit no-client-change declaration.** Journal entries written by
Clara render in the existing web/iOS journal views on next fetch (they are
ordinary rows). iOS repo untouched.

## Out of scope (S4)

Meal-row writes incl. skipped-marking (gap-demand decides) · goal/body writes
(post-S6, §7) · trend synthesis over journal data (S11 Progress) · journal
entry deletion (no route exists; the app has no delete either) · reminders.

## Error taxonomy

`INVALID_INPUT` (bad date, off-vocabulary value, no fields, bad weight,
noteText too long) · `OUT_OF_RANGE` (range >365 days) · `CONFIRM_REQUIRED`
(guard) · `FAILED` (cap, unexpected). Missing entry/day is never an error.

## Testing

- Parity: `applyWeighIn` tests encode the POST route's sync block behavior
  (latest-dated wins, BMI only with height, stale only past 5 lbs drift and
  only with an active plan anchor) BEFORE the route refactor; route delegates
  after; suite stays green.
- Handler units via injected deps: search filters/caps/truncation/newest-first;
  get-day null path; upsert merge preserves unsent fields + vocabulary
  validation + at-least-one-field; weigh-in bound + cascade result narration
  fields + goalWeight never in any write's data.
- Schema contract (4 defs, isWrite on exactly 2, no identity params).
- Registry: journal on/off combos; FELT row flow-framing pinned with
  single-line anchors (S3 lesson).
- Loop round-trip: journal_search → answer.
- Routing eval at audit over the whole accumulated fixture — the tripwire run.

## Process

Per cycle.md: this spec → plan doc `docs/superpowers/plans/2026-08-03-clara-s4-journal.md`
→ engine tasks on `cycle-clara-s4-journal` (E1 applyWeighIn extraction+parity,
E2 skill+wiring, E3 fixture) → per-task reviews → final review (write-path +
recognition) → audit (TRIPWIRE) → merge. Post-merge: JOURNAL gap rows should
collapse; NUTRITION/MEAL_PLAN rows are the S2/S3 controls.
