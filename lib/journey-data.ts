// ─── Journey payload — the ONE fetch path for /journey and /api/journey ──────
// Kills the page/route duplication: both the server page and the API route
// call getJourneyPayload, so the JournalEntry fetch, the MealLog fetch, and
// both stat computations can never drift apart.
//
// SERVER-ONLY: imports the prisma singleton (via @/lib/db and lib/meal-log).
// Client components must never value-import from this module — chart props are
// plain serializable data computed server-side (build-2 boundary lesson).
//
// Stats read ONLY stored MealLog snapshots (deletedAt: null, grouped by the
// localDate string). The window target reuses getDayTarget with
// usePlanRamp=false — the same steady-state basis the shipped
// GET /api/meal-log?from=&to= range mode pins (a multi-day window has no
// single plan-ramp day) — and the full DailyTargets passes through so its
// `basis` field stays legible to consumers.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeJourneyStats, computeMacroStats } from "@/lib/journey";
import { formatLocalDate, getDayTarget } from "@/lib/meal-log";
import type { JourneyStats, MacroStats } from "@/types";

export type JourneyEntry = Prisma.JournalEntryGetPayload<{ include: { meals: true } }>;

export interface JourneyPayload {
  stats: JourneyStats;
  macroStats: MacroStats;
  entries: JourneyEntry[];
}

/**
 * @param from window start (local midnight on the caller's clock)
 * @param to   window end (local end-of-day on the caller's clock)
 */
export async function getJourneyPayload(
  patientId: string,
  from: Date,
  to: Date
): Promise<JourneyPayload> {
  const fromStr = formatLocalDate(from);
  const toStr = formatLocalDate(to);

  const [entries, logs] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { patientId, date: { gte: from, lte: to } },
      include: { meals: true },
      orderBy: { date: "asc" },
    }),
    prisma.mealLog.findMany({
      where: { patientId, localDate: { gte: fromStr, lte: toStr }, deletedAt: null },
    }),
  ]);

  // Engagement is measured against every day in the window, not just the days
  // that happen to have a journal entry.
  const totalDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));

  // Range spans many days → single steady-state target (no plan-ramp lookup),
  // matching the shipped GET /api/meal-log range contract.
  const target = await getDayTarget(patientId, toStr, false);

  return {
    stats: computeJourneyStats(entries, totalDays),
    macroStats: computeMacroStats(logs, target),
    entries,
  };
}
