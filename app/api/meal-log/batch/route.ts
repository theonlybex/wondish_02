import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { hasActivePremium, getAccountWithSubscription } from "@/lib/auth";
import {
  parseBatchInput,
  resolveSnapshot,
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  serializeMealLog,
  buildCustomUnitMap,
  getDayEnvelope,
  type ParsedMealLog,
  type RecipeDep,
  type CustomIngredientDep,
  type MealLogCreateData,
} from "@/lib/meal-log";

// ─── POST /api/meal-log/batch — multi-item one-tap (Picture plate) ───────────
// All items validated up front, dependencies resolved, then inserted in ONE
// $transaction of per-item upserts (each with its own clientRequestId + the
// pinned update: {} no-op) so a retried batch is fully replay-safe and never
// clobbers interleaved edits.
export async function POST(req: NextRequest) {
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

  const parsed = parseBatchInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const { localDate, items } = parsed.value;

  // Premium gate once if any item is CUSTOM.
  if (items.some((it) => it.source === MealLogSource.CUSTOM)) {
    const account = await getAccountWithSubscription(userId);
    if (!hasActivePremium(account?.subscription)) {
      return NextResponse.json({ error: "Premium required" }, { status: 402 });
    }
  }

  // Resolve each item's snapshot (reads) BEFORE opening the write transaction.
  const rowsData: MealLogCreateData[] = [];
  for (const item of items) {
    let recipe: RecipeDep | undefined;
    let customIngredient: CustomIngredientDep | undefined;

    if (item.source === MealLogSource.RECIPE) {
      const r = await prisma.recipe.findUnique({
        where: { id: item.recipeId! },
        select: { name: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, servings: true },
      });
      if (!r) return NextResponse.json({ error: `Recipe not found: ${item.recipeId}` }, { status: 404 });
      recipe = r;
    } else if (item.source === MealLogSource.CUSTOM) {
      const ci = await prisma.patientCustomIngredient.findFirst({
        where: { id: item.customIngredientId!, patientId: patient.id },
        select: { name: true, calories: true, protein: true, carbs: true, fat: true },
      });
      if (!ci) return NextResponse.json({ error: `Custom ingredient not found: ${item.customIngredientId}` }, { status: 404 });
      customIngredient = ci;
    }

    const resolved = resolveSnapshot(item as ParsedMealLog, { recipe, customIngredient });
    rowsData.push(buildMealLogCreateData(patient.id, item, resolved));
  }

  // One transaction: per-item idempotent upsert (or plain create when the item
  // carries no clientRequestId).
  const rows = await prisma.$transaction(
    rowsData.map((data) =>
      data.clientRequestId
        ? prisma.mealLog.upsert(buildMealLogUpsertArgs(data))
        : prisma.mealLog.create({ data })
    )
  );

  const envelope = await getDayEnvelope(patient.id, localDate);
  const unitMap = await buildCustomUnitMap(patient.id, rows);
  const logs = rows.map((r) => serializeMealLog(r, r.customIngredientId ? unitMap.get(r.customIngredientId) ?? null : null));
  return NextResponse.json({ logs, ...envelope }, { status: 201 });
}
