// ─── Wondish local-date & meal-type primitives (PURE — client-safe) ──────────
// A dependency-free module: it imports NOTHING that touches Prisma/lib/db, so
// it is safe to value-import from both server code (lib/meal-log.ts, routes)
// AND client components (components/tracking/*). This is the single source of
// truth for `formatLocalDate` and the four fixed meal-type slugs — lib/meal-log
// .ts and components/tracking/shared.ts both re-export from here rather than
// carrying hand-written twins (which had drifted apart: a value copy in
// meal-log.ts and a separate one in shared.ts, plus MEAL_TYPES / MEAL_TYPE_ORDER
// duplicated across the two).
// ────────────────────────────────────────────────────────────────────────────

// ─── formatLocalDate ────────────────────────────────────────────────────────
// Local getters, zero-padded — the string-for-string twin of iOS's
// DateFormatter "yyyy-MM-dd" in the device's current calendar. Every web write
// path derives localDate from this on the BROWSER's clock. Never
// toISOString().slice(0,10) (UTC → the T3 off-by-one at local-midnight edges).

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Meal-type slugs (the four fixed sections) ──────────────────────────────
// The canonical ordered list. lib/meal-log.ts re-exports this as MEAL_TYPES;
// components/tracking/shared.ts re-exports it as MEAL_TYPE_ORDER (its existing
// import name) — one array, no twins.

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
