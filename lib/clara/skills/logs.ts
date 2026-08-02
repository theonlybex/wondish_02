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
import type { ClaraContext, Skill, ToolResult } from "../types";

export const MAX_SEARCH_DAYS = 90;
export const MAX_SEARCH_ROWS = 50;

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
  findById: async (id, patientId) => prisma.mealLog.findFirst({ where: { id, patientId } }),
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
      return {
        ok: false,
        reason: "OUT_OF_RANGE",
        message: `Range is capped at ${MAX_SEARCH_DAYS} days — narrow it.`,
      };
    }
    const text =
      typeof input.text === "string" && input.text.trim() ? input.text.trim().slice(0, 80) : undefined;
    const mealType =
      typeof input.mealType === "string" && MEAL_TYPES.includes(input.mealType as never)
        ? input.mealType
        : undefined;
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
      data: {
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
      data: {
        date,
        items: rows.slice(0, MAX_SEARCH_ROWS).map((r) => serializeMealLog(r)),
        totals,
        incompleteCount,
      },
    };
  };

  const create = async (
    ctx: ClaraContext,
    input: Record<string, unknown>,
    toolUseId = "unknown"
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
    const row = await deps.findById(logId, ctx.patientId);
    if (!row || row.deletedAt) {
      return {
        ok: false,
        reason: "NOT_FOUND",
        message: "No such log entry (it may already be deleted).",
      };
    }
    await deps.softDelete(row.id);
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
    'About your logs_ tools: the meal log is the record of what the user ACTUALLY ATE (their intake), not what was planned. Use logs_search for any question about past eating; logs_day_summary for a single day\'s items and totals — it has no goals or targets, so questions about calories LEFT or targets are not answerable yet (call gap_report with category NUTRITION). To log a meal: first state your estimate and ask ("Around 550 kcal — want me to log it for lunch?"); only after they agree call logs_create with exactly the numbers you stated. Omit any macro you are genuinely unsure of rather than inventing it. To delete: find the row with logs_search, and if several match what they described, list them and ask which — never guess. logs_delete needs the id from a search result in this conversation.',
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
