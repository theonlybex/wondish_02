import { prisma } from "@/lib/db";
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText } from "@/lib/food-map";
import type { ClaraContext, Skill, ToolResult } from "../types";

/**
 * C0 pilot skill: read-only, no input, no writes. It exists to prove the loop
 * end-to-end with zero blast radius — the dietary snapshot is already in the
 * system prompt, but reading it through a tool exercises the whole round trip.
 */
export const profileSkill: Skill = {
  name: "profile",
  promptFragment:
    "About profile_get: the user's dietary profile is already summarised for you above. Call profile_get only when they ask you to read it back or you need the exact current list. You cannot change the profile — if they want something added or removed, tell them it is not something you can do yet and call gap_report with category FILTERS.",
  tools: [
    {
      def: {
        name: "profile_get",
        description:
          "Read the user's current dietary profile: allergies, foods to avoid, preferences, health conditions and motivations. Use when they ask what is on their profile. This tool is READ-ONLY — it can NOT add, change or remove anything on the profile.",
        input_schema: { type: "object", properties: {} },
      },
      handler: async (ctx: ClaraContext): Promise<ToolResult> => {
        const patient = await prisma.patient.findUnique({
          where: { id: ctx.patientId },
          include: PATIENT_FOOD_MAP_INCLUDE,
        });
        if (!patient) {
          return { ok: false, reason: "NOT_FOUND", message: "No dietary profile on file yet." };
        }
        return { ok: true, data: { profile: buildFoodMapText(patient) } };
      },
    },
  ],
};
