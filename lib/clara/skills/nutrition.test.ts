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
import { startClaraLoop } from "../loop";
import { resolveActiveSkills, findTool, ALL_SKILLS } from "../registry";
import type {
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
} from "../types";

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
  assert.match((res as { ok: false; message: string }).message, new RegExp(String(MAX_RANGE_DAYS)));
});

test("range: calendar-invalid date that survives a format check cannot skip the cap (NaN guard)", async () => {
  // The invalid month goes in toDate: in fromDate the from>to string compare
  // fires first and the guard is never reached (review finding — the original
  // version of this test exercised the wrong branch). parseLocalDateStrict's
  // constructor rolls "2026-13-45" over, so only Date.parse's NaN catches it.
  const h = makeNutritionHandlers(fakeDeps().deps);
  const res = await h.range(ctx, { fromDate: "2026-08-01", toDate: "2026-13-45" });
  assert.equal(res.ok, false);
  assert.equal((res as { ok: false; reason: string }).reason, "INVALID_INPUT");
});

test("range: groups rows by day, sums via sumMealLogs, sorts ascending, excludes empty days from the average", async () => {
  const rows = [
    slim({ localDate: "2026-07-28", calories: 600, protein: 40, servings: 1 }),
    slim({ localDate: "2026-07-30", calories: 500, protein: 30, servings: 2 }),
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

test("range: a day whose EVERY row is incomplete is quarantined from the average (dashboard parity)", async () => {
  const rows = [
    slim({ localDate: "2026-07-28", calories: 600, protein: 40 }),
    // All-incomplete day: no usable macros — sums to ~0 and would drag the
    // average into "you're way under target" territory (lib/journey.ts rule).
    slim({ localDate: "2026-07-29", calories: null, protein: null, carbs: null, fat: null, fiber: null, incomplete: true }),
  ];
  const { deps } = fakeDeps({ findSlimRows: async () => rows });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-07-27", toDate: "2026-08-02" });
  assert.equal(res.ok, true);
  const data = (res as { ok: true; data: Record<string, unknown> }).data as {
    daysLogged: number;
    daysAllIncomplete: number;
    days: { date: string; incomplete: boolean }[];
    avgPerLoggedDay: Record<string, number>;
    avgRemaining: Record<string, number>;
  };
  // Still visible and counted as logged — just never averaged.
  assert.equal(data.daysLogged, 2);
  assert.equal(data.daysAllIncomplete, 1);
  assert.equal(data.days.length, 2);
  assert.equal(data.days[1].incomplete, true);
  assert.equal(data.avgPerLoggedDay.calories, 600); // NOT (600+0)/2
  assert.equal(data.avgRemaining.calories, 1200);
});

test("range: partially-incomplete days still count toward the average (only all-incomplete is quarantined)", async () => {
  const rows = [
    slim({ localDate: "2026-07-28", calories: 600 }),
    slim({ localDate: "2026-07-29", calories: 400 }),
    slim({ localDate: "2026-07-29", calories: null, incomplete: true }), // one bad row, day still priced
  ];
  const { deps } = fakeDeps({ findSlimRows: async () => rows });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-07-28", toDate: "2026-07-29" });
  const data = (res as { ok: true; data: Record<string, unknown> }).data as {
    daysAllIncomplete: number;
    avgPerLoggedDay: Record<string, number>;
  };
  assert.equal(data.daysAllIncomplete, 0);
  assert.equal(data.avgPerLoggedDay.calories, 500); // (600 + 400) / 2
});

test("range: every logged day all-incomplete leaves averages null", async () => {
  const rows = [slim({ localDate: "2026-07-28", calories: null, incomplete: true })];
  const { deps } = fakeDeps({ findSlimRows: async () => rows });
  const h = makeNutritionHandlers(deps);
  const res = await h.range(ctx, { fromDate: "2026-07-28", toDate: "2026-07-29" });
  const data = (res as { ok: true; data: Record<string, unknown> }).data;
  assert.equal(data.daysLogged, 1);
  assert.equal(data.daysAllIncomplete, 1);
  assert.equal(data.avgPerLoggedDay, null);
  assert.equal(data.avgRemaining, null);
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

// ── loop round-trip (C0 stub pattern, no DB, no network) ──

test("loop round-trip: 'calories left' → nutrition_day executes and the answer streams", async () => {
  const rounds: { deltas?: string[]; content?: ModelContentBlock[] }[] = [
    {
      deltas: ["Let me check today. "],
      content: [
        { type: "text", text: "Let me check today. " },
        { type: "tool_use", id: "t1", name: "nutrition_day", input: {} },
      ],
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
  // tool_result content is itself a JSON string, so its quotes are escaped in
  // the outer stringify — match the substance, not the quoting.
  const replayed = JSON.stringify(seen[1].messages);
  assert.match(replayed, /remaining/);
  assert.match(replayed, /480/);
});
