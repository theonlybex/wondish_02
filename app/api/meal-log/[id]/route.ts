import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  parsePatchInput,
  buildMealLogLookupWhere,
  nullableMacroColumns,
  isCallerSuppliedMacroSource,
  serializeMealLog,
  getDayEnvelope,
} from "@/lib/meal-log";

// PATCH/DELETE address the row by server id (cuid) OR clientRequestId, both
// ownership-scoped. Lets a device correct/remove a row it created offline the
// instant its create has synced, without yet knowing the server id.

// ─── PATCH /api/meal-log/[idOrClientRequestId] — edit / undo ─────────────────
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("meal-log", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parsePatchInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const patch = parsed.value;

  const row = await prisma.mealLog.findFirst({ where: buildMealLogLookupWhere(patient.id, params.id) });
  if (!row) return NextResponse.json({ error: "Meal log not found" }, { status: 404 });

  // A tombstoned row can only be touched by the explicit undo (deletedAt: null).
  // A plain field edit must never resurrect a tombstone.
  const isUndo = patch.deletedAt === null;
  if (row.deletedAt != null && !isUndo) {
    return NextResponse.json({ error: "Meal log not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (patch.servings !== undefined) data.servings = patch.servings; // rescales at read from stored per-serving
  if (patch.mealType !== undefined) data.mealType = patch.mealType;
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.localDate !== undefined) data.localDate = patch.localDate;
  // Only caller-supplied sources (MANUAL/PICTURE/FRIDGE) let the client set
  // macros; a perServing on a server-priced RECIPE/CUSTOM row is ignored so its
  // stored snapshot can't be clobbered — symmetric with buildMealLogCreateData.
  if (patch.perServing !== undefined && isCallerSuppliedMacroSource(row.source)) {
    // Absent fields → NULL columns (unset ≠ 0), so a blank edit keeps the row
    // incomplete instead of silently marking it complete with 0s.
    const cols = nullableMacroColumns(patch.perServing);
    data.calories = cols.calories;
    data.protein = cols.protein;
    data.carbs = cols.carbs;
    data.fat = cols.fat;
    data.fiber = cols.fiber;
    data.incomplete = cols.incomplete;
  }
  if (isUndo) data.deletedAt = null;

  const updated = await prisma.mealLog.update({ where: { id: row.id }, data });
  // Carry the CUSTOM ingredient's unit label on the echo (no-op for other sources).
  let unit: string | null = null;
  if (updated.source === MealLogSource.CUSTOM && updated.customIngredientId) {
    const ci = await prisma.patientCustomIngredient.findFirst({
      where: { id: updated.customIngredientId, patientId: patient.id },
      select: { unit: true },
    });
    unit = ci?.unit ?? null;
  }
  const envelope = await getDayEnvelope(patient.id, updated.localDate);
  return NextResponse.json({ log: serializeMealLog(updated, unit), ...envelope });
}

// ─── DELETE /api/meal-log/[idOrClientRequestId] — soft delete (tombstone) ────
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("meal-log", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const row = await prisma.mealLog.findFirst({ where: buildMealLogLookupWhere(patient.id, params.id) });
  // Unknown id/clientRequestId → 404 (the offline queue reads this as "create
  // never synced" and drops the queued create).
  if (!row) return NextResponse.json({ error: "Meal log not found" }, { status: 404 });

  // Idempotent: already-tombstoned rows are left as-is and still return 200.
  const target = row.deletedAt == null
    ? await prisma.mealLog.update({ where: { id: row.id }, data: { deletedAt: new Date() } })
    : row;

  const envelope = await getDayEnvelope(patient.id, target.localDate);
  return NextResponse.json({ ok: true, ...envelope });
}
