"use client";

// Phase 6a M2 — catalog-first ingredient rows (design §5.4): typeahead over
// the site ingredient catalog; no match → keep the free text (files an
// IngredientRequest server-side) with a "pending catalog match" chip.

import { useEffect, useRef, useState } from "react";

export interface IngredientRowValue {
  name: string;
  quantity: string; // form-side string; parsed server-side
  unit: string;
  ingredientId: string | null;
}

interface Suggestion {
  id: string;
  name: string;
  unit: string | null;
}

export default function IngredientPicker({
  rows,
  onChange,
}: {
  rows: IngredientRowValue[];
  onChange: (rows: IngredientRowValue[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ingredients/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const body = await res.json();
        setSuggestions(body.ingredients ?? []);
        setHighlight(0);
      } catch {
        // typeahead is best-effort; free text always works
      }
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const addRow = (name: string, ingredientId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (rows.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setQuery("");
      setOpen(false);
      return;
    }
    onChange([...rows, { name: trimmed, quantity: "", unit: "", ingredientId }]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  };

  const updateRow = (index: number, patch: Partial<IngredientRowValue>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div>
      {/* Existing rows */}
      {rows.length > 0 && (
        <ul className="space-y-2 mb-3">
          {rows.map((row, i) => (
            <li key={row.name} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 flex items-center gap-2 text-sm text-[#1E1A1A]">
                <span className="truncate font-medium">{row.name}</span>
                {row.ingredientId === null && (
                  <span className="shrink-0 text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                    pending catalog match
                  </span>
                )}
              </span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="qty"
                aria-label={`${row.name} quantity (optional)`}
                value={row.quantity}
                onChange={(e) => updateRow(i, { quantity: e.target.value })}
                className="w-16 border border-[#EAE4CA] rounded-lg px-2 py-1 text-xs"
              />
              <input
                type="text"
                placeholder="unit"
                aria-label={`${row.name} unit (optional)`}
                value={row.unit}
                onChange={(e) => updateRow(i, { unit: e.target.value })}
                className="w-14 border border-[#EAE4CA] rounded-lg px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove ${row.name}`}
                className="w-7 h-7 rounded-lg text-[#848181] hover:bg-[#F5F1DD] font-bold"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Typeahead */}
      <div className="relative">
        <input
          type="text"
          value={query}
          placeholder="Search ingredients (e.g. peanut, tomato)…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - (exactMatch ? 1 : 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions[highlight]) {
                addRow(suggestions[highlight].name, suggestions[highlight].id);
              } else if (query.trim().length >= 2) {
                addRow(query, null);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
          role="combobox"
          aria-expanded={open && (suggestions.length > 0 || query.trim().length >= 2)}
          aria-label="Add an ingredient"
        />
        {open && query.trim().length >= 2 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-[#EAE4CA] rounded-xl shadow-lg overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => addRow(s.name, s.id)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === highlight ? "bg-[#F5F1DD]" : "hover:bg-[#F9F7ED]"
                }`}
              >
                {s.name}
              </button>
            ))}
            {!exactMatch && (
              <button
                type="button"
                onClick={() => addRow(query, null)}
                className={`w-full text-left px-3 py-2 text-sm border-t border-[#F5F1DD] ${
                  highlight === suggestions.length ? "bg-[#F5F1DD]" : "hover:bg-[#F9F7ED]"
                }`}
              >
                Add “{query.trim()}” — we&apos;ll match it to our catalog
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
