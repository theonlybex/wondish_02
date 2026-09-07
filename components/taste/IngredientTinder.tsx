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

export default function IngredientTinder({ mode }: { mode: "onboarding" | "edit" }) {
  const router = useRouter();
  const [items, setItems] = useState<DeckIngredient[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [done, setDone] = useState(false);
  const [likedCount, setLikedCount] = useState(0);

  useEffect(() => {
    fetch(`/api/taste/ingredients${mode === "edit" ? "?edit=1" : ""}`)
      .then((r) => r.json())
      .then((data) => setItems(data.ingredients ?? []))
      .finally(() => setLoading(false));
  }, [mode]);

  // Mark taste as complete so the layout gate stops redirecting here.
  useEffect(() => {
    if (mode === "edit" || done || (!loading && items.length === 0)) {
      fetch("/api/taste/seen", { method: "POST" }).catch(() => {});
    }
  }, [mode, done, loading, items.length]);

  const finish = () => router.push(mode === "edit" ? "/pantry?tab=buy" : "/pantry?onboarding=1");

  const swipe = async (liked: boolean) => {
    if (swiping || index >= items.length) return;
    setSwiping(true);
    const ing = items[index];
    await fetch("/api/taste/ingredient-swipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId: ing.id, liked }),
    });
    if (liked) setLikedCount((n) => n + 1);
    if (index + 1 >= items.length) setDone(true);
    else setIndex((i) => i + 1);
    setSwiping(false);
  };

  const skip = () => {
    if (index + 1 >= items.length) setDone(true);
    else setIndex((i) => i + 1);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-4xl animate-pulse mb-4" aria-hidden="true">🥘</div>
        <p className="text-[#848181] text-sm">Loading ingredients…</p>
      </div>
    );
  }

  if (items.length === 0) {
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

  if (done) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🎉</div>
        <h2 className="text-2xl font-bold text-navy mb-2">Favorites saved!</h2>
        <p className="text-[#848181] text-sm mb-8">
          You favorited <span className="text-primary font-semibold">{likedCount}</span> ingredient
          {likedCount === 1 ? "" : "s"}. They&apos;ll sit at the top of your shopping list.
        </p>
        <button
          onClick={finish}
          className="px-8 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/30 hover:opacity-90 transition-opacity"
        >
          {mode === "edit" ? "Back to ingredients →" : "Continue to what to buy →"}
        </button>
      </div>
    );
  }

  const ing = items[index];
  const progress = (index / items.length) * 100;

  return (
    <div className="max-w-sm mx-auto">
      <div className="text-center mb-6">
        <p className="text-xs font-bold text-primary uppercase tracking-widest">
          {mode === "edit" ? "Edit your favorite ingredients" : "Which ingredients do you love?"}
        </p>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-1.5 bg-[#F0EFF5] rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-[#848181] shrink-0">{index + 1} / {items.length}</span>
      </div>

      <div className="bg-white border border-[#EAE4CA] rounded-3xl overflow-hidden shadow-lg">
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 px-8 pt-10 pb-6 text-center">
          <span className="text-8xl leading-none" aria-hidden="true">{ing.emoji}</span>
          <h2 className="text-xl font-bold text-navy mt-5 leading-tight">{ing.name}</h2>
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
          <button onClick={skip} className="text-xs text-[#848181] hover:text-navy transition-colors px-4 py-2">
            Skip →
          </button>
        </div>
      </div>
    </div>
  );
}
