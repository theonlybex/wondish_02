# Clara S2 — Nutrition & Targets Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clara answers "calories left / did I go over / am I hitting my protein / what are my targets" from real data, read-only, via a `nutrition` skill on the C0 runtime.

**Architecture:** One new skill file `lib/clara/skills/nutrition.ts` (3 tools, injected-deps factory like S1's logs) + the recorded cross-skill wiring: registry line, nutrition-aware tie-breaker row, one-sentence trim in logs' fragment, `CATEGORY_TO_SKILL` entry, routing-fixture additions. All math reuses `getDayEnvelope` / `getDayTarget` / `computeRemaining` (`lib/meal-log.ts`) and `sumMealLogs` / `r1` (`lib/macros.ts`) — the skill contains **no nutrition math of its own**.

**Tech Stack:** Next.js / TypeScript, Prisma, `node --import tsx --test` (suite: `npm test`), no new deps, **no migration**.

**Spec (contract of record):** `docs/superpowers/specs/2026-08-02-clara-s2-nutrition-skill-design.md`

## Global Constraints

- Branch: `cycle-clara-s2-nutrition` off `main` (branch already carries the spec commit 2853807).
- Read-only skill: no confirm protocol, no write rate cap, no premium gate, no migration, no iOS work (explicit no-client-change cycle).
- `lib/clara/loop.ts` and `lib/clara/types.ts` are UNTOUCHED. Files S2 may modify beyond its own: `registry.ts` (tie-breaker + one import + one array entry), `gap.ts` (one map entry), `skills/logs.ts` (delete one fragment sentence), `__fixtures__/routing.ts` (append + flip one case). Anything else needs an amendment.
- Handlers NEVER throw — every outcome is a typed `ToolResult`. Incomplete caloric profile is `ok:true` with `target: null` + note, never an error.
- No tool input may identify a user/patient (`patientId` comes from `ctx`).
- Range cap: **31 days**. Empty days are excluded from averages but reported via `daysInRange` / `daysLogged`.
- Targets carry no fiber (engine limitation) — never invent one; `dayTotals`/averages do include fiber.
- Suite must stay green (`npm test`, 767 pre-S2); `npx tsc --noEmit` has **19 pre-existing errors** — add none.
- House test idiom: `node:test` + `assert/strict`, deps-injection fakes, no DB in unit tests.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/clara/skills/nutrition.ts` | create | 3 tool defs + handlers (`makeNutritionHandlers(deps)`), prompt fragment, `nutritionSkill` |
| `lib/clara/skills/nutrition.test.ts` | create | handler units, schema contract, loop round-trip |
| `lib/clara/registry.ts` | modify | import + `ALL_SKILLS` entry; nutrition-aware "calories LEFT" tie-breaker row |
| `lib/clara/registry.test.ts` | modify | flag-combination + tie-breaker assertions |
| `lib/clara/gap.ts` | modify | `NUTRITION: "nutrition"` in `CATEGORY_TO_SKILL` |
| `lib/clara/gap.test.ts` | modify | FLAGGED_OFF resolution for NUTRITION |
| `lib/clara/skills/logs.ts` | modify | delete the stale gap_report(NUTRITION) sentence from `promptFragment` |
| `lib/clara/__fixtures__/routing.ts` | modify | flip 1 case, append 12 |

---

### Task E1: `nutrition.ts` — handlers, tool defs, fragment (TDD)

**Files:**
- Create: `lib/clara/skills/nutrition.ts`
- Test: `lib/clara/skills/nutrition.test.ts`

**Interfaces:**
- Consumes (all existing): `getDayEnvelope(patientId, localDate): Promise<DayEnvelope>` and `getDayTarget(patientId, localDate, usePlanRamp?): Promise<DailyTargets | null>` and `computeRemaining(target, totals): Remaining | null` and `type DayEnvelope` from `@/lib/meal-log`; `sumMealLogs(rows): MacroSnapshot`, `r1(n)`, `type MacroSnapshot` from `@/lib/macros`; `type DailyTargets` from `@/lib/caloric-engine`; `parseLocalDateStrict` from `@/lib/journal`; `ClaraContext`, `Skill`, `ToolResult` from `../types`; `prisma` from `@/lib/db`.
- Produces: `nutritionSkill: Skill` (name `"nutrition"`), `makeNutritionHandlers(deps?: NutritionDeps)`, `NutritionDeps`, `SlimLogRow`, `MAX_RANGE_DAYS = 31`, `PROFILE_INCOMPLETE_NOTE` — E2 imports `nutritionSkill`; tests import the rest.

- [ ] **Step 1: Write the failing tests**

Create `lib/clara/skills/nutrition.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nutritionSkill,
  makeNutritionHandlers,
  MAX_RANGE_DAYS,
  PROFILE_INCOMPLETE_NOTE,
  type NutritionDeps,
  type SlimLogRow,
} from "./nutrition";
import type { ClaraContext } from "../types";
import type { DayEnvelope } from "@/lib/meal-log";
import { sumMealLogs } from "@/lib/macros";

const ctx: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-08-02",
  surface: "web",
  disabledSkills: [],
};

const TARGET = {
  calories: 1800, protein: 120, carbs: 180, fat: 60,
  profile: "balanced" as const, basis: "steady-state" as const,
};

const envelope = (over: Partial<DayEnvelope> = {}): DayEnvelope => ({
  dayTotals: { calories: 1320, protein: 82, carbs: 140, fat: 44, fiber: 18, incomplete: false },
  dayTarget: TARGET,
  remaining: { calories: 480, protein: 38, carbs: 40, fat: 16 },
  ...over,
});

const slim = (over: Partial<SlimLogRow> = {}): SlimLogRow => ({
  localDate: "2026-08-01",
  calories: 500, protein: 30, carbs: 50, fat: 15, fiber: 5,
  servings: 1,
  incomplete: false,
  ...over,
});

function fakeDeps(over: Partial<NutritionDeps> = {}) {
  const envelopeCalls: string[] = [];
  const targetCalls: { localDate: string; usePlanRamp?: boolean }[] = [];
  const deps: NutritionDeps = {
    getEnvelope: async (_p, localDate) => {
      envelopeCalls.push(localDate);
      return envelope();
    },
    getTarget: async (_p, localDate, usePlanRamp) => {
      targetCalls.push({ localDate, usePlanRamp });
      return TARGET;
    },
    findSlimRows: async () => [slim()],
    ...over,
  };
  return { deps, envelopeCalls, targetCalls };
}

// ── nutrition_day ──

test("day: defaults to ctx.today, echoes the date, passes the envelope through", async () => {
  const { deps, envelopeCalls } = fakeDeps();
  const h = makeNutritionHandlers(deps);
  const res = await h.day(ctx, {});
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.date, "2026-08-02");
  assert.deepEqual(data.dayTarget, TARGET);
  assert.deepEqual(data.remaining, { calories: 480, protein: 38, carbs: 40, fat: 16 });
  assert.deepEqual(envelopeCalls, ["2026-08-02"]);
  assert.equal("note" in data, false);
});

test("day: explicit date is used verbatim", async () => {
  const { deps, envelopeCalls } = fakeDeps();
  const h = makeNutritionHandlers(deps);
  const res = await h.day(ctx, { date: "2026-08-01" });
  assert.equal(res.ok, true);
  assert.deepEqual(envelopeCalls, ["2026-08-01"]);
});

test("day: malformed date is INVALID_INPUT, envelope never fetched", async () => {
  const { deps, envelopeCalls } = fakeDeps();
  const h = makeNutritionHandlers(deps);
  const res = await h.day(ctx, { date: "yesterday" });
  assert.equal(res.ok, false);
  assert.equal((res as { ok: false; reason: string }).reason, "INVALID_INPUT");
  assert.equal(envelopeCalls.length, 0);
});

test("day: null target is ok:true with the incomplete-profile note", async () => {
  const { deps } = fakeDeps({
    getEnvelope: async () => envelope({ dayTarget: null, remaining: null }),
  });
  const h = makeNutritionHandlers(deps);
  const res = await h.day(ctx, {});
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.dayTarget, null);
  assert.equal(data.remaining, null);
  assert.equal(data.note, PROFILE_INCOMPLETE_NOTE);
});

// ── nutrition_range_summary ──

test("range: fromDate and toDate are required and validated", async () => {
  const h = makeNutritionHandlers(fakeDeps().deps);
  for (const input of [{}, { fromDate: "2026-08-01" }, { fromDate: "bad", toDate: "2026-08-02" }]) {
    const res = await h.range(ctx, input);
    assert.equal(res.ok, false);
    assert.equal((res as { ok: false; reason: string }).reason, "INVALID_INPUT");
  }
});

test("range: from after to is INVALID_INPUT", async () => {
  const h = makeNutritionHandlers(fakeDeps().deps);
  const res = await h.range(ctx, { fromDate: "2026-08-02", toDate: "2026-08-01" });
  assert.equal(res.ok, false);
  assert.equal((res as { ok: false; reason: string }).reason, "INVALID_INPUT");
});

test("range: spans over MAX_RANGE_DAYS are OUT_OF_RANGE", async () => {
  const h = makeNutritionHandlers(fakeDeps().deps);
  const res = await h.range(ctx, { fromDate: "2026-06-01", toDate: "2026-08-01" });
  assert.equal(res.ok, false);
  assert.equal((res as { ok: false; reason: string }).reason, "OUT_OF_RANGE");
  assert.match((res as { ok: false; message: string }).message, /31/);
});

test("range: calendar-invalid date that survives a format check cannot skip the cap (NaN guard)", async () => {
  // parseLocalDateStrict may reject this outright — either way the result
  // must be a typed failure, never a query with an unbounded range.
  const h = makeNutritionHandlers(fakeDeps().deps);
  const res = await h.range(ctx, { fromDate: "2026-13-45", toDate: "2026-08-01" });
  assert.equal(res.ok, false);
});

test("range: groups rows by day, sums via sumMealLogs, sorts ascending, excludes empty days from the average", async () => {
  const rows = [
    slim({ localDate: "2026-07-28", calories: 600, protein: 40, servings: 1 }),
    slim({ localDate: "2026-07-30", calories: 500, protein: 30, servings: 2 }), // 2 servings
    slim({ localDate: "2026-07-30", calories: 400, protein: 20, incomplete: true }),
  ];
  const { deps } = fakeDeps({ findSlimRows: async () => rows });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-07-27", toDate: "2026-08-02" });
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data as {
    daysInRange: number;
    daysLogged: number;
    days: { date: string; totals: Record<string, number>; incomplete: boolean }[];
    avgPerLoggedDay: Record<string, number>;
    target: typeof TARGET;
    avgRemaining: Record<string, number>;
  };
  assert.equal(data.daysInRange, 7);
  assert.equal(data.daysLogged, 2);
  assert.deepEqual(data.days.map((d) => d.date), ["2026-07-28", "2026-07-30"]);
  // Day totals must EQUAL canonical sumMealLogs over the same rows (S1 lesson:
  // no hand-rolled summation that can drift from the dashboard).
  const day30 = sumMealLogs(rows.slice(1));
  assert.equal(data.days[1].totals.calories, day30.calories); // 500*2 + 400 = 1400
  assert.equal(data.days[1].incomplete, true);
  assert.equal(data.days[0].incomplete, false);
  // Average over LOGGED days only: (600 + 1400) / 2.
  assert.equal(data.avgPerLoggedDay.calories, 1000);
  // avgRemaining = target − average, signed.
  assert.equal(data.avgRemaining.calories, 800);
  assert.deepEqual(data.target, TARGET);
});

test("range: steady-state target — getTarget called with usePlanRamp=false", async () => {
  const { deps, targetCalls } = fakeDeps();
  const h = makeNutritionHandlers(deps);
  await h.range(ctx, { fromDate: "2026-08-01", toDate: "2026-08-02" });
  assert.equal(targetCalls.length, 1);
  assert.equal(targetCalls[0].usePlanRamp, false);
});

test("range: zero logged days is ok:true with null averages", async () => {
  const { deps } = fakeDeps({ findSlimRows: async () => [] });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-08-01", toDate: "2026-08-02" });
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.daysLogged, 0);
  assert.deepEqual(data.days, []);
  assert.equal(data.avgPerLoggedDay, null);
  assert.equal(data.avgRemaining, null);
});

test("range: null target yields null avgRemaining plus the note, still ok:true", async () => {
  const { deps } = fakeDeps({ getTarget: async () => null });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-08-01", toDate: "2026-08-02" });
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.target, null);
  assert.equal(data.avgRemaining, null);
  assert.equal(data.note, PROFILE_INCOMPLETE_NOTE);
});

// ── nutrition_targets ──

test("targets: returns today's plan-ramp-aware DailyTargets verbatim", async () => {
  const { deps, targetCalls } = fakeDeps();
  const h = makeNutritionHandlers(deps);
  const res = await h.targets(ctx, {});
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.deepEqual(data.target, TARGET);
  assert.equal(targetCalls[0].localDate, "2026-08-02");
  assert.equal(targetCalls[0].usePlanRamp, true);
  assert.equal("note" in data, false);
});

test("targets: incomplete profile is ok:true with null target and the note", async () => {
  const { deps } = fakeDeps({ getTarget: async () => null });
  const h = makeNutritionHandlers(deps);
  const res = await h.targets(ctx, {});
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.target, null);
  assert.equal(data.note, PROFILE_INCOMPLETE_NOTE);
});

// ── schema contract ──

test("skill shape: name, three tools, schemas carry no identity params", () => {
  assert.equal(nutritionSkill.name, "nutrition");
  const names = nutritionSkill.tools.map((t) => t.def.name);
  assert.deepEqual(names, ["nutrition_day", "nutrition_range_summary", "nutrition_targets"]);
  for (const t of nutritionSkill.tools) {
    const props = Object.keys(t.def.input_schema.properties);
    for (const banned of ["patientId", "accountId", "userId", "id"]) {
      assert.equal(props.includes(banned), false, `${t.def.name} leaks ${banned}`);
    }
  }
  const [day, range, targets] = nutritionSkill.tools.map((t) => t.def);
  assert.equal(day.input_schema.required, undefined); // date optional
  assert.deepEqual(range.input_schema.required, ["fromDate", "toDate"]);
  assert.deepEqual(Object.keys(targets.input_schema.properties), []);
});

test("fragment: carries the fiber caveat and the no-mental-math rule", () => {
  assert.match(nutritionSkill.promptFragment, /fiber/i);
  assert.match(nutritionSkill.promptFragment, /never .*(compute|derive|do the math)/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/clara/skills/nutrition.test.ts`
Expected: FAIL — cannot find module `./nutrition`.

- [ ] **Step 3: Implement `lib/clara/skills/nutrition.ts`**

```ts
import { prisma } from "@/lib/db";
import {
  getDayEnvelope,
  getDayTarget,
  computeRemaining,
  type DayEnvelope,
} from "@/lib/meal-log";
import { sumMealLogs, r1, type MacroSnapshot } from "@/lib/macros";
import type { DailyTargets } from "@/lib/caloric-engine";
import { parseLocalDateStrict } from "@/lib/journal";
import type { ClaraContext, Skill, ToolResult } from "../types";

/**
 * Range cap. Deliberately tighter than logs_search's 90: a month is adherence
 * ("am I hitting my protein"), anything longer is trend analysis and belongs
 * to S11 Progress — those asks should fall through to gap_report(PROGRESS).
 */
export const MAX_RANGE_DAYS = 31;

/** Narratable, never an error: "finish your profile" is an answer. */
export const PROFILE_INCOMPLETE_NOTE =
  "No daily target is set because the caloric profile is incomplete — totals are still accurate. Suggest finishing profile setup in the app.";

/** The slim projection range summation needs; deletedAt handled in the query. */
export interface SlimLogRow {
  localDate: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  servings: number;
  incomplete: boolean;
}

/** Effects, injected so every handler path is unit-tested without a DB. */
export interface NutritionDeps {
  getEnvelope: (patientId: string, localDate: string) => Promise<DayEnvelope>;
  getTarget: (
    patientId: string,
    localDate: string,
    usePlanRamp?: boolean
  ) => Promise<DailyTargets | null>;
  findSlimRows: (q: {
    patientId: string;
    fromDate: string;
    toDate: string;
  }) => Promise<SlimLogRow[]>;
}

const prismaDeps: NutritionDeps = {
  getEnvelope: getDayEnvelope,
  getTarget: getDayTarget,
  findSlimRows: async (q) =>
    prisma.mealLog.findMany({
      where: {
        patientId: q.patientId,
        deletedAt: null,
        localDate: { gte: q.fromDate, lte: q.toDate },
      },
      select: {
        localDate: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        fiber: true,
        servings: true,
        incomplete: true,
      },
      orderBy: { localDate: "asc" },
    }),
};

// Same 2-line helper as skills/logs.ts (kept local: a skill file is
// self-contained, and lifting it to shared C0 surface is not worth an
// amendment for two lines).
const dayGap = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });

export function makeNutritionHandlers(deps: NutritionDeps = prismaDeps) {
  const day = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const date = typeof input.date === "string" ? input.date : ctx.today;
    if (!parseLocalDateStrict(date)) return invalid("date must be YYYY-MM-DD");
    const env = await deps.getEnvelope(ctx.patientId, date);
    return {
      ok: true,
      // Echo the resolved date (S1 lesson): when the model sent no date it was
      // told none, and narrating "for Aug 2" is how a user catches a bad
      // assumption. Null target is an answer, not an error.
      data: {
        date,
        dayTotals: env.dayTotals,
        dayTarget: env.dayTarget,
        remaining: env.remaining,
        ...(env.dayTarget === null ? { note: PROFILE_INCOMPLETE_NOTE } : {}),
      },
    };
  };

  const range = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const fromDate = typeof input.fromDate === "string" ? input.fromDate : "";
    const toDate = typeof input.toDate === "string" ? input.toDate : "";
    if (!parseLocalDateStrict(fromDate) || !parseLocalDateStrict(toDate)) {
      return invalid("fromDate/toDate must be YYYY-MM-DD");
    }
    if (fromDate > toDate) return invalid("fromDate must not be after toDate");
    const gap = dayGap(fromDate, toDate);
    // NaN guard (S1 lesson): a calendar-invalid date that survives the format
    // check yields NaN, and NaN > cap is false — the cap would silently skip.
    if (!Number.isFinite(gap) || gap > MAX_RANGE_DAYS) {
      return {
        ok: false,
        reason: "OUT_OF_RANGE",
        message: `Range is capped at ${MAX_RANGE_DAYS} days — narrow it. Longer horizons aren't available yet.`,
      };
    }

    const [rows, target] = await Promise.all([
      deps.findSlimRows({ patientId: ctx.patientId, fromDate, toDate }),
      // Steady-state for multi-day reads (the Stats precedent): a plan-ramp
      // target is a per-day number and would misprice every other day.
      deps.getTarget(ctx.patientId, toDate, false),
    ]);

    const byDate = new Map<string, SlimLogRow[]>();
    for (const row of rows) {
      const group = byDate.get(row.localDate);
      if (group) group.push(row);
      else byDate.set(row.localDate, [row]);
    }
    // Canonical summation per day (S1 Critical lesson): sumMealLogs scales raw
    // and rounds ONCE — a hand-rolled sum drifts from the dashboard.
    const days = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, group]) => {
        const { incomplete, ...totals } = sumMealLogs(group);
        return { date, totals, incomplete };
      });

    const daysLogged = days.length;
    const daysInRange = gap + 1;

    let avgPerLoggedDay: Omit<MacroSnapshot, "incomplete"> | null = null;
    let avgRemaining: ReturnType<typeof computeRemaining> = null;
    if (daysLogged > 0) {
      const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      for (const d of days) {
        sum.calories += d.totals.calories;
        sum.protein += d.totals.protein;
        sum.carbs += d.totals.carbs;
        sum.fat += d.totals.fat;
        sum.fiber += d.totals.fiber;
      }
      avgPerLoggedDay = {
        calories: r1(sum.calories / daysLogged),
        protein: r1(sum.protein / daysLogged),
        carbs: r1(sum.carbs / daysLogged),
        fat: r1(sum.fat / daysLogged),
        fiber: r1(sum.fiber / daysLogged),
      };
      avgRemaining = computeRemaining(target, { ...avgPerLoggedDay, incomplete: false });
    }

    return {
      ok: true,
      data: {
        fromDate,
        toDate,
        daysInRange,
        daysLogged,
        days,
        avgPerLoggedDay,
        target,
        avgRemaining,
        ...(target === null ? { note: PROFILE_INCOMPLETE_NOTE } : {}),
      },
    };
  };

  const targets = async (ctx: ClaraContext, _input: Record<string, unknown>): Promise<ToolResult> => {
    const target = await deps.getTarget(ctx.patientId, ctx.today, true);
    return {
      ok: true,
      data: target === null ? { target: null, note: PROFILE_INCOMPLETE_NOTE } : { target },
    };
  };

  return { day, range, targets };
}

const handlers = makeNutritionHandlers();

export const nutritionSkill: Skill = {
  name: "nutrition",
  promptFragment:
    "About your nutrition_ tools: they interpret intake against the user's daily targets. nutrition_day returns one day's totals PLUS the target and what is remaining — use it for any 'calories left', 'did I go over', 'do I have room for X' question, and never compute or derive remaining yourself from logs results; the tool returns it. nutrition_range_summary answers 'am I hitting my protein this week': its averages cover only days that have logs — when daysLogged is below daysInRange, say how many days had no logs. nutrition_targets is for 'what are my targets supposed to be'; its basis field tells you whether the number comes from the active meal plan (plan-ramp) or the steady-state calculation — explain in plain words. Targets have no fiber value — never invent a fiber target. If the target comes back null, relay the note: their profile setup is incomplete. You cannot change targets or goals — for that, send them to the app's profile settings.",
  tools: [
    {
      def: {
        name: "nutrition_day",
        description:
          "One day's intake totals PLUS the daily target and remaining (target minus eaten, signed). Use for 'how many calories/protein do I have left', 'did I go over', 'room for X'. NOT for listing what was eaten — logs_day_summary does that. Defaults to today.",
        input_schema: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD; omit for today. Resolve relative phrases against today's date first." },
          },
        },
      },
      handler: handlers.day,
    },
    {
      def: {
        name: "nutrition_range_summary",
        description:
          "Adherence over a date range (max 31 days): per-day totals for logged days, the average per logged day, the steady-state daily target, and the average remaining. Use for 'am I hitting my protein this week', 'how were my calories this month'. NOT for a single day (nutrition_day) and NOT for listing meals (logs_search).",
        input_schema: {
          type: "object",
          properties: {
            fromDate: { type: "string", description: "Start, YYYY-MM-DD (inclusive)." },
            toDate: { type: "string", description: "End, YYYY-MM-DD (inclusive). Range capped at 31 days." },
          },
          required: ["fromDate", "toDate"],
        },
      },
      handler: handlers.range,
    },
    {
      def: {
        name: "nutrition_targets",
        description:
          "The user's current daily targets: calories, protein/carbs/fat grams, the macro profile, and whether today's number comes from their meal plan (plan-ramp) or the steady-state calculation. Use for 'what are my macros supposed to be', 'what's my calorie target'. It does NOT know what they ate — nutrition_day compares intake to target.",
        input_schema: { type: "object", properties: {} },
      },
      handler: handlers.targets,
    },
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/clara/skills/nutrition.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + type check**

Run: `npm test` → green (767 pre-S2 + new). `npx tsc --noEmit 2>&1 | grep -c error` → 19 (unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/clara/skills/nutrition.ts lib/clara/skills/nutrition.test.ts
git commit -m "feat(clara): nutrition skill — day envelope, range summary, targets (S2 E1)"
```

---

### Task E2: Wiring — registry line, tie-breaker row, logs trim, gap map (TDD)

**Files:**
- Modify: `lib/clara/registry.ts` (import + `ALL_SKILLS`; `buildTieBreakers` leftRow)
- Modify: `lib/clara/skills/logs.ts` (`promptFragment` only)
- Modify: `lib/clara/gap.ts` (`CATEGORY_TO_SKILL`)
- Test: `lib/clara/registry.test.ts`, `lib/clara/gap.test.ts`, loop round-trip appended to `lib/clara/skills/nutrition.test.ts`

**Interfaces:**
- Consumes: `nutritionSkill` from `./skills/nutrition` (E1); existing `resolveActiveSkills`, `buildSystemPrompt`, `buildToolDefs`, `findTool`, `resolveGapReason`, `startClaraLoop`.
- Produces: no new exports — behavior changes only.

- [ ] **Step 1: Write the failing tests**

Append to `lib/clara/registry.test.ts` (match its existing import style):

```ts
test("S2: unset CLARA_SKILLS activates nutrition; its three tools are in the defs", () => {
  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  const names = buildToolDefs(active).map((d) => d.name);
  for (const n of ["nutrition_day", "nutrition_range_summary", "nutrition_targets"]) {
    assert.equal(names.includes(n), true, `missing ${n}`);
  }
});

test("S2: CLARA_SKILLS without nutrition hides the tools AND the tie-breaker names none of them", () => {
  const active = resolveActiveSkills(ALL_SKILLS, "profile,logs");
  const names = buildToolDefs(active).map((d) => d.name);
  assert.equal(names.some((n) => n.startsWith("nutrition_")), false);
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  // Dark-launch discipline (S1 amendment 6): no row may name absent tools.
  assert.equal(prompt.includes("nutrition_"), false);
  // Falls back to the S1 text: totals + gap_report for the remaining half.
  assert.match(prompt, /gap_report \(NUTRITION\)/);
});

test("S2: with nutrition active the calories-LEFT row routes to nutrition_ tools and the stale logs sentence is gone", () => {
  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_day/);
  // The logs fragment must no longer steer "calories left" to gap_report.
  assert.equal(prompt.includes("because the remaining/target part is not available yet"), false);
  // And the two skills' fragments must not contradict: only the tie-breaker
  // may mention gap_report (NUTRITION), and only in its inactive branch.
  assert.equal(prompt.includes("gap_report (NUTRITION)"), false);
});

test("S2: logs-off/nutrition-on emits a coherent table (intake row steers to gap_report, LEFT row to nutrition)", () => {
  const active = resolveActiveSkills(ALL_SKILLS, "profile,nutrition");
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  assert.match(prompt, /gap_report \(LOGS\)/);
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_day/);
});
```

Append to `lib/clara/gap.test.ts`:

```ts
test("S2: NUTRITION maps to the nutrition skill for FLAGGED_OFF resolution", () => {
  assert.equal(resolveGapReason("NUTRITION", "NOT_BUILT", ["nutrition"]), "FLAGGED_OFF");
  assert.equal(resolveGapReason("NUTRITION", "NOT_BUILT", []), "NOT_BUILT");
});
```

Append the loop round-trip to `lib/clara/skills/nutrition.test.ts` (stub client copied from `loop.test.ts`'s pattern):

```ts
import { startClaraLoop } from "../loop";
import { resolveActiveSkills, findTool, ALL_SKILLS } from "../registry";
import type { ModelClient, ModelContentBlock, ModelRoundEvent, ModelRoundRequest } from "../types";

test("loop round-trip: 'calories left' → nutrition_day executes and the answer streams", async () => {
  const rounds = [
    {
      deltas: ["Let me check today. "],
      content: [
        { type: "text", text: "Let me check today. " },
        { type: "tool_use", id: "t1", name: "nutrition_day", input: {} },
      ] as ModelContentBlock[],
    },
    { deltas: ["You have 480 kcal left."] },
  ];
  const seen: ModelRoundRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async openRound(req) {
      seen.push(structuredClone(req));
      const round = rounds[i++] ?? { deltas: [] };
      const content =
        round.content ?? [{ type: "text" as const, text: (round.deltas ?? []).join("") }];
      return (async function* () {
        for (const d of round.deltas ?? []) yield { type: "text", text: d } as ModelRoundEvent;
        yield { type: "end", content, stopReason: null } as ModelRoundEvent;
      })();
    },
  };

  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  const { deps } = fakeDeps();
  const testHandlers = makeNutritionHandlers(deps);
  const execute = async (name: string, input: Record<string, unknown>) => {
    // Route through the registry so a rename breaks THIS test, then execute
    // with injected deps (no DB in unit tests).
    const hit = findTool(active, name);
    assert.ok(hit, `registry has no tool ${name}`);
    if (name === "nutrition_day") return testHandlers.day(ctx, input);
    throw new Error(`unexpected tool ${name}`);
  };

  let out = "";
  const gen = await startClaraLoop({
    client,
    system: "s",
    tools: nutritionSkill.tools.map((t) => t.def),
    messages: [{ role: "user", content: "how many calories do I have left?" }],
    maxToolRounds: 2,
    execute,
  });
  for await (const chunk of gen) out += chunk;

  assert.equal(out, "Let me check today. You have 480 kcal left.");
  assert.equal(seen.length, 2);
  const replayed = JSON.stringify(seen[1].messages);
  assert.match(replayed, /"remaining"/);
  assert.match(replayed, /480/);
});
```

> Adjust the `startClaraLoop` options object to the loop's actual signature if it differs (check `lib/clara/loop.ts` — the S1 amendment made `execute` receive `(name, input, toolUseId)`); the assertion targets stay the same.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/clara/registry.test.ts lib/clara/gap.test.ts lib/clara/skills/nutrition.test.ts`
Expected: FAIL — nutrition not in `ALL_SKILLS`, tie-breaker not nutrition-aware, gap map missing entry, stale logs sentence present.

- [ ] **Step 3: Implement the wiring**

`lib/clara/registry.ts` — import + registry line:

```ts
import { nutritionSkill } from "./skills/nutrition";
// …
export const ALL_SKILLS: Skill[] = [profileSkill, logsSkill, nutritionSkill];
```

`lib/clara/registry.ts` — inside `buildTieBreakers`, add `nutritionOn` and make `leftRow` three-state (replace the existing `leftRow` const):

```ts
const nutritionOn = active.some((s) => s.name === "nutrition");
const leftRow = nutritionOn
  ? '- Calories LEFT, targets, remaining, "did I go over", "am I hitting my protein" → nutrition_ tools (nutrition_day for one day, nutrition_range_summary for a week or month, nutrition_targets for the targets themselves). Never derive remaining by arithmetic over logs results.'
  : logsOn
    ? "- Calories LEFT or targets → logs_day_summary knows only what was eaten, not goals: answer with the day's totals, and call gap_report (NUTRITION) if they asked what's remaining."
    : "- Calories LEFT or targets → no tools for this: gap_report (NUTRITION) and say so.";
```

`lib/clara/skills/logs.ts` — one-sentence deletion in `promptFragment` (rule-8 amendment, recorded in the spec). Exact edit:

- old: `Use logs_search for any question about past eating; logs_day_summary for a single day's items and totals. It has no goals or targets: for "calories left"-type questions, answer with the day's totals and call gap_report (category NUTRITION) because the remaining/target part is not available yet. To log a meal:`
- new: `Use logs_search for any question about past eating; logs_day_summary for a single day's items and totals. To log a meal:`

`lib/clara/gap.ts` — one map entry:

```ts
export const CATEGORY_TO_SKILL: Partial<Record<(typeof GAP_CATEGORIES)[number], string>> = {
  FILTERS: "profile",
  LOGS: "logs", // S1
  NUTRITION: "nutrition", // S2
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/clara/registry.test.ts lib/clara/gap.test.ts lib/clara/skills/nutrition.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + type check**

Run: `npm test` → green. `npx tsc --noEmit 2>&1 | grep -c error` → 19.

- [ ] **Step 6: Commit**

```bash
git add lib/clara/registry.ts lib/clara/registry.test.ts lib/clara/gap.ts lib/clara/gap.test.ts lib/clara/skills/logs.ts lib/clara/skills/nutrition.test.ts
git commit -m "feat(clara): wire nutrition skill — registry, tie-breaker, gap map, logs fragment trim (S2 E2)"
```

---

### Task E3: Routing fixture — flip the S1 case, append S2 cases

**Files:**
- Modify: `lib/clara/__fixtures__/routing.ts`

**Interfaces:**
- Consumes: `RoutingCase` shape (existing).
- Produces: the accumulated fixture the audit-phase `npm run clara:routing-eval` runs (score is release-gate, not CI).

- [ ] **Step 1: Flip the S1 "calories left" case**

Replace:

```ts
{
  utterance: "how many calories do I have left today?",
  expect: "logs_day_summary",
  note: "totals are answerable; remaining is S2 — either way NOT a gap-only turn",
},
```

with:

```ts
{
  utterance: "how many calories do I have left today?",
  expect: "nutrition_day",
  note: "S2: flipped from logs_day_summary — remaining is now a real tool",
},
```

- [ ] **Step 2: Append the S2 block**

```ts
// ── S2 nutrition — direct hits ──
{ utterance: "how much protein do I have left today?", expect: "nutrition_day" },
{ utterance: "did I go over my calories yesterday?", expect: "nutrition_day" },
{ utterance: "do I have room for a burger tonight?", expect: "nutrition_day" },
{ utterance: "am I hitting my protein target this week?", expect: "nutrition_range_summary" },
{ utterance: "how have my calories looked over the past two weeks?", expect: "nutrition_range_summary" },
{ utterance: "what are my daily macros supposed to be?", expect: "nutrition_targets" },
{ utterance: "what's my calorie target?", expect: "nutrition_targets" },

// ── S2 adversarial neighbours — boundaries that must hold ──
{ utterance: "how much protein have I had so far today?", expect: "logs_day_summary", note: "ate ≠ left — must NOT drift to nutrition_day now that it exists" },
{ utterance: "am I on track to reach my goal weight?", expect: "gap_report", note: "trend/prediction is S11 PROGRESS, not a 31-day adherence read" },
{ utterance: "change my calorie target to 2000", expect: "gap_report", note: "BODY_GOALS write — out of scope until post-S6; refuse + hand off" },

// ── padding: unambiguous S2 hits (protects the ≥90% margin) ──
{ utterance: "how many carbs do I have left for the day?", expect: "nutrition_day" },
{ utterance: "how much protein should I be getting according to my plan?", expect: "nutrition_targets" },
```

- [ ] **Step 3: Sanity-check the fixture compiles and the suite is green**

Run: `npx tsc --noEmit 2>&1 | grep -c error` → 19. `npm test` → green (the fixture is imported by the eval script, not the suite, but a syntax error would break the type check).

- [ ] **Step 4: Commit**

```bash
git add lib/clara/__fixtures__/routing.ts
git commit -m "feat(clara): S2 routing fixture — flip calories-left, +12 nutrition cases (S2 E3)"
```

---

## Cycle process (controller, per cycle.md — not subagent work)

- Branch `cycle-clara-s2-nutrition`; E1 → E2 → E3 sequential (E2 imports E1; E3's flip assumes the tools exist).
- Per-task review after each task; final whole-branch review (write-path reviewer unnecessary — read-only cycle; use recognition/boundary + correctness reviewers).
- Audit: `npm run clara:routing-eval` over the WHOLE accumulated fixture (41 cases) on the release-gate machine (local key is a dud — memory: local .env keys are placeholders). Bar ≥90% top-1; score to the ledger; a drop on S1/C0 cases is a Critical finding.
- No migration, no iOS work, no client change this cycle (explicit declaration per spec).
- Close-out: append the S2 block to `.superpowers/sdd/progress.md` (commits, suite count, eval score, carried minors), then merge per superpowers:finishing-a-development-branch.
- Post-merge watch: `/admin/clara-gaps` NUTRITION rows should collapse to ~zero; release gate re-checks `CLARA_SKILLS` unset or includes `nutrition` (stale allowlist ships the cycle dead with no failing test — S1 lesson).
