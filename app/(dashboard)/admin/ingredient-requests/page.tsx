"use client";

// Phase 6a M3 — ingredient-request queue (design §5.4). Free-text portal
// ingredient rows land here; mapping one to a catalog Ingredient backfills
// ingredientId on every unmapped same-name dish row and closes duplicate
// requests. Rejected names stay valid verdict inputs as plain text.

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

interface RequestItem {
  id: string;
  name: string;
  restaurant: { id: string; name: string };
  createdAt: string;
  usageCount: number;
}

interface CatalogHit {
  id: string;
  name: string;
  unit: string | null;
}

function MapPicker({
  request,
  busy,
  onMap,
  onCancel,
}: {
  request: RequestItem;
  busy: boolean;
  onMap: (ingredientId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(request.name);
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [selected, setSelected] = useState<CatalogHit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/ingredients/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const body = await res.json();
        setHits(body.ingredients ?? []);
      }
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div className="mt-3 bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl p-4">
      <label htmlFor={`map-${request.id}`} className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
        Map &ldquo;{request.name}&rdquo; to a catalog ingredient
      </label>
      <input
        id={`map-${request.id}`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        className="w-full bg-white border border-[#EAE4CA] rounded-xl px-4 py-2.5 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
        placeholder="Search the catalog…"
        autoComplete="off"
      />
      {!selected && hits.length > 0 && (
        <ul className="mt-2 bg-white border border-[#EAE4CA] rounded-xl divide-y divide-[#F5F1DD] max-h-52 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setSelected(h)}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1E1A1A] hover:bg-[#F9F7ED] transition-colors"
              >
                {h.name}
                {h.unit ? <span className="text-xs text-[#ABA6A6]"> · {h.unit}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <p className="mt-2 text-sm text-[#1E1A1A]">
          Selected: <span className="font-semibold">{selected.name}</span>
        </p>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!selected} loading={busy} onClick={() => selected && onMap(selected.id)}>
          Map ingredient
        </Button>
      </div>
    </div>
  );
}

export default function AdminIngredientRequestsPage() {
  const [items, setItems] = useState<RequestItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mappingId, setMappingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/admin/ingredient-requests");
    if (res.ok) {
      const body = await res.json();
      setItems(body.items ?? []);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "Could not load requests.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: RequestItem, payload: Record<string, unknown>) => {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/ingredient-requests/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${item.name}: ${body?.error ?? "Decision failed"}`);
        return;
      }
      if (body.status === "MAPPED") {
        setNotice(
          `Mapped "${item.name}" — ${body.backfilled} dish row${body.backfilled === 1 ? "" : "s"} linked, ` +
            `${body.resolvedRequests} request${body.resolvedRequests === 1 ? "" : "s"} closed.`
        );
      } else {
        setNotice(`Rejected "${item.name}" — it stays as free text on the dishes that use it.`);
      }
      setMappingId(null);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
          Restaurants · catalog
        </p>
        <h1 className="text-2xl font-semibold text-[#1E1A1A] mb-2">Ingredient requests</h1>
        <p className="text-sm text-[#6E6868] max-w-2xl leading-relaxed">
          When restaurant staff can&rsquo;t find an ingredient in the catalog, they type it in and it
          lands here. Mapping links every same-name dish row to the catalog entry, so allergy
          verdicts stop depending on spelling.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-white rounded-2xl p-5 mb-6 border border-[#E8C4CE] text-sm text-[#B75E78]">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-[#FBF6E9] border border-[#EAE4CA] rounded-2xl p-5 mb-6 text-sm text-[#1E1A1A]">
          {notice}
        </div>
      )}

      {items === null ? (
        <p className="text-sm text-[#ABA6A6]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-10 text-center">
          <p className="font-semibold text-[#1E1A1A] mb-1">No pending requests</p>
          <p className="text-sm text-[#6E6868]">
            Free-text ingredients from the restaurant portal will show up here.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl divide-y divide-[#F5F1DD]">
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#1E1A1A]">{item.name}</p>
                    <p className="text-xs mt-0.5 text-[#6E6868]">
                      {item.restaurant.name} · {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                      <span className="tabular-nums">{item.usageCount}</span> unmapped dish row
                      {item.usageCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Reject "${item.name}"? It stays as free text on dishes.`)) {
                          void decide(item, { action: "reject" });
                        }
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setMappingId(mappingId === item.id ? null : item.id)}
                    >
                      Map…
                    </Button>
                  </div>
                </div>
                {mappingId === item.id && (
                  <MapPicker
                    request={item}
                    busy={busy}
                    onMap={(ingredientId) => void decide(item, { action: "map", ingredientId })}
                    onCancel={() => setMappingId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
