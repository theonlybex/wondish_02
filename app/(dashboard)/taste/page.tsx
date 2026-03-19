import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRecipeEmoji } from "@/lib/recipeEmoji";
import DishTinder from "@/components/taste/DishTinder";

export const metadata = { title: "My Taste Profile" };

export default async function TasteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ discover?: string }>;
}) {
  const { discover } = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) redirect("/login");

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) redirect("/profile?onboarding=true");

  // ── Dish Tinder preferences ──────────────────────────────────────────────────
  const tinderPrefs = await prisma.patientDishPreference.findMany({
    where: { patientId: patient.id },
    include: {
      recipe: {
        select: {
          id: true, name: true, emoji: true, tags: true, calories: true,
          mealType: { select: { name: true } },
          ethnic: { select: { name: true } },
          ingredients: { include: { ingredient: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Show Dish Tinder if: no preferences yet, OR user clicked "Rate More Dishes"
  if (tinderPrefs.length === 0 || discover === "1") {
    return (
      <div className="max-w-lg mx-auto py-4">
        <DishTinder />
      </div>
    );
  }

  const tinderLiked = tinderPrefs.filter((p) => p.liked);
  const tinderDisliked = tinderPrefs.filter((p) => !p.liked);

  // ── Ingredient affinity (from liked tinder dishes) ───────────────────────────
  const ingredientCount: Record<string, number> = {};
  for (const pref of tinderLiked) {
    for (const ri of pref.recipe.ingredients) {
      const name = ri.ingredient.name;
      ingredientCount[name] = (ingredientCount[name] ?? 0) + 1;
    }
  }
  const totalLiked = tinderLiked.length;
  const ingredientAffinity = totalLiked > 0
    ? Object.entries(ingredientCount)
        .map(([name, count]) => ({ name, percent: Math.round((count / totalLiked) * 100), count }))
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 15)
    : [];

  // ── Journal meal ratings (existing My Taste data) ────────────────────────────
  const ratedMeals = await prisma.journalMeal.findMany({
    where: {
      journalEntry: { patientId: patient.id },
      skipped: false,
      recipeId: { not: null },
      rating: { not: null },
    },
    select: {
      recipeId: true,
      rating: true,
      mealType: true,
      journalEntry: { select: { date: true } },
    },
    orderBy: { journalEntry: { date: "desc" } },
  });

  const recipeStats: Record<string, { likes: number; dislikes: number; mealType: string }> = {};
  for (const m of ratedMeals) {
    if (!m.recipeId) continue;
    if (!recipeStats[m.recipeId]) {
      recipeStats[m.recipeId] = { likes: 0, dislikes: 0, mealType: m.mealType };
    }
    if ((m.rating ?? 0) > 0) recipeStats[m.recipeId].likes++;
    else recipeStats[m.recipeId].dislikes++;
  }

  const journalRecipeIds = Object.keys(recipeStats);
  const journalRecipes = journalRecipeIds.length > 0
    ? await prisma.recipe.findMany({
        where: { id: { in: journalRecipeIds } },
        select: { id: true, name: true, emoji: true, tags: true, calories: true, mealType: { select: { name: true } } },
      })
    : [];

  const journalLiked = journalRecipes.filter((r) => (recipeStats[r.id]?.likes ?? 0) > (recipeStats[r.id]?.dislikes ?? 0));
  const journalDisliked = journalRecipes.filter((r) => (recipeStats[r.id]?.dislikes ?? 0) > (recipeStats[r.id]?.likes ?? 0));

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">My Taste Profile</h1>
          <p className="text-[#8A8D93] text-sm mt-1">
            Your personalised dish map — built from dishes you'd try and meals you've rated.
          </p>
        </div>
        <a
          href="/taste?discover=1"
          className="px-4 py-2 rounded-xl border border-primary text-primary text-sm font-semibold hover:bg-primary/5 transition-colors shrink-0"
        >
          Rate More Dishes
        </a>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 text-center">
          <p className="text-3xl font-black text-navy">{tinderPrefs.length + journalRecipeIds.length}</p>
          <p className="text-[#8A8D93] text-xs mt-1">Dishes rated</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
          <p className="text-3xl font-black text-emerald-600">{tinderLiked.length + journalLiked.length}</p>
          <p className="text-emerald-600/70 text-xs mt-1">Would Try 👍</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
          <p className="text-3xl font-black text-red-500">{tinderDisliked.length + journalDisliked.length}</p>
          <p className="text-red-500/70 text-xs mt-1">Would Skip 👎</p>
        </div>
      </div>

      {/* Ingredient Affinities */}
      {ingredientAffinity.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🧠</span>
            <h2 className="font-bold text-navy text-base">Ingredients You Love</h2>
            <span className="ml-auto text-xs text-[#8A8D93]">from your liked dishes</span>
          </div>
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 space-y-3">
            {ingredientAffinity.map(({ name, percent }) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm text-navy font-medium w-36 truncate">{name}</span>
                <div className="flex-1 h-2 bg-[#F0EFF5] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-primary w-10 text-right">{percent}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#8A8D93] mt-2 pl-1">
            Your meal plan prioritises recipes with these ingredients. Higher % = appears in more of your liked dishes.
          </p>
        </section>
      )}

      {/* Dishes You'd Try (Tinder) */}
      {tinderLiked.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">✅</span>
            <h2 className="font-bold text-navy text-base">Dishes You'd Try</h2>
            <span className="ml-auto text-xs text-[#8A8D93]">{tinderLiked.length} dishes</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {tinderLiked.map(({ recipe }) => {
              const emoji = recipe.emoji ?? getRecipeEmoji(recipe.name, recipe.tags, recipe.mealType?.name);
              return (
                <div key={recipe.id} className="bg-white border border-emerald-100 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 text-2xl">
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-navy text-sm truncate">{recipe.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {recipe.mealType?.name && (
                        <span className="text-[10px] text-[#8A8D93]">{recipe.mealType.name}</span>
                      )}
                      {recipe.ethnic?.name && (
                        <span className="text-[10px] text-primary">· {recipe.ethnic.name}</span>
                      )}
                      {recipe.calories && (
                        <span className="text-[10px] text-[#8A8D93]">· {recipe.calories} kcal</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Dishes You Loved (Journal) */}
      {journalLiked.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">👍</span>
            <h2 className="font-bold text-navy text-base">Meals You Loved</h2>
            <span className="ml-auto text-xs text-[#8A8D93]">{journalLiked.length} from your journal</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {journalLiked.map((r) => {
              const stats = recipeStats[r.id];
              const emoji = r.emoji ?? getRecipeEmoji(r.name, r.tags, r.mealType?.name);
              return (
                <div key={r.id} className="bg-white border border-emerald-100 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 text-2xl">
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-navy text-sm truncate">{r.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {r.calories && <span className="text-[10px] text-[#8A8D93]">{r.calories} kcal</span>}
                      {r.mealType?.name && <span className="text-[10px] text-[#8A8D93]">· {r.mealType.name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {Array.from({ length: Math.min(stats?.likes ?? 0, 5) }).map((_, i) => (
                      <span key={i} className="text-xs">💚</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Dishes to Skip (Tinder + Journal) */}
      {(tinderDisliked.length > 0 || journalDisliked.length > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🙅</span>
            <h2 className="font-bold text-navy text-base">Not Your Thing</h2>
            <span className="ml-auto text-xs text-[#8A8D93]">{tinderDisliked.length + journalDisliked.length} dishes</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[...tinderDisliked.map((p) => p.recipe), ...journalDisliked].map((r) => {
              const emoji = r.emoji ?? getRecipeEmoji(r.name, r.tags, r.mealType?.name);
              return (
                <div key={r.id} className="bg-white border border-red-100 rounded-2xl p-4 flex items-center gap-4 opacity-70">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0 text-2xl">
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-navy text-sm truncate line-through decoration-red-300">{r.name}</p>
                    {r.mealType?.name && <p className="text-[10px] text-[#8A8D93] mt-1">{r.mealType.name}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="bg-primary/5 border border-primary/15 rounded-2xl p-5 text-center">
        <p className="text-navy text-sm font-medium mb-1">Your taste profile improves your meal plan</p>
        <p className="text-[#8A8D93] text-xs">
          The more you rate, the smarter your suggestions get. Liked dishes boost similar recipes in your meal plan.
        </p>
      </div>
    </div>
  );
}
