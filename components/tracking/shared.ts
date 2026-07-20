// ─── Tracking UI shared helpers (client-safe) ────────────────────────────────
// Pure module — safe to import from client components. Server DTO shapes are
// imported as TYPE-ONLY imports from lib/meal-log.ts (fully erased at compile
// time), so nothing here drags lib/db (Prisma) into the browser bundle.

import type { MealLogDTO, MealType, Remaining } from "@/lib/meal-log";
import type { MacroSnapshot } from "@/lib/macros";
import type { DailyTargets } from "@/lib/caloric-engine";

export type { MealLogDTO, MealType, Remaining, MacroSnapshot, DailyTargets };

// ─── localDate ───────────────────────────────────────────────────────────────
// Local getters on the BROWSER's clock, zero-padded — the string-for-string
// twin of lib/meal-log.ts's formatLocalDate (which cannot be value-imported
// here: lib/meal-log.ts pulls in lib/db's PrismaClient at module scope, and
// Prisma cannot run in the browser). Never toISOString().slice(0,10) — that is
// UTC and reintroduces the T3 off-by-one at local-midnight boundaries.
// Behavior is pinned to the server twin's contract: `YYYY-MM-DD` via
// getFullYear/getMonth/getDate.

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── clientRequestId (idempotency key, one per user action) ─────────────────

export function newClientRequestId(): string {
  return crypto.randomUUID();
}

// ─── mealType metadata (the four fixed sections) ────────────────────────────

export const MEAL_TYPE_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const satisfies readonly MealType[];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// ─── Source badge metadata (maps MealLogSource → ui/Badge variant) ──────────

export const SOURCE_META: Record<
  string,
  { label: string; variant: "primary" | "success" | "warning" | "error" | "info" | "neutral" }
> = {
  RECIPE: { label: "Recipe", variant: "primary" },
  MANUAL: { label: "Manual", variant: "neutral" },
  PICTURE: { label: "Photo", variant: "info" },
  FRIDGE: { label: "Fridge", variant: "success" },
  CUSTOM: { label: "Custom", variant: "warning" },
};

// ─── Response envelopes (mirror app/api/meal-log contracts) ─────────────────

export interface DayEnvelopeDTO {
  dayTotals: MacroSnapshot;
  dayTarget: DailyTargets | null;
  remaining: Remaining | null;
}

/** GET /api/meal-log?date=YYYY-MM-DD */
export interface DayLogResponse extends DayEnvelopeDTO {
  date: string;
  logs: MealLogDTO[];
  byMealType: Record<MealType, MealLogDTO[]>;
}

/** POST /api/meal-log · PATCH /api/meal-log/[id] */
export interface WriteResponse extends DayEnvelopeDTO {
  log: MealLogDTO;
}

export function groupLogsByMealType(logs: MealLogDTO[]): Record<MealType, MealLogDTO[]> {
  const out: Record<MealType, MealLogDTO[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const log of logs) {
    if (log.mealType in out) out[log.mealType as MealType].push(log);
  }
  return out;
}

// ─── Cross-card sync event ──────────────────────────────────────────────────
// Mirrors the existing "journal:saved" window-event pattern (QuickJournalLog →
// CaloricProfileCard). Every write carries the SERVER echo of dayTotals /
// dayTarget / remaining — listeners apply the echo, never recompute macros
// client-side. `emitterId` lets the card that performed the write skip its own
// event (it already applied the echo locally).

export const MEAL_LOG_UPDATED_EVENT = "meal-log:updated";

export interface MealLogUpdatedDetail extends DayEnvelopeDTO {
  localDate: string;
  emitterId?: string;
}

export function emitMealLogUpdated(detail: MealLogUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MealLogUpdatedDetail>(MEAL_LOG_UPDATED_EVENT, { detail }));
}
