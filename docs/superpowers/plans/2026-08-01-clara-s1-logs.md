# Clara S1 — Logs Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clara reads and writes the user's meal-log history from chat — search, day summary, confirmed create (new `CLARA` source, Clara-estimated macros), confirmed soft-delete.

**Architecture:** One new skill file `lib/clara/skills/logs.ts` plugs into the C0 runtime (one `ALL_SKILLS` entry). All meal-log validation/pricing reuses `lib/meal-log.ts` verbatim — the skill contains no macro logic. Handlers follow the `gap.ts` injected-deps factory so every effect is unit-tested without a DB. Recognition work (tie-breaker table + fixture flips) lands in the same cycle because S1 is the first moment two domains can be confused.

**Tech Stack:** Next.js 14 / TypeScript / Prisma 5 (Neon) / `node:test` + `tsx` / C0 skill runtime (`lib/clara/`).

**Spec:** `docs/superpowers/specs/2026-08-01-clara-s1-logs-skill-design.md`.

## Global Constraints

- One skill file + one registry line (C0 rule 8). A change to `lib/clara/loop.ts` needs a plan amendment.
- Handlers return typed `ToolResult`, never throw. No tool input may carry identity (`registry.test.ts` enforces).
- Writes behind conversational confirm (C0 rule 6) — enforced by the prompt fragment, not new code.
- `logs_create` forces `source: "CLARA"` server-side; source is NOT a tool input. `clientRequestId = "clara:" + toolUseId` (the loop passes the tool-call id — see E2 interface note).
- Search range cap **90 days**, result cap **50 rows** + `truncated` flag; soft-deleted rows excluded everywhere.
- `logs_day_summary` returns items + totals ONLY — no targets, no remaining (S2's boundary).
- Migration is additive-only (one enum value), authored offline, byte-checked against `prisma migrate diff`, applied at the release gate.
- Every task ends green: `npm test`, `npx tsc --noEmit` (no NEW errors; 19 pre-existing), `npm run build`.
- iOS task uses destination `platform=iOS Simulator,name=iPhone 17 Pro`; no new Swift files (pbxproj untouched); `Config/Debug.xcconfig` never staged.
- Routing eval at audit runs the WHOLE accumulated fixture; ≥90% top-1 or Critical. Needs a real key (release-gate machine — local `.env` key is a dud).

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260801000000_clara_meal_log_source/migration.sql` | `MealLogSource` gains `CLARA`. |
| `lib/meal-log.ts` (modify, 2 spots) | `CALLER_SUPPLIED_SOURCES` gains `CLARA`; `validateItem`'s caller-supplied branch admits it. |
| `lib/clara/skills/logs.ts` (new) | The whole skill: `LogsDeps`, `makeLogsHandlers(deps)`, 4 tool defs, prompt fragment, `logsSkill`. |
| `lib/clara/registry.ts` (modify, 2 lines) | Import + `ALL_SKILLS` entry; tie-breaker table into `buildSystemPrompt`. |
| `lib/clara/gap.ts` (modify, 1 line) | `CATEGORY_TO_SKILL.LOGS = "logs"`. |
| `lib/clara/__fixtures__/routing.ts` (modify) | Flip 2 C0 gap expectations to logs tools; append ~15 S1 cases. |
| Tests | `lib/clara/skills/logs.test.ts` (new), `lib/meal-log.test.ts` (append), `lib/clara/registry.test.ts` (append), `lib/clara/gap.test.ts` (append 1). |
| iOS `Clara/Features/Stats/StatsViewModel.swift` + `ClaraTests` + `Clara/App/LaunchFixtures.swift` | T1: deliberate `CLARA` badge + fixture row + test. |

---

## Task E1: `CLARA` meal-log source (schema + acceptance)

**Files:**
- Modify: `prisma/schema.prisma` (the `MealLogSource` enum, ~line 690)
- Create: `prisma/migrations/20260801000000_clara_meal_log_source/migration.sql`
- Modify: `lib/meal-log.ts:415-419` (`CALLER_SUPPLIED_SOURCES`) and the `validateItem` caller-supplied branch (~line 253, comment "MANUAL / PICTURE / FRIDGE")
- Test: `lib/meal-log.test.ts` (append)

**Interfaces:**
- Consumes: existing `parseMealLogInput`, `isCallerSuppliedMacroSource`, `buildMealLogCreateData`, `resolveSnapshot`.
- Produces: `MealLogSource.CLARA` usable everywhere the enum flows; `parseMealLogInput` accepts `source: "CLARA"` with the exact MANUAL semantics (name required, `perServing` optional, absent macros → NULL + `incomplete`).

- [ ] **Step 1: Write the failing tests** — append to `lib/meal-log.test.ts`:

```ts
// ─── CLARA source (S1) — Clara-logged meals, caller-supplied macros ─────────

test("CLARA is a caller-supplied macro source", () => {
  assert.equal(isCallerSuppliedMacroSource(MealLogSource.CLARA), true);
});

test("parseMealLogInput accepts a CLARA row with MANUAL semantics", () => {
  const r = parseMealLogInput({
    localDate: "2026-08-01",
    mealType: "lunch",
    source: "CLARA",
    name: "Tonkotsu ramen",
    servings: 1,
    perServing: { calories: 550, protein: 24 },
    clientRequestId: "clara:toolu_abc",
  });
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.source, "CLARA");
});

test("a CLARA row without a name is rejected, like MANUAL", () => {
  const r = parseMealLogInput({
    localDate: "2026-08-01", mealType: "lunch", source: "CLARA", servings: 1,
  });
  assert.equal(r.ok, false);
});

test("CLARA create data stores stated macros; absent ones NULL + incomplete", () => {
  const parsed = parseMealLogInput({
    localDate: "2026-08-01", mealType: "lunch", source: "CLARA",
    name: "Tonkotsu ramen", servings: 1, perServing: { calories: 550, protein: 24 },
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const resolved = resolveSnapshot(parsed.value, {});
  const data = buildMealLogCreateData("patient-1", parsed.value, resolved);
  assert.equal(data.source, "CLARA");
  assert.equal(data.calories, 550);
  assert.equal(data.protein, 24);
  assert.equal(data.carbs, null);   // unknown ≠ 0
  assert.equal(data.incomplete, true);
  assert.equal(data.name, "Tonkotsu ramen");
});
```

Add `resolveSnapshot` to the file's existing `./meal-log` import if absent.

- [ ] **Step 2: Run to verify failure**

Run: `npm test 2>&1 | grep -E "CLARA|fail"`
Expected: FAIL — `MealLogSource.CLARA` does not exist (TS error surfaces as a load failure).

- [ ] **Step 3: Schema + migration**

In `prisma/schema.prisma`, extend the enum (comment style matches neighbours):

```prisma
enum MealLogSource {
  MANUAL // typed/edited by hand (web or iOS)
  RECIPE // logged from an existing Recipe row (incl. meal-plan dishes)
  PICTURE // one-tap from a Picture Mode vision result
  FRIDGE // "I cooked this" on a Fridge Mode generated recipe
  CUSTOM // from a PatientCustomIngredient (premium)
  RESTAURANT // "Add to today" from a restaurant menu dish
  CLARA // logged by Clara from chat (S1) — Clara's stated estimate is the snapshot
}
```

Create `prisma/migrations/20260801000000_clara_meal_log_source/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "MealLogSource" ADD VALUE 'CLARA';
```

Run `npx prisma generate` (NOT `migrate dev` — applies at the release gate). Then verify the SQL matches Prisma's own diff:

Run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_UNPOOLED" --script 2>/dev/null | head -5`
Expected: only the `ALTER TYPE ... ADD VALUE 'CLARA'` statement (or empty if the tool counts the new folder; either way no OTHER statements).

- [ ] **Step 4: Admit CLARA in `lib/meal-log.ts`** — two edits:

```ts
const CALLER_SUPPLIED_SOURCES: ReadonlySet<MealLogSource> = new Set([
  MealLogSource.MANUAL,
  MealLogSource.PICTURE,
  MealLogSource.FRIDGE,
  MealLogSource.CLARA, // S1 — Clara-logged; her stated estimate is the snapshot
]);
```

In `validateItem`, find the caller-supplied branch (comment "MANUAL / PICTURE / FRIDGE — caller supplies per-serving macros and a name"). If it tests membership via `CALLER_SUPPLIED_SOURCES`/`isCallerSuppliedMacroSource`, the set change above is sufficient — update only the comment to "MANUAL / PICTURE / FRIDGE / CLARA". If it enumerates sources explicitly, add `CLARA` to that enumeration. The Step-1 tests are the arbiter.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS, count +4.

- [ ] **Step 6: Typecheck, build, commit**

```bash
npx tsc --noEmit   # no NEW errors (19 pre-existing)
npm run build
git add prisma lib/meal-log.ts lib/meal-log.test.ts
git commit -m "feat(meal-log): CLARA source — Clara-logged meals with caller-supplied macros (S1 E1)"
```

---

## Task E2: The logs skill

**Files:**
- Create: `lib/clara/skills/logs.ts`
- Test: `lib/clara/skills/logs.test.ts`
- Modify: `lib/clara/registry.ts` (import + `ALL_SKILLS`), `lib/clara/gap.ts` (`CATEGORY_TO_SKILL`), `lib/clara/gap.test.ts` (one test)
- Modify: `lib/clara/loop.ts` + `lib/clara/types.ts` — **pre-authorized amendment**: `execute` gains the tool-call id as a third argument (see Interfaces). This is the plan's ONE loop change; anything further needs a fresh amendment.

**Interfaces:**
- Consumes: `ToolResult`, `ClaraContext`, `Skill` (`../types`); `parseMealLogInput`, `resolveSnapshot`, `buildMealLogCreateData`, `buildMealLogUpsertArgs`, `serializeMealLog`, `MEAL_TYPES` (`@/lib/meal-log`); `shiftLocalDate`, `parseLocalDateStrict` guards via `@/lib/journal`.
- Produces: `logsSkill: Skill` (name `"logs"`); `LogsDeps` + `makeLogsHandlers(deps)` for tests; tools `logs_search`, `logs_day_summary`, `logs_create`, `logs_delete`.
- **Loop change (types.ts + loop.ts):** `execute: (name, input, toolUseId: string) => Promise<ToolResult>` — the loop passes `call.id`. The route's `execute` forwards it to `tool.handler(ctx, input, toolUseId)`; `SkillTool.handler` gains the optional third param. Existing handlers ignore it. One loop test updates: assert the id is forwarded.

- [ ] **Step 1: Write the failing tests** — create `lib/clara/skills/logs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { logsSkill, makeLogsHandlers, type LogsDeps } from "./logs";
import type { ClaraContext } from "../types";

const ctx: ClaraContext = {
  patientId: "p1", accountId: "a1", firstName: "Sam", isPremium: false,
  today: "2026-08-01", surface: "web", disabledSkills: [],
};

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "log-1", localDate: "2026-08-01", mealType: "lunch", source: "CLARA",
  name: "Ramen", servings: 1, calories: 550, protein: 24, carbs: null, fat: null,
  fiber: null, incomplete: true, recipeId: null, restaurantDishId: null,
  customIngredientId: null, journalMealId: null, pictureResultId: null,
  fridgeRecipeId: null, planExchangeId: null, note: null, clientRequestId: null,
  deletedAt: null, loggedAt: new Date("2026-08-01T12:00:00Z"),
  updatedAt: new Date("2026-08-01T12:00:00Z"),
  ...over,
});

function fakeDeps(over: Partial<LogsDeps> = {}) {
  const writes: unknown[] = [];
  const deletes: string[] = [];
  const deps: LogsDeps = {
    findRows: async () => [row()],
    findById: async (id) => (id === "log-1" ? row() : null),
    create: async (args) => { writes.push(args); return row(); },
    softDelete: async (id) => { deletes.push(id); },
    ...over,
  };
  return { deps, writes, deletes };
}
const h = (deps: LogsDeps) => makeLogsHandlers(deps);

// ── shape ──
test("the skill registers 4 logs_ tools with no identity fields", () => {
  assert.equal(logsSkill.name, "logs");
  assert.deepEqual(logsSkill.tools.map((t) => t.def.name),
    ["logs_search", "logs_day_summary", "logs_create", "logs_delete"]);
});

// ── search ──
test("search validates dates and caps the range at 90 days", async () => {
  const bad = await h(fakeDeps().deps).search(ctx, { fromDate: "garbage", toDate: "2026-08-01" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.reason, "INVALID_INPUT");
  const wide = await h(fakeDeps().deps).search(ctx, { fromDate: "2020-01-01", toDate: "2026-08-01" });
  assert.equal(!wide.ok && wide.reason, "OUT_OF_RANGE");
});

test("search returns serialized rows and an empty list is ok:true", async () => {
  const { deps } = fakeDeps({ findRows: async () => [] });
  const r = await h(deps).search(ctx, { fromDate: "2026-07-25", toDate: "2026-08-01" });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && (r.data as { items: unknown[] }).items, []);
});

test("search truncates at 51+ rows and says so", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row({ id: `log-${i}` }));
  const { deps } = fakeDeps({ findRows: async () => rows });
  const r = await h(deps).search(ctx, { fromDate: "2026-07-25", toDate: "2026-08-01" });
  assert.ok(r.ok);
  const data = r.ok ? (r.data as { items: unknown[]; truncated: boolean }) : null!;
  assert.equal(data.items.length, 50);
  assert.equal(data.truncated, true);
});

// ── day summary ──
test("day summary defaults to ctx.today and sums with null-safe totals", async () => {
  const asked: unknown[] = [];
  const { deps } = fakeDeps({
    findRows: async (q) => { asked.push(q); return [row(), row({ id: "log-2", calories: 300, protein: null, incomplete: true })]; },
  });
  const r = await h(deps).daySummary(ctx, {});
  assert.ok(r.ok);
  const data = r.ok ? (r.data as { date: string; totals: { calories: number }; incompleteCount: number }) : null!;
  assert.equal(data.date, "2026-08-01");
  assert.equal(data.totals.calories, 850);
  assert.equal(data.incompleteCount, 2);
});

// ── create ──
test("create forces source CLARA and derives clientRequestId from the tool call", async () => {
  const { deps, writes } = fakeDeps();
  const r = await h(deps).create(ctx, {
    name: "Tonkotsu ramen", mealType: "lunch", date: "2026-08-01",
    servings: 1, calories: 550, protein: 24,
  }, "toolu_xyz");
  assert.ok(r.ok);
  const args = writes[0] as { create: { source: string; clientRequestId: string; calories: number; carbs: null; incomplete: boolean; patientId: string } };
  assert.equal(args.create.source, "CLARA");
  assert.equal(args.create.clientRequestId, "clara:toolu_xyz");
  assert.equal(args.create.calories, 550);
  assert.equal(args.create.carbs, null);
  assert.equal(args.create.incomplete, true);
  assert.equal(args.create.patientId, "p1"); // ctx, never input
});

test("create rejects a bad mealType or absent name as INVALID_INPUT, not a throw", async () => {
  const r1 = await h(fakeDeps().deps).create(ctx, { name: "x", mealType: "brunch", date: "2026-08-01" }, "t");
  assert.equal(!r1.ok && r1.reason, "INVALID_INPUT");
  const r2 = await h(fakeDeps().deps).create(ctx, { mealType: "lunch", date: "2026-08-01" }, "t");
  assert.equal(!r2.ok && r2.reason, "INVALID_INPUT");
});

test("a create input cannot smuggle a server-priced source or foreign patient", async () => {
  const { deps, writes } = fakeDeps();
  await h(deps).create(ctx, {
    name: "x", mealType: "lunch", date: "2026-08-01",
    source: "RECIPE", patientId: "attacker", recipeId: "r-1",
  }, "t");
  const args = writes[0] as { create: { source: string; patientId: string; recipeId: null } };
  assert.equal(args.create.source, "CLARA");
  assert.equal(args.create.patientId, "p1");
  assert.equal(args.create.recipeId, null);
});

// ── delete ──
test("delete tombstones an owned row", async () => {
  const { deps, deletes } = fakeDeps();
  const r = await h(deps).del(ctx, { logId: "log-1" });
  assert.ok(r.ok);
  assert.deepEqual(deletes, ["log-1"]);
});

test("delete of a missing or foreign row is NOT_FOUND", async () => {
  const { deps, deletes } = fakeDeps({ findById: async () => null });
  const r = await h(deps).del(ctx, { logId: "someone-elses" });
  assert.equal(!r.ok && r.reason, "NOT_FOUND");
  assert.deepEqual(deletes, []);
});

test("delete of an already-deleted row is NOT_FOUND, not a second tombstone", async () => {
  const { deps, deletes } = fakeDeps({ findById: async () => row({ deletedAt: new Date() }) });
  const r = await h(deps).del(ctx, { logId: "log-1" });
  assert.equal(!r.ok && r.reason, "NOT_FOUND");
  assert.deepEqual(deletes, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test 2>&1 | grep "logs.test"`
Expected: FAIL — cannot find module `./logs`.

- [ ] **Step 3: The loop amendment (types + loop + its test)**

`lib/clara/types.ts`: `SkillTool.handler` becomes
`(ctx: ClaraContext, input: Record<string, unknown>, toolUseId?: string) => Promise<ToolResult>`.
`LoopParams.execute` becomes
`(name: string, input: Record<string, unknown>, toolUseId: string) => Promise<ToolResult>`.

`lib/clara/loop.ts` (the one pre-authorized edit): `params.execute(call.name, call.input)` → `params.execute(call.name, call.input, call.id)`.

`app/api/dish-checker/route.ts`: `execute` signature gains `toolUseId` and forwards it: `return tool.handler(ctx, input, toolUseId);`.

Append to `lib/clara/loop.test.ts`:

```ts
test("the tool call id reaches execute — write skills derive idempotency from it", async () => {
  const { client } = stubClient([
    { content: [toolUse("toolu_42", "x_get")] },
    { deltas: ["done"] },
  ]);
  const seenIds: string[] = [];
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2,
      execute: async (_n, _i, id) => { seenIds.push(id); return { ok: true, data: null }; },
    })
  );
  assert.deepEqual(seenIds, ["toolu_42"]);
});
```

- [ ] **Step 4: Write `lib/clara/skills/logs.ts`**

```ts
import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  MEAL_TYPES, parseMealLogInput, resolveSnapshot, buildMealLogCreateData,
  buildMealLogUpsertArgs, serializeMealLog, type MealLogRow, type MealLogCreateData,
} from "@/lib/meal-log";
import { parseLocalDateStrict } from "@/lib/journal";
import type { ClaraContext, Skill, ToolResult } from "../types";

export const MAX_SEARCH_DAYS = 90;
export const MAX_SEARCH_ROWS = 50;

/** Effects, injected so every handler path is unit-tested without a DB. */
export interface LogsDeps {
  findRows: (q: {
    patientId: string; fromDate: string; toDate: string;
    text?: string; mealType?: string; limit: number;
  }) => Promise<MealLogRow[]>;
  findById: (id: string, patientId: string) => Promise<MealLogRow | null>;
  create: (args: ReturnType<typeof buildMealLogUpsertArgs>) => Promise<MealLogRow>;
  softDelete: (id: string) => Promise<void>;
}

const prismaDeps: LogsDeps = {
  findRows: async (q) =>
    prisma.mealLog.findMany({
      where: {
        patientId: q.patientId,
        deletedAt: null,
        localDate: { gte: q.fromDate, lte: q.toDate },
        ...(q.mealType ? { mealType: q.mealType } : {}),
        ...(q.text ? { name: { contains: q.text, mode: "insensitive" } } : {}),
      },
      orderBy: [{ localDate: "desc" }, { loggedAt: "desc" }],
      take: q.limit,
    }),
  findById: async (id, patientId) =>
    prisma.mealLog.findFirst({ where: { id, patientId } }),
  create: async (args) => prisma.mealLog.upsert(args),
  softDelete: async (id) => {
    await prisma.mealLog.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};

const dayGap = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });

export function makeLogsHandlers(deps: LogsDeps = prismaDeps) {
  const search = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const fromDate = typeof input.fromDate === "string" ? input.fromDate : ctx.today;
    const toDate = typeof input.toDate === "string" ? input.toDate : ctx.today;
    if (!parseLocalDateStrict(fromDate) || !parseLocalDateStrict(toDate)) {
      return invalid("fromDate/toDate must be YYYY-MM-DD");
    }
    if (dayGap(fromDate, toDate) > MAX_SEARCH_DAYS) {
      return { ok: false, reason: "OUT_OF_RANGE", message: `Range is capped at ${MAX_SEARCH_DAYS} days — narrow it.` };
    }
    const text = typeof input.text === "string" && input.text.trim() ? input.text.trim().slice(0, 80) : undefined;
    const mealType = typeof input.mealType === "string" && MEAL_TYPES.includes(input.mealType as never) ? input.mealType : undefined;
    const rows = await deps.findRows({
      patientId: ctx.patientId, fromDate, toDate, text, mealType, limit: MAX_SEARCH_ROWS + 1,
    });
    const truncated = rows.length > MAX_SEARCH_ROWS;
    return {
      ok: true,
      data: { items: rows.slice(0, MAX_SEARCH_ROWS).map((r) => serializeMealLog(r)), truncated },
    };
  };

  const daySummary = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const date = typeof input.date === "string" ? input.date : ctx.today;
    if (!parseLocalDateStrict(date)) return invalid("date must be YYYY-MM-DD");
    const rows = await deps.findRows({
      patientId: ctx.patientId, fromDate: date, toDate: date, limit: MAX_SEARCH_ROWS + 1,
    });
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    let incompleteCount = 0;
    for (const r of rows) {
      const dto = serializeMealLog(r);
      totals.calories += dto.totals.calories ?? 0;
      totals.protein += dto.totals.protein ?? 0;
      totals.carbs += dto.totals.carbs ?? 0;
      totals.fat += dto.totals.fat ?? 0;
      totals.fiber += dto.totals.fiber ?? 0;
      if (r.incomplete) incompleteCount += 1;
    }
    return {
      ok: true,
      data: { date, items: rows.slice(0, MAX_SEARCH_ROWS).map((r) => serializeMealLog(r)), totals, incompleteCount },
    };
  };

  const create = async (
    ctx: ClaraContext, input: Record<string, unknown>, toolUseId = "unknown"
  ): Promise<ToolResult> => {
    // Everything funnels through the ROUTE's own validator — the skill adds no
    // rules of its own. Source is forced CLARA and provenance ids are stripped:
    // a model input can never smuggle a server-priced source or a foreign row.
    const date = typeof input.date === "string" ? input.date : ctx.today;
    const perServing: Record<string, unknown> = {};
    for (const k of ["calories", "protein", "carbs", "fat", "fiber"] as const) {
      if (typeof input[k] === "number") perServing[k] = input[k];
    }
    const parsed = parseMealLogInput({
      localDate: date,
      mealType: input.mealType,
      source: MealLogSource.CLARA,
      name: input.name,
      servings: input.servings ?? 1,
      ...(Object.keys(perServing).length > 0 ? { perServing } : {}),
      ...(typeof input.note === "string" ? { note: input.note } : {}),
      clientRequestId: `clara:${toolUseId}`,
    });
    if (!parsed.ok) return invalid(parsed.error);
    const resolved = resolveSnapshot(parsed.value, {});
    const data: MealLogCreateData = buildMealLogCreateData(ctx.patientId, parsed.value, resolved);
    const row = await deps.create(buildMealLogUpsertArgs(data));
    return { ok: true, data: { logged: serializeMealLog(row) } };
  };

  const del = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const logId = typeof input.logId === "string" ? input.logId : "";
    if (!logId) return invalid("logId is required — find it with logs_search first");
    const row = await deps.findById(logId, ctx.patientId);
    if (!row || row.deletedAt) {
      return { ok: false, reason: "NOT_FOUND", message: "No such log entry (it may already be deleted)." };
    }
    await deps.softDelete(row.id);
    return { ok: true, data: { deleted: { id: row.id, name: row.name, localDate: row.localDate } } };
  };

  return { search, daySummary, create, del };
}

const handlers = makeLogsHandlers();

export const logsSkill: Skill = {
  name: "logs",
  promptFragment:
    "About your logs_ tools: the meal log is the record of what the user ACTUALLY ATE (their intake), not what was planned. Use logs_search for any question about past eating; logs_day_summary for a single day's items and totals — it has no goals or targets, so questions about calories LEFT or targets are not answerable yet (call gap_report with category NUTRITION). To log a meal: first state your estimate and ask (\"Around 550 kcal — want me to log it for lunch?\"); only after they agree call logs_create with exactly the numbers you stated. Omit any macro you are genuinely unsure of rather than inventing it. To delete: find the row with logs_search, and if several match what they described, list them and ask which — never guess. logs_delete needs the id from a search result in this conversation.",
  tools: [
    {
      def: {
        name: "logs_search",
        description:
          "Search the user's meal-log history (what they actually ate) by date range and optional text/meal-type. Use for 'what did I eat …' questions. NOT for planned meals, and NOT for day totals — logs_day_summary does totals.",
        input_schema: {
          type: "object",
          properties: {
            fromDate: { type: "string", description: "Start, YYYY-MM-DD (inclusive). Resolve relative phrases against today's date first." },
            toDate: { type: "string", description: "End, YYYY-MM-DD (inclusive). Range capped at 90 days." },
            text: { type: "string", description: "Optional name filter, e.g. 'ramen'." },
            mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
          },
          required: ["fromDate", "toDate"],
        },
      },
      handler: handlers.search,
    },
    {
      def: {
        name: "logs_day_summary",
        description:
          "One day's logged meals plus summed calories/protein/carbs/fat/fiber. Use for 'how much protein have I had today'. Totals only — it does NOT know targets or how much is LEFT.",
        input_schema: {
          type: "object",
          properties: { date: { type: "string", description: "YYYY-MM-DD; omit for today." } },
        },
      },
      handler: handlers.daySummary,
    },
    {
      def: {
        name: "logs_create",
        description:
          "Log a meal the user actually ate, AFTER they have confirmed your stated estimate in conversation. Pass exactly the macro numbers you told them; omit any you did not state. Never call it on the same turn the meal is first mentioned.",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Dish name, e.g. 'Tonkotsu ramen'. Max 120 chars." },
            mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
            date: { type: "string", description: "YYYY-MM-DD; omit for today." },
            servings: { type: "number", description: "Defaults to 1." },
            calories: { type: "number", description: "Per-serving kcal, exactly as stated to the user." },
            protein: { type: "number" }, carbs: { type: "number" },
            fat: { type: "number" }, fiber: { type: "number" },
            note: { type: "string" },
          },
          required: ["name", "mealType"],
        },
      },
      handler: handlers.create,
    },
    {
      def: {
        name: "logs_delete",
        description:
          "Delete one meal-log entry, AFTER the user confirmed which one. logId must come from a logs_search/logs_day_summary result in this conversation. If several entries matched their description, ask which — do not pick one.",
        input_schema: {
          type: "object",
          properties: { logId: { type: "string" } },
          required: ["logId"],
        },
      },
      handler: handlers.del,
    },
  ],
};
```

- [ ] **Step 5: Register** — `lib/clara/registry.ts`: `import { logsSkill } from "./skills/logs";` and `export const ALL_SKILLS: Skill[] = [profileSkill, logsSkill];`. `lib/clara/gap.ts`: `CATEGORY_TO_SKILL` gains `LOGS: "logs",`. Append to `lib/clara/gap.test.ts`:

```ts
test("a LOGS gap while the logs skill is disabled is FLAGGED_OFF", () => {
  assert.equal(resolveGapReason("LOGS", "NOT_BUILT", ["logs"]), "FLAGGED_OFF");
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: PASS (registry's uniqueness + no-identity-field tests now sweep `logs_*` automatically).

- [ ] **Step 7: Typecheck, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/clara app/api/dish-checker/route.ts
git commit -m "feat(clara): logs skill — search, day summary, confirmed create/delete (S1 E2)"
```

---

## Task E3: Recognition — tie-breaker table + fixture

**Files:**
- Modify: `lib/clara/registry.ts` (`buildSystemPrompt` — insert the table into `runtimeRules`)
- Modify: `lib/clara/__fixtures__/routing.ts` (flip 2, append 15)
- Test: `lib/clara/registry.test.ts` (append)

**Interfaces:** none new — prompt text + fixture data only.

- [ ] **Step 1: Failing test** — append to `lib/clara/registry.test.ts`:

```ts
// S1: first cycle with two confusable domains — the tie-breaker table enters.
test("the tie-breaker table separates eaten / planned / felt", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-08-01");
  assert.match(prompt, /Which domain owns the question/i);
  assert.match(prompt, /actually ATE .*logs_/i);
  assert.match(prompt, /planned|for dinner/i);
  assert.match(prompt, /mood, energy/i);
});

test("the table is absent when the toolbox is empty, like every tool rule", () => {
  const prompt = buildSystemPrompt("Sam", "none", [], null);
  assert.ok(!/Which domain owns the question/i.test(prompt));
});
```

- [ ] **Step 2: Run to verify failure** — `npm test 2>&1 | grep "tie-breaker"` → FAIL.

- [ ] **Step 3: Insert the table** — in `buildSystemPrompt`, inside `runtimeRules` immediately after the "identify WHAT the question is about" paragraph:

```ts
  const tieBreakers = `

Which domain owns the question (do not mix these up):
- What they actually ATE — past meals, intake, "what did I eat", "how much protein today" → logs_ tools.
- What is PLANNED — "what's for dinner", the meal plan, swapping dishes → you have no plan tools yet: gap_report (MEAL_PLAN) and say so.
- How they FELT — mood, energy, sleep, symptoms, body weight notes → no journal tools yet: gap_report (JOURNAL).
- Calories LEFT or targets → logs_day_summary knows only what was eaten, not goals: answer totals, and gap_report (NUTRITION) if they want remaining/targets.
- Whether a dish FITS their profile → no tool; answer from the profile above.`;
```

and append `${tieBreakers}` to `runtimeRules` (before the "Rules that always apply" block). The MEAL_PLAN/JOURNAL/NUTRITION lines are updated by those future cycles — each replaces its own line when its tools land.

- [ ] **Step 4: Fixture — flip the two now-buildable C0 rows and append S1 cases.** In `lib/clara/__fixtures__/routing.ts`, change:

```ts
  { utterance: "what did I eat two weeks ago?", expect: "logs_search", note: "S1" },
  { utterance: "log that ramen for lunch", expect: null, note: "S1: PROPOSES first (confirm rule) — no tool on the first turn" },
```

(the create case expects `null` because the confirm rule forbids a first-turn write — the proposal is the correct behavior), and append:

```ts
  // ── S1 logs — direct hits ──
  { utterance: "what did I have for breakfast yesterday?", expect: "logs_search" },
  { utterance: "did I eat any fish last week?", expect: "logs_search" },
  { utterance: "how much protein have I had today?", expect: "logs_day_summary" },
  { utterance: "show me today's meals", expect: "logs_day_summary" },
  { utterance: "how many calories did I eat on Monday?", expect: "logs_day_summary" },
  { utterance: "delete the snack I logged twice", expect: "logs_search", note: "find candidates first, then confirm" },

  // ── adversarial neighbours — must NOT hit logs ──
  { utterance: "what's for dinner tomorrow?", expect: "gap_report", note: "planned ≠ eaten (MEAL_PLAN)" },
  { utterance: "swap Wednesday's lunch for something else", expect: "gap_report", note: "MEAL_PLAN" },
  { utterance: "when did I last note feeling bloated?", expect: "gap_report", note: "felt ≠ eaten (JOURNAL)" },
  { utterance: "how was my energy this week?", expect: "gap_report", note: "JOURNAL" },
  { utterance: "how many calories do I have left today?", expect: "logs_day_summary", note: "totals answerable; remaining is S2 — either way NOT a gap-only turn" },
  { utterance: "is ramen okay for me?", expect: null, note: "dish check — profile, no tool" },

  // ── confirm flow, second turn ──
  { utterance: "yes, log it", expect: "logs_create", note: "assumes a prior proposal turn in history — eval seeds it" },
```

For the last case the eval needs a two-turn message array; extend `RoutingCase` with optional `history?: { role: "user" | "assistant"; content: string }[]` and set it: user "log that ramen for lunch" → assistant "Tonkotsu ramen is about 550 kcal with 24g protein — want me to log it for lunch?". In `scripts/clara-routing-eval.mjs`, build `messages: [...(testCase.history ?? []), { role: "user", content: testCase.utterance }]`.

- [ ] **Step 5: Run the suite** — `npm test` → PASS (fixture is data; the registry tests pin the table).

- [ ] **Step 6: Commit**

```bash
git add lib/clara scripts/clara-routing-eval.mjs
git commit -m "feat(clara): tie-breaker table + S1 routing fixture (S1 E3)"
```

---

## Task T1 (Clara iOS): deliberate CLARA badge

**Files:**
- Modify: `Clara/Features/Stats/StatsViewModel.swift:91-101` (`sourceBadge`)
- Modify: `Clara/App/LaunchFixtures.swift` (~line 972 — add one CLARA row to the meal-log fixture day)
- Test: `ClaraTests/StatsViewModelTests.swift` (append; file exists — no pbxproj change)

**Interfaces:** none — display only. `source` decodes as `String`; the `default:` branch already tolerates `"CLARA"` (verified 2026-08-01), so an unpatched client renders "Clara"/neutral. This task makes it deliberate.

- [ ] **Step 1: Failing test** — append to `ClaraTests/StatsViewModelTests.swift`:

```swift
    func testClaraSourceGetsItsOwnBadge() {
        let badge = StatsViewModel.sourceBadge("CLARA")
        XCTAssertEqual(badge.text, "Clara")
        XCTAssertEqual(badge.variant, .info)
    }

    func testUnknownSourceStillFallsThroughTolerantly() {
        let badge = StatsViewModel.sourceBadge("FUTURE_THING")
        XCTAssertEqual(badge.text, "Future_thing")
        XCTAssertEqual(badge.variant, .neutral)
    }
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Desktop/BeTech/Clara
xcodebuild test -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:ClaraTests/StatsViewModelTests 2>&1 | tail -5
```
Expected: FAIL — CLARA falls to `default:` → variant `.neutral`, not `.info`.

- [ ] **Step 3: Add the case** — in `sourceBadge`, before `default:`:

```swift
        case "CLARA": return ("Clara", .info)      // S1: logged by Clara from chat
```

- [ ] **Step 4: Fixture row** — in `LaunchFixtures.swift`, append to the fixture day's meal-log items array (match the neighbouring rows' exact JSON shape):

```swift
               {"id":"fx-l5","mealType":"snack","source":"CLARA","name":"Tonkotsu Ramen · via Clara","servings":1,
```
with per-serving/totals fields copied from the `fx-l3` MANUAL row's structure (same keys, values 550 kcal / 24 protein, carbs null).

- [ ] **Step 5: Full iOS suite**

```bash
xcodebuild test -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | grep -E "Executed 40|TEST" | tail -3
```
Expected: PASS (403+).

- [ ] **Step 6: Commit** (never stage `Config/Debug.xcconfig`)

```bash
git add Clara/Features/Stats/StatsViewModel.swift Clara/App/LaunchFixtures.swift ClaraTests/StatsViewModelTests.swift
git commit -m "feat(stats): deliberate Clara badge for CLARA-source meal logs (S1 T1)"
```

---

## Cycle close-out (controller)

- [ ] Per-task reviews (implementer diff per task), then final whole-branch review: contract walk of the E2 loop-signature change (old handlers unaffected), auth scope of all 4 tool schemas, migration additivity, prompt-fragment confirm rules.
- [ ] Audit: `npm test` + `tsc` + build; iOS suite on iPhone 17 Pro; screenshot of the fixture day showing the Clara badge; routing eval over the WHOLE fixture with a real key — score in the ledger, ≥90% or Critical.
- [ ] Ledger close-out; memory update (CLARA source semantics).
- [ ] Release gate: `prisma migrate deploy` (the enum ALTER) BEFORE merge deploy reaches users; live smoke — "log that ramen for lunch" → confirm → row lands with `source: CLARA` and Clara's exact stated numbers; `/admin/clara-gaps` LOGS rows collapse over the following days.
