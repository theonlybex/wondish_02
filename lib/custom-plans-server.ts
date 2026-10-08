// Database side of custom plans (route files may only export handlers).
// Pure rules: lib/custom-plans. Mirrors lib/custom-conditions-server.
import { prisma } from "@/lib/db";

export const CUSTOM_PLAN_SELECT = {
  id: true,
  name: true,
  guidance: true,
  bannedIngredients: { select: { name: true }, orderBy: { name: "asc" as const } },
} as const;

export type CustomPlanView = { id: string; name: string; guidance: string | null; avoid: string[] };

export const toCustomPlanView = (r: { id: string; name: string; guidance: string | null; bannedIngredients: { name: string }[] }): CustomPlanView => ({
  id: r.id,
  name: r.name,
  guidance: r.guidance,
  avoid: r.bannedIngredients.map((b) => b.name),
});

export async function listCustomPlans(patientId: string): Promise<CustomPlanView[]> {
  const rows = await prisma.foodPreference.findMany({ where: { ownerPatientId: patientId }, select: CUSTOM_PLAN_SELECT, orderBy: { name: "asc" } });
  return rows.map(toCustomPlanView);
}

// A built-in diet or one of the user's own plans with the same name.
export async function planNameTaken(patientId: string, name: string, excludeId?: string): Promise<boolean> {
  const hit = await prisma.foodPreference.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      OR: [{ ownerPatientId: null }, { ownerPatientId: patientId }],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return hit != null;
}

export async function ownedPlan(patientId: string, id: string) {
  return prisma.foodPreference.findFirst({ where: { id, ownerPatientId: patientId }, select: { id: true } });
}
