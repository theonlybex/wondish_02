"use client";

import Button from "@/components/ui/Button";
import { RecipeDTO } from "@/types";

interface MealCardProps {
  menuId: string;
  recipe: RecipeDTO;
  mealTypeName?: string;
  onSwap?: (menuId: string, mealTypeId: string, currentRecipeId: string) => void;
  mealTypeId?: string;
}

export default function MealCard({
  menuId,
  recipe,
  mealTypeName,
  onSwap,
  mealTypeId,
}: MealCardProps) {
  return (
    <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8A8D93] uppercase tracking-wide">
          {mealTypeName}
        </span>
        {onSwap && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onSwap(menuId, mealTypeId ?? "", recipe.id)}
          >
            Swap
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-4xl">{recipe.emoji ?? "🍽"}</span>
        <div>
          <p className="font-semibold text-navy">{recipe.name}</p>
          {recipe.description && (
            <p className="text-[#8A8D93] text-xs line-clamp-1 mt-0.5">{recipe.description}</p>
          )}
        </div>
      </div>

      {/* Macro pills */}
      <div className="flex flex-wrap gap-2">
        {recipe.calories && (
          <span className="bg-[#FFF3E0] text-warning text-xs font-semibold px-2.5 py-1 rounded-full">
            {recipe.calories} kcal
          </span>
        )}
        {recipe.protein && (
          <span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1 rounded-full">
            {recipe.protein}g protein
          </span>
        )}
        {recipe.carbs && (
          <span className="bg-success/10 text-success text-xs font-semibold px-2.5 py-1 rounded-full">
            {recipe.carbs}g carbs
          </span>
        )}
        {recipe.fat && (
          <span className="bg-[#F3F2FF] text-[#8A8D93] text-xs font-semibold px-2.5 py-1 rounded-full">
            {recipe.fat}g fat
          </span>
        )}
      </div>
    </div>
  );
}
