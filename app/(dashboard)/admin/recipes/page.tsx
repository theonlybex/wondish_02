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
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="ov flex items-start justify-between mb-8" style={{ animationDelay: "0ms" }}>
        <div>
          <p
            className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
            style={{ color: "#7DB87D" }}
          >
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Recipes</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#9EA8A0" }}>
              {recipes.length} recipes in pool
            </p>
          </div>
        </div>
        <Link
          href="/admin/recipes/new"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-5 py-2.5 rounded-xl text-sm font-bold transition-colors mt-8"
          style={{ boxShadow: "0 4px 16px rgba(74,222,128,0.2)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          New Recipe
        </Link>
      </div>

      <div
        className="ov bg-white rounded-2xl overflow-hidden"
        style={{
          animationDelay: "80ms",
          boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <RecipeListTable recipes={recipes as never} />
      </div>
    </div>
  );
}
