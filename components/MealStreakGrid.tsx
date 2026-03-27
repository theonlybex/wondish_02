"use client";

import type { ReactNode } from "react";

export type DayStatus = "full" | "partial" | "none" | "empty" | "future";

export interface GridDay {
  date: string; // yyyy-MM-dd
  status: DayStatus;
}

interface MealStreakGridProps {
  days: GridDay[];
  totalCompleted: number;
  firstDay: string; // yyyy-MM-dd — user's registration date; cells before this are hidden
}

const COLORS: Record<DayStatus, string> = {
  full: "#22c55e",
  partial: "#86efac",
  none: "#E8E7EA",
  empty: "#F0EEF4",
  future: "#F8F7FA",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Row 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Show labels on Mon (1), Wed (3), Fri (5)
const ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function tooltipLabel(day: GridDay): string | undefined {
  if (day.status === "future" || day.status === "empty") return undefined;
  const d = new Date(day.date + "T00:00:00");
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (day.status === "full") return `${dateStr}: All meals completed ✓`;
  if (day.status === "partial") return `${dateStr}: Partially completed`;
  return `${dateStr}: No meals logged`;
}

export default function MealStreakGrid({ days, totalCompleted, firstDay }: MealStreakGridProps) {
  // days starts from a Sunday — split into weekly columns of 7
  const columns: GridDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    columns.push(days.slice(i, i + 7));
  }

  const numCols = columns.length;

  // Month labels — show once per unique month name, keyed by column index
  const monthLabels: Map<number, string> = new Map();
  const shownLabels = new Set<string>();
  let lastMonth = -1;
  columns.forEach((col, ci) => {
    // Use the Sunday (first day) of each column for month detection
    const first = col[0];
    if (first) {
      const m = new Date(first.date + "T00:00:00").getMonth();
      const label = MONTHS[m];
      if (m !== lastMonth && !shownLabels.has(label)) {
        monthLabels.set(ci, label);
        shownLabels.add(label);
        lastMonth = m;
      }
    }
  });

  // Build flat cell array for CSS grid (row-major: top-to-bottom, left-to-right)
  const cells: ReactNode[] = [];

  // Row 0: empty corner + month labels
  cells.push(<div key="corner" />);
  for (let ci = 0; ci < numCols; ci++) {
    cells.push(
      <div key={`month-${ci}`} className="text-center">
        {monthLabels.has(ci) && (
          <span className="text-[9px] text-[#8A8D93] select-none leading-none">
            {monthLabels.get(ci)}
          </span>
        )}
      </div>
    );
  }

  // Rows 1–7: day label + grid cells
  for (let rowIdx = 0; rowIdx < 7; rowIdx++) {
    cells.push(
      <div key={`lbl-${rowIdx}`} className="flex items-center justify-end pr-0.5">
        <span className="text-[9px] text-[#8A8D93] select-none leading-none">
          {ROW_LABELS[rowIdx]}
        </span>
      </div>
    );
    for (let ci = 0; ci < numCols; ci++) {
      const day = columns[ci]?.[rowIdx];
      const hidden = day && day.date < firstDay;
      cells.push(
        <div
          key={`cell-${ci}-${rowIdx}`}
          className="aspect-square rounded-[2px] cursor-default"
          style={{ backgroundColor: day && !hidden ? COLORS[day.status] : "transparent" }}
          title={day && !hidden ? tooltipLabel(day) : undefined}
        />
      );
    }
  }

  return (
    <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-navy text-base">Meal Plan Activity</h2>
        <span className="text-[#8A8D93] text-xs">
          {totalCompleted} day{totalCompleted !== 1 ? "s" : ""} completed
        </span>
      </div>

      <div className="w-full overflow-hidden">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `24px repeat(${numCols}, 1fr)`,
            gap: "3px",
          }}
        >
          {cells}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 justify-end">
        <span className="text-[#8A8D93] text-[10px] select-none">Less</span>
        {(["empty", "partial", "full"] as DayStatus[]).map((s) => (
          <div
            key={s}
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: COLORS[s] }}
          />
        ))}
        <span className="text-[#8A8D93] text-[10px] select-none">More</span>
      </div>
    </div>
  );
}
