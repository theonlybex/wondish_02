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
/** Gap rows one user may create per day. Beyond it, reports are dropped silently. */
export const GAP_DAILY_CAP = 10;
export const GAP_RATE_LIMIT_NAME = "clara-gap-day";
export const GAP_RATE_LIMIT_WINDOW_SEC = 86400;

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
      handler: async (ctx: ClaraContext, input): Promise<ToolResult> => {
        const parsed = normalizeGapInput(input);
        if (!parsed.ok) return { ok: false, reason: "INVALID_INPUT", message: parsed.message };

        const { success } = await rateLimit(
          GAP_RATE_LIMIT_NAME,
          ctx.patientId,
          GAP_DAILY_CAP,
          GAP_RATE_LIMIT_WINDOW_SEC
        );
        // Over the cap: acknowledge and drop. The user's chat must not change
        // because of an internal telemetry limit.
        if (!success) return { ok: true, data: { recorded: false } };

        await prisma.claraCapabilityRequest.upsert({
          where: {
            patientId_category_localDate: {
              patientId: ctx.patientId,
              category: parsed.value.category,
              localDate: ctx.today,
            },
          },
          create: {
            patientId: ctx.patientId,
            category: parsed.value.category,
            reason: parsed.value.reason,
            summary: parsed.value.summary,
            surface: ctx.surface,
            localDate: ctx.today,
          },
          // Same user, same category, same day ⇒ keep the first row. Ranking
          // counts distinct users, so repeats must not inflate anything.
          update: {},
        });

        return { ok: true, data: { recorded: true } };
      },
    },
  ],
};
