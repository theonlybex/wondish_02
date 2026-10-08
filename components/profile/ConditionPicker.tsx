"use client";

import { useId, useMemo, useState } from "react";
import { groupConditions } from "@/lib/condition-groups";

interface Option {
  id: string;
  name: string;
}

interface ConditionPickerProps {
  options: Option[];
  selected: string[];
  onChange: (ids: string[]) => void;
  // The user's own conditions (always active) — counted in the summary, and
  // their editor rendered as the last group inside the panel.
  customNames?: string[];
  children?: React.ReactNode;
}

// Health conditions behind one disclosure, grouped by body system (product
// list, lib/condition-groups). 41 chips in one alphabetical cloud was the
// longest block of the profile; collapsed, the header still says what is
// selected, so nobody has to open it to check.
export default function ConditionPicker({ options, selected, onChange, customNames = [], children }: ConditionPickerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const groups = useMemo(() => groupConditions(options), [options]);
  const labelById = useMemo(() => new Map(groups.flatMap((g) => g.options.map((o) => [o.id, o.label] as const))), [groups]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const chosen = [...selected.map((id) => labelById.get(id)).filter((l): l is string => Boolean(l)), ...customNames];
  const summary =
    chosen.length === 0 ? "None selected" : chosen.length <= 3 ? chosen.join(", ") : `${chosen.slice(0, 3).join(", ")} +${chosen.length - 3} more`;

  return (
    <div className="rounded-2xl border border-[#EAE4CA] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left rounded-2xl transition-colors hover:bg-[#FBFAF5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[#1E1A1A]">Health Conditions</span>
          <span className="block text-xs mt-0.5 truncate" style={{ color: chosen.length ? "#812549" : "#848181" }} title={chosen.join(", ")}>
            {summary}
          </span>
        </span>
        {chosen.length > 0 && (
          <span className="shrink-0 text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full" style={{ background: "#F5F1DD", color: "#812549" }}>
            {chosen.length} selected
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="shrink-0 transition-transform duration-200 motion-reduce:transition-none"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        >
          <path d="M4 6l4 4 4-4" stroke="#848181" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={panelId} className="border-t border-[#EAE4CA] px-4 pt-4 pb-5 space-y-5">
          {groups.map((g) => {
            const count = g.options.filter((o) => selected.includes(o.id)).length;
            return (
              <fieldset key={g.title}>
                <legend className="flex items-baseline gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#4A4646]">{g.title}</span>
                  {count > 0 && <span className="text-[11px] tabular-nums" style={{ color: "#812549" }}>{count} selected</span>}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((opt) => {
                    const active = selected.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggle(opt.id)}
                        aria-pressed={active}
                        className={`min-h-[44px] px-4 py-2 rounded-full text-sm font-medium text-left transition-all ${
                          active
                            ? "bg-primary text-white shadow-sm shadow-primary/30"
                            : "bg-[#F3F2FF] text-[#4A4646] hover:bg-primary/10 hover:text-primary"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          {children && (
            // Enter in the custom-condition fields must not submit the whole profile.
            <div
              className="border-t border-[#EAE4CA] pt-5"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
              }}
            >
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
