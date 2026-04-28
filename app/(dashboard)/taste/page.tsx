import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRecipeEmoji } from "@/lib/recipeEmoji";
import DishTinder from "@/components/taste/DishTinder";

export const metadata = { title: "Taste Profile" };

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

  if (tinderPrefs.length === 0 || discover === "1") {
    return (
      <div className="max-w-lg mx-auto py-4">
        <DishTinder />
      </div>
    );
  }

  const tinderLiked = tinderPrefs.filter((p) => p.liked);
  const tinderDisliked = tinderPrefs.filter((p) => !p.liked);

  const ingredientCount: Record<string, number> = {};
  for (const pref of tinderLiked) {
    for (const ri of pref.recipe.ingredients) {
      const name = ri.ingredient.name;
      ingredientCount[name] = (ingredientCount[name] ?? 0) + 1;
    }
  }
  const totalLiked = tinderLiked.length;
  const ingredientAffinity =
    totalLiked > 0
      ? Object.entries(ingredientCount)
          .map(([name, count]) => ({ name, percent: Math.round((count / totalLiked) * 100), count }))
          .sort((a, b) => b.percent - a.percent)
          .slice(0, 15)
      : [];

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
    if (!recipeStats[m.recipeId])
      recipeStats[m.recipeId] = { likes: 0, dislikes: 0, mealType: m.mealType };
    if ((m.rating ?? 0) > 0) recipeStats[m.recipeId].likes++;
    else recipeStats[m.recipeId].dislikes++;
  }

  const journalRecipeIds = Object.keys(recipeStats);
  const journalRecipes =
    journalRecipeIds.length > 0
      ? await prisma.recipe.findMany({
          where: { id: { in: journalRecipeIds } },
          select: { id: true, name: true, emoji: true, tags: true, calories: true, mealType: { select: { name: true } } },
        })
      : [];

  const journalLiked = journalRecipes.filter(
    (r) => (recipeStats[r.id]?.likes ?? 0) > (recipeStats[r.id]?.dislikes ?? 0)
  );
  const journalDisliked = journalRecipes.filter(
    (r) => (recipeStats[r.id]?.dislikes ?? 0) > (recipeStats[r.id]?.likes ?? 0)
  );

  const totalDishes = tinderPrefs.length + journalRecipeIds.length;
  const totalWouldTry = tinderLiked.length + journalLiked.length;
  const totalWouldSkip = tinderDisliked.length + journalDisliked.length;

  return (
    <div className="max-w-3xl mx-auto pb-8">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* Header */}
      <div className="ov flex items-start justify-between mb-8" style={{ animationDelay: "0ms" }}>
        <div>
          <p
            className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
            style={{ color: "#7DB87D" }}
          >
            Taste Profile
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Taste Profile</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#9EA8A0" }}>
              Built from dishes you&apos;d try and meals you&apos;ve rated
            </p>
          </div>
        </div>
        <a
          href="/taste?discover=1"
          className="mt-8 inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex-shrink-0"
          style={{ boxShadow: "0 4px 16px rgba(74,222,128,0.2)" }}
        >
          Rate More
        </a>
      </div>

      {/* Stats bar */}
      <div
        className="ov bg-white rounded-2xl overflow-hidden mb-6"
        style={{
          animationDelay: "70ms",
          boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <div className="grid grid-cols-3" style={{ background: "#FAFCFA" }}>
          {[
            { label: "Dishes Rated", value: totalDishes, color: "#0d1f10" },
            { label: "Would Try", value: totalWouldTry, color: "#4ade80" },
            { label: "Would Skip", value: totalWouldSkip, color: "#EA5455" },
          ].map((s, i) => (
            <div key={s.label} className={`px-6 py-5 ${i > 0 ? "border-l border-[#E8E7EA]" : ""}`}>
              <p
                className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2"
                style={{ color: "#ADBDAD" }}
              >
                {s.label}
              </p>
              <p
                className="font-black tabular-nums leading-none"
                style={{ fontSize: "1.75rem", color: s.color }}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Ingredient Affinities */}
      {ingredientAffinity.length > 0 && (
        <div
          className="ov bg-white rounded-2xl p-6 mb-6"
          style={{
            animationDelay: "140ms",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <p
                className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1"
                style={{ color: "#ADBDAD" }}
              >
                Affinity Map
              </p>
              <h2 className="text-base font-bold text-[#0d1f10]">Ingredients You Love</h2>
            </div>
            <span className="text-2xl">🧠</span>
          </div>
          <div className="space-y-3">
            {ingredientAffinity.map(({ name, percent }) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm text-[#0d1f10] font-medium w-36 truncate">{name}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0F4F0" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${percent}%`, background: "linear-gradient(90deg, #4ade80, #22c55e)" }}
                  />
                </div>
                <span
                  className="text-xs font-bold w-10 text-right tabular-nums"
                  style={{ color: "#4ade80" }}
                >
                  {percent}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-4" style={{ color: "#ADBDAD" }}>
            Higher % = appears in more of your liked dishes. Your meal plan prioritises these ingredients.
          </p>
        </div>
      )}

      {/* Dishes You'd Try */}
      {tinderLiked.length > 0 && (
        <div className="ov mb-6" style={{ animationDelay: "210ms" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>
                Dish Tinder
              </p>
              <h2 className="text-base font-bold text-[#0d1f10]">Dishes You&apos;d Try</h2>
            </div>
            <span
              className="text-[10px] font-bold tracking-widest uppercase"
              style={{ color: "#4ade80" }}
            >
              {tinderLiked.length} dishes
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {tinderLiked.map(({ recipe }) => {
              const emoji = recipe.emoji ?? getRecipeEmoji(recipe.name, recipe.tags, recipe.mealType?.name);
              return (
                <div
                  key={recipe.id}
                  className="bg-white rounded-2xl p-4 flex items-center gap-4"
                  style={{ boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
                >
                  <div
                    className="w-0.5 h-10 rounded-full flex-shrink-0"
                    style={{ background: "#4ade80" }}
                  />
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
                    style={{ background: "rgba(74,222,128,0.08)" }}
                  >
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0d1f10] text-sm truncate">{recipe.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {recipe.mealType?.name && (
                        <span className="text-[10px]" style={{ color: "#ADBDAD" }}>{recipe.mealType.name}</span>
                      )}
                      {recipe.ethnic?.name && (
                        <span className="text-[10px]" style={{ color: "#4ade80" }}>· {recipe.ethnic.name}</span>
                      )}
                      {recipe.calories && (
                        <span className="text-[10px]" style={{ color: "#ADBDAD" }}>· {recipe.calories} kcal</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meals You Loved (Journal) */}
      {journalLiked.length > 0 && (
        <div className="ov mb-6" style={{ animationDelay: "270ms" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>
                From Your Journal
              </p>
              <h2 className="text-base font-bold text-[#0d1f10]">Meals You Loved</h2>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "#4ade80" }}>
              {journalLiked.length} meals
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {journalLiked.map((r) => {
              const stats = recipeStats[r.id];
              const emoji = r.emoji ?? getRecipeEmoji(r.name, r.tags, r.mealType?.name);
              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl p-4 flex items-center gap-4"
                  style={{ boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
                >
                  <div className="w-0.5 h-10 rounded-full flex-shrink-0" style={{ background: "#4ade80" }} />
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
                    style={{ background: "rgba(74,222,128,0.08)" }}
                  >
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0d1f10] text-sm truncate">{r.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {r.calories && (
                        <span className="text-[10px]" style={{ color: "#ADBDAD" }}>{r.calories} kcal</span>
                      )}
                      {r.mealType?.name && (
                        <span className="text-[10px]" style={{ color: "#ADBDAD" }}>· {r.mealType.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {Array.from({ length: Math.min(stats?.likes ?? 0, 5) }).map((_, i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Not Your Thing */}
      {(tinderDisliked.length > 0 || journalDisliked.length > 0) && (
        <div className="ov mb-6" style={{ animationDelay: "330ms" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>
                Excluded
              </p>
              <h2 className="text-base font-bold text-[#0d1f10]">Not Your Thing</h2>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "#EA5455" }}>
              {tinderDisliked.length + journalDisliked.length} dishes
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[...tinderDisliked.map((p) => p.recipe), ...journalDisliked].map((r) => {
              const emoji = r.emoji ?? getRecipeEmoji(r.name, r.tags, r.mealType?.name);
              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl p-4 flex items-center gap-4 opacity-60"
                  style={{ boxShadow: "0 1px 3px rgba(13,31,16,0.05), 0 0 0 1px rgba(13,31,16,0.03)" }}
                >
                  <div className="w-0.5 h-10 rounded-full flex-shrink-0" style={{ background: "#EA5455" }} />
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
                    style={{ background: "rgba(234,84,85,0.06)" }}
                  >
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm truncate line-through"
                      style={{ color: "#0d1f10", textDecorationColor: "#EA5455" }}
                    >
                      {r.name}
                    </p>
                    {r.mealType?.name && (
                      <p className="text-[10px] mt-1" style={{ color: "#ADBDAD" }}>
                        {r.mealType.name}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer CTA */}
      <div
        className="ov relative rounded-2xl p-8 overflow-hidden text-center"
        style={{
          animationDelay: "390ms",
          background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
          boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
        }}
      >
        <div
          className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.08) 0%, transparent 65%)", transform: "translate(30%, -30%)" }}
        />
        <div className="relative">
          <p className="text-white font-bold mb-2">Your taste profile improves your meal plan</p>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
            The more you rate, the smarter your suggestions get. Liked dishes boost similar recipes in your plan.
          </p>
          <a
            href="/taste?discover=1"
            className="inline-flex items-center gap-2 mt-6 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl text-sm font-bold transition-colors"
            style={{ boxShadow: "0 4px 20px rgba(74,222,128,0.25)" }}
          >
            Rate More Dishes
          </a>
        </div>
      </div>
    </div>
  );
}
