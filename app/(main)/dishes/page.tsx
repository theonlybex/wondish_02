import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import DishesGrid from "@/components/DishesGrid";
import type { Dish, MealTypeKey } from "@/types";
import { displayDishName } from "@/lib/dish-name";
import { readableDescription } from "@/lib/dish-plausibility";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our Menu",
  description: "Nutritionist-approved recipes designed for every meal and every goal.",
};

export default async function DishesPage() {
  const recipes = await prisma.recipe.findMany({
    // Not the rows no plan can serve: a declared 0-59 kcal "meal" or one over
    // 1,200 kcal is import noise on the public menu (84 + 5 rows in QA cycle
    // 17, "Beef Pot Roast" at 0 kcal). Sides can be small.
    where: {
      isPublic: true,
      calories: { gte: 1, lte: 1200 },
      OR: [{ calories: { gte: 60 } }, { dishType: { name: { contains: "side", mode: "insensitive" } } }],
    },
    include: { mealType: true },
    orderBy: { name: "asc" },
  });

  const dishes: Dish[] = recipes.map((r, i) => {
    // displayDishName only — the same name every other screen shows.
    const name = displayDishName(r.name);
    return {
    id: i + 1,
    // The public menu was the one surface still printing raw import rows —
    // "2-Step Chicken , V1L- 6 oz chicken" on 626 dishes (QA cycle 17) — and
    // the description, which repeats the whole method on 784 of them.
    name,
    // Many descriptions just repeat the name — the raw one, variant code and all.
    description:
      r.description && r.description.trim() === r.name.trim()
        ? name
        : readableDescription(r.description ?? "", r.steps),
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
    };
  });

  return (
    <div className="min-h-screen bg-[#F8F7FA] pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E1A1A] mb-3">Our Menu</h1>
          <p className="text-[#848181] text-lg max-w-xl">
            Nutritionist-approved recipes designed for every meal and every goal.
          </p>
        </div>

        <DishesGrid dishes={dishes} />
      </div>
    </div>
  );
}
