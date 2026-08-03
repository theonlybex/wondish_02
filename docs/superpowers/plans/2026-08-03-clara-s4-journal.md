# Clara S4 — Journal Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clara reads and writes the user's journal (mood/energy/activity/notes search + day reads, field-preserving upserts, weigh-ins with the app's full weight cascade) behind confirm + the S3 structural guard.

**Architecture:** Three engine tasks. E1 extracts the journal POST route's weight-sync block into `syncLatestWeighIn` (shared) and builds `applyWeighIn` (Clara's entry-merge + sync) on top of it, parity-pinned before the route delegates. E2 ships `lib/clara/skills/journal.ts` (4 tools, injected deps) plus the conditional FELT tie-breaker row, gap-map entry, and tests. E3 updates the routing fixture — whose audit run is the binding Stage-B tripwire.

**Tech Stack:** Next.js / TypeScript, Prisma, `node --import tsx --test` (suite: `npm test`), no new deps, **no migration**.

**Spec (contract of record):** `docs/superpowers/specs/2026-08-03-clara-s4-journal-skill-design.md`

## Global Constraints

- Branch: `cycle-clara-s4-journal` off `main`.
- **No migration, no client change, no iOS work.**
- Files S4 may touch beyond its own skill+tests: `lib/journal.ts` (+`syncLatestWeighIn`/`applyWeighIn`), `app/api/journal/route.ts` (sync block delegates), `lib/clara/registry.ts` (import + entry + FELT row), `lib/clara/gap.ts` (one map entry), `lib/clara/__fixtures__/routing.ts`, and their test files. `loop.ts`/`types.ts` untouched.
- Vocabulary (the app's only scales, from `components/journal/JournalForm.tsx`): mood `"1"|"2"|"3"|"4"` (Bad/Meh/Good/Great) · energyLevel `"1"|"2"|"3"|"4"` (Very Low/Low/Moderate/High) · activityLevel `"none"|"light"|"moderate"|"intense"` · weight lbs `0 < w < 1500` (`MAX_WEIGHT_LBS`) · notes ≤2000 chars.
- `journal_upsert_entry` merges (unsent fields preserved) — deliberate divergence from the POST route's replace-all; the route is NOT changed for its own clients. `notes` REPLACES the day's note.
- `journal_log_weight` runs the FULL cascade (Patient.weight + `weightUnit:"lbs"` + BMI + `mealPlanStale` at ≥5 lbs drift). `Patient.goalWeight` appears in NO write payload, ever.
- Writes: `isWrite: true`, shared cap `clara-journal-write` 30/h budget-first fail-open, calendar-strict dates (round-trip check — the S3 lesson), flow-framed tie-breaker rows (never bare write steers).
- No `clientRequestId`: both writes are per-day-field upserts, naturally idempotent (recorded in the spec).
- Suite green at every commit; `npx tsc --noEmit` stays at **19 pre-existing errors**. `Array.from` over Map iterators (tsconfig target).
- `lib/journal.test.ts` has no prisma stub — helpers use injected ports like S3's `CompletionDb`. `lib/meal-plan.test.ts`'s dynamic-import rule does NOT apply here (journal.test.ts imports statically already).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/journal.ts` + `lib/journal.test.ts` | modify | `syncLatestWeighIn`, `applyWeighIn`, `WeighInDb`, `WEIGHT_DRIFT_LBS` |
| `app/api/journal/route.ts:114-144` | modify | sync block delegates to `syncLatestWeighIn` |
| `lib/clara/skills/journal.ts` + `journal.test.ts` | create | 4 tools, handlers, fragment |
| `lib/clara/registry.ts` + `registry.test.ts` | modify | import + entry; conditional FELT row |
| `lib/clara/gap.ts` + `gap.test.ts` | modify | `JOURNAL: "journal"` |
| `lib/clara/__fixtures__/routing.ts` | modify | 2 flips + 12 cases |

---

### Task E1: `syncLatestWeighIn` + `applyWeighIn` (parity first)

**Files:**
- Modify: `lib/journal.ts` (append), `app/api/journal/route.ts:7-9,114-144`
- Test: `lib/journal.test.ts` (append)

**Interfaces:**
- Consumes (existing): `parseLocalDateStrict` (same file), `convertHeight`, `convertWeight`, `calcCBMI` (@/lib/caloric-engine), `prisma`, `MAX_WEIGHT_LBS` (same file, currently module-private — export it).
- Produces (E2 consumes):
  - `WEIGHT_DRIFT_LBS = 5` (moved from the route)
  - `syncLatestWeighIn(patientId: string, db?: WeighInDb): Promise<WeighInSync | null>` — `null` = no weigh-ins on record (no patient update).
  - `WeighInSync = { currentWeight: number; bmi: number | null; planFlaggedStale: boolean }`
  - `applyWeighIn(patientId: string, args: { date: string; weightLbs: number }, db?: WeighInDb): Promise<{ entryDate: string; weightLbs: number; synced: WeighInSync | null } | null>` — `null` = invalid date or out-of-bounds weight; merges weight into the day's entry (other fields preserved), then syncs.
  - `WeighInDb` port: `findEntry(patientId, dayStart, dayEnd): Promise<{id: string} | null>` · `createEntryWithWeight(patientId, date: Date, weight: number): Promise<{id: string}>` · `updateEntryWeight(id, weight): Promise<void>` · `latestWeighIn(patientId): Promise<number | null>` · `getPatientAnchor(patientId): Promise<{height: number | null; heightUnit: string | null; mealPlanStartDate: Date | null; mealPlanWeight: number | null} | null>` · `updatePatient(patientId, data: {weight: number; weightUnit: string; bmi?: number; mealPlanStale?: boolean}): Promise<void>`.
  - `export const MAX_WEIGHT_LBS` (was private).

- [ ] **Step 1: Write the failing tests** — append to `lib/journal.test.ts` (extend its top import from `./journal` with `syncLatestWeighIn`, `applyWeighIn`, `MAX_WEIGHT_LBS`, `WEIGHT_DRIFT_LBS`, `type WeighInDb`; import `convertHeight`, `convertWeight`, `calcCBMI` from `./caloric-engine`):

```ts
function fakeWeighInDb(over: Partial<WeighInDb> = {}) {
  const patientUpdates: Record<string, unknown>[] = [];
  const entryOps: string[] = [];
  const db: WeighInDb = {
    findEntry: async () => null,
    createEntryWithWeight: async (_p, _d, w) => {
      entryOps.push(`create:${w}`);
      return { id: "e-new" };
    },
    updateEntryWeight: async (id, w) => {
      entryOps.push(`update:${id}:${w}`);
    },
    latestWeighIn: async () => 181,
    getPatientAnchor: async () => ({
      height: null, heightUnit: null, mealPlanStartDate: null, mealPlanWeight: null,
    }),
    updatePatient: async (_p, data) => {
      patientUpdates.push(data as Record<string, unknown>);
    },
    ...over,
  };
  return { db, patientUpdates, entryOps };
}

test("sync: latest weigh-in lands on the patient in lbs; no BMI without height, no stale without anchor", async () => {
  const { db, patientUpdates } = fakeWeighInDb();
  const res = await syncLatestWeighIn("p1", db);
  assert.deepEqual(res, { currentWeight: 181, bmi: null, planFlaggedStale: false });
  assert.deepEqual(patientUpdates, [{ weight: 181, weightUnit: "lbs" }]);
});

test("sync: BMI matches the route's formula exactly when height exists", async () => {
  const { db, patientUpdates } = fakeWeighInDb({
    getPatientAnchor: async () => ({
      height: 170, heightUnit: "cm", mealPlanStartDate: null, mealPlanWeight: null,
    }),
  });
  const res = await syncLatestWeighIn("p1", db);
  const ht = convertHeight(170, "cm");
  const wt = convertWeight(181, "lbs");
  const expectedBmi = parseFloat(calcCBMI(wt.kg, ht.m2).toFixed(1));
  assert.equal(res?.bmi, expectedBmi);
  assert.equal((patientUpdates[0] as { bmi: number }).bmi, expectedBmi);
});

test("sync: stale flagged only past the drift threshold AND with a plan anchor", async () => {
  const anchor = (planWeight: number | null, started: boolean) => ({
    getPatientAnchor: async () => ({
      height: null, heightUnit: null,
      mealPlanStartDate: started ? new Date(2026, 6, 1) : null,
      mealPlanWeight: planWeight,
    }),
  });
  // drift 6 lbs with anchor → stale
  let r = await syncLatestWeighIn("p1", fakeWeighInDb(anchor(175, true)).db);
  assert.equal(r?.planFlaggedStale, true);
  // drift 4 lbs → quiet
  r = await syncLatestWeighIn("p1", fakeWeighInDb(anchor(178, true)).db);
  assert.equal(r?.planFlaggedStale, false);
  // drift 6 but no start date → quiet (route parity)
  r = await syncLatestWeighIn("p1", fakeWeighInDb(anchor(175, false)).db);
  assert.equal(r?.planFlaggedStale, false);
  assert.equal(WEIGHT_DRIFT_LBS, 5);
});

test("sync: no weigh-ins on record → null, patient untouched", async () => {
  const { db, patientUpdates } = fakeWeighInDb({ latestWeighIn: async () => null });
  assert.equal(await syncLatestWeighIn("p1", db), null);
  assert.equal(patientUpdates.length, 0);
});

test("sync: goalWeight is NEVER in the update payload", async () => {
  const { db, patientUpdates } = fakeWeighInDb();
  await syncLatestWeighIn("p1", db);
  for (const u of patientUpdates) assert.equal("goalWeight" in u, false);
});

test("applyWeighIn: merges weight into an existing day entry — weight ONLY, then syncs", async () => {
  const { db, entryOps } = fakeWeighInDb({ findEntry: async () => ({ id: "e-1" }) });
  const res = await applyWeighIn("p1", { date: "2026-08-03", weightLbs: 181 }, db);
  assert.deepEqual(entryOps, ["update:e-1:181"]);
  assert.equal(res?.entryDate, "2026-08-03");
  assert.equal(res?.synced?.currentWeight, 181);
});

test("applyWeighIn: creates the day entry when missing", async () => {
  const { db, entryOps } = fakeWeighInDb();
  await applyWeighIn("p1", { date: "2026-08-03", weightLbs: 181 }, db);
  assert.deepEqual(entryOps, ["create:181"]);
});

test("applyWeighIn: calendar-invalid date and out-of-bounds weight → null, no effects", async () => {
  const { db, entryOps, patientUpdates } = fakeWeighInDb();
  assert.equal(await applyWeighIn("p1", { date: "2026-02-30", weightLbs: 181 }, db), null);
  for (const w of [0, -5, 1500, NaN]) {
    assert.equal(await applyWeighIn("p1", { date: "2026-08-03", weightLbs: w }, db), null);
  }
  assert.equal(entryOps.length, 0);
  assert.equal(patientUpdates.length, 0);
});
```

- [ ] **Step 2: Run to verify failure** — `npx tsx --test lib/journal.test.ts` → FAIL (no such exports).

- [ ] **Step 3: Implement** — append to `lib/journal.ts` (add `convertHeight`, `convertWeight`, `calcCBMI` to an import from `@/lib/caloric-engine`; export the existing `MAX_WEIGHT_LBS`):

```ts
// ─── Weigh-in cascade (S4 extraction from app/api/journal POST) ──────────────
// The journal is the ongoing weight ground truth: the latest-dated entry with
// a weight syncs into Patient.weight (+BMI, + mealPlanStale past the drift
// threshold). One shared path: the POST route delegates its sync block here;
// Clara's journal_log_weight adds the entry-merge half via applyWeighIn.

/** Route parity: drift below this stays quiet (daily fluctuation). */
export const WEIGHT_DRIFT_LBS = 5;

export interface WeighInDb {
  findEntry(patientId: string, dayStart: Date, dayEnd: Date): Promise<{ id: string } | null>;
  createEntryWithWeight(patientId: string, date: Date, weight: number): Promise<{ id: string }>;
  updateEntryWeight(id: string, weight: number): Promise<void>;
  latestWeighIn(patientId: string): Promise<number | null>;
  getPatientAnchor(patientId: string): Promise<{
    height: number | null;
    heightUnit: string | null;
    mealPlanStartDate: Date | null;
    mealPlanWeight: number | null;
  } | null>;
  updatePatient(
    patientId: string,
    data: { weight: number; weightUnit: string; bmi?: number; mealPlanStale?: boolean }
  ): Promise<void>;
}

export interface WeighInSync {
  currentWeight: number;
  bmi: number | null;
  planFlaggedStale: boolean;
}

const prismaWeighInDb: WeighInDb = {
  findEntry: async (patientId, dayStart, dayEnd) =>
    prisma.journalEntry.findFirst({
      where: { patientId, date: { gte: dayStart, lte: dayEnd } },
      select: { id: true },
    }),
  createEntryWithWeight: async (patientId, date, weight) =>
    prisma.journalEntry.create({ data: { patientId, date, weight }, select: { id: true } }),
  updateEntryWeight: async (id, weight) => {
    await prisma.journalEntry.update({ where: { id }, data: { weight } });
  },
  latestWeighIn: async (patientId) => {
    const row = await prisma.journalEntry.findFirst({
      where: { patientId, weight: { not: null } },
      orderBy: { date: "desc" },
      select: { weight: true },
    });
    return row?.weight ?? null;
  },
  getPatientAnchor: async (patientId) =>
    prisma.patient.findUnique({
      where: { id: patientId },
      select: { height: true, heightUnit: true, mealPlanStartDate: true, mealPlanWeight: true },
    }),
  updatePatient: async (patientId, data) => {
    await prisma.patient.update({ where: { id: patientId }, data });
  },
};

/** The POST route's sync block, verbatim semantics (parity pinned by tests). */
export async function syncLatestWeighIn(
  patientId: string,
  db: WeighInDb = prismaWeighInDb
): Promise<WeighInSync | null> {
  const currentWeight = await db.latestWeighIn(patientId);
  if (currentWeight == null) return null;
  const anchor = await db.getPatientAnchor(patientId);
  const data: { weight: number; weightUnit: string; bmi?: number; mealPlanStale?: boolean } = {
    weight: currentWeight,
    weightUnit: "lbs", // the app's single unit
  };
  let bmi: number | null = null;
  if (anchor?.height) {
    const ht = convertHeight(anchor.height, anchor.heightUnit === "in" ? "in" : "cm");
    const wt = convertWeight(currentWeight, "lbs");
    bmi = parseFloat(calcCBMI(wt.kg, ht.m2).toFixed(1));
    data.bmi = bmi;
  }
  let planFlaggedStale = false;
  if (
    anchor?.mealPlanStartDate &&
    anchor.mealPlanWeight != null &&
    Math.abs(currentWeight - anchor.mealPlanWeight) >= WEIGHT_DRIFT_LBS
  ) {
    data.mealPlanStale = true;
    planFlaggedStale = true;
  }
  await db.updatePatient(patientId, data);
  return { currentWeight, bmi, planFlaggedStale };
}

/**
 * Clara's weigh-in: merge the weight into the day's entry (ALL other fields
 * preserved — the route's replace-all semantics are its clients' contract,
 * not this one's), then run the shared sync. Null = invalid input.
 */
export async function applyWeighIn(
  patientId: string,
  args: { date: string; weightLbs: number },
  db: WeighInDb = prismaWeighInDb
): Promise<{ entryDate: string; weightLbs: number; synced: WeighInSync | null } | null> {
  const parsed = parseLocalDateStrict(args.date);
  if (!parsed) return null;
  // Calendar-strict: the constructor rolls "2026-02-30" over without NaN.
  const y = parsed.getFullYear();
  const m = parsed.getMonth() + 1;
  const d = parsed.getDate();
  const roundTrip = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (roundTrip !== args.date) return null;
  const w = args.weightLbs;
  if (!Number.isFinite(w) || w <= 0 || w >= MAX_WEIGHT_LBS) return null;

  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const existing = await db.findEntry(patientId, dayStart, dayEnd);
  if (existing) await db.updateEntryWeight(existing.id, w);
  else await db.createEntryWithWeight(patientId, dayStart, w);

  const synced = await syncLatestWeighIn(patientId, db);
  return { entryDate: args.date, weightLbs: w, synced };
}
```

- [ ] **Step 4: Refactor the route** — in `app/api/journal/route.ts`: delete the local `WEIGHT_DRIFT_LBS` const (line 7-9) and the whole sync block (lines 114-144, from `const latestWeighIn = await prisma.journalEntry.findFirst…` through the `patient.update`), replacing with:

```ts
  // Latest-weigh-in → patient sync (S4 extraction — lib/journal.ts, shared
  // with Clara's journal_log_weight). Same semantics, parity pinned by tests.
  await syncLatestWeighIn(patient.id);
```

Add `syncLatestWeighIn` to the route's `@/lib/journal` import; drop the now-unused `convertHeight`/`convertWeight`/`calcCBMI` import from the route.

- [ ] **Step 5: Run to green** — `npx tsx --test lib/journal.test.ts` → PASS; `npm test` → green; `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 19.

- [ ] **Step 6: Commit**

```bash
git add lib/journal.ts lib/journal.test.ts app/api/journal/route.ts
git commit -m "refactor(journal): extract weigh-in cascade into syncLatestWeighIn/applyWeighIn — parity pinned (S4 E1)"
```

---

### Task E2: The journal skill + wiring

**Files:**
- Create: `lib/clara/skills/journal.ts`, `lib/clara/skills/journal.test.ts`
- Modify: `lib/clara/registry.ts` (import + `ALL_SKILLS` + FELT row), `lib/clara/registry.test.ts`, `lib/clara/gap.ts` (+`JOURNAL: "journal"`), `lib/clara/gap.test.ts`

**Interfaces:**
- Consumes: E1's `applyWeighIn`, `MAX_WEIGHT_LBS`; `parseLocalDateStrict` (@/lib/journal); `rateLimit` (@/lib/rate-limit); `ClaraContext`/`Skill`/`ToolResult` (../types); `prisma`.
- Produces: `journalSkill: Skill` (name `"journal"`), `makeJournalHandlers(deps?)`, `JournalDeps`, `JOURNAL_WRITE_HOURLY_CAP = 30`, `MAX_JOURNAL_RANGE_DAYS = 365`, `MAX_JOURNAL_ROWS = 30`, `MAX_NOTES_CHARS = 2000`.

**Contracts (tests pin these):**

```ts
export interface SlimJournalEntry {
  date: Date;
  mood: string | null;
  weight: number | null;
  energyLevel: string | null;
  activityLevel: string | null;
  notes: string | null;
}
export interface JournalDeps {
  findEntries(q: {
    patientId: string;
    dayStart: Date;   // range start, 00:00 local
    dayEnd: Date;     // range end, 23:59:59.999 local
    noteText?: string;          // insensitive contains on notes
    field?: "weight" | "mood" | "energy" | "activity"; // non-null filter
    limit: number;
  }): Promise<SlimJournalEntry[]>;
  findDayEntry(patientId: string, dayStart: Date, dayEnd: Date): Promise<
    (SlimJournalEntry & { meals: { mealType: string; skipped: boolean; rating: number | null }[] }) | null
  >;
  upsertEntryFields(
    patientId: string,
    date: Date, // day start
    dayEnd: Date,
    fields: Partial<{ mood: string; energyLevel: string; activityLevel: string; notes: string }>
  ): Promise<void>; // update only the sent keys when the entry exists; create otherwise
  applyWeighIn: typeof applyWeighIn;
  consumeWriteBudget(patientId: string): Promise<boolean>;
}
```

Prisma defaults: `findEntries` → `journalEntry.findMany` where `{patientId, date: {gte, lte}, ...(noteText ? {notes: {contains, mode: "insensitive"}} : {}), ...(field non-null map: weight→`weight: {not: null}`, mood→`mood: {not: null}`, energy→`energyLevel: {not: null}`, activity→`activityLevel: {not: null}`)}`, `orderBy: {date: "desc"}`, `take: limit`, scalar select. `findDayEntry` → `findFirst` day window include meals select. `upsertEntryFields` → `findFirst` day window select id; `update` with exactly the sent keys, else `create({...fields, patientId, date})`.

**Handlers** (S1/S2/S3 factory shape, `invalid()` helper, local `dayGap`/`toLocalDateString`/`localMidnight` copies, calendar-strict round-trip on every date input):

- `search(ctx, input)`: `fromDate`/`toDate` required + calendar-strict; from ≤ to; NaN-guarded gap; `gap > 365` → `OUT_OF_RANGE` ("Range is capped at 365 days"); `noteText` trimmed, sliced 80; `field` must be one of the four or `INVALID_INPUT`; fetch `limit: 31`, `truncated = rows.length > 30`, slice 30; serialize `date` via `toLocalDateString`. Payload `{fromDate, toDate, entries, truncated}`.
- `getDay(ctx, input)`: `date?` default `ctx.today`, calendar-strict; payload `{date, entry: null | {mood, weight, energyLevel, activityLevel, notes, meals}}`.
- `upsert(ctx, input, )` ✍️: budget-first; `date?` default today calendar-strict; validate each provided field — `mood`/`energyLevel` ∈ `{"1","2","3","4"}`, `activityLevel` ∈ `{"none","light","moderate","intense"}`, `notes` string ≤2000 — off-vocabulary → `INVALID_INPUT` with the scale in the message; zero provided fields → `INVALID_INPUT` ("send at least one of mood, energyLevel, activityLevel, notes"); call `upsertEntryFields`; payload `{saved: {date, fields}}`.
- `logWeight(ctx, input)` ✍️: budget-first; `weightLbs` must be a number (bounds re-checked inside `applyWeighIn`); `date?` default today; `applyWeighIn` null → `INVALID_INPUT` ("weight must be a positive number under 1500 lbs; date must be a real calendar date"); payload `{logged: {date: r.entryDate, weightLbs: r.weightLbs}, synced: r.synced}`.

**Prompt fragment (verbatim):**

```
About your journal_ tools: the journal is how the user FELT and their body data — mood, energy, activity, notes and weigh-ins — never what they ate (logs_ tools) or what is scheduled (plan_ tools). journal_search finds past entries ("when did I last note bloating", "how was my energy last week"); journal_get_day reads one day. The scales are fixed: mood and energy go 1 to 4 (1 = bad / very low, 4 = great / high), activity is none, light, moderate or intense — map the user's words onto them, or ask when unclear. To record something, PROPOSE the exact values first ("Mood 4 and a note about poor sleep — save that for today?") and call journal_upsert_entry only after their yes; it changes only the fields you send, and notes REPLACE the day's note — when adding to an existing note, restate the whole thing. A weigh-in goes through journal_log_weight (pounds), also only after their yes; it also updates their current weight and BMI on the dashboard, and if the result says the plan was flagged stale, tell them their meal plan may need a refresh from the Meal Plan tab. You cannot change goal weight or body goals: gap_report (BODY_GOALS). Marking meals as skipped is still not something you can do: gap_report (JOURNAL).
```

**Tool defs** (order + isWrite pinned by the schema test):

1. `journal_search` — "Search the user's journal entries (mood, energy, activity, notes, weigh-ins) by date range, note text, or field. Use for 'when did I last note X', 'how was my energy last week'. NOT for food — logs_search owns what they ate." — props `fromDate`/`toDate` (required), `noteText`, `field` enum `["weight","mood","energy","activity"]`.
2. `journal_get_day` — "One day's journal entry: mood, weight, energy, activity, notes, and meal completion rows. Defaults to today. NOT for intake totals — logs_day_summary does that." — props `date`.
3. `journal_upsert_entry` (isWrite) — "Save mood, energy level, activity level and/or a note for a day, AFTER the user confirmed the exact values. Only the fields sent are changed; notes replace the day's note. Scales: mood/energy 1-4, activity none/light/moderate/intense." — props `date`, `mood` enum, `energyLevel` enum, `activityLevel` enum, `notes`; required `[]` (validated in-handler).
4. `journal_log_weight` (isWrite) — "Record a weigh-in in pounds for a day (default today), AFTER the user confirmed the number. Also updates their current weight and BMI, and may flag the meal plan for a refresh. NOT for changing goal weight — that is not available." — props `weightLbs` (required), `date`.

**Registry FELT row** (replace the hardcoded line in the rows array; add `journalOn`):

```ts
const journalOn = active.some((s) => s.name === "journal");
const feltRow = journalOn
  ? '- How they FELT — mood, energy, activity, notes, symptoms, weigh-ins → journal_ tools (journal_search for the past, journal_get_day for one day; for writes PROPOSE the values first, the write only after their yes).'
  : "- How they FELT — mood, energy, sleep, symptoms, body weight notes → no journal tools yet: gap_report (JOURNAL).";
```

**gap.ts:** `JOURNAL: "journal", // S4` in `CATEGORY_TO_SKILL`.

- [ ] **Step 1: Write the failing tests** — `lib/clara/skills/journal.test.ts` with a `fakeDeps()` in the house style (ops recorded), covering: search date/range/field validation incl. NaN guard + 365 cap + truncation at 30 + newest-first passthrough + noteText slice; getDay null path + date echo; upsert budget-first, vocabulary rejection per field (with scale in message), at-least-one-field, merge payload contains ONLY sent keys, date = day start of the input date; logWeight budget-first, non-number rejection, `applyWeighIn` args passthrough (date default ctx.today), null → INVALID_INPUT, synced passthrough incl. `planFlaggedStale: true` case; schema contract (4 names in order, isWrite `[false,false,true,true]`, no identity params, `weightLbs` required); fragment matches `/PROPOSE/`, `/REPLACE/`, `/gap_report \(BODY_GOALS\)/`, `/none, light, moderate or intense/`; loop round-trip `journal_search` → answer (S2 stub pattern). Registry appends: journal-off combo (`"profile,logs,nutrition,plan"`) → no `journal_` substring + FELT row falls back; journal-on → single-line anchors `/How they FELT[^\n]*journal_search/`, `/How they FELT[^\n]*PROPOSE/`, `/How they FELT[^\n]*after their yes/`, and NOT `/How they FELT[^\n]*journal_upsert_entry/` (flow framing, no bare write steer in the row); 18-def count assertion (`buildToolDefs(resolveActiveSkills(ALL_SKILLS, undefined)).length === 18`) so the tripwire number is pinned. Gap appends: `resolveGapReason("JOURNAL", "NOT_BUILT", ["journal"]) === "FLAGGED_OFF"` / `[]` → `NOT_BUILT`.
- [ ] **Step 2: Run to verify failures** — `npx tsx --test lib/clara/skills/journal.test.ts lib/clara/registry.test.ts lib/clara/gap.test.ts`.
- [ ] **Step 3: Implement** `lib/clara/skills/journal.ts` + the registry/gap edits per the contracts above.
- [ ] **Step 4: Run to green** — same command; then `npm test` → green; `npx tsc --noEmit` → 19.
- [ ] **Step 5: Commit**

```bash
git add lib/clara/skills/journal.ts lib/clara/skills/journal.test.ts lib/clara/registry.ts lib/clara/registry.test.ts lib/clara/gap.ts lib/clara/gap.test.ts
git commit -m "feat(clara): journal skill — search/day reads, merge upsert, cascading weigh-in (S4 E2)"
```

---

### Task E3: Routing fixture — 2 flips + S4 cases (the tripwire run's input)

**Files:**
- Modify: `lib/clara/__fixtures__/routing.ts`

- [ ] **Step 1: Flip the two S1-era JOURNAL gap cases**

```ts
  { utterance: "when did I last note feeling bloated?", expect: "journal_search", note: "S4: flipped from gap_report" },
  { utterance: "how was my energy this week?", expect: "journal_search", note: "S4: flipped from gap_report" },
```

(replacing their `expect: "gap_report"` versions in the adversarial-neighbours block).

- [ ] **Step 2: Append the S4 block** (before the closing `];`):

```ts
  // ── S4 journal — direct hits ──
  { utterance: "how's my mood been this month?", expect: "journal_search" },
  { utterance: "when was my last weigh-in?", expect: "journal_search", note: "field: weight" },
  { utterance: "how active have I been the past two weeks?", expect: "journal_search" },
  { utterance: "what did I journal today?", expect: "journal_get_day" },
  { utterance: "did I write any notes yesterday?", expect: "journal_get_day" },

  // ── S4 writes: confirm-first turn 1, then history-seeded turn 2 ──
  {
    utterance: "I weighed 181 this morning",
    expect: null,
    note: "S4: confirm rule — propose logging 181 lbs; no tool on the first turn",
    expectTextMatch: "181[\\s\\S]*\\?",
  },
  {
    utterance: "yes, log it",
    expect: "journal_log_weight",
    note: "S4: the affirmative after a weigh-in proposal",
    history: [
      { role: "user", content: "I weighed 181 this morning" },
      { role: "assistant", content: "181 lbs for today — want me to log it? It'll also update your dashboard weight." },
    ],
  },
  {
    utterance: "yes please",
    expect: "journal_upsert_entry",
    note: "S4: the affirmative after a mood/note proposal",
    history: [
      { role: "user", content: "note that I slept badly and my mood's been low" },
      { role: "assistant", content: "I'd save mood 2 and the note \"slept badly\" for today — shall I?" },
    ],
  },

  // ── S4 adversarial neighbours ──
  { utterance: "change my goal weight to 165", expect: "gap_report", note: "BODY_GOALS refusal — journal_log_weight must NOT fire" },
  { utterance: "how many calories did I have this week vs target?", expect: "nutrition_range_summary", note: "adherence ≠ how they felt" },
  { utterance: "what did I have for lunch on Friday?", expect: "logs_search", note: "ate ≠ felt — must not drift to journal_search" },

  // ── padding: unambiguous S4 hit ──
  { utterance: "show me my journal entry for last Tuesday", expect: "journal_get_day" },
];
```

- [ ] **Step 3: Update the margin comment and verify the count** — run `node --import tsx -e 'import("./lib/clara/__fixtures__/routing.ts").then(m => console.log(m.ROUTING_FIXTURE.length))'`; expected 68 (56 + 12); set the padding-section comment to "6 misses allowed at 68 cases" (90% of 68 = 61.2 → 6-miss floor). If the count differs, fix the comment to the real number.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 19; `npm test` → green.
- [ ] **Step 5: Commit**

```bash
git add lib/clara/__fixtures__/routing.ts
git commit -m "feat(clara): S4 routing fixture — journal flips + 12 cases (S4 E3)"
```

---

## Cycle process (controller — not subagent work)

- E1 → E2 → E3 sequential. Per-task review; final whole-branch review (write-path reviewer: cascade parity, merge semantics, guard flags; recognition reviewer: FELT boundaries, 18-def coherence, fixture).
- **Audit = the TRIPWIRE RUN**: `npm run clara:routing-eval` (68 cases, real key, release-gate machine). <90% overall OR any S1–S3 case regression → Stage B tiered disclosure becomes cycle C1 before S5 (binding, spec decision 1). Score + per-case misses to the ledger, incl. the two S3-reworded sensor cases.
- Close-out: S4 block in `.superpowers/sdd/progress.md`; merge per superpowers:finishing-a-development-branch.
- Release gate carries: prod `CLARA_SKILLS` unset or includes `journal`; live smoke — "I weighed 181" → confirm → dashboard current weight updates and (if drift ≥5 lbs) Clara mentions the stale plan; JOURNAL gap rows collapse.
