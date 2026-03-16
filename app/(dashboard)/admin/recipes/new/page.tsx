import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import RecipeForm from "@/components/admin/RecipeForm";

export const metadata = { title: "New Recipe" };

export default async function NewRecipePage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account?.roles.some((r) => r.role.name === "SUPER")) redirect("/overview");

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
