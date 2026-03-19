"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRecipeEmoji } from "@/lib/recipeEmoji";

interface TinderDish {
  id: string;
  name: string;
  emoji?: string | null;
  description?: string | null;
  calories?: number | null;
  tags: string[];
  mealType?: { name: string } | null;
  ethnic?: { name: string } | null;
}

export default function DishTinder() {
  const router = useRouter();
  const [dishes, setDishes] = useState<TinderDish[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [done, setDone] = useState(false);
  const [likedCount, setLikedCount] = useState(0);

  useEffect(() => {
    fetch("/api/taste/dishes")
      .then((r) => r.json())
      .then((data) => setDishes(data.dishes ?? []))
      .finally(() => setLoading(false));
  }, []);

  // Mark taste setup as seen so layout doesn't redirect back after completion
  useEffect(() => {
    if (done || (!loading && dishes.length === 0)) {
      document.cookie = "wondish_taste_seen=1; path=/; max-age=31536000; SameSite=Lax; Secure";
    }
  }, [done, loading, dishes.length]);

  const swipe = async (liked: boolean) => {
    if (swiping || index >= dishes.length) return;
    setSwiping(true);
    const dish = dishes[index];

    await fetch("/api/taste/swipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId: dish.id, liked }),
    });

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

  const finish = () => {
    router.push("/meal-plan");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-4xl animate-pulse mb-4">🍽</div>
        <p className="text-[#8A8D93] text-sm">Preparing your dishes…</p>
      </div>
    );
  }

  if (dishes.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-5xl mb-4">✅</p>
        <p className="text-navy font-semibold text-lg mb-2">You've rated all available dishes!</p>
        <p className="text-[#8A8D93] text-sm mb-6">Check back after new recipes are added.</p>
        <button onClick={finish} className="px-6 py-3 rounded-2xl bg-primary text-white font-semibold text-sm">
          Go to Meal Plan →
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-navy mb-2">Preferences saved!</h2>
        <p className="text-[#8A8D93] text-sm mb-1">
          You liked <span className="text-primary font-semibold">{likedCount}</span> out of{" "}
          <span className="font-semibold">{dishes.length}</span> dishes.
        </p>
        <p className="text-[#8A8D93] text-xs mb-8 max-w-xs">
          Your meal plan will now prioritise ingredients from the dishes you'd try.
        </p>
        <button
          onClick={finish}
          className="px-8 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/30 hover:opacity-90 transition-opacity"
        >
          Take me to today's dishes →
        </button>
      </div>
    );
  }

  const dish = dishes[index];
  const emoji = dish.emoji ?? getRecipeEmoji(dish.name, dish.tags, dish.mealType?.name);
  const progress = ((index) / dishes.length) * 100;

  return (
    <div className="max-w-sm mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-xs font-bold text-primary uppercase tracking-widest">
          The Chef wants to know your preferences
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-1.5 bg-[#F0EFF5] rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-[#8A8D93] shrink-0">
          {index + 1} / {dishes.length}
        </span>
      </div>

      {/* Dish Card */}
      <div className="bg-white border border-[#E8E7EA] rounded-3xl overflow-hidden shadow-lg">
        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 px-8 pt-10 pb-6 text-center">
          <span className="text-8xl leading-none">{emoji}</span>
          <h2 className="text-xl font-bold text-navy mt-5 leading-tight">{dish.name}</h2>

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

        {/* Buttons */}
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

        {/* Skip */}
        <div className="pb-4 text-center">
          <button
            onClick={skip}
            className="text-xs text-[#8A8D93] hover:text-navy transition-colors px-4 py-2"
          >
            Skip this dish →
          </button>
        </div>
      </div>

      <p className="text-[#8A8D93] text-xs text-center mt-6">
        Choose whether you'd try each dish so we can personalise your meal plan even more
      </p>
    </div>
  );
}
