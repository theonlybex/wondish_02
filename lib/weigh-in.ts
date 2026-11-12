// Weigh-in logic shared by POST /api/journal and POST /api/numbers/weight.
// syncPatientWeightFromJournal is the follow-up the journal route has always
// done after a save (extracted verbatim); the rest backs the weigh-in-only
// route, which must never touch the day's other journal fields.
import type { PrismaClient } from "@prisma/client";
import { convertHeight, convertWeight, calcCBMI } from "@/lib/caloric-engine";
import { checkBodyMetrics } from "@/lib/body-bounds";
import { parseLocalDateStrict } from "@/lib/journal";

// How far current weight must drift from the weight the active meal plan was
// generated at before we flag the plan stale. Keeps daily weigh-in noise quiet.
export const WEIGHT_DRIFT_LBS = 5;

export interface WeighInPatient {
  id: string;
  height: number | null;
  heightUnit: string | null;
  mealPlanStartDate: Date | null;
  mealPlanWeight: number | null;
}

// Keep the account's CURRENT weight in sync with the most recent actual
// weigh-in. The journal is the ongoing ground truth — the latest-dated entry
// with a weight wins, so editing an older day never overrides a newer one.
export async function syncPatientWeightFromJournal(
  db: Pick<PrismaClient, "journalEntry" | "patient">,
  patient: WeighInPatient,
): Promise<void> {
  const latestWeighIn = await db.journalEntry.findFirst({
    where: { patientId: patient.id, weight: { not: null } },
    orderBy: { date: "desc" },
    select: { weight: true },
  });
  if (latestWeighIn?.weight != null) {
    const currentWeight = latestWeighIn.weight; // lbs — the app's single unit
    const data: { weight: number; weightUnit: string; bmi?: number; mealPlanStale?: boolean } = {
      weight: currentWeight,
      weightUnit: "lbs",
    };
    if (patient.height) {
      const ht = convertHeight(patient.height, patient.heightUnit === "in" ? "in" : "cm");
      const wt = convertWeight(currentWeight, "lbs");
      data.bmi = parseFloat(calcCBMI(wt.kg, ht.m2).toFixed(1));
    }
    // Calorie targets are built from current weight. Only flag the plan stale
    // once weight has drifted past the threshold from the weight it was built
    // for — normal day-to-day fluctuation stays quiet.
    if (
      patient.mealPlanStartDate &&
      patient.mealPlanWeight != null &&
      Math.abs(currentWeight - patient.mealPlanWeight) >= WEIGHT_DRIFT_LBS
    ) {
      data.mealPlanStale = true;
    }
    await db.patient.update({ where: { id: patient.id }, data });
  }
}

// ─── POST /api/numbers/weight ───────────────────────────────────────────────
export type WeighInValidation =
  | { ok: true; date: Date; weight: number }
  | { ok: false; status: 422; error: string; field: "body" | "date" | "weight" };

const DAY_MS = 86400000;

export function validateWeighInBody(body: unknown, now: Date = new Date()): WeighInValidation {
  const fail = (field: "body" | "date" | "weight", error: string): WeighInValidation => ({ ok: false, status: 422, error, field });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("body", "body must be an object");
  const b = body as Record<string, unknown>;

  const date = parseLocalDateStrict(b.date);
  const s = b.date as string;
  // parseLocalDateStrict lets Feb 30 roll into March; a real calendar date round-trips.
  const real =
    date !== null &&
    `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === s;
  if (!date || !real) return fail("date", "date must be a real YYYY-MM-DD date");
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1);
  if (date.getTime() > limit.getTime()) return fail("date", "date cannot be in the future");

  const w = b.weight;
  if (typeof w !== "number" || !Number.isFinite(w)) return fail("weight", "weight must be a number");
  const err = checkBodyMetrics({ weightLbs: w }, { weight: "lbs", height: "cm" }).weight;
  if (err) return fail("weight", err);

  date.setHours(0, 0, 0, 0);
  return { ok: true, date, weight: w };
}

export interface WeighInDeps {
  // The row for that local day (same gte/lte day window the journal route uses), if any.
  findDayEntry(patientId: string, dayStart: Date, dayEnd: Date): Promise<{ id: string } | null>;
  updateWeight(entryId: string, weight: number): Promise<void>;
  createEntry(patientId: string, date: Date, weight: number): Promise<void>;
  // Journal's post-save follow-up (patient weight/bmi sync, plan-stale check).
  syncPatient(): Promise<void>;
}

export const weightUnitLabel = (weightUnit: string | null): "lbs" | "kg" => (weightUnit === "kg" ? "kg" : "lbs");

// Sets ONLY weight on that day's entry. The journal route stores `date` at
// local midnight and finds the day by a gte/lte window; do the same here.
export async function recordWeighIn(
  deps: WeighInDeps,
  input: { patientId: string; date: Date; weight: number },
): Promise<{ created: boolean }> {
  const dayStart = new Date(input.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const existing = await deps.findDayEntry(input.patientId, dayStart, dayEnd);
  if (existing) await deps.updateWeight(existing.id, input.weight);
  else await deps.createEntry(input.patientId, dayStart, input.weight);
  await deps.syncPatient();
  return { created: !existing };
}
