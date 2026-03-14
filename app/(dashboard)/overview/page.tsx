import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Onboarding redirect
  if (!session.user.onboardingComplete) {
    redirect("/profile?onboarding=true");
  }

  const patient = await prisma.patient.findUnique({
    where: { accountId: session.user.id },
    include: {
      journalEntries: {
        orderBy: { date: "desc" },
        take: 7,
        include: { meals: true },
      },
      menus: {
        where: {
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
        include: { recipe: true, mealType: true },
      },
    },
  });

  const todayMenus = patient?.menus ?? [];
  const latestJournal = patient?.journalEntries?.[0];
  const currentWeight = latestJournal?.weight ?? null;

  // Streak: consecutive days with journal entry
  const streak = (() => {
    const entries = patient?.journalEntries ?? [];
    let count = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < entries.length; i++) {
      const entryDate = new Date(entries[i].date);
      entryDate.setHours(0, 0, 0, 0);
      const expected = new Date(today);
      expected.setDate(today.getDate() - i);
      if (entryDate.getTime() === expected.getTime()) {
        count++;
      } else {
        break;
      }
    }
    return count;
  })();

  const completedMeals = todayMenus.filter((m) => {
    const journalMeals = latestJournal?.meals ?? [];
    return journalMeals.some(
      (jm) => jm.recipeId === m.recipeId && !jm.skipped
    );
  }).length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">
          Good to see you, {session.user.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-[#8A8D93] mt-1 text-sm">Here&apos;s your health snapshot for today.</p>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-5 mb-8">
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Today&apos;s Meals</p>
          <p className="text-3xl font-bold text-navy mb-1">
            {completedMeals}/{todayMenus.length || 4}
          </p>
          <p className="text-[#8A8D93] text-xs">meals completed</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Current Weight</p>
          <p className="text-3xl font-bold text-navy mb-1">
            {currentWeight ? `${currentWeight} kg` : "—"}
          </p>
          <p className="text-[#8A8D93] text-xs">from last journal entry</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Streak</p>
          <p className="text-3xl font-bold text-navy mb-1">{streak} days</p>
          <p className="text-[#8A8D93] text-xs">consecutive journal entries</p>
        </div>
      </div>

      {/* Today's meal plan preview */}
      {todayMenus.length > 0 ? (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-navy">Today&apos;s Meal Plan</h2>
            <Link href="/meal-plan" className="text-primary text-sm font-medium hover:underline">
              View all →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {todayMenus.map((menu) => (
              <div key={menu.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                <span className="text-2xl">{menu.recipe.emoji ?? "🍽"}</span>
                <div>
                  <p className="font-medium text-navy text-sm">{menu.recipe.name}</p>
                  <p className="text-[#8A8D93] text-xs">{menu.mealType?.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-6 text-center">
          <p className="text-[#8A8D93] mb-3">No meal plan for today.</p>
          <Link
            href="/meal-plan"
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            Set up meal plan
          </Link>
        </div>
      )}

      {/* Upgrade CTA */}
      {session.user.plan !== "PREMIUM" && (
        <div className="relative bg-navy rounded-2xl p-8 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <h2 className="text-white font-bold text-xl mb-2">Unlock the full experience</h2>
            <p className="text-white/50 text-sm mb-6 max-w-md">
              Upgrade to Premium for custom ingredients, full journey analytics, and priority support. First 14 days free.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-primary/30"
            >
              Upgrade to Premium — $15/mo
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
