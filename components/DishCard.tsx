import type { Dish, MealTypeKey } from "@/types";
import { clsx } from "clsx";
import { getRecipeEmoji } from "@/lib/recipeEmoji";

const mealTypeColors: Record<MealTypeKey, string> = {
  breakfast: "bg-warning/10 text-warning",
  lunch: "bg-success/10 text-success",
  dinner: "bg-primary/10 text-primary",
  snack: "bg-info/10 text-info",
};

const mealTypeLabels: Record<MealTypeKey, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

interface DishCardProps {
  dish: Dish;
  compact?: boolean;
}

export default function DishCard({ dish, compact = false }: DishCardProps) {
  return (
    <div className="group bg-white border border-[#E8E7EA] hover:border-primary/20 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 flex flex-col h-full">
      {/* Emoji banner */}
      <div className="w-full h-28 flex-shrink-0 bg-[#F8F7FA] flex items-center justify-center text-5xl">
        {dish.emoji || getRecipeEmoji(dish.name, dish.tags, dish.mealType)}
      </div>

      <div className="p-5 flex flex-col flex-1">
      {/* Top row */}
      <div className="flex items-start justify-end gap-3 mb-4">
        <span
          className={clsx(
            "text-xs font-semibold px-2.5 py-1 rounded-full",
            mealTypeColors[dish.mealType]
          )}
        >
          {mealTypeLabels[dish.mealType]}
        </span>
      </div>

      {/* Content */}
      <h3 className="text-[#25293C] font-semibold text-base leading-snug mb-2">
        {dish.name}
      </h3>

      {!compact && (
        <p className="text-[#8A8D93] text-sm leading-relaxed mb-4 line-clamp-2 flex-1">
          {dish.description}
        </p>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {dish.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-[11px] font-medium text-[#8A8D93] bg-[#F8F7FA] px-2 py-0.5 rounded-full"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Nutrition row */}
      <div className="flex items-center justify-between pt-4 border-t border-[#E8E7EA] mt-auto">
        <div className="flex items-center gap-1">
          <span className="text-primary font-bold text-sm">{dish.calories}</span>
          <span className="text-[#8A8D93] text-xs">kcal</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#8A8D93]">
          <span>
            <strong className="text-[#25293C]">{dish.protein}g</strong> protein
          </span>
          {dish.prepTime > 0 && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 3.5V6l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {dish.prepTime + dish.cookTime}m
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
