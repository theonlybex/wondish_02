// Pure view-shaping for the Log tab: meal rows -> days, newest first.
// Groups by the stored localDate string, never by server timezone.

export interface LogRow {
  id: string;
  localDate: string;
  mealType: string;
  name: string;
  source: string;
  estimated: boolean;
  loggedAt: Date;
  deletedAt: Date | null;
  /** Optional so older callers and tests need not pass them. */
  pictureResultId?: string | null;
  servings?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}
export interface LogEntry {
  id: string;
  mealType: string;
  name: string;
  source: string;
  estimated: boolean;
  /** The chat photo this meal was logged from (2026-11-17). The picture itself stays on the phone. */
  photoId?: string;
  /** What was eaten in all (per serving x servings), rounded; left out when unknown. For Apple Health. */
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}
export interface LogDay {
  date: string;
  entries: LogEntry[];
}

export function groupLogByDate(rows: LogRow[]): LogDay[] {
  const live = rows
    .filter((r) => r.deletedAt == null)
    .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
  const byDate = new Map<string, LogEntry[]>();
  for (const r of live) {
    const entry: LogEntry = { id: r.id, mealType: r.mealType, name: r.name, source: r.source, estimated: r.estimated };
    if (r.pictureResultId) entry.photoId = r.pictureResultId;
    const servings = r.servings != null && r.servings > 0 ? r.servings : 1;
    const total = (v: number | null | undefined, digits: number): number | undefined =>
      v != null && Number.isFinite(v) ? Math.round(v * servings * 10 ** digits) / 10 ** digits : undefined;
    const calories = total(r.calories, 0);
    const protein = total(r.protein, 1);
    const carbs = total(r.carbs, 1);
    const fat = total(r.fat, 1);
    if (calories !== undefined) entry.calories = calories;
    if (protein !== undefined) entry.protein = protein;
    if (carbs !== undefined) entry.carbs = carbs;
    if (fat !== undefined) entry.fat = fat;
    const bucket = byDate.get(r.localDate);
    if (bucket) bucket.push(entry);
    else byDate.set(r.localDate, [entry]);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, entries]) => ({ date, entries }));
}
