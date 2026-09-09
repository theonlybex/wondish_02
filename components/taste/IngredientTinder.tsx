"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface DeckIngredient {
  id: string;
  name: string;
  emoji: string;
  dishCount: number;
  liked: boolean | null;
}
interface Level {
  key: string;
  title: string;
  ingredients: DeckIngredient[];
}

export default function IngredientTinder({ mode }: { mode: "onboarding" | "edit" }) {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelIdx, setLevelIdx] = useState(0);
  const [cardIdx, setCardIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [done, setDone] = useState(false);
  const [likedCount, setLikedCount] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadDeck = () => {
    setLoading(true);
    return fetch(`/api/taste/ingredients${mode === "edit" ? "?edit=1" : ""}`)
      .then((r) => r.json())
      .then((data) => setLevels(data.levels ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Clear every rating and rate favorites from scratch.
  const startOver = async () => {
    setResetting(true);
    try {
      await fetch("/api/taste/ingredients/reset", { method: "POST" });
    } catch {
      /* proceed anyway — the deck reload reflects server state */
    }
    setDone(false);
    setLevelIdx(0);
    setCardIdx(0);
    setLikedCount(0);
    setConfirmReset(false);
    await loadDeck();
    setResetting(false);
  };

  // Mark taste as complete so the layout gate stops redirecting here.
  useEffect(() => {
    if (mode === "edit" || done || (!loading && levels.length === 0)) {
      fetch("/api/taste/seen", { method: "POST" }).catch(() => {});
    }
  }, [mode, done, loading, levels.length]);

  const finish = () => router.push(mode === "edit" ? "/pantry?tab=buy" : "/pantry?onboarding=1");

  const level = levels[levelIdx];

  const advance = () => {
    if (!level) return;
    if (cardIdx + 1 < level.ingredients.length) {
      setCardIdx((i) => i + 1);
    } else if (levelIdx + 1 < levels.length) {
      setLevelIdx((l) => l + 1);
      setCardIdx(0);
    } else {
      setDone(true);
    }
  };

  const swipe = async (liked: boolean) => {
    if (swiping || !level) return;
    setSwiping(true);
    const ing = level.ingredients[cardIdx];
    await fetch("/api/taste/ingredient-swipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId: ing.id, liked }),
    });
    if (liked) setLikedCount((n) => n + 1);
    advance();
    setSwiping(false);
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
        <p className="text-5xl mb-4" aria-hidden="true">✅</p>
        <p className="text-navy font-semibold text-lg mb-2">You&apos;ve rated the key ingredients!</p>
        <button onClick={finish} className="mt-4 px-6 py-3 rounded-2xl bg-primary text-white font-semibold text-sm">
          {mode === "edit" ? "Done →" : "Continue →"}
        </button>
      </div>
    );
  }

  if (done || !level) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🎉</div>
        <h2 className="text-2xl font-bold text-navy mb-2">Favorites saved!</h2>
        <p className="text-[#848181] text-sm mb-8">
          You favorited <span className="text-primary font-semibold">{likedCount}</span> ingredient
          {likedCount === 1 ? "" : "s"} across {levels.length} food groups. They&apos;ll sit at the top of your shopping list.
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

  const ing = level.ingredients[cardIdx];
  const levelProgress = ((cardIdx) / level.ingredients.length) * 100;

  return (
    <div className="max-w-sm mx-auto">
      {/* Start over */}
      <div className="flex justify-end items-center mb-1 h-5">
        {confirmReset ? (
          <span className="flex items-center gap-2 text-[11px]">
            <span style={{ color: "#848181" }}>Clear all your ratings?</span>
            <button onClick={() => void startOver()} disabled={resetting} className="font-bold text-error disabled:opacity-50">
              Start over
            </button>
            <button onClick={() => setConfirmReset(false)} className="font-semibold" style={{ color: "#848181" }}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="text-[11px] hover:text-navy transition-colors"
            style={{ color: "#ABA6A6" }}
          >
            Start over
          </button>
        )}
      </div>

      {/* Level header */}
      <div className="text-center mb-4">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#B75E78" }}>
          Level {levelIdx + 1} of {levels.length}
        </p>
        <h2 className="text-lg font-bold text-navy mt-0.5">{level.title}</h2>
      </div>

      {/* Level dots — which food groups are done / current / to come */}
      <div className="flex items-center justify-center gap-1.5 mb-4" role="group" aria-label={`Level ${levelIdx + 1} of ${levels.length}`}>
        {levels.map((l, i) => (
          <span
            key={l.key}
            aria-hidden="true"
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === levelIdx ? 20 : 8,
              background: i < levelIdx ? "#812549" : i === levelIdx ? "#812549" : "#EAE4CA",
              opacity: i <= levelIdx ? 1 : 0.6,
            }}
          />
        ))}
      </div>

      {/* Within-level progress */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-1.5 bg-[#F0EFF5] rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${levelProgress}%` }} />
        </div>
        <span className="text-xs text-[#848181] shrink-0">{cardIdx + 1} / {level.ingredients.length}</span>
      </div>

      {/* Ingredient card */}
      <div className="bg-white border border-[#EAE4CA] rounded-3xl overflow-hidden shadow-lg">
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 px-8 pt-10 pb-6 text-center">
          <span className="text-8xl leading-none" aria-hidden="true">{ing.emoji}</span>
          <h3 className="text-xl font-bold text-navy mt-5 leading-tight">{ing.name}</h3>
          <p className="text-[10px] text-[#848181] mt-2">unlocks {ing.dishCount} dish{ing.dishCount === 1 ? "" : "es"}</p>
          {mode === "edit" && ing.liked !== null && (
            <p className="text-[10px] mt-1 font-bold" style={{ color: ing.liked ? "#059669" : "#EA5455" }}>
              Currently: {ing.liked ? "👍 Favorite" : "👎 Not for me"}
            </p>
          )}
        </div>

        <div className="px-5 py-4 flex gap-3">
          <button
            onClick={() => swipe(false)}
            disabled={swiping}
            className="flex-1 py-4 rounded-2xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-sm hover:bg-red-100 disabled:opacity-50 transition-all active:scale-95"
          >
            ✕ Not for me
          </button>
          <button
            onClick={() => swipe(true)}
            disabled={swiping}
            className="flex-1 py-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-bold text-sm hover:bg-emerald-100 disabled:opacity-50 transition-all active:scale-95"
          >
            ✓ Favorite
          </button>
        </div>

        <div className="pb-4 text-center">
          <button onClick={advance} className="text-xs text-[#848181] hover:text-navy transition-colors px-4 py-2">
            Skip →
          </button>
        </div>
      </div>
    </div>
  );
}
