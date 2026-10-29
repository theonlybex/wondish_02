"use client";

import { useCallback, useEffect, useState } from "react";

interface Memory {
  id: string;
  text: string;
  createdAt: string;
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

function saved(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" });
}

/**
 * "What Clara remembers" — the member's saved memories, each deletable, plus a
 * confirmed Clear all. Loads itself from /api/clara/memories.
 */
export default function MemoryList() {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/clara/memories", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items?: Memory[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = async (item: Memory) => {
    if (deletingId || clearing) return;
    setDeletingId(item.id);
    setNotice("");
    try {
      const res = await fetch(`/api/clara/memories/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      // 404 = already gone (deleted elsewhere): same end state the member wanted.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setItems((prev) => (prev ? prev.filter((m) => m.id !== item.id) : prev));
    } catch {
      setNotice("Couldn't forget that one. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const clearAll = async () => {
    if (clearing) return;
    setClearing(true);
    setNotice("");
    try {
      const res = await fetch("/api/clara/memories", { method: "DELETE" });
      // 404 = no profile / nothing to clear.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setItems([]);
      setConfirming(false);
    } catch {
      setNotice("Couldn't clear Clara's memory. Nothing was removed — please try again.");
    } finally {
      setClearing(false);
    }
  };

  const busy = deletingId !== null || clearing;

  return (
    <section aria-labelledby="clara-memory-heading" className="mt-12 rounded-2xl border border-[#EAE4CA] bg-white p-6">
      <h2 id="clara-memory-heading" className="text-base font-semibold text-navy mb-1">
        What Clara remembers
      </h2>
      <p className="text-xs mb-4" style={{ color: "#848181" }}>
        Things you&apos;ve told Clara so she can help you better. She keeps them until you delete them.
      </p>

      {notice && (
        <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-3">
          {notice}
        </div>
      )}

      {items === null && !loadError ? (
        <ul className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i} className="h-11 rounded-lg bg-[#F9F7ED] animate-pulse" />
          ))}
        </ul>
      ) : loadError ? (
        <p className="text-sm" role="alert" style={{ color: "#848181" }}>
          Couldn&apos;t load what Clara remembers.{" "}
          <button type="button" onClick={() => void load()} className="font-bold hover:underline cursor-pointer" style={{ color: "#812549" }}>
            Try again
          </button>
        </p>
      ) : items && items.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: "#848181" }}>
          Clara hasn&apos;t saved anything yet. Tell her things like how many people you cook for.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[#EAE4CA]/70">
            {items?.map((item) => (
              <li key={item.id} className={`flex items-center gap-3 py-2.5 ${deletingId === item.id ? "opacity-40" : ""}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1E1A1A] break-words">{item.text}</p>
                  <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: "#848181" }}>
                    Saved {saved(item.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void forget(item)}
                  disabled={busy}
                  aria-label={`Forget: ${item.text}`}
                  title="Forget this"
                  className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg transition-colors text-[#848181] hover:text-[#EA5455] hover:bg-[#EA5455]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EA5455]/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="inline-flex items-center min-h-[44px] px-4 py-2.5 rounded-xl border border-error/40 text-error text-sm font-semibold hover:bg-error/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Clear all
              </button>
            ) : (
              <div role="group" aria-label="Confirm clearing Clara's memory" className="rounded-xl border border-error/25 bg-error/[0.03] p-4">
                <p className="text-sm text-[#1E1A1A] mb-3">
                  Clara will forget everything on this list. This can&apos;t be undone.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void clearAll()}
                    disabled={clearing}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-error text-white text-sm font-semibold hover:bg-error/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {clearing ? "Clearing…" : "Yes, clear everything"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={clearing}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#F5F1DD] transition-colors cursor-pointer"
                    style={{ color: "#848181" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
