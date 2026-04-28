"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getRecipeEmoji } from "@/lib/recipeEmoji";

interface Dish {
  id: string;
  name: string;
  emoji?: string | null;
  description?: string | null;
  calories?: number | null;
  tags: string[];
  mealType?: { name: string } | null;
  ethnic?: { name: string } | null;
}

export default function PublicDishTinder() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [done, setDone] = useState(false);
  const [likedCount, setLikedCount] = useState(0);

  useEffect(() => {
    fetch("/api/taste/public-dishes")
      .then((r) => r.json())
      .then((data) => setDishes(data.dishes ?? []))
      .finally(() => setLoading(false));
  }, []);

  const swipe = (liked: boolean) => {
    if (swiping || index >= dishes.length) return;
    setSwiping(true);

    // Store in localStorage so register page can pick up later
    const dish = dishes[index];
    const existing = JSON.parse(localStorage.getItem("wondish_taste") ?? "[]");
    existing.push({ id: dish.id, liked });
    localStorage.setItem("wondish_taste", JSON.stringify(existing));

    if (liked) setLikedCount((n) => n + 1);

    if (index + 1 >= dishes.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
    }
    setSwiping(false);
  };

  const skip = () => {
    if (index + 1 >= dishes.length) setDone(true);
    else setIndex((i) => i + 1);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-4xl animate-pulse mb-4">🍽</div>
        <p className="text-[#8A8D93] text-sm">Loading dishes…</p>
      </div>
    );
  }

  if (dishes.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-5xl mb-4">🍽</p>
        <p className="text-[#25293C] font-semibold text-lg mb-2">No dishes available yet.</p>
        <p className="text-[#8A8D93] text-sm mb-6">Check back soon — new recipes are added regularly.</p>
        <Link href="/register" className="px-6 py-3 rounded-2xl bg-primary text-[#0a1509] font-semibold text-sm">
          Create your account →
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center py-12 text-center max-w-sm mx-auto">
        <div className="text-6xl mb-5">🎉</div>
        <h2 className="text-2xl font-bold text-[#25293C] mb-2">Nice taste!</h2>
        <p className="text-[#8A8D93] text-sm mb-1">
          You liked <span className="text-primary font-semibold">{likedCount}</span> out of{" "}
          <span className="font-semibold">{dishes.length}</span> dishes.
        </p>
        <p className="text-[#8A8D93] text-sm mb-8 max-w-xs leading-relaxed">
          Create a free account to save your preferences and get a meal plan built around what you actually want to eat.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary hover:bg-primary-dark text-[#0a1509] font-bold text-sm shadow-lg shadow-primary/20 transition-colors"
        >
          Save my preferences
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <p className="text-[#8A8D93] text-xs mt-4">Free — no credit card needed</p>
      </div>
    );
  }

  const dish = dishes[index];
  const emoji = dish.emoji ?? getRecipeEmoji(dish.name, dish.tags, dish.mealType?.name);
  const progress = (index / dishes.length) * 100;

  return (
    <div className="max-w-sm mx-auto">
      <div className="text-center mb-5">
        <p className="text-xs font-bold text-primary uppercase tracking-widest">
          What would you eat?
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-1.5 bg-[#F0EFF5] rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-[#8A8D93] shrink-0">{index + 1} / {dishes.length}</span>
      </div>

      {/* Card */}
      <div className="bg-white border border-[#E8E7EA] rounded-3xl overflow-hidden shadow-lg">
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 px-8 pt-10 pb-6 text-center">
          <span className="text-8xl leading-none">{emoji}</span>
          <h2 className="text-xl font-bold text-[#25293C] mt-5 leading-tight">{dish.name}</h2>

          <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
            {dish.mealType?.name && (
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full uppercase tracking-wide">
                {dish.mealType.name}
              </span>
            )}
            {dish.ethnic?.name && (
              <span className="text-[10px] font-semibold text-[#8A8D93] bg-white/80 border border-[#E8E7EA] px-2.5 py-1 rounded-full">
                {dish.ethnic.name}
              </span>
            )}
          </div>

          {dish.description && (
            <p className="text-[#8A8D93] text-xs mt-3 leading-relaxed line-clamp-2 max-w-[240px] mx-auto">
              {dish.description.split("\n")[0].replace(/^\d+\.\s*/, "")}
            </p>
          )}

          {dish.calories && (
            <p className="text-[10px] text-[#8A8D93] mt-2">{dish.calories} kcal</p>
          )}
        </div>

        <div className="px-5 py-4 flex gap-3">
          <button
            onClick={() => swipe(false)}
            disabled={swiping}
            className="flex-1 py-4 rounded-2xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-sm hover:bg-red-100 disabled:opacity-50 transition-all active:scale-95"
          >
            ✕ Not Gonna Try
          </button>
          <button
            onClick={() => swipe(true)}
            disabled={swiping}
            className="flex-1 py-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-bold text-sm hover:bg-emerald-100 disabled:opacity-50 transition-all active:scale-95"
          >
            ✓ Would Try
          </button>
        </div>

        <div className="pb-4 text-center">
          <button onClick={skip} className="text-xs text-[#8A8D93] hover:text-[#25293C] transition-colors px-4 py-2">
            Skip this dish →
          </button>
        </div>
      </div>

      <p className="text-[#8A8D93] text-xs text-center mt-5">
        Your preferences are saved when you create a free account
      </p>
    </div>
  );
}
