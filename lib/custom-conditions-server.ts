// Database side of user-defined conditions (route files may only export
// handlers, so the shared pieces live here). Pure rules: lib/custom-conditions.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { customTrackingCode, customTriggerRuleCode, customTriggerRuleData, sameLabel, symptomItemCode } from "@/lib/custom-conditions";

export const CUSTOM_CONDITION_SELECT = {
  id: true,
  name: true,
  guidance: true,
  bannedIngredients: { select: { name: true }, orderBy: { name: "asc" as const } },
  trackingItems: {
    where: { active: true, category: "SYMPTOM" as const },
    select: { id: true, label: true },
    orderBy: { label: "asc" as const },
  },
  triggerRules: { where: { active: true }, select: { id: true, category: true }, orderBy: { category: "asc" as const } },
} as const;

export interface CustomConditionView {
  id: string;
  name: string;
  guidance: string | null;
  avoid: string[];
  symptoms: { id: string; label: string }[];
  triggers: string[]; // active trigger category codes
}

type Row = {
  id: string;
  name: string;
  guidance: string | null;
  bannedIngredients: { name: string }[];
  trackingItems: { id: string; label: string }[];
  triggerRules: { id: string; category: string }[];
};

export const toCustomConditionView = (r: Row): CustomConditionView => ({
  id: r.id,
  name: r.name,
  guidance: r.guidance,
  avoid: r.bannedIngredients.map((b) => b.name),
  symptoms: r.trackingItems,
  triggers: r.triggerRules.map((t) => t.category),
});

export function patientForClerk(userId: string) {
  return prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true, mealPlanStartDate: true } });
}

export async function listCustomConditions(patientId: string): Promise<CustomConditionView[]> {
  const rows = await prisma.healthCondition.findMany({
    where: { ownerPatientId: patientId },
    select: CUSTOM_CONDITION_SELECT,
    orderBy: { name: "asc" },
  });
  return rows.map(toCustomConditionView);
}

// A built-in condition or one of the user's own with the same name.
export async function conditionNameTaken(patientId: string, name: string, excludeId?: string): Promise<boolean> {
  const hit = await prisma.healthCondition.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      OR: [{ ownerPatientId: null }, { ownerPatientId: patientId }],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return hit != null;
}

export const newTrackingItem = (label: string) => ({
  code: customTrackingCode(randomUUID()),
  category: "SYMPTOM" as const,
  itemCode: symptomItemCode(label),
  label,
  inputSource: "USER_REPORTED",
});

// Sync a condition's symptom labels: unchanged labels keep their row (and
// journal history), removed ones are deactivated (history kept), new ones are
// created. Runs inside the caller's transaction.
export async function syncSymptomItems(
  tx: Pick<typeof prisma, "conditionTrackingItem">,
  conditionId: string,
  labels: string[]
): Promise<void> {
  const existing = await tx.conditionTrackingItem.findMany({
    where: { conditionId, category: "SYMPTOM" },
    select: { id: true, label: true, active: true },
  });
  const keep = new Set<string>();
  for (const label of labels) {
    const match = existing.find((e) => sameLabel(e.label, label));
    if (match) {
      keep.add(match.id);
      if (!match.active || match.label !== label) {
        await tx.conditionTrackingItem.update({ where: { id: match.id }, data: { active: true, label } });
      }
    } else {
      await tx.conditionTrackingItem.create({ data: { conditionId, ...newTrackingItem(label) } });
    }
  }
  const retire = existing.filter((e) => e.active && !keep.has(e.id)).map((e) => e.id);
  if (retire.length) await tx.conditionTrackingItem.updateMany({ where: { id: { in: retire } }, data: { active: false } });
}

// Sync a condition's trigger rules to the chosen categories: a category that
// stays keeps its row (a running trial points at it), a removed one is
// deactivated, a new one is created. Every active rule monitors the
// condition's current active symptom items. Runs inside the caller's transaction.
export async function syncTriggerRules(
  tx: Pick<typeof prisma, "triggerRule" | "triggerRuleTrackingItem" | "conditionTrackingItem">,
  conditionId: string,
  categories: string[]
): Promise<void> {
  const items = await tx.conditionTrackingItem.findMany({ where: { conditionId, category: "SYMPTOM", active: true }, select: { id: true, label: true } });
  const rules = await tx.triggerRule.findMany({ where: { conditionId }, select: { id: true, category: true, active: true } });
  const wanted = new Set(categories);
  const activeIds: string[] = [];
  for (const category of categories) {
    const existing = rules.find((r) => r.category === category);
    if (existing) {
      const data = customTriggerRuleData(category, items.map((i) => i.label));
      await tx.triggerRule.update({ where: { id: existing.id }, data: { active: true, examples: data.examples, symptomsToMonitor: data.symptomsToMonitor } });
      activeIds.push(existing.id);
    } else {
      const created = await tx.triggerRule.create({
        data: { conditionId, code: customTriggerRuleCode(randomUUID()), ...customTriggerRuleData(category, items.map((i) => i.label)) },
        select: { id: true },
      });
      activeIds.push(created.id);
    }
  }
  const retire = rules.filter((r) => r.active && !wanted.has(r.category)).map((r) => r.id);
  if (retire.length) await tx.triggerRule.updateMany({ where: { id: { in: retire } }, data: { active: false } });
  if (activeIds.length) {
    await tx.triggerRuleTrackingItem.deleteMany({ where: { ruleId: { in: activeIds } } });
    if (items.length) {
      await tx.triggerRuleTrackingItem.createMany({
        data: activeIds.flatMap((ruleId) => items.map((i) => ({ ruleId, trackingItemId: i.id }))),
        skipDuplicates: true,
      });
    }
  }
}

// Bans changed → the current week no longer reflects the profile.
export async function flagPlanStale(patient: { id: string; mealPlanStartDate: Date | null }): Promise<void> {
  if (patient.mealPlanStartDate) await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } });
}
