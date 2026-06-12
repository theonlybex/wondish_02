import Link from "next/link";
import { dishes } from "@/data/dishes";
import { getTranslations } from "next-intl/server";
import { getRecipeEmoji } from "@/lib/recipeEmoji";
import type { MealTypeKey } from "@/types";

const mealTypeTag: Record<MealTypeKey, { bg: string; color: string; label: string }> = {
  breakfast: { bg: "#FFE9AE", color: "#DEA402", label: "Breakfast" },
  lunch:     { bg: "#F5F1DD", color: "#5F1C35", label: "Lunch" },
  dinner:    { bg: "#8DCEBD", color: "#2b6472", label: "Dinner" },
  snack:     { bg: "#E0A2AA", color: "#5F1C35", label: "Snack" },
};

export default async function DishesPreview() {
  const t = await getTranslations("dishesPreview");
  const track = [...dishes, ...dishes];

  return (
    <section id="menu" className="pb-24 overflow-hidden">
      <style>{`
        @keyframes tray-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .tray-track { display: flex; gap: 18px; width: max-content; animation: tray-scroll 40s linear infinite; }
        .tray-wrap:hover .tray-track { animation-play-state: paused; }
        .tray-card:hover { transform: translateY(-6px); box-shadow: 0 16px 40px rgba(30,26,26,0.1); }
      `}</style>

      <div className="reveal max-w-[1180px] mx-auto px-7 mb-12">
        <div className="max-w-[640px] mx-auto text-center">
          <span
            className="inline-flex items-center justify-center gap-[9px] text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "#812549" }}
          >
            <span className="w-[22px] h-0.5 rounded-sm" style={{ background: "#FDC221" }} />
            {t("eyebrow")}
          </span>
          <h2
            className="font-extrabold mt-4 mb-4"
            style={{ fontSize: "clamp(32px, 4.4vw, 52px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
          >
            {t("headline")}
          </h2>
          <p className="text-lg" style={{ color: "#4F4A4A" }}>{t("subheadline")}</p>
          <Link
            href="/dishes"
            className="inline-block mt-4 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: "#812549" }}
          >
            {t("viewAll")} →
          </Link>
        </div>
      </div>

      {/* Spinning food tray — continuous marquee of dishes */}
      <div className="tray-wrap relative overflow-hidden" style={{ padding: "8px 0 32px" }}>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-32 z-10"
          style={{ background: "linear-gradient(to right, #F9F7ED, transparent)" }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-32 z-10"
          style={{ background: "linear-gradient(to left, #F9F7ED, transparent)" }}
        />

        <div className="tray-track">
          {track.map((dish, i) => {
            const tag = mealTypeTag[dish.mealType];
            const emoji = dish.emoji || getRecipeEmoji(dish.name, dish.tags, dish.mealType);
            const totalTime = dish.prepTime + dish.cookTime;
            return (
              <div
                key={`${dish.id}-${i}`}
                aria-hidden={i >= dishes.length ? true : undefined}
                className="tray-card flex-none w-[280px] rounded-3xl overflow-hidden bg-white border transition-all duration-300"
                style={{ borderColor: "#EAE4CA" }}
              >
                <div
                  className="aspect-square flex items-center justify-center text-[64px]"
                  style={{ background: "linear-gradient(160deg, #fff, #f4efe5)" }}
                >
                  {emoji}
                </div>
                <div className="p-5">
                  <span
                    className="inline-block text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1 rounded-full mb-2.5"
                    style={{ background: tag.bg, color: tag.color }}
                  >
                    {tag.label}
                  </span>
                  <h4 className="text-[17px] font-bold mb-1 leading-snug" style={{ color: "#1E1A1A", letterSpacing: "-0.02em" }}>
                    {dish.name}
                  </h4>
                  <p className="text-[13px] leading-relaxed line-clamp-1" style={{ color: "#848181" }}>
                    {dish.description}
                  </p>
                  <div className="flex gap-3.5 mt-3.5 pt-3.5 border-t" style={{ borderColor: "#EAE4CA" }}>
                    <span className="text-[12.5px]" style={{ color: "#4F4A4A" }}>
                      <strong style={{ color: "#1E1A1A" }}>{dish.calories}</strong> kcal
                    </span>
                    <span className="text-[12.5px]" style={{ color: "#4F4A4A" }}>
                      <strong style={{ color: "#1E1A1A" }}>{dish.protein}g</strong> protein
                    </span>
                    {totalTime > 0 && (
                      <span className="text-[12.5px]" style={{ color: "#4F4A4A" }}>
                        <strong style={{ color: "#1E1A1A" }}>{totalTime}</strong> min
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
