import Link from "next/link";
import { dishes } from "@/data/dishes";
import { getTranslations } from "next-intl/server";
import { getRecipeEmoji } from "@/lib/recipeEmoji";
import type { MealTypeKey } from "@/types";

const mealTypeTag: Record<MealTypeKey, { bg: string; color: string; label: string }> = {
  breakfast: { bg: "rgba(255,159,67,0.12)",  color: "#FF9F43", label: "Breakfast" },
  lunch:     { bg: "rgba(74,222,128,0.12)",  color: "#4ade80", label: "Lunch" },
  dinner:    { bg: "rgba(0,207,232,0.12)",   color: "#00CFE8", label: "Dinner" },
  snack:     { bg: "rgba(234,84,85,0.12)",   color: "#EA5455", label: "Snack" },
};

const cardBgs = [
  "linear-gradient(145deg,#263b2a,#152718)",
  "linear-gradient(145deg,#2a2015,#1a1510)",
  "linear-gradient(145deg,#132028,#0a1518)",
  "linear-gradient(145deg,#152718,#0d1a10)",
  "linear-gradient(145deg,#2a2515,#1a1810)",
  "linear-gradient(145deg,#263b2a,#1e3422)",
];

export default async function DishesPreview() {
  const t = await getTranslations("dishesPreview");
  const track = [...dishes, ...dishes];

  return (
    <section id="menu" className="py-28 overflow-hidden" style={{ background: "#0d1a10" }}>
      <style>{`
        @keyframes tray-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .tray-track { display: flex; gap: 20px; width: max-content; animation: tray-scroll 40s linear infinite; }
        .tray-wrap:hover .tray-track { animation-play-state: paused; }
        .tray-card:hover { transform: translateY(-6px) scale(1.02); border-color: rgba(74,222,128,0.2) !important; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
      `}</style>

      <div className="px-6 max-w-6xl mx-auto mb-12 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase mb-4" style={{ color: "#4ade80" }}>
            {t("eyebrow")}
          </p>
          <h2 className="text-4xl sm:text-5xl font-extrabold leading-tight" style={{ color: "#f0fdf4", letterSpacing: "-0.03em" }}>
            {t("headline")}
          </h2>
        </div>
        <Link
          href="/dishes"
          className="text-sm font-semibold shrink-0 transition-opacity hover:opacity-70"
          style={{ color: "#4ade80" }}
        >
          {t("viewAll")} →
        </Link>
      </div>

      <div className="tray-wrap relative overflow-hidden" style={{ padding: "8px 0 32px" }}>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-32 z-10"
          style={{ background: "linear-gradient(to right, #0d1a10, transparent)" }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-32 z-10"
          style={{ background: "linear-gradient(to left, #0d1a10, transparent)" }}
        />

        <div className="tray-track">
          {track.map((dish, i) => {
            const tag = mealTypeTag[dish.mealType];
            const emoji = dish.emoji || getRecipeEmoji(dish.name, dish.tags, dish.mealType);
            const totalTime = dish.prepTime + dish.cookTime;
            const bg = cardBgs[i % cardBgs.length];
            return (
              <div
                key={`${dish.id}-${i}`}
                aria-hidden={i >= dishes.length ? true : undefined}
                className="tray-card flex-none w-[280px] rounded-[20px] overflow-hidden transition-all duration-300"
                style={{ background: bg, border: "1px solid rgba(74,222,128,0.06)" }}
              >
                <div
                  className="aspect-square flex items-center justify-center text-[64px] relative"
                  style={{ background: bg }}
                >
                  {emoji}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1/2"
                    style={{ background: "linear-gradient(to top, #0d1a10, transparent)" }}
                  />
                </div>
                <div className="p-5">
                  <span
                    className="inline-block text-[10px] font-bold tracking-[0.15em] uppercase px-2.5 py-1 rounded-full mb-2.5"
                    style={{ background: tag.bg, color: tag.color }}
                  >
                    {tag.label}
                  </span>
                  <h4 className="text-base font-bold mb-1.5 leading-snug" style={{ color: "#f0fdf4" }}>
                    {dish.name}
                  </h4>
                  <p
                    className="text-[13px] leading-relaxed line-clamp-1"
                    style={{ color: "rgba(240,253,244,0.28)" }}
                  >
                    {dish.description}
                  </p>
                  <div
                    className="flex gap-4 mt-3.5 pt-3.5"
                    style={{ borderTop: "1px solid rgba(74,222,128,0.06)" }}
                  >
                    <span className="text-xs font-medium" style={{ color: "rgba(240,253,244,0.45)" }}>
                      <strong style={{ color: "#f0fdf4" }}>{dish.calories}</strong> kcal
                    </span>
                    <span className="text-xs font-medium" style={{ color: "rgba(240,253,244,0.45)" }}>
                      <strong style={{ color: "#f0fdf4" }}>{dish.protein}g</strong> protein
                    </span>
                    {totalTime > 0 && (
                      <span className="text-xs font-medium" style={{ color: "rgba(240,253,244,0.45)" }}>
                        <strong style={{ color: "#f0fdf4" }}>{totalTime}</strong> min
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
