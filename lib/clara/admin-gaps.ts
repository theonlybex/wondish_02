/** Demand thresholds before measured demand may override the default wave order (spec §8 Q12). */
export const MIN_SAMPLE_USERS = 20;
export const MIN_SAMPLE_DAYS = 14;

const SAMPLES_PER_CATEGORY = 3;

export interface GapInputRow {
  patientId: string;
  category: string;
  reason: string;
  summary: string;
  surface: string;
  localDate: string;
}

export interface GapRow {
  category: string;
  distinctUsers: number;
  rows: number;
  /** Change in distinct users vs the previous window; null if new. */
  trend: number | null;
  samples: string[];
}

export interface GapReport {
  buildable: GapRow[];
  outOfScope: GapRow[];
  flaggedOff: GapRow[];
  totalRows: number;
}

function group(
  rows: GapInputRow[]
): Map<string, { users: Set<string>; rows: number; samples: string[] }> {
  const out = new Map<string, { users: Set<string>; rows: number; samples: string[] }>();
  for (const r of rows) {
    const entry = out.get(r.category) ?? { users: new Set<string>(), rows: 0, samples: [] };
    entry.users.add(r.patientId);
    entry.rows += 1;
    if (entry.samples.length < SAMPLES_PER_CATEGORY) entry.samples.push(r.summary);
    out.set(r.category, entry);
  }
  return out;
}

function toRows(rows: GapInputRow[], previous: Map<string, number>): GapRow[] {
  // Array.from, not spread: the repo's tsconfig target predates downlevelIteration.
  return Array.from(group(rows).entries())
    .map(([category, e]) => ({
      category,
      distinctUsers: e.users.size,
      rows: e.rows,
      trend: previous.has(category) ? e.users.size - previous.get(category)! : null,
      samples: e.samples,
    }))
    // Alphabetical tie-break keeps the ranking stable across reloads — an
    // unstable order would make "what's top" look like it changed when it did not.
    .sort((a, b) => b.distinctUsers - a.distinctUsers || a.category.localeCompare(b.category));
}

/**
 * Turns raw gap rows into the owner-facing report. Buildable demand excludes
 * OUT_OF_SCOPE (policy pressure — deliberately never built) and FLAGGED_OFF
 * (an ops problem, not backlog), so neither can drift into the build order.
 */
export function aggregateGaps(rows: GapInputRow[], opts: { previous: GapInputRow[] }): GapReport {
  const previousUsers = new Map<string, number>();
  group(opts.previous).forEach((e, category) => previousUsers.set(category, e.users.size));

  return {
    buildable: toRows(
      rows.filter((r) => r.reason === "NOT_BUILT" || r.reason === "UNCLEAR"),
      previousUsers
    ),
    outOfScope: toRows(rows.filter((r) => r.reason === "OUT_OF_SCOPE"), previousUsers),
    flaggedOff: toRows(rows.filter((r) => r.reason === "FLAGGED_OFF"), previousUsers),
    totalRows: rows.length,
  };
}
