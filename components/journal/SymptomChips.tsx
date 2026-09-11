"use client";

import { useState } from "react";
import { SEVERITIES, SEVERITY_LABEL, type Severity, type TrackingItemView } from "@/lib/journal-symptoms";

// Condition symptoms (workbook 05): one row per item, four 44-px chips.
// Tapping the selected chip clears it (= "not tracked" for the day).
// Rendered only when `items` is non-empty — users without a condition never
// see it. More than `collapseAfter` items → "Show all" disclosure.
export default function SymptomChips({
  items,
  values,
  onChange,
  collapseAfter = 8,
}: {
  items: TrackingItemView[];
  values: Record<string, Severity>;
  onChange: (id: string, severity: Severity | null) => void;
  collapseAfter?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  // Collapsed view keeps the first `collapseAfter` rows plus any row that
  // already has a value today, so a prefilled symptom is never hidden.
  const visible = showAll ? items : items.filter((it, i) => i < collapseAfter || values[it.id] != null);
  const hidden = items.length - visible.length;
  const collapsible = showAll && items.length > collapseAfter;

  return (
    <div className="space-y-2" role="group" aria-label="Symptoms today">
      {visible.map((it) => {
        const current = values[it.id];
        return (
          <div key={it.id} className="rounded-xl border-2 border-[#F5F1DD] bg-white px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold text-[#1E1A1A]">{it.label}</span>
              {it.inTrial && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "rgba(129,37,73,0.12)", color: "#812549" }}>
                  trial
                </span>
              )}
              <span className="ml-auto text-[10px]" style={{ color: "#ABA6A6" }}>{it.conditionName}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {SEVERITIES.map((s) => {
                const active = current === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(it.id, active ? null : s)}
                    className="min-h-[44px] rounded-lg text-[11px] font-bold transition-colors px-1"
                    style={{
                      background: active ? "#812549" : "#F3F2FF",
                      color: active ? "#fff" : "#4A4646",
                    }}
                  >
                    {SEVERITY_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {(hidden > 0 || collapsible) && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
          className="min-h-[44px] px-2 -ml-2 text-xs font-bold underline rounded-lg"
          style={{ color: "#812549" }}
        >
          {showAll ? "Show fewer" : `Show all (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
