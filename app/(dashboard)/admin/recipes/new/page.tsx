import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import RecipeForm from "@/components/admin/RecipeForm";

export const metadata = { title: "New Recipe" };

export default async function NewRecipePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!session.user.roles?.includes("SUPER")) redirect("/overview");

  const [mealTypes, dishTypes, ethnics, ingredients] = await Promise.all([
    prisma.mealType.findMany({ orderBy: { name: "asc" } }),
    prisma.dishType.findMany({ orderBy: { name: "asc" } }),
    prisma.ethnic.findMany({ orderBy: { name: "asc" } }),
    prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">New Recipe</h1>
        <p className="text-[#8A8D93] text-sm mt-1">Add a recipe to the meal plan pool</p>
      </div>
      <RecipeForm
        mode="create"
        refData={{ mealTypes, dishTypes, ethnics, ingredients }}
      />
    </div>
  );
}
