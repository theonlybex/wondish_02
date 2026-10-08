"use client";

import { useEffect, useId, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";

// "Kitchen basics" on What I have: the staples plans, Clara and "dishes you
// can cook" assume you have (lib/kitchen-basics). Pre-ticked; untick what you
// don't have and it's never assumed again. Saved on each tap.
type Basic = { key: string; label: string };

export default function KitchenBasics() {
  const [basics, setBasics] = useState<Basic[] | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const panelId = useId();

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/pantry/basics");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setBasics(data.basics);
        setMissing(new Set(data.missing));
      } catch {
        setError("Couldn't load your kitchen basics.");
      }
    })();
  }, []);

  const toggle = async (key: string) => {
    const before = missing;
    const next = new Set(missing);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setMissing(next);
    setStatus("");
    setError("");
    try {
      const res = await apiFetch("/api/pantry/basics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missing: [...next] }),
      });
      if (!res.ok) throw new Error();
      setStatus("Saved — your next plan follows this.");
    } catch {
      setMissing(before); // never show a state that wasn't saved
      setError("Couldn't save. Check your connection and try again.");
    }
  };

  if (!basics) return error ? <p className="text-xs mb-4" role="alert" style={{ color: "#9B1C1C" }}>{error}</p> : null;
  const kept = basics.length - missing.size;
  const unticked = basics.filter((b) => missing.has(b.key)).map((b) => b.label);

  return (
    <div className="mb-6 rounded-2xl border border-[#EAE4CA] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left rounded-2xl hover:bg-[#FBFAF5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-[#1E1A1A]">Kitchen basics</span>
          <span className="block text-xs mt-0.5 truncate" style={{ color: "#6B6767" }}>
            {kept} of {basics.length} assumed{unticked.length ? ` · not in your kitchen: ${unticked.join(", ")}` : " · salt, oils and dried spices"}
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 transition-transform duration-200 motion-reduce:transition-none" style={{ transform: open ? "rotate(180deg)" : "none" }}>
          <path d="M4 6l4 4 4-4" stroke="#848181" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={panelId} className="border-t border-[#EAE4CA] px-4 pt-3 pb-4">
          <p className="text-xs mb-3" style={{ color: "#6B6767" }}>
            We assume you have these. Untick anything you don&apos;t — your meal plans, Clara and &ldquo;dishes you can cook&rdquo; will stop using it.
          </p>
          <div className="flex flex-wrap gap-2">
            {basics.map((b) => {
              const has = !missing.has(b.key);
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={has}
                  onClick={() => void toggle(b.key)}
                  className={`min-h-[44px] px-4 py-2 rounded-full text-sm font-medium transition-colors ${has ? "bg-primary text-white shadow-sm shadow-primary/30" : "bg-[#F3F2FF] text-[#4A4646] line-through hover:bg-primary/10 hover:text-primary"}`}
                >
                  {b.label}
                  <span className="sr-only">{has ? " — in your kitchen" : " — not in your kitchen"}</span>
                </button>
              );
            })}
          </div>
          <p role="status" aria-live="polite" className="text-xs mt-3" style={{ color: "#1F6B45" }}>{status}</p>
          {error && <p role="alert" className="text-xs mt-1" style={{ color: "#9B1C1C" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
