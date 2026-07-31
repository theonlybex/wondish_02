import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import type { ClaraContext, Skill, ToolResult } from "./types";

export const GAP_CATEGORIES = [
  "LOGS", "NUTRITION", "MEAL_PLAN", "JOURNAL", "SUPPLEMENTS", "FILTERS",
  "GROCERY", "RESTAURANTS", "FRIDGE", "EXCHANGES", "PROGRESS", "TASTE",
  "CUSTOM_INGREDIENTS", "BODY_GOALS", "OTHER",
] as const;

export const GAP_REASONS = ["NOT_BUILT", "FLAGGED_OFF", "OUT_OF_SCOPE", "UNCLEAR"] as const;

export const MAX_GAP_SUMMARY = 200;
/**
 * Gap rows one user may create per day. Must stay ABOVE the category count:
 * the unique (patient, category, day) index already bounds a user to one row
 * per category per day, so a cap below GAP_CATEGORIES.length could only ever
 * delete distinct-category signal — never volume it wasn't already bounding.
 * The cap is a backstop against a pathological client, not the real limit.
 */
export const GAP_DAILY_CAP = 20;
export const GAP_RATE_LIMIT_NAME = "clara-gap-day";
export const GAP_RATE_LIMIT_WINDOW_SEC = 86400;

/**
 * Which product skill each category belongs to, so the server can tell
 * "never built" from "built but switched off". The model cannot: a disabled
 * skill has its tools and prompt fragment stripped from the request, so it
 * sees the identical absence either way and would file everything NOT_BUILT.
 */
export const CATEGORY_TO_SKILL: Partial<Record<(typeof GAP_CATEGORIES)[number], string>> = {
  FILTERS: "profile",
};

/**
 * The server owns the FLAGGED_OFF verdict — it is the only party that knows
 * what is registered versus active. The model's reason is respected otherwise.
 */
export function resolveGapReason(
  category: (typeof GAP_CATEGORIES)[number],
  modelReason: (typeof GAP_REASONS)[number],
  disabledSkills: readonly string[]
): (typeof GAP_REASONS)[number] {
  const skill = CATEGORY_TO_SKILL[category];
  if (skill && disabledSkills.includes(skill)) return "FLAGGED_OFF";
  // A model-supplied FLAGGED_OFF is never trustworthy — it cannot see config.
  return modelReason === "FLAGGED_OFF" ? "NOT_BUILT" : modelReason;
}

export interface NormalizedGap {
  category: (typeof GAP_CATEGORIES)[number];
  reason: (typeof GAP_REASONS)[number];
  summary: string;
}

/**
 * Model input is untrusted text: an unknown category degrades to OTHER instead
 * of failing, because losing the signal is worse than mis-filing it. Only a
 * missing summary is fatal — a row with no content is not demand data.
 */
export function normalizeGapInput(
  input: Record<string, unknown>
): { ok: true; value: NormalizedGap } | { ok: false; message: string } {
  const rawSummary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (rawSummary.length === 0) {
    return { ok: false, message: "summary is required" };
  }
  const category = GAP_CATEGORIES.includes(input.category as never)
    ? (input.category as NormalizedGap["category"])
    : "OTHER";
  const reason = GAP_REASONS.includes(input.reason as never)
    ? (input.reason as NormalizedGap["reason"])
    : "NOT_BUILT";
  return {
    ok: true,
    value: { category, reason, summary: rawSummary.slice(0, MAX_GAP_SUMMARY) },
  };
}

/** The two effects the handler needs, injected so the handler is testable. */
export interface GapDeps {
  findExisting: (patientId: string, category: string, localDate: string) => Promise<boolean>;
  consumeDailyBudget: (patientId: string) => Promise<boolean>;
  write: (row: {
    patientId: string;
    category: string;
    reason: string;
    summary: string;
    surface: string;
    localDate: string;
  }) => Promise<void>;
}

const prismaGapDeps: GapDeps = {
  findExisting: async (patientId, category, localDate) =>
    (await prisma.claraCapabilityRequest.findUnique({
      where: {
        patientId_category_localDate: {
          patientId,
          category: category as never,
          localDate,
        },
      },
      select: { id: true },
    })) !== null,

  consumeDailyBudget: async (patientId) => {
    // rateLimit fails OPEN if Redis is down (lib/rate-limit.ts). That is the
    // right trade here — a telemetry cap must never change the user's chat —
    // and the unique index bounds the damage to one row per category per day.
    const { success } = await rateLimit(
      GAP_RATE_LIMIT_NAME,
      patientId,
      GAP_DAILY_CAP,
      GAP_RATE_LIMIT_WINDOW_SEC
    );
    return success;
  },

  write: async (row) => {
    await prisma.claraCapabilityRequest.upsert({
      where: {
        patientId_category_localDate: {
          patientId: row.patientId,
          category: row.category as never,
          localDate: row.localDate,
        },
      },
      create: {
        patientId: row.patientId,
        category: row.category as never,
        reason: row.reason as never,
        summary: row.summary,
        surface: row.surface,
        localDate: row.localDate,
      },
      // Keep the first summary of the day — ranking counts distinct users, so
      // repeats must not inflate anything — but let buildable demand win the
      // reason: a first "cancel my subscription" (OUT_OF_SCOPE) must not bury a
      // later genuine NOT_BUILT ask filed under the same catch-all category.
      update: row.reason === "NOT_BUILT" ? { reason: "NOT_BUILT" } : {},
    });
  },
};

/**
 * Built as a factory so the effects are injectable — the plan specified this
 * shape, and every future write skill will copy this file as its template.
 */
export function makeGapHandler(deps: GapDeps = prismaGapDeps) {
  return async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const parsed = normalizeGapInput(input);
    if (!parsed.ok) return { ok: false, reason: "INVALID_INPUT", message: parsed.message };

    const reason = resolveGapReason(parsed.value.category, parsed.value.reason, ctx.disabledSkills);

    // Dedupe BEFORE spending budget. The unique index means a repeat ask in the
    // same category today writes nothing, so charging for it would let a user
    // burn their whole allowance on one category and lose every other
    // category's signal for the rest of the day.
    if (await deps.findExisting(ctx.patientId, parsed.value.category, ctx.today)) {
      return { ok: true, data: { recorded: true, duplicate: true } };
    }

    if (!(await deps.consumeDailyBudget(ctx.patientId))) {
      // Over the cap: acknowledge and drop. The user's chat must not change
      // because of an internal telemetry limit.
      return { ok: true, data: { recorded: false } };
    }

    await deps.write({
      patientId: ctx.patientId,
      category: parsed.value.category,
      reason,
      summary: parsed.value.summary,
      surface: ctx.surface,
      localDate: ctx.today,
    });

    return { ok: true, data: { recorded: true } };
  };
}

/**
 * Runtime-owned, always active — this is not a product skill and must never be
 * disabled by CLARA_SKILLS (see registry.ts). It is how we learn which skill
 * cycle to run next (spec §5).
 */
export const gapSkill: Skill = {
  name: "gap",
  promptFragment:
    "About gap_report: call it once, silently, whenever the user asks for something none of your tools can do — reading or changing data you have no tool for. Pick the closest category, write one plain sentence describing what they wanted in your own words (never quote them verbatim), then tell them plainly that you cannot do that yet. Do not call it for questions you can answer from your own knowledge, and never mention the tool itself.",
  tools: [
    {
      def: {
        name: "gap_report",
        description:
          "Record that the user asked for a capability you do not have. Call it once per unmet request, before you tell them you cannot help. Do NOT call it when you were able to answer.",
        input_schema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [...GAP_CATEGORIES],
              description:
                "The area of the product the request belongs to. Use OTHER only when nothing fits.",
            },
            summary: {
              type: "string",
              description:
                "One plain sentence describing what the user wanted, in your own words. Max 200 characters.",
            },
            reason: {
              type: "string",
              enum: [...GAP_REASONS],
              description:
                "NOT_BUILT if no such tool exists; OUT_OF_SCOPE for orders, payments, subscription or account settings; UNCLEAR if you could not tell what they meant.",
            },
          },
          required: ["category", "summary"],
        },
      },
      handler: makeGapHandler(),
    },
  ],
};
