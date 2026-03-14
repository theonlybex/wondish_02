import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import RecipeForm from "@/components/admin/RecipeForm";

export const metadata = { title: "Edit Recipe" };

export default async function EditRecipePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!session.user.roles?.includes("SUPER")) redirect("/overview");

  const [recipe, mealTypes, dishTypes, ethnics, ingredients] = await Promise.all([
    prisma.recipe.findUnique({
      where: { id: params.id },
      include: {
        mealType: true,
        dishType: true,
        ethnic: true,
        ingredients: { include: { ingredient: true } },
      },
    }),
    prisma.mealType.findMany({ orderBy: { name: "asc" } }),
    prisma.dishType.findMany({ orderBy: { name: "asc" } }),
    prisma.ethnic.findMany({ orderBy: { name: "asc" } }),
    prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!recipe) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Edit Recipe</h1>
        <p className="text-[#8A8D93] text-sm mt-1">{recipe.name}</p>
      </div>
      <RecipeForm
        mode="edit"
        recipe={recipe as never}
        refData={{ mealTypes, dishTypes, ethnics, ingredients }}
      />
    </div>
  );
}
