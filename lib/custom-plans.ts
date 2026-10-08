// User-made eating plans ("custom plans", 2026-10-07): a diet the user
// defines — a name, the foods it excludes, a note for Clara — stored as a
// FoodPreference row they own and enforced by the engine like any built-in
// diet. Validation reuses the custom-condition rules (same name, list and
// note limits) without symptoms or trials. Pure; the routes under
// app/api/patient/plans do the database work.
import { CUSTOM_CONDITION_LIMITS, validateCustomCondition } from "./custom-conditions";

export const CUSTOM_PLAN_LIMITS = {
  perPatient: 5,
  nameMin: CUSTOM_CONDITION_LIMITS.nameMin,
  nameMax: CUSTOM_CONDITION_LIMITS.nameMax,
  avoidMax: CUSTOM_CONDITION_LIMITS.avoidMax,
  avoidNameMax: CUSTOM_CONDITION_LIMITS.avoidNameMax,
  guidanceMax: CUSTOM_CONDITION_LIMITS.guidanceMax,
} as const;

export type CustomPlanField = "name" | "avoid" | "guidance";
export type CustomPlanInput = { name: string; avoid: string[]; guidance: string | null };
export type CustomPlanValidation =
  | { ok: true; value: CustomPlanInput }
  | { ok: false; field: CustomPlanField; error: string };

export function validateCustomPlan(body: unknown): CustomPlanValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const v = validateCustomCondition({ name: b.name, avoid: b.avoid, guidance: b.guidance, symptoms: [], triggers: [] });
  if (!v.ok) {
    const field = (v.field === "name" || v.field === "avoid" || v.field === "guidance" ? v.field : "name") as CustomPlanField;
    return { ok: false, field, error: v.error.replace(/\bcondition\b/g, "plan") };
  }
  if (v.value.avoid.length === 0 && !v.value.guidance) {
    return { ok: false, field: "avoid", error: "Add at least one food this plan leaves out, or a note for Clara." };
  }
  return { ok: true, value: { name: v.value.name, avoid: v.value.avoid, guidance: v.value.guidance } };
}
