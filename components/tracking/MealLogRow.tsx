"use client";

// One logged meal inside DailyLogCard: name, source badge, servings ×,
// kcal/P/C/F from log.totals (the server-scaled snapshot — never recomputed
// here), an "Incomplete" badge when totals.incomplete, edit + delete.

import Badge from "@/components/ui/Badge";
import { SOURCE_META, type MealLogDTO } from "./shared";

interface MealLogRowProps {
  log: MealLogDTO;
  onEdit: (log: MealLogDTO) => void;
  onDelete: (log: MealLogDTO) => void;
  disabled?: boolean;
}

export default function MealLogRow({ log, onEdit, onDelete, disabled }: MealLogRowProps) {
  const meta = SOURCE_META[log.source] ?? SOURCE_META.MANUAL;
  const iconBtn =
    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";

  return (
    <div className="flex items-center gap-2 py-2 border-b border-[#F5F1DD] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-[#1E1A1A] truncate" title={log.name}>
            {log.name}
          </span>
          <span className="flex-shrink-0">
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </span>
          {log.totals.incomplete && (
            <span className="flex-shrink-0">
              <Badge variant="warning">Incomplete</Badge>
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#848181] tabular-nums mt-0.5">
          × {log.servings}
          {log.unit ? ` ${log.unit}` : ""} · P {Math.round(log.totals.protein)}g · C{" "}
          {Math.round(log.totals.carbs)}g · F {Math.round(log.totals.fat)}g
        </p>
      </div>

      <div className="flex items-baseline gap-1 flex-shrink-0">
        <span className="text-sm font-bold text-primary tabular-nums">
          {Math.round(log.totals.calories)}
        </span>
        <span className="text-[10px] text-[#848181]">kcal</span>
      </div>

      <div className="flex items-center flex-shrink-0">
        <button
          type="button"
          onClick={() => onEdit(log)}
          disabled={disabled}
          aria-label={`Edit ${log.name}`}
          className={`${iconBtn} text-[#848181] hover:text-primary hover:bg-primary/10`}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M11.3 2.1l2.6 2.6-8.5 8.5-3.2.6.6-3.2 8.5-8.5z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(log)}
          disabled={disabled}
          aria-label={`Delete ${log.name}`}
          className={`${iconBtn} text-[#848181] hover:text-error hover:bg-error/10`}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 4.5h11M6.5 4.5V3c0-.5.4-1 1-1h1c.6 0 1 .5 1 1v1.5M4 4.5l.7 8.3c0 .4.4.7.8.7h5c.4 0 .8-.3.8-.7l.7-8.3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
