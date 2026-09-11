# Symptom journal, trigger trials, condition rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users with a health condition log that condition's symptoms in the daily journal, can run one 34-day trigger trial whose elimination phase really removes the trigger from the plan, and the deployable workbook-03 condition rules become bans.

**Architecture:** Workbook 05/04 rows are seeded into new Prisma tables (tracking items, trigger rules, category terms). Symptoms hang off `JournalEntry`. A `TriggerTrial` row plus a pure schedule module decide which phase the user is in; `derivePatientBans` reads active trials and emits bans with source `"trial"`, so every existing consumer (plan builder, Clara generation, swap, What-to-buy, taste) enforces the trial with no new filtering code. Users without conditions see nothing new.

**Tech Stack:** Next.js 14 App Router, Prisma 5.22 + Neon, node:test via `npm test`, Playwright harness in the scratchpad `e2e/` folder, `xlsx` for the workbooks (gitignored, project root).

**Spec:** `docs/superpowers/specs/2026-09-11-workbooks-tier2-3-design.md`

## Global Constraints

- Branch `feat/workbooks-tier2` (from `main` at `b7740e6`). Never `npm run build` while the dev server runs.
- Migrations: write SQL with `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`, review, `prisma migrate deploy`, `prisma generate`, then restart the dev server (stale Prisma client = silent 500s).
- Every seed/import script is dry-run by default, `--apply` to write, idempotent on rerun, and prints what it would change.
- Nothing new renders for a user whose profile has no condition with tracking items and no trial (spec "Users without a condition").
- Copy: the app suggests, the user decides; every trial screen shows the workbook safety note and "Not medical advice".
- Keep AI on Haiku; no new AI spend in these features.
- Tests: `npm test` (node:test over `lib/**/*.test.ts` etc.) and `npx tsc --noEmit -p .` must be green before each commit.

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (HealthCondition, JournalEntry, Patient + 6 new models/enums)
- Create: `prisma/migrations/20260911120000_symptom_journal_trials/migration.sql`

**Interfaces:**
- Produces the Prisma models named exactly as in the spec: `ConditionTrackingItem`, `JournalSymptom`, `TriggerRule`, `TriggerRuleTrackingItem`, `TriggerCategoryTerm`, `TriggerTrial`; enums `TrackingCategory`, `SymptomSeverity`, `TrialStatus`, `TrialClassification`; columns `HealthCondition.profileFactorId Int?`, `TriggerTrial.lastPhase String?`.

- [ ] **Step 1: Add the models** to `prisma/schema.prisma` (copy the spec's Prisma block verbatim; add `profileFactorId Int?`, `trackingItems`, `triggerRules` to `HealthCondition`; `symptoms JournalSymptom[]` to `JournalEntry`; `triggerTrials TriggerTrial[]` to `Patient`; `@@index([patientId, status])` on `TriggerTrial`).

- [ ] **Step 2: Generate and review the SQL**

```bash
set -a; source .env.local; set +a
mkdir -p prisma/migrations/20260911120000_symptom_journal_trials
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260911120000_symptom_journal_trials/migration.sql
```
Append to the SQL (one ACTIVE trial per patient):
```sql
CREATE UNIQUE INDEX "TriggerTrial_one_active_per_patient" ON "TriggerTrial"("patientId") WHERE "status" = 'ACTIVE';
```

- [ ] **Step 3: Apply, generate, restart dev server**

```bash
npx prisma migrate deploy && npx prisma generate
pkill -f "next dev"; pkill -f next-server; AI_DEBUG=1 nohup npm run dev > <scratchpad>/dev.log 2>&1 &
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p .` passes; `npm test` still green.

- [ ] **Step 5: Commit** `feat(schema): symptom tracking items, journal symptoms, trigger rules and trials`

---

### Task 2: Workbook readers for 05 and 04

**Files:**
- Modify: `lib/workbooks/read.ts` (findWorkbook prefixes + 4 readers)
- Test: `lib/workbooks/read-trials.test.ts` (uses tiny in-memory sheets via `XLSX.utils.aoa_to_sheet`)

**Interfaces:**
- `readConditionSummary(file): { profileFactorId: number; name: string; symptomCount: number; testCount: number; hasTrial: boolean }[]` (sheet "Condition Journal Summary")
- `readTrackingItems(file): { code, profileFactorId, category: "SYMPTOM"|"OBJECTIVE", itemCode, label, inputSource, active }[]` (sheets "Symptoms" + "Tests and Follow Up"; `tracking_category_code` JOURNAL_SYMPTOM → SYMPTOM, OBJECTIVE_MONITORING → OBJECTIVE; `status_code === "ACTIVE"`)
- `readTriggerRules(file): { code, profileFactorId, category, action, baselineDays, trialDays, reintroductionDays, washoutDays, doseDependent, examples, symptomsToMonitor, safetyNote, sourceUrl }[]` (sheet "Trigger Rules")
- `readTriggerLinks(file): { ruleCode, trackingCode }[]` (sheet "Trial Journal Links", ACTIVE only)

- [ ] **Step 1: Failing test** — build a workbook in memory with one row per sheet and assert the four readers return the mapped shapes (numbers parsed, booleans from "YES").
- [ ] **Step 2: Run** `node --import tsx --test lib/workbooks/read-trials.test.ts` → fails (functions missing).
- [ ] **Step 3: Implement** — extend `findWorkbook`'s prefix union with `"Wondish_04" | "Wondish_05"`; add the readers with the existing `rows/s/n` helpers; export a `readWorkbookFromBuffer` overload is NOT needed — make `rows()` accept a `WorkBook` when given an object so tests can pass `XLSX.utils.book_new()`.
- [ ] **Step 4: Run** → passes. **Step 5: Commit** `feat(workbooks): readers for 05 tracking items and 04 trigger rules`

---

### Task 3: Seed phase C (05 + 04 + terms) and the name map

**Files:**
- Create: `lib/workbooks/condition-map.ts` — `export const CONDITION_FACTOR_MAP: Record<number, string[]>` copied from the spec table (`4 → ["Type 2 Diabetes", "Prediabetes"]`).
- Create: `lib/trials/category-terms.ts` — `export const TRIGGER_CATEGORY_TERMS: Record<string, { terms: string[]; groups?: string[] }>` copied from spec Appendix A.
- Modify: `scripts/import-workbooks.ts` — add `--phase c`.
- Test: `lib/trials/category-terms.test.ts` (every category in workbook 04's 28 codes has terms; no bare "sugar"/"butter"/"beans").

- [ ] **Step 1: Failing test** for the terms table (list the 28 category codes in the test).
- [ ] **Step 2: Implement** phase C in the script:
  1. `HealthCondition.profileFactorId` from `CONDITION_FACTOR_MAP` (update by name; report unmapped both ways).
  2. `ConditionTrackingItem` upsert by `code` for items whose factor maps (skip and count the rest).
  3. `TriggerRule` upsert by `code` (only mapped factors → 47 of 55; IBS-M's 10 are skipped and reported).
  4. `TriggerRuleTrackingItem` from links where both sides exist.
  5. `TriggerCategoryTerm` upsert `(category, term)` from `TRIGGER_CATEGORY_TERMS`; retire rows not in the table (delete) so the table is the source of truth.
  Dry-run prints counts; `--apply` writes; rollback JSON of pre-existing rows as in phases A/B.
- [ ] **Step 3: Run** `npx tsx scripts/import-workbooks.ts --phase c` (dry) then `--apply`, then dry again → all zeros. Record the counts in the commit message.
- [ ] **Step 4: Verify** with a one-off query: items per condition for GERD = 6, trigger rules for GERD = 8, terms for ACIDIC_CITRUS = 10.
- [ ] **Step 5: Commit** `feat(data): seed condition tracking items, trigger rules and category terms (workbooks 05/04)`

---

### Task 4: Trial schedule + scoring (pure)

**Files:**
- Create: `lib/trials/schedule.ts`, `lib/trials/score.ts`
- Test: `lib/trials/schedule.test.ts`, `lib/trials/score.test.ts`

**Interfaces:**
```ts
export type TrialPhase = "BASELINE" | "ELIMINATION" | "EVALUATION" | "REINTRODUCTION" | "WASHOUT" | "FINAL";
export const ENFORCED_PHASES: ReadonlySet<TrialPhase>; // ELIMINATION, EVALUATION, WASHOUT, FINAL
export function localDay(d: Date): Date;                // midnight local
export function dayNumber(startDate: Date, today: Date): number; // 1 on startDate
export function phaseFor(rule: { baselineDays; trialDays; reintroductionDays; washoutDays }, startDate: Date, today: Date): { phase: TrialPhase; dayNumber: number; dayInPhase: number; phaseLength: number; nextPhaseOn: Date | null };
export function phaseWindows(rule, startDate): Record<TrialPhase, { from: Date; to: Date }>;
export function isEnforced(phase: TrialPhase): boolean;

export type Severity = "NOT_PRESENT" | "MILD" | "MODERATE" | "SEVERE";
export const SEVERITY_SCORE: Record<Severity, number>; // 0,1,2,3
export function dayScore(rows: { trackingItemId: string; severity: Severity }[], monitoredIds: Set<string>): number | null;
export function phaseScore(dayScores: (number | null)[]): number | null; // null under 3 logged days
export function evaluate(a: { baseline: number | null; elimination: number | null }): { improvementPct: number | null; suggestion: "PROCEED" | "STOP_RESTRICTION" | "INSUFFICIENT_DATA" };
export function classify(a: { elimination: number | null; challenge: number | null }): "TOLERATED" | "LIKELY_TRIGGER" | null;
```
Rules: EVALUATION is day 28 only; ELIMINATION is 1..27 for display but `isEnforced` is true for both; after day `trialDays + reintroductionDays + washoutDays` the phase is FINAL until the trial is classified. `evaluate`: PROCEED when `improvementPct >= 30`. `classify`: LIKELY_TRIGGER when `challenge > elimination + 0.5`, TOLERATED otherwise, null when either is null.

- [ ] **Step 1: Failing tests** covering: day 0 (baseline day 7), day 1, 27, 28 (EVALUATION), 29, 31, 32, 34, 35 (FINAL), `nextPhaseOn`, DST-safe date math (use `new Date(2026, 2, 7)` → `new Date(2026, 2, 9)` across the US DST change), `dayScore` ignores non-monitored items, `phaseScore` null under 3 days, `evaluate` at 29.9 % and 30 %, `classify` at +0.5 and +0.51.
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (date math by `Date.UTC(y,m,d)` differences, never `getTime()/86400000` on local dates). **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(trials): pure schedule and scoring modules`

---

### Task 5: Enforcement in diet-match + food map

**Files:**
- Modify: `lib/diet-match.ts` (`BanSource`, `PatientDietGraph.triggerTrials?`, `derivePatientBans(patient, today?)`, `PATIENT_DIET_INCLUDE.triggerTrials`)
- Modify: `lib/food-map.ts` (`FoodMapPatient.triggerTrials?`, trial line)
- Test: append to `lib/diet-match.test.ts`, `lib/food-map.test.ts`

**Interfaces:**
```ts
// PatientDietGraph gains:
triggerTrials?: { status: "ACTIVE"|"STOPPED"|"COMPLETED"; startDate: Date; classification: string | null;
  rule: { category: string; baselineDays: number; trialDays: number; reintroductionDays: number; washoutDays: number } }[];
// derivePatientBans(patient, today = new Date()) — terms come from TRIGGER_CATEGORY_TERMS[rule.category]
// (the DB table mirrors it; the pure module reads the constant so no query is needed here).
```
Behaviour: ACTIVE trial in an enforced phase, or COMPLETED with `LIKELY_TRIGGER` → `exactBanned` rows `{ name: term, source: "trial" }` and groups with source `"trial"`. `PATIENT_DIET_INCLUDE.triggerTrials = { where: { status: { in: ["ACTIVE","COMPLETED"] } }, include: { rule: true } }`. Food map: enforced → `Trigger trial: eliminating ACIDIC_CITRUS (day 12 of 28) — never include: orange, …`; REINTRODUCTION → `Trigger trial: reintroducing ACIDIC_CITRUS — include one normal portion a day and note symptoms`.

- [ ] **Step 1: Failing tests** — active trial day 5 bans "orange juice" with source "trial"; day 30 (reintroduction) does not; COMPLETED + LIKELY_TRIGGER bans; STOPPED does not; food-map lines for both phases; PATIENT_DIET_INCLUDE shape test updated.
- [ ] **Step 2–4:** run, implement, run.
- [ ] **Step 5: Commit** `feat(trials): active trials ban their trigger terms through the shared diet pipeline`

---

### Task 6: Journal API + symptoms step

**Files:**
- Modify: `app/api/journal/route.ts` (GET adds `symptoms`, `trackingItems`; POST accepts `symptoms`)
- Create: `lib/journal-symptoms.ts` (`trackingItemsForPatient(prisma, patientId): Promise<{ id, label, conditionName, inTrial }[]>`, `validateSymptoms(body, allowedIds): { ok: true; rows } | { ok: false; error }`)
- Create: `app/api/journal/symptoms/route.ts` (GET `?days=30` → `{ days: { date, score }[] }`)
- Modify: `components/dashboard/QuickJournalLog.tsx` (symptoms step), `components/journal/JournalForm.tsx` (symptoms section), `components/journal/JournalCalendar.tsx` (day view list)
- Test: `lib/journal-symptoms.test.ts`

Behaviour: `trackingItemsForPatient` = SYMPTOM items of the patient's conditions, ordered trial-linked first (items linked to the patient's ACTIVE trial rule) then by condition, label. POST `symptoms: { trackingItemId, severity | null }[]` → inside the existing transaction: null → deleteMany, else upsert on `(journalEntryId, trackingItemId)`; ids not in `trackingItemsForPatient` → 400. GET returns `symptoms` for the entry (empty array when no entry) and `trackingItems` (empty for users without conditions → the UI hides the step).

- [ ] **Step 1: Failing tests** for `validateSymptoms` (unknown id, bad severity, null clears) and the ordering rule of `trackingItemsForPatient` (mock prisma object with `conditionTrackingItem.findMany` and `triggerTrial.findFirst`).
- [ ] **Step 2–4:** implement route + lib; run tests.
- [ ] **Step 5: UI** — QuickJournalLog: fetch `/api/journal?date=today` on mount; if `trackingItems.length > 0` insert `"symptoms"` after `"activity"` in the step list (computed, not the const); render rows: label + 4 chips (`min-h-[44px]`), tapping the selected chip clears; "trial" tag when `inTrial`; > 8 items → "Show all". Include `symptoms` in the save body. JournalForm: same rows in a "Symptoms" section when items exist, prefilled from the entry. JournalCalendar day view: list `symptoms` with severity labels when present.
- [ ] **Step 6: Verify in browser** (desktop QA account has Celiac + GERD → GERD's 6 symptoms appear; a fresh account with no conditions shows 5 steps).
- [ ] **Step 7: Commit** `feat(journal): condition symptoms in the daily log`

---

### Task 7: Trials API

**Files:**
- Create: `lib/trials/view.ts` (`buildTrialView(trial, rule, entries, today)` → phase, scores via Task 4, suggestion, terms), `lib/trials/eligibility.ts` (`eligibleRules(conditionNames, rules, trials)`)
- Create: `app/api/trials/route.ts` (GET, POST), `app/api/trials/[id]/route.ts` (PATCH)
- Test: `lib/trials/view.test.ts`, `lib/trials/eligibility.test.ts`, `app/api/trials/route.test.ts` (pure helpers only; the handler bodies stay thin)

Behaviour:
- GET: `{ eligible, active, history }`. `eligible` = active rules whose condition is on the profile, minus categories with an ACTIVE trial or a COMPLETED LIKELY_TRIGGER one. Also: compute `phaseFor` for the active trial; if `trial.lastPhase !== phase` → update `lastPhase` and, when enforcement changed (`isEnforced(old) !== isEnforced(new)`), set `patient.mealPlanStale = true`.
- POST `{ ruleId, skipBaseline?: boolean }`: 403 when the rule's condition is not on the profile; 409 when an ACTIVE trial exists (catch the unique-index error too); `startDate = today + (skipBaseline ? 0 : baselineDays)`; set `mealPlanStale = true` when starting in an enforced phase (skipBaseline).
- PATCH `{ action: "stop" | "classify" | "clear", classification?, notes? }`: stop → STOPPED + stale; classify (only in EVALUATION/FINAL or later) → COMPLETED with the given classification, freeze scores, stale=true unless LIKELY_TRIGGER (ban continues); clear (only COMPLETED LIKELY_TRIGGER) → STOPPED, stale=true.
- Rate limit key `trials`, 60/min.

- [ ] **Step 1: Failing tests** for eligibility (dedupe by category, exclusions) and view (scores from entries by phase window; suggestion at evaluation; `nextPhaseOn`).
- [ ] **Step 2–4:** implement; run tests.
- [ ] **Step 5: Smoke** with curl through the harness session: POST start (skipBaseline) → GET shows ELIMINATION day 1; second POST → 409.
- [ ] **Step 6: Commit** `feat(trials): trial lifecycle API`

---

### Task 8: Trials page + Journey cards + nav

**Files:**
- Create: `app/(dashboard)/trials/page.tsx` (server: redirect to `/journey` when no eligible rule and no trial), `components/trials/TrialsClient.tsx`, `components/trials/TrialTimeline.tsx`, `components/trials/TriggerCard.tsx`
- Create: `components/journey/SymptomTrendCard.tsx`, `components/journey/TrialsCard.tsx`
- Modify: `app/(dashboard)/journey/page.tsx` (render the two cards only when `trackingItems.length > 0` or a trial exists), `components/dashboard/DashboardSidebar.tsx` + `components/dashboard/MobileNav.tsx` (nav item "Trials" only when `showTrials` prop is true), `app/(dashboard)/layout.tsx` (compute `showTrials` = patient has an eligible condition or any trial; one small query), `messages/{en,es,ru}.json` (`sidebar.trials`: "Trials" / "Pruebas" / "Пробы")

UI per spec: eligible categories as cards (title = humanised category, workbook examples, safety note, source link, Start with a "Skip the 7-day baseline" checkbox); active trial timeline (6 steps, day n of m, "what to avoid" chips from terms, current instruction, scores + suggestion when available, buttons Stop / Confirm classification (radio TOLERATED, DOSE_DEPENDENT, LIKELY_TRIGGER; suggested one preselected) / "Generate a new week" when `mealPlanStale`); history list with classification badges and "Clear ban". Use `apiFetch` from `lib/client-fetch.ts`. Footer on every trial screen: safety note + "Not medical advice — talk to your clinician before restricting food groups."

- [ ] **Step 1: Build** the components with the existing card styling (`rounded-2xl`, `#812549` primary, 44 px touch targets).
- [ ] **Step 2: Verify** with the harness on desktop and mobile: no-condition account → no nav item, `/trials` redirects; GERD account → cards; Start with skip baseline → timeline day 1; banner on meal plan; regenerate → assert no citrus in the DB week; move `startDate` back 28 days in the DB → evaluation shows scores/suggestion; back 31 → reintroduction; classify LIKELY_TRIGGER → ban persists (to-buy hides oranges); Clear → released.
- [ ] **Step 3: Commit** `feat(trials): trials page, journey cards, conditional nav`

---

### Task 9: Workbook 03 deployable rules import (phase D)

**Files:**
- Create: `scripts/import-condition-rules.ts`
- Modify: `lib/workbooks/read.ts` (`readHealthRules(file): { ruleId, profileFactorId, ingredientFormId, action, gate, status }[]`)

- [ ] **Step 1: Dry-run** listing per condition the rows that would be added (DEPLOYABLE + action in {DO_NOT_AUTO_INCLUDE, AVOID}, factor mapped, form id resolves to an `Ingredient` we hold, not already banned, and for Celiac skip names containing "gluten-free"). Print the skipped categories with counts.
- [ ] **Step 2: Apply**, then rerun the per-condition audit script from `docs/qa/condition-audit-2026-09-11.md` (pool sizes + suspicious matches). Fix false positives by adding them to a `RETIRED` list in the script and re-applying.
- [ ] **Step 3: Commit** `feat(data): import deployable workbook-03 condition rules`

---

### Task 10: Release gate

- [ ] `npm test` and `npx tsc --noEmit -p .` green; seeds rerun → zero changes.
- [ ] Harness pass on desktop and mobile: no-condition account sees nothing new (5 journal steps, no Trials nav, `/trials` redirects); GERD account full trial lifecycle (Task 8 step 2); journal symptoms persist and show in the day view.
- [ ] Update `docs/qa/feature-checklist-2026-09-11.md` (new rows) and `BACKLOG.md` (Tier 2/3 entries → done; remaining: REVIEW_REQUIRED rules, objective items UI, Clara symptom history).
- [ ] Commit, then finishing-a-development-branch.
