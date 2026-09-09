"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Item { id: string; name: string; liked: boolean }
interface Group { label: string; items: Item[] }
interface Level { key: string; title: string; groups: Group[] }

export default function IngredientTinder({ mode }: { mode: "onboarding" | "edit" }) {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelIdx, setLevelIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadDeck = () => {
    setLoading(true);
    return fetch("/api/taste/ingredients")
      .then((r) => r.json())
      .then((data) => {
        const lv: Level[] = data.levels ?? [];
        setLevels(lv);
        const pre = new Set<string>();
        for (const l of lv) for (const g of l.groups) for (const it of g.items) if (it.liked) pre.add(it.id);
        setSelected(pre);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark taste complete so the layout gate stops redirecting here.
  useEffect(() => {
    if (mode === "edit" || done || (!loading && levels.length === 0)) {
      fetch("/api/taste/seen", { method: "POST" }).catch(() => {});
    }
  }, [mode, done, loading, levels.length]);

  const finish = () => router.push(mode === "edit" ? "/pantry?tab=buy" : "/pantry?onboarding=1");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const nowSelected = !next.has(id);
      if (nowSelected) next.add(id);
      else next.delete(id);
      if (nowSelected) {
        fetch("/api/taste/ingredient-swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId: id, liked: true }),
        }).catch(() => {});
      } else {
        fetch(`/api/taste/ingredient-swipe?ingredientId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
      }
      return next;
    });
  };

  const startOver = async () => {
    setResetting(true);
    try {
      await fetch("/api/taste/ingredients/reset", { method: "POST" });
    } catch {
      /* proceed — the reload reflects server state */
    }
    setDone(false);
    setLevelIdx(0);
    setConfirmReset(false);
    setSelected(new Set());
    await loadDeck();
    setResetting(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-4xl animate-pulse mb-4" aria-hidden="true">🥘</div>
        <p className="text-[#848181] text-sm">Loading ingredients…</p>
      </div>
    );
  }

  if (levels.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-navy font-semibold text-lg mb-2">No ingredients to choose from.</p>
        <button onClick={finish} className="mt-4 px-6 py-3 rounded-2xl bg-primary text-white font-semibold text-sm">
          {mode === "edit" ? "Done →" : "Continue →"}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🎉</div>
        <h2 className="text-2xl font-bold text-navy mb-2">Favorites saved!</h2>
        <p className="text-[#848181] text-sm mb-8">
          You picked <span className="text-primary font-semibold">{selected.size}</span> favorite
          ingredient{selected.size === 1 ? "" : "s"}. They&apos;ll sit at the top of your shopping list.
        </p>
        <button
          onClick={finish}
          className="px-8 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/30 hover:opacity-90 transition-opacity"
        >
          {mode === "edit" ? "Back to ingredients →" : "Continue to what to buy →"}
        </button>
        <button
          onClick={() => void startOver()}
          disabled={resetting}
          className="mt-4 text-xs font-semibold hover:text-navy transition-colors disabled:opacity-50"
          style={{ color: "#ABA6A6" }}
        >
          {resetting ? "Resetting…" : "Start over from scratch"}
        </button>
      </div>
    );
  }

  const level = levels[levelIdx];
  const selectedInLevel = level.groups.reduce((n, g) => n + g.items.filter((it) => selected.has(it.id)).length, 0);
  const isLast = levelIdx === levels.length - 1;

  return (
    <div className="max-w-md mx-auto pb-24">
      {/* Start over */}
      <div className="flex justify-end items-center mb-1 h-5">
        {confirmReset ? (
          <span className="flex items-center gap-2 text-[11px]">
            <span style={{ color: "#848181" }}>Clear all your picks?</span>
            <button onClick={() => void startOver()} disabled={resetting} className="font-bold text-error disabled:opacity-50">Start over</button>
            <button onClick={() => setConfirmReset(false)} className="font-semibold" style={{ color: "#848181" }}>Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-[11px] hover:text-navy transition-colors" style={{ color: "#ABA6A6" }}>
            Start over
          </button>
        )}
      </div>

      {/* Level header */}
      <div className="text-center mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#B75E78" }}>
          Level {levelIdx + 1} of {levels.length}
        </p>
        <h2 className="text-lg font-bold text-navy mt-0.5">{level.title}</h2>
        <p className="text-xs mt-1" style={{ color: "#848181" }}>
          Tap the ones you like{selectedInLevel > 0 ? ` · ${selectedInLevel} selected` : ""}
        </p>
      </div>

      {/* Level dots */}
      <div className="flex items-center justify-center gap-1.5 mb-5" role="group" aria-label={`Level ${levelIdx + 1} of ${levels.length}`}>
        {levels.map((l, i) => (
          <span key={l.key} aria-hidden="true" className="h-1.5 rounded-full transition-all" style={{ width: i === levelIdx ? 20 : 8, background: i <= levelIdx ? "#812549" : "#EAE4CA" }} />
        ))}
      </div>

      {/* Grouped selectable chips */}
      <div className="space-y-4">
        {level.groups.map((g) => (
          <div key={g.label}>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "#ABA6A6" }}>{g.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((it) => {
                const sel = selected.has(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => toggle(it.id)}
                    aria-pressed={sel}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${sel ? "text-white" : "text-[#5F1C35] bg-white hover:bg-[#812549]/10"}`}
                    style={sel ? { background: "#812549", borderColor: "#812549" } : { borderColor: "rgba(129,37,73,0.3)" }}
                  >
                    {sel ? "✓ " : ""}{it.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky Back / Next */}
      <div className="fixed bottom-0 left-0 right-0 px-5 py-3 flex items-center justify-between gap-3 max-w-md mx-auto" style={{ background: "linear-gradient(to top, #F9F7ED 70%, rgba(249,247,237,0))" }}>
        {levelIdx > 0 ? (
          <button onClick={() => setLevelIdx((i) => i - 1)} className="px-4 py-2.5 rounded-2xl text-sm font-semibold border border-[#EAE4CA] bg-white text-[#5F1C35]">
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => (isLast ? setDone(true) : setLevelIdx((i) => i + 1))}
          className="px-8 py-2.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/25"
        >
          {isLast ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}
