"use client";

import { useState, type KeyboardEvent } from "react";
import Button from "@/components/ui/Button";

// Tag input: type, then Enter / comma / "Add"; chips remove with ×. Used by
// the custom-condition form (profile) and the onboarding health step.
export default function TagInput({
  id, label, helper, values, onChange, placeholder, max, maxLength, error,
}: {
  id: string; label: string; helper: string; values: string[]; onChange: (v: string[]) => void;
  placeholder: string; max: number; maxLength: number; error?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  };
  const full = values.length >= max;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#1E1A1A] mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={full ? `Up to ${max}` : placeholder}
          disabled={full}
          maxLength={maxLength}
          aria-describedby={`${id}-help`}
          aria-invalid={!!error}
          className="flex-1 min-w-0 min-h-[44px] px-4 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all disabled:opacity-50"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={full || !draft.trim()}>Add</Button>
      </div>
      <p id={`${id}-help`} className="text-xs mt-1.5" style={{ color: "#848181" }}>{helper} ({values.length}/{max})</p>
      {error && <p className="text-error text-xs mt-1.5" role="alert">{error}</p>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-2" aria-label={`${label} added`}>
          {values.map((v) => (
            <li key={v} className="flex items-center rounded-full bg-[#F3F2FF] text-sm font-medium text-[#4A4646] pl-3">
              <span className="py-2">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-[#812549] hover:bg-[#812549]/10"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
