import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import DishesGrid from "@/components/DishesGrid";
import type { Dish, MealTypeKey } from "@/types";

export const metadata: Metadata = {
  title: "Our Menu",
  description: "Nutritionist-approved recipes designed for every meal and every goal.",
};

export default async function DishesPage() {
  const recipes = await prisma.recipe.findMany({
    where: { isPublic: true },
    include: { mealType: true },
    orderBy: { name: "asc" },
  });

  const dishes: Dish[] = recipes.map((r, i) => ({
    id: i + 1,
    name: r.name,
    description: r.description ?? "",
    mealType: (r.mealType?.name?.toLowerCase() ?? "dinner") as MealTypeKey,
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
    prepTime: r.prepTime ?? 0,
    cookTime: r.cookTime ?? 0,
    servings: r.servings ?? 0,
    tags: r.tags ?? [],
    emoji: r.emoji ?? "🍽️",
    imageUrl: r.imageUrl ?? undefined,
  }));

  return (
    <div className="min-h-screen bg-[#F8F7FA] pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#25293C] mb-3">Our Menu</h1>
          <p className="text-[#8A8D93] text-lg max-w-xl">
            Nutritionist-approved recipes designed for every meal and every goal.
          </p>
        </div>

        <DishesGrid dishes={dishes} />
      </div>
    </div>
  );
}
