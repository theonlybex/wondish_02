import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  MEAL_TYPES,
  parseMealLogInput,
  resolveSnapshot,
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  serializeMealLog,
  type MealLogRow,
  type MealLogCreateData,
} from "@/lib/meal-log";
import { parseLocalDateStrict } from "@/lib/journal";
import { rateLimit } from "@/lib/rate-limit";
import { sumMealLogs } from "@/lib/macros";
import type { ClaraContext, Skill, ToolResult } from "../types";

export const MAX_SEARCH_DAYS = 90;
export const MAX_SEARCH_ROWS = 50;
/**
 * Backstop on Clara-driven writes (create+delete share it). The confirm rule
 * is prompt text, not code, and premium bypasses the chat quota — this is the
 * only hard ceiling. Same in-handler shape as gap_report's cap; fails OPEN on
 * a Redis outage (a telemetry-grade limit must not break chat).
 */
export const LOGS_WRITE_HOURLY_CAP = 30;
export const LOGS_WRITE_RATE_LIMIT_NAME = "clara-logs-write";
export const LOGS_WRITE_RATE_LIMIT_WINDOW_SEC = 3600;

/** Effects, injected so every handler path is unit-tested without a DB. */
export interface LogsDeps {
  findRows: (q: {
    patientId: string;
    fromDate: string;
    toDate: string;
    text?: string;
    mealType?: string;
    limit: number;
  }) => Promise<MealLogRow[]>;
  findById: (id: string, patientId: string) => Promise<MealLogRow | null>;
  create: (args: ReturnType<typeof buildMealLogUpsertArgs>) => Promise<MealLogRow>;
  /** Ownership-scoped: id AND patientId in one atomic where. */
  softDelete: (id: string, patientId: string) => Promise<void>;
  consumeWriteBudget: (patientId: string) => Promise<boolean>;
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
  findById: async (id, patientId) => prisma.mealLog.findFirst({ where: { id, patientId } }),
  create: async (args) => prisma.mealLog.upsert(args),
  softDelete: async (id, patientId) => {
    // updateMany so ownership + not-yet-deleted ride the same atomic where.
    await prisma.mealLog.updateMany({
      where: { id, patientId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  },
  consumeWriteBudget: async (patientId) => {
    const { success } = await rateLimit(
      LOGS_WRITE_RATE_LIMIT_NAME,
      patientId,
      LOGS_WRITE_HOURLY_CAP,
      LOGS_WRITE_RATE_LIMIT_WINDOW_SEC
    );
    return success;
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
    if (fromDate > toDate) {
      return invalid("fromDate must not be after toDate");
    }
    const gap = dayGap(fromDate, toDate);
    // NaN guard: a calendar-invalid date ("2026-13-45") passes the format
    // check but Date.parse yields NaN, and NaN > cap is false — without this
    // the cap would be silently skipped.
    if (!Number.isFinite(gap) || gap > MAX_SEARCH_DAYS) {
      return {
        ok: false,
        reason: "OUT_OF_RANGE",
        message: `Range is capped at ${MAX_SEARCH_DAYS} days — narrow it.`,
      };
    }
    const text =
      typeof input.text === "string" && input.text.trim() ? input.text.trim().slice(0, 80) : undefined;
    // An unrecognised mealType is an error, not a silent broadening — the
    // create path rejects it, and search must be symmetric.
    if (input.mealType !== undefined && !MEAL_TYPES.includes(input.mealType as never)) {
      return invalid(`mealType must be one of: ${MEAL_TYPES.join(", ")}`);
    }
    const mealType = typeof input.mealType === "string" ? input.mealType : undefined;
    const rows = await deps.findRows({
      patientId: ctx.patientId,
      fromDate,
      toDate,
      text,
      mealType,
      limit: MAX_SEARCH_ROWS + 1,
    });
    const truncated = rows.length > MAX_SEARCH_ROWS;
    return {
      ok: true,
      // Echo the searched range: when the client sent no date the model was
      // told none, so narrating "for Jul 25-Aug 1" is the only way a user
      // catches a bad date assumption.
      data: {
        fromDate,
        toDate,
        items: rows.slice(0, MAX_SEARCH_ROWS).map((r) => serializeMealLog(r)),
        truncated,
      },
    };
  };

  const daySummary = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const date = typeof input.date === "string" ? input.date : ctx.today;
    if (!parseLocalDateStrict(date)) return invalid("date must be YYYY-MM-DD");
    const rows = await deps.findRows({
      patientId: ctx.patientId,
      fromDate: date,
      toDate: date,
      limit: MAX_SEARCH_ROWS + 1,
    });
    const truncated = rows.length > MAX_SEARCH_ROWS;
    const visible = rows.slice(0, MAX_SEARCH_ROWS);
    // Canonical summation (lib/macros.ts): raw per-row scaling, rounded ONCE —
    // a hand-rolled sum over already-rounded DTO totals drifted from the
    // dashboard's numbers for the identical day. Totals cover exactly the rows
    // the model sees; `truncated` tells it (and the user) the day overflowed.
    const totals = sumMealLogs(visible);
    const incompleteCount = visible.filter((r) => r.incomplete).length;
    return {
      ok: true,
      data: {
        date,
        items: visible.map((r) => serializeMealLog(r)),
        totals,
        incompleteCount,
        truncated,
      },
    };
  };

  const create = async (
    ctx: ClaraContext,
    input: Record<string, unknown>,
    toolUseId?: string
  ): Promise<ToolResult> => {
    // Hard requirement, not a default: a fallback key like "clara:unknown"
    // would upsert-collide across DIFFERENT meals and silently return the
    // first row as if it had logged the second.
    if (!toolUseId) {
      return { ok: false, reason: "FAILED", message: "Internal: missing tool call id." };
    }
    if (!(await deps.consumeWriteBudget(ctx.patientId))) {
      return { ok: false, reason: "FAILED", message: "Too many changes in a short time — try again later." };
    }
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
      // Always an object: checkPerServing rejects a missing one even for
      // caller-supplied sources; {} yields all-NULL macros + incomplete.
      perServing,
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
    if (!(await deps.consumeWriteBudget(ctx.patientId))) {
      return { ok: false, reason: "FAILED", message: "Too many changes in a short time — try again later." };
    }
    const row = await deps.findById(logId, ctx.patientId);
    if (!row || row.deletedAt) {
      return {
        ok: false,
        reason: "NOT_FOUND",
        message: "No such log entry (it may already be deleted).",
      };
    }
    await deps.softDelete(row.id, ctx.patientId);
    return {
      ok: true,
      data: { deleted: { id: row.id, name: row.name, localDate: row.localDate } },
    };
  };

  return { search, daySummary, create, del };
}

const handlers = makeLogsHandlers();

export const logsSkill: Skill = {
  name: "logs",
  promptFragment:
    'About your logs_ tools: the meal log is the record of what the user ACTUALLY ATE (their intake), not what was planned. Use logs_search for any question about past eating; logs_day_summary for a single day\'s items and totals. It has no goals or targets: for "calories left"-type questions, answer with the day\'s totals and call gap_report (category NUTRITION) because the remaining/target part is not available yet. To log a meal: first state your estimate and ask ("Around 550 kcal — want me to log it for lunch?"); only after they agree call logs_create with exactly the numbers you stated. Omit any macro you are genuinely unsure of rather than inventing it. To delete: find the row with logs_search, and if several match what they described, list them and ask which — never guess. logs_delete needs the id from a search result in this conversation.',
  tools: [
    {
      def: {
        name: "logs_search",
        description:
          "Search the user's meal-log history (what they actually ate) by date range and optional text/meal-type. Use for 'what did I eat …' questions. NOT for planned meals, and NOT for day totals — logs_day_summary does totals.",
        input_schema: {
          type: "object",
          properties: {
            fromDate: {
              type: "string",
              description:
                "Start, YYYY-MM-DD (inclusive). Resolve relative phrases against today's date first.",
            },
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
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
            fiber: { type: "number" },
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
