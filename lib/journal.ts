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
