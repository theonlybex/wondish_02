import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { accountHasActivePremium, getAccountWithSubscription } from "@/lib/auth";
import { sumMealLogs } from "@/lib/macros";
import {
  parseMealLogInput,
  resolveSnapshot,
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  serializeMealLog,
  buildCustomUnitMap,
  computeRemaining,
  getDayTarget,
  getDayEnvelope,
  validateRange,
  MEAL_TYPES,
  DELTA_PAGE_SIZE,
  parseDeltaSyncParam,
  buildDeltaWhere,
  buildNextDeltaCursor,
  DELTA_ORDER_BY,
  type RecipeDep,
  type CustomIngredientDep,
  type RestaurantDishDep,
  type MealType,
} from "@/lib/meal-log";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── POST /api/meal-log — universal single write ─────────────────────────────
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

  const parsed = parseMealLogInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const input = parsed.value;

  // Resolve the source-specific dependency (DB fetch + premium gate live here;
  // resolveSnapshot itself is pure over the fetched deps).
  let recipe: RecipeDep | undefined;
  let customIngredient: CustomIngredientDep | undefined;
  let restaurantDish: RestaurantDishDep | undefined;

  if (input.source === MealLogSource.RECIPE) {
    const r = await prisma.recipe.findUnique({
      where: { id: input.recipeId! },
      select: { name: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, servings: true },
    });
    if (!r) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    recipe = r;
  } else if (input.source === MealLogSource.CUSTOM) {
    const account = await getAccountWithSubscription(userId);
    if (!accountHasActivePremium(account?.subscriptions ?? [])) {
      return NextResponse.json({ error: "Premium required" }, { status: 402 });
    }
    const ci = await prisma.patientCustomIngredient.findFirst({
      where: { id: input.customIngredientId!, patientId: patient.id },
      select: { name: true, calories: true, protein: true, carbs: true, fat: true, unit: true },
    });
    if (!ci) return NextResponse.json({ error: "Custom ingredient not found" }, { status: 404 });
    customIngredient = ci;
  } else if (input.source === MealLogSource.RESTAURANT) {
    // No PUBLISHED/available check at log time — the user already ate it and
    // menus mutate; resolution is by id only (never gated on dish status).
    const dish = await prisma.restaurantDish.findUnique({
      where: { id: input.restaurantDishId! },
      select: { name: true, calories: true, protein: true, carbs: true, fat: true, fiber: true },
    });
    if (!dish) return NextResponse.json({ error: "Restaurant dish not found" }, { status: 404 });
    restaurantDish = dish;
  }

  const resolved = resolveSnapshot(input, { recipe, customIngredient, restaurantDish });
  const data = buildMealLogCreateData(patient.id, input, resolved);

  // Idempotent upsert (pinned update: {}) when a clientRequestId is present;
  // plain create otherwise. Replay of an existing key returns the row as it
  // CURRENTLY exists (possibly edited) with a 200 rather than a 201.
  let created = true;
  let row;
  if (input.clientRequestId) {
    const existing = await prisma.mealLog.findUnique({
      where: { patientId_clientRequestId: { patientId: patient.id, clientRequestId: input.clientRequestId } },
    });
    created = !existing;
    row = await prisma.mealLog.upsert(buildMealLogUpsertArgs(data));
  } else {
    row = await prisma.mealLog.create({ data });
  }

  const envelope = await getDayEnvelope(patient.id, input.localDate);
  // CUSTOM rows carry the ingredient unit label; already fetched above.
  const unit = input.source === MealLogSource.CUSTOM ? customIngredient?.unit ?? null : null;
  return NextResponse.json({ log: serializeMealLog(row, unit), ...envelope }, { status: created ? 201 : 200 });
}

// ─── GET /api/meal-log — mutually exclusive query modes ──────────────────────
// ?date=YYYY-MM-DD  → one day (log UI)
// ?from=&to=        → range (Stats)
// ?updatedSince=ISO → delta sync incl. tombstones (iOS)
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("meal-log-read", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const updatedSince = searchParams.get("updatedSince");

  const modes = [date != null, from != null || to != null, updatedSince != null].filter(Boolean).length;
  if (modes === 0) {
    return NextResponse.json({ error: "Specify one of: ?date=, ?from=&to=, ?updatedSince=" }, { status: 400 });
  }
  if (modes > 1) {
    return NextResponse.json({ error: "Query modes date / from-to / updatedSince are mutually exclusive" }, { status: 400 });
  }

  // ── Day mode ──
  if (date != null) {
    if (!LOCAL_DATE_RE.test(date)) {
      return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
    }
    const rows = await prisma.mealLog.findMany({
      where: { patientId: patient.id, localDate: date, deletedAt: null },
      orderBy: { loggedAt: "asc" },
    });
    const unitMap = await buildCustomUnitMap(patient.id, rows);
    const logs = rows.map((r) => serializeMealLog(r, r.customIngredientId ? unitMap.get(r.customIngredientId) ?? null : null));
    const byMealType: Record<MealType, typeof logs> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    for (const dto of logs) {
      if ((MEAL_TYPES as readonly string[]).includes(dto.mealType)) byMealType[dto.mealType as MealType].push(dto);
    }
    const dayTotals = sumMealLogs(rows);
    const dayTarget = await getDayTarget(patient.id, date);
    const remaining = computeRemaining(dayTarget, dayTotals);
    return NextResponse.json({ date, logs, byMealType, dayTotals, dayTarget, remaining });
  }

  // ── Range mode ──
  if (from != null || to != null) {
    if (from == null || to == null) {
      return NextResponse.json({ error: "Both from and to are required for a range query" }, { status: 400 });
    }
    const range = validateRange(from, to);
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: range.status });

    const rows = await prisma.mealLog.findMany({
      where: { patientId: patient.id, localDate: { gte: from, lte: to }, deletedAt: null },
    });
    const byDay = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byDay.get(row.localDate);
      if (bucket) bucket.push(row);
      else byDay.set(row.localDate, [row]);
    }
    const days = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([localDate, dayRows]) => ({ localDate, totals: sumMealLogs(dayRows) }));
    // Range spans many days → single steady-state target (no plan-ramp lookup).
    const target = await getDayTarget(patient.id, to, false);
    return NextResponse.json({ days, target });
  }

  // ── Delta mode ──
  // updatedSince doubles as the pagination cursor: page 1 sends a plain
  // ISO-8601 instant, later pages echo back the opaque compound `nextCursor`
  // from the prior response. See lib/meal-log.ts (parseDeltaSyncParam et al)
  // for why a compound (updatedAt, id) cursor is required — a plain
  // `updatedAt` cursor can silently drop rows that share a timestamp across
  // a page boundary (batch-write clustering).
  const parsedParam = parseDeltaSyncParam(updatedSince);
  if (!parsedParam.ok) {
    return NextResponse.json({ error: parsedParam.error }, { status: parsedParam.status });
  }
  const rows = await prisma.mealLog.findMany({
    where: buildDeltaWhere(patient.id, parsedParam.value), // includes tombstones (deletedAt != null)
    orderBy: DELTA_ORDER_BY,
    take: DELTA_PAGE_SIZE,
  });
  const unitMap = await buildCustomUnitMap(patient.id, rows);
  const logs = rows.map((r) => serializeMealLog(r, r.customIngredientId ? unitMap.get(r.customIngredientId) ?? null : null));
  const nextCursor = buildNextDeltaCursor(rows);
  return NextResponse.json({ logs, nextCursor });
}
