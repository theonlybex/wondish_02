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
}
export interface LogEntry {
  id: string;
  mealType: string;
  name: string;
  source: string;
  estimated: boolean;
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
    const bucket = byDate.get(r.localDate);
    if (bucket) bucket.push(entry);
    else byDate.set(r.localDate, [entry]);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, entries]) => ({ date, entries }));
}
