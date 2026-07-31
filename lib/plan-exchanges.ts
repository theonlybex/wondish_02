// Plan-exchange overlay core (spec 2026-07-30-plan-exchanges-design.md).
// Pure mapping/composition up top (unit-tested); thin Prisma-backed range
// helpers below (queries only — logic stays in the pure part). Menu rows are
// never mutated: exchanges are day-scoped overlay rows composed at read time.
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";
import { validateFridgeRecipeSnapshot, type FridgeRecipe } from "@/lib/fridge";
import type { PlanExchangeDTO, PlanExchangeSource } from "@/types";

// Structural union of both exchange tables' rows — restaurant rows carry
// restaurantName/incomplete, fridge rows carry emoji; macros overlap.
export interface ExchangeRowLike {
  id: string;
  localDate: string;
  planVersion: number;
  status: "PENDING" | "RESOLVED" | "CANCELLED";
  displacedMenuId: string | null;
  servings: number;
  name: string;
  createdAt: Date;
  restaurantName?: string;
  incomplete?: boolean;
  emoji?: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

export function toExchangeDTO(
  row: ExchangeRowLike,
  source: PlanExchangeSource,
  eatenIds: Set<string>
): PlanExchangeDTO {
  return {
    id: row.id,
    source,
    localDate: row.localDate,
    status: row.status,
    servings: row.servings,
    displacedMenuId: row.displacedMenuId,
    name: row.name,
    originLabel: source === "RESTAURANT" ? row.restaurantName ?? "" : "Your fridge",
    emoji: source === "FRIDGE" ? row.emoji ?? null : null,
    perServing: {
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      fiber: row.fiber,
    },
    incomplete: source === "RESTAURANT" ? row.incomplete ?? false : false,
    eaten: eatenIds.has(row.id),
    createdAt: row.createdAt.toISOString(),
  };
}

export function splitByStatus(dtos: PlanExchangeDTO[]): {
  pending: PlanExchangeDTO[];
  resolved: PlanExchangeDTO[];
} {
  return {
    pending: dtos.filter((d) => d.status === "PENDING"),
    resolved: dtos.filter((d) => d.status === "RESOLVED"),
  };
}

export function displacedMenuIdSet(dtos: PlanExchangeDTO[]): Set<string> {
  return new Set(
    dtos
      .filter((d) => d.status === "RESOLVED" && d.displacedMenuId)
      .map((d) => d.displacedMenuId as string)
  );
}

// Local midnight..23:59:59.999 for a "YYYY-MM-DD" string; null on garbage.
// Built on parseLocalDateStrict so local-vs-UTC parsing stays consistent
// with the journal/grocery routes (audit Task 15 precedent).
export function localDayWindow(localDate: string): { start: Date; end: Date } | null {
  const start = parseLocalDateStrict(localDate);
  if (!start) return null;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ── Prisma-backed helpers (thin: queries only) ──────────────────────────────

const NOT_CANCELLED = { in: ["PENDING", "RESOLVED"] as ("PENDING" | "RESOLVED")[] };

export async function getExchangesForRange(
  patientId: string,
  planVersion: number,
  fromLocalDate: string,
  toLocalDate: string
): Promise<PlanExchangeDTO[]> {
  const where = {
    patientId,
    planVersion,
    status: NOT_CANCELLED,
    localDate: { gte: fromLocalDate, lte: toLocalDate },
  };
  const [restRows, fridgeRows] = await Promise.all([
    prisma.restaurantPlanExchange.findMany({ where, orderBy: { createdAt: "asc" } }),
    prisma.fridgePlanExchange.findMany({ where, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...restRows, ...fridgeRows].map((r) => r.id);
  const eatenLogs = ids.length
    ? await prisma.mealLog.findMany({
        where: { patientId, planExchangeId: { in: ids }, deletedAt: null },
        select: { planExchangeId: true },
      })
    : [];
  const eaten = new Set(eatenLogs.map((l) => l.planExchangeId as string));
  return [
    ...restRows.map((r) => toExchangeDTO(r, "RESTAURANT", eaten)),
    ...fridgeRows.map((r) => toExchangeDTO(r, "FRIDGE", eaten)),
  ];
}

export async function getDisplacedMenuIdsForRange(
  patientId: string,
  planVersion: number,
  fromLocalDate: string,
  toLocalDate: string
): Promise<Set<string>> {
  return displacedMenuIdSet(
    await getExchangesForRange(patientId, planVersion, fromLocalDate, toLocalDate)
  );
}

export async function findExchangeById(
  patientId: string,
  id: string
): Promise<{ row: ExchangeRowLike; source: PlanExchangeSource } | null> {
  const rest = await prisma.restaurantPlanExchange.findFirst({ where: { id, patientId } });
  if (rest) return { row: rest, source: "RESTAURANT" };
  const fridge = await prisma.fridgePlanExchange.findFirst({ where: { id, patientId } });
  if (fridge) return { row: fridge, source: "FRIDGE" };
  return null;
}

// ── Input parsers ───────────────────────────────────────────────────────────

const MACRO_KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

export type ParseExchangeResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseServings(raw: unknown): number | { error: string } {
  if (raw === undefined) return 1;
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0 || raw > 20) {
    return { error: "servings must be a number in (0, 20]" };
  }
  return raw;
}

export function parseRestaurantExchangeInput(
  raw: unknown
): ParseExchangeResult<{ restaurantDishId: string; localDate: string; servings: number }> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;
  // Server prices RESTAURANT macros (standing rule 3) — reject any client attempt.
  for (const k of MACRO_KEYS) {
    if (k in r) return { ok: false, error: `${k} is server-priced; do not send it` };
  }
  const restaurantDishId =
    typeof r.restaurantDishId === "string" && r.restaurantDishId ? r.restaurantDishId : null;
  if (!restaurantDishId) return { ok: false, error: "restaurantDishId is required" };
  if (typeof r.localDate !== "string" || !localDayWindow(r.localDate)) {
    return { ok: false, error: "localDate must be YYYY-MM-DD" };
  }
  const servings = parseServings(r.servings);
  if (typeof servings !== "number") return { ok: false, error: servings.error };
  return { ok: true, value: { restaurantDishId, localDate: r.localDate, servings } };
}

export function parseFridgeExchangeInput(
  raw: unknown
): ParseExchangeResult<{
  localDate: string;
  servings: number;
  recipe: FridgeRecipe;
  fridgeRecipeId: string | null;
}> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;
  if (typeof r.localDate !== "string" || !localDayWindow(r.localDate)) {
    return { ok: false, error: "localDate must be YYYY-MM-DD" };
  }
  // Same validation the fridge generator's own output passes (name clamp,
  // steps required, F-D8 macro plausibility) — a snapshot that fails here
  // could never have come from /api/fridge.
  const recipe = validateFridgeRecipeSnapshot(r.recipe);
  if (!recipe) return { ok: false, error: "recipe failed validation" };
  const servings = parseServings(r.servings);
  if (typeof servings !== "number") return { ok: false, error: servings.error };
  const fridgeRecipeId =
    typeof r.fridgeRecipeId === "string" && r.fridgeRecipeId ? r.fridgeRecipeId : null;
  return { ok: true, value: { localDate: r.localDate, servings, recipe, fridgeRecipeId } };
}

// ── resolveGuard ────────────────────────────────────────────────────────────
// Pure pre-write validation for the resolve action. Returns a user-facing
// error string, or null when the exchange may claim the menu slot. The route
// maps /not found/i → 404 and everything else → 409.
export function resolveGuard(args: {
  row: ExchangeRowLike;
  activePlanVersion: number;
  menu: { id: string; patientId: string; date: Date } | null;
  patientId: string;
  alreadyDisplaced: boolean;
  menuEaten: boolean;
}): string | null {
  const { row, activePlanVersion, menu, patientId, alreadyDisplaced, menuEaten } = args;
  if (row.status !== "PENDING") return "Exchange is not pending";
  if (row.planVersion !== activePlanVersion) return "Your plan changed since this dish was added";
  if (!menu || menu.patientId !== patientId) return "Menu not found";
  const w = localDayWindow(row.localDate);
  if (!w || menu.date < w.start || menu.date > w.end) return "That planned dish is on a different day";
  if (alreadyDisplaced) return "That planned dish was already exchanged";
  if (menuEaten) return "That planned dish is already eaten";
  return null;
}

// ── eat action (plan amendment 2026-07-30) ──────────────────────────────────
// "Eaten" is a server-side transition: the PATCH's { action: "eat" } writes
// the MealLog intake row from the exchange's own snapshot in one transaction
// (the client can't — RESTAURANT logs need ids/macros the DTO deliberately
// doesn't carry, and standing rule 3 forbids client-priced macros).

export function eatGuard(args: { row: ExchangeRowLike; alreadyEaten: boolean }): string | null {
  if (args.row.status !== "RESOLVED") return "Exchange it in first — the dish isn't in your plan yet";
  if (args.alreadyEaten) return "Already marked eaten";
  return null;
}

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

export function mealTypeForExchange(args: {
  rowMealType: string | null;
  menuMealTypeName: string | null;
}): string {
  const own = (args.rowMealType ?? "").toLowerCase();
  if (VALID_MEAL_TYPES.has(own)) return own;
  const fromMenu = (args.menuMealTypeName ?? "").toLowerCase();
  if (VALID_MEAL_TYPES.has(fromMenu)) return fromMenu;
  return "dinner";
}
