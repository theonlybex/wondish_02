"use client";

import { motion } from "framer-motion";
import { RecipeDTO } from "@/types";

interface MealCardProps {
  menuId: string;
  recipe: RecipeDTO;
  mealTypeName?: string;
  onSelect?: () => void;
  compact?: boolean;
}

export default function MealCard({ recipe, mealTypeName, onSelect, compact = false }: MealCardProps) {
  if (compact) {
    return (
      <motion.div
        onClick={onSelect}
        className="bg-white border border-[#E8E7EA] rounded-2xl p-3 flex items-center gap-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="text-2xl shrink-0">{recipe.emoji ?? "🍽"}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-wide">{mealTypeName}</p>
          <p className="font-semibold text-navy text-sm truncate">{recipe.name}</p>
          {recipe.calories && (
            <p className="text-[10px] text-[#8A8D93] mt-0.5">{recipe.calories} kcal</p>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      onClick={onSelect}
      className="bg-white border border-[#E8E7EA] rounded-2xl p-5 flex flex-col gap-3 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8A8D93] uppercase tracking-wide">{mealTypeName}</span>
        <span className="text-[10px] text-[#8A8D93] opacity-60">tap to expand</span>
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
    </motion.div>
  );
}
