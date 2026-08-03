// Pure validation/decision logic for the journal write routes
// (app/api/journal + app/api/journal/log-meal). Extracted 2026-07-24 (audit
// Task 14): the routes previously stored NaN/negative weights (synced into
// patient BMI), 500'd on garbage dates, and wiped the day's meal ratings on
// any save that omitted `meals`.

// Strict local-date parse: only "YYYY-MM-DD" is accepted, built via the
// local-time constructor (a bare `new Date("YYYY-MM-DD")` UTC-parses and
// lands on the previous local day in negative-offset zones). Anything else
// is null — callers 400 instead of letting an Invalid Date reach Prisma.
export function parseLocalDateStrict(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Meal rows are replaced ONLY when the client actually sent the `meals` key:
// an omitted key preserves existing rows (mood/weight-only saves no longer
// destroy log-meal ratings); an explicit `meals: []` remains a clear.
export function shouldReplaceMeals(body: { meals?: unknown }): boolean {
  return body.meals !== undefined;
}

export interface JournalMealInput {
  mealType: string;
  recipeId?: string;
  preparation?: string;
  skipped?: boolean;
  rating?: number | null;
}

export type JournalPostValidation =
  | {
      ok: true;
      date: Date;
      weight: number | null;
      meals: JournalMealInput[] | undefined;
    }
  | { ok: false; error: string };

const MAX_WEIGHT_LBS = 1500;

export function validateJournalPost(body: Record<string, unknown>): JournalPostValidation {
  const date = parseLocalDateStrict(body.date);
  if (!date) return { ok: false, error: "date must be a YYYY-MM-DD string" };

  let weight: number | null = null;
  if (body.weight !== undefined && body.weight !== null && body.weight !== "") {
    const w = Number(body.weight);
    if (!Number.isFinite(w) || w <= 0 || w >= MAX_WEIGHT_LBS) {
      return { ok: false, error: "weight must be a positive number" };
    }
    weight = w;
  }

  let meals: JournalMealInput[] | undefined;
  if (body.meals !== undefined) {
    if (!Array.isArray(body.meals)) return { ok: false, error: "meals must be an array" };
    const parsed: JournalMealInput[] = [];
    for (const raw of body.meals) {
      const m = raw as Record<string, unknown> | null;
      if (!m || typeof m.mealType !== "string" || m.mealType.trim().length === 0) {
        return { ok: false, error: "each meal needs a non-empty mealType" };
      }
      if (m.rating !== undefined && m.rating !== null) {
        const r = m.rating;
        if (typeof r !== "number" || !Number.isInteger(r) || r < -1 || r > 5) {
          return { ok: false, error: "rating must be an integer between -1 and 5" };
        }
      }
      parsed.push({
        mealType: m.mealType,
        recipeId: typeof m.recipeId === "string" ? m.recipeId : undefined,
        preparation: typeof m.preparation === "string" ? m.preparation : undefined,
        skipped: m.skipped === true,
        rating: (m.rating as number | null | undefined) ?? null,
      });
    }
    meals = parsed;
  }

  return { ok: true, date, weight, meals };
}

// Calendar meal filter: the web journal shows only rated meals; the iOS
// journal (allMeals) shows everything eaten. Skipped meals never render.
export function filterCalendarMeals<T extends { skipped: boolean; rating: number | null }>(
  meals: T[],
  allMeals: boolean,
): T[] {
  return meals.filter((m) => !m.skipped && (allMeals || (m.rating != null && m.rating !== 0)));
}

// ─── Meal completion upsert (S3 extraction from app/api/journal/log-meal) ────
// DB-bound helper (meal-log.ts precedent: pure logic above, injected-port
// effects below). One shared write path for "this planned dish was eaten":
// the HTTP route uses toggle mode (same rating again = undo, its UI contract);
// Clara uses non-toggle mode (re-marking done is idempotent, never an undo)
// and may pass rating null (done, unrated) — which NEVER clears an existing
// rating.

import { prisma } from "@/lib/db";

export interface CompletionDb {
  findEntry(
    patientId: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<{ id: string; meals: { id: string; recipeId: string | null; skipped: boolean; rating: number | null }[] } | null>;
  createEntry(patientId: string, date: Date): Promise<{ id: string }>;
  createMeal(data: {
    journalEntryId: string;
    mealType: string;
    recipeId: string;
    skipped: boolean;
    rating: number | null;
  }): Promise<{ id: string }>;
  updateMealRating(id: string, rating: number | null): Promise<void>;
  deleteMeal(id: string): Promise<void>;
}

export interface CompletionResult {
  action: "created" | "updated" | "removed" | "unchanged";
  journalMealId: string | null;
  rating: number | null;
}

const prismaCompletionDb: CompletionDb = {
  findEntry: async (patientId, dayStart, dayEnd) =>
    prisma.journalEntry.findFirst({
      where: { patientId, date: { gte: dayStart, lte: dayEnd } },
      include: { meals: { select: { id: true, recipeId: true, skipped: true, rating: true } } },
    }),
  createEntry: async (patientId, date) => prisma.journalEntry.create({ data: { patientId, date } }),
  createMeal: async (data) => prisma.journalMeal.create({ data }),
  updateMealRating: async (id, rating) => {
    await prisma.journalMeal.update({ where: { id }, data: { rating } });
  },
  deleteMeal: async (id) => {
    await prisma.journalMeal.delete({ where: { id } });
  },
};

export async function upsertMealCompletion(
  patientId: string,
  args: { recipeId: string; mealTypeName?: string; date: string; rating: 1 | -1 | null; toggle?: boolean },
  db: CompletionDb = prismaCompletionDb
): Promise<CompletionResult | null> {
  const parsed = parseLocalDateStrict(args.date);
  if (!parsed) return null;
  const y = parsed.getFullYear();
  const m = parsed.getMonth() + 1;
  const d = parsed.getDate();
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

  let entry = await db.findEntry(patientId, dayStart, dayEnd);
  if (!entry) {
    const created = await db.createEntry(patientId, dayStart);
    entry = { id: created.id, meals: [] };
  }

  const existing = entry.meals.find((ml) => ml.recipeId === args.recipeId && !ml.skipped);

  if (existing) {
    if (args.rating === null || existing.rating === args.rating) {
      if (args.toggle && args.rating !== null && existing.rating === args.rating) {
        await db.deleteMeal(existing.id); // route contract: same button = undo
        return { action: "removed", journalMealId: null, rating: null };
      }
      return { action: "unchanged", journalMealId: existing.id, rating: existing.rating };
    }
    await db.updateMealRating(existing.id, args.rating);
    return { action: "updated", journalMealId: existing.id, rating: args.rating };
  }

  const meal = await db.createMeal({
    journalEntryId: entry.id,
    mealType: args.mealTypeName ?? "Meal",
    recipeId: args.recipeId,
    skipped: false,
    rating: args.rating,
  });
  return { action: "created", journalMealId: meal.id, rating: args.rating };
}
