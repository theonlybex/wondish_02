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
    // NaN guard (S1 lesson): a calendar-invalid date like "2026-13-45" rolls
    // over in parseLocalDateStrict's constructor and survives the format
    // check, but Date.parse yields NaN — and NaN > cap is false, so without
    // this the cap would be silently skipped. A bad date is INVALID_INPUT
    // (spec taxonomy), not a too-long range.
    if (!Number.isFinite(gap)) {
      return invalid("fromDate/toDate must be real calendar dates");
    }
    if (gap > MAX_RANGE_DAYS) {
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
    const days = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, group]) => {
        const { incomplete, ...totals } = sumMealLogs(group);
        return { date, totals, incomplete };
      });

    const daysLogged = days.length;
    const daysInRange = gap + 1;

    // Quarantine rule (review fix, mirrors computeMacroStats in lib/journey.ts):
    // a day whose EVERY row is incomplete sums to ~0 kcal and would drag the
    // average down while looking wildly under target — the exact misleading-
    // advice failure the empty-day rule exists to prevent. Such days stay
    // visible in `days` (flagged) but are never averaged.
    const pricedDays = days.filter((d) => {
      const group = byDate.get(d.date);
      return group !== undefined && !group.every((r) => r.incomplete);
    });
    const daysAllIncomplete = daysLogged - pricedDays.length;

    let avgPerLoggedDay: Omit<MacroSnapshot, "incomplete"> | null = null;
    let avgRemaining: ReturnType<typeof computeRemaining> = null;
    if (pricedDays.length > 0) {
      const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      for (const d of pricedDays) {
        sum.calories += d.totals.calories;
        sum.protein += d.totals.protein;
        sum.carbs += d.totals.carbs;
        sum.fat += d.totals.fat;
        sum.fiber += d.totals.fiber;
      }
      avgPerLoggedDay = {
        calories: r1(sum.calories / pricedDays.length),
        protein: r1(sum.protein / pricedDays.length),
        carbs: r1(sum.carbs / pricedDays.length),
        fat: r1(sum.fat / pricedDays.length),
        fiber: r1(sum.fiber / pricedDays.length),
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
        daysAllIncomplete,
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
    "About your nutrition_ tools: they interpret intake against the user's daily targets. nutrition_day returns one day's totals PLUS the target and what is remaining — use it for any 'calories left', 'did I go over', 'do I have room for X' question, and never compute or derive remaining yourself from logs results; the tool returns it. nutrition_range_summary answers 'am I hitting my protein this week': its averages cover only days that have logs with usable macros — when daysLogged is below daysInRange, say how many days had no logs, and when daysAllIncomplete is nonzero, say those days were logged without nutrition numbers and left out of the average. nutrition_targets is for 'what are my targets supposed to be'; its basis field tells you whether the number comes from the active meal plan (plan-ramp) or the steady-state calculation — explain in plain words. Targets have no fiber value — never invent a fiber target. If the target comes back null, relay the note: their profile setup is incomplete. You cannot change targets or goals — call gap_report (category BODY_GOALS) once, then send them to the app's profile settings.",
  tools: [
    {
      def: {
        name: "nutrition_day",
        description:
          "One day's intake totals PLUS the daily target and remaining (target minus eaten, signed). Use for 'how many calories/protein do I have left', 'did I go over', 'room for X'. NOT for listing what was eaten — logs_day_summary does that. Defaults to today.",
        input_schema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD; omit for today. Resolve relative phrases against today's date first.",
            },
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
