import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findExchangeById,
  resolveGuard,
  eatGuard,
  mealTypeForExchange,
  toExchangeDTO,
  localDayWindow,
} from "@/lib/plan-exchanges";

class ResolveError extends Error {}

// Resolve or cancel a plan exchange (spec 2026-07-30-plan-exchanges-design.md).
// - resolve: claims a Menu slot for a PENDING exchange. All guards + the write
//   run inside one transaction; a Menu row may be displaced by at most ONE
//   active exchange across BOTH tables.
// - cancel: PENDING → CANCELLED, or RESOLVED → CANCELLED (un-exchange, which
//   restores the planned dish) unless the exchanged-in dish is already eaten.
//   CANCELLED rows null displacedMenuId so the @unique slot is freed.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { action, menuId } = (body ?? {}) as { action?: unknown; menuId?: unknown };
  if (action !== "resolve" && action !== "cancel" && action !== "eat") {
    return NextResponse.json({ error: "action must be 'resolve', 'cancel' or 'eat'" }, { status: 400 });
  }
  if (action === "resolve" && (typeof menuId !== "string" || !menuId)) {
    return NextResponse.json({ error: "menuId is required to resolve" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, activePlanVersion: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const found = await findExchangeById(patient.id, params.id);
  if (!found) return NextResponse.json({ error: "Exchange not found" }, { status: 404 });
  const { row, source } = found;

  if (action === "cancel") {
    if (row.status === "CANCELLED") {
      return NextResponse.json({ error: "Already cancelled" }, { status: 409 });
    }
    if (row.status === "RESOLVED") {
      const eatenLog = await prisma.mealLog.findFirst({
        where: { patientId: patient.id, planExchangeId: row.id, deletedAt: null },
        select: { id: true },
      });
      if (eatenLog) {
        return NextResponse.json(
          { error: "Dish already eaten — remove the log first" },
          { status: 409 }
        );
      }
    }
    const updated =
      source === "RESTAURANT"
        ? await prisma.restaurantPlanExchange.update({
            where: { id: row.id },
            data: { status: "CANCELLED", displacedMenuId: null },
          })
        : await prisma.fridgePlanExchange.update({
            where: { id: row.id },
            data: { status: "CANCELLED", displacedMenuId: null },
          });
    return NextResponse.json({ exchange: toExchangeDTO(updated, source, new Set()) });
  }

  if (action === "eat") {
    // Amendment 2026-07-30: server-side eaten transition — writes the intake
    // MealLog row from the exchange's own snapshot (per-serving macros
    // verbatim; servings from the row) in one transaction with the guards.
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.mealLog.findFirst({
          where: { patientId: patient.id, planExchangeId: row.id, deletedAt: null },
          select: { id: true },
        });
        const err = eatGuard({ row, alreadyEaten: Boolean(existing) });
        if (err) throw new ResolveError(err);
        const menu = row.displacedMenuId
          ? await tx.menu.findFirst({
              where: { id: row.displacedMenuId },
              select: { mealType: { select: { name: true } } },
            })
          : null;
        const isRestaurant = source === "RESTAURANT";
        const restRow = row as typeof row & { restaurantDishId?: string | null };
        const fridgeRow = row as typeof row & { fridgeRecipeId?: string | null; mealType?: string | null };
        const incomplete =
          row.calories == null || row.protein == null || row.carbs == null ||
          row.fat == null || row.fiber == null;
        await tx.mealLog.create({
          data: {
            patientId: patient.id,
            localDate: row.localDate,
            mealType: mealTypeForExchange({
              rowMealType: isRestaurant ? null : fridgeRow.mealType ?? null,
              menuMealTypeName: menu?.mealType?.name ?? null,
            }),
            source: isRestaurant ? "RESTAURANT" : "FRIDGE",
            name: row.name,
            servings: row.servings,
            calories: row.calories,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            fiber: row.fiber,
            incomplete,
            restaurantDishId: isRestaurant ? restRow.restaurantDishId ?? null : null,
            fridgeRecipeId: isRestaurant ? null : fridgeRow.fridgeRecipeId ?? null,
            planExchangeId: row.id,
          },
        });
      });
      return NextResponse.json({ exchange: toExchangeDTO(row, source, new Set([row.id])) });
    } catch (err) {
      if (err instanceof ResolveError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  }

  // action === "resolve"
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const menu = await tx.menu.findFirst({
        where: { id: menuId as string, planVersion: patient.activePlanVersion },
        select: { id: true, patientId: true, date: true, recipeId: true },
      });
      const [restHit, fridgeHit] = menu
        ? await Promise.all([
            tx.restaurantPlanExchange.findFirst({
              where: { displacedMenuId: menu.id, status: { in: ["PENDING", "RESOLVED"] } },
              select: { id: true },
            }),
            tx.fridgePlanExchange.findFirst({
              where: { displacedMenuId: menu.id, status: { in: ["PENDING", "RESOLVED"] } },
              select: { id: true },
            }),
          ])
        : [null, null];

      // "Eaten" for a planned dish = active JournalMeal with its recipeId on
      // that date (mirrors loggedRecipeIds in app/api/meal-plan/route.ts).
      let menuEaten = false;
      if (menu) {
        const w = localDayWindow(row.localDate)!;
        const entry = await tx.journalEntry.findFirst({
          where: { patientId: patient.id, date: { gte: w.start, lte: w.end } },
          include: { meals: { select: { recipeId: true, skipped: true } } },
        });
        menuEaten = (entry?.meals ?? []).some((m) => !m.skipped && m.recipeId === menu.recipeId);
      }

      const err = resolveGuard({
        row,
        activePlanVersion: patient.activePlanVersion,
        menu,
        patientId: patient.id,
        alreadyDisplaced: Boolean(restHit || fridgeHit),
        menuEaten,
      });
      if (err) throw new ResolveError(err);

      const data = { status: "RESOLVED" as const, displacedMenuId: menu!.id, resolvedAt: new Date() };
      return source === "RESTAURANT"
        ? tx.restaurantPlanExchange.update({ where: { id: row.id }, data })
        : tx.fridgePlanExchange.update({ where: { id: row.id }, data });
    });
    return NextResponse.json({ exchange: toExchangeDTO(updated, source, new Set()) });
  } catch (err) {
    if (err instanceof ResolveError) {
      const status = /not found/i.test(err.message) ? 404 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
