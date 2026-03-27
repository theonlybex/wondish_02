"use client";

import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { RecipeDTO } from "@/types";
import { getRecipeEmoji } from "@/lib/recipeEmoji";

interface RecipeListTableProps {
  recipes: RecipeDTO[];
}

export default function RecipeListTable({ recipes }: RecipeListTableProps) {
  const [items, setItems] = useState<RecipeDTO[]>(recipes);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recipe?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/recipes/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E8E7EA]">
            <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Recipe</th>
            <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden md:table-cell">Meal Type</th>
            <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden lg:table-cell">Calories</th>
            <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden lg:table-cell">Protein</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {items.map((recipe) => (
            <tr key={recipe.id} className="border-b border-[#E8E7EA] hover:bg-[#FAFAFA]">
              <td className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{recipe.emoji ?? getRecipeEmoji(recipe.name, recipe.tags)}</span>
                  <div>
                    <p className="font-medium text-navy">{recipe.name}</p>
                    {recipe.description && (
                      <p className="text-[#8A8D93] text-xs line-clamp-1">{recipe.description}</p>
                    )}
                  </div>
                </div>
              </td>
              <td className="py-3 px-4 hidden md:table-cell">
                {recipe.mealType ? (
                  <Badge variant="primary">{recipe.mealType.name}</Badge>
                ) : (
                  <span className="text-[#8A8D93]">—</span>
                )}
              </td>
              <td className="py-3 px-4 hidden lg:table-cell text-[#8A8D93]">
                {recipe.calories ? `${recipe.calories} kcal` : "—"}
              </td>
              <td className="py-3 px-4 hidden lg:table-cell text-[#8A8D93]">
                {recipe.protein ? `${recipe.protein}g` : "—"}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-2 justify-end">
                  <Link href={`/admin/recipes/${recipe.id}/edit`}>
                    <Button variant="secondary" size="sm">Edit</Button>
                  </Link>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={deletingId === recipe.id}
                    onClick={() => handleDelete(recipe.id)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#8A8D93]">No recipes found.</div>
      )}
    </div>
  );
}
