// A rolling ~2-month memory of dishes served to a patient, stored as JSON on
// Patient.recentDishes: [{ id: recipeId, ts: epochMs }]. Weekly generation
// excludes dishes still inside the window; once a dish rolls out (older than
// the window) it becomes eligible again — reordered naturally by the builder's
// variety/motivation scoring, so it doesn't come back in the same sequence.

export const RECENT_DISH_WINDOW_DAYS = 60;
const WINDOW_MS = RECENT_DISH_WINDOW_DAYS * 86400000;

export type RecentDish = { id: string; ts: number };

export function parseRecentDishes(value: unknown): RecentDish[] {
  if (!Array.isArray(value)) return [];
  const out: RecentDish[] = [];
  for (const e of value) {
    const id = (e as { id?: unknown })?.id;
    const ts = (e as { ts?: unknown })?.ts;
    if (typeof id === "string" && typeof ts === "number") out.push({ id, ts });
  }
  return out;
}

/** Recipe ids still inside the window (to exclude from the next generation). */
export function recentDishIds(entries: RecentDish[], now: number = Date.now()): Set<string> {
  const cutoff = now - WINDOW_MS;
  return new Set(entries.filter((e) => e.ts >= cutoff).map((e) => e.id));
}

/** Merge freshly-served ids at `now`, drop anything past the window, dedupe by id. */
export function mergeRecentDishes(
  entries: RecentDish[],
  newIds: string[],
  now: number = Date.now()
): RecentDish[] {
  const cutoff = now - WINDOW_MS;
  const byId = new Map<string, number>();
  for (const e of entries) if (e.ts >= cutoff) byId.set(e.id, e.ts);
  for (const id of newIds) byId.set(id, now);
  return Array.from(byId.entries()).map(([id, ts]) => ({ id, ts }));
}
