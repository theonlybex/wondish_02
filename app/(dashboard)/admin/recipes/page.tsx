import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import RecipeListTable from "@/components/admin/RecipeListTable";

export const metadata = { title: "Manage Recipes" };

export default async function AdminRecipesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account?.roles.some((r) => r.role.name === "SUPER")) redirect("/overview");

  const recipes = await prisma.recipe.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      mealType: true,
      dishType: true,
      ethnic: true,
      ingredients: { include: { ingredient: true } },
    },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy">Recipes</h1>
          <p className="text-[#8A8D93] text-sm mt-1">{recipes.length} recipes in pool</p>
        </div>
        <Link
          href="/admin/recipes/new"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
        >
          + New Recipe
        </Link>
      </div>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl">
        <RecipeListTable recipes={recipes as never} onDelete={() => {}} />
      </div>
    </div>
  );
}
