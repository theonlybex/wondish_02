import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import GroceryListView from "@/components/grocery/GroceryListView";

export const metadata = { title: "Grocery List" };

export default async function GroceryListPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const menus = await prisma.menu.findMany({
    where: {
      patient: { account: { clerkId: userId } },
      date: { gte: weekStart, lte: weekEnd },
    },
    include: {
      recipe: {
        include: { ingredients: { include: { ingredient: true } } },
      },
    },
  });

  // Aggregate
  const aggregated: Record<
    string,
    { ingredientId: string; name: string; totalQuantity: number; unit: string | null }
  > = {};

  for (const menu of menus) {
    for (const ri of menu.recipe.ingredients) {
      const key = ri.ingredientId;
      if (!aggregated[key]) {
        aggregated[key] = {
          ingredientId: ri.ingredientId,
          name: ri.ingredient.name,
          totalQuantity: 0,
          unit: ri.unit ?? ri.ingredient.unit ?? null,
        };
      }
      aggregated[key].totalQuantity += ri.quantity ?? 1;
    }
  }

  const items = Object.values(aggregated).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const weekLabel = (() => {
    const s = weekStart;
    const e = weekEnd;
    const sMonth = s.toLocaleDateString("en-US", { month: "short" });
    const eMonth = e.toLocaleDateString("en-US", { month: "short" });
    return sMonth === eMonth
      ? `${sMonth} ${s.getDate()} – ${e.getDate()}`
      : `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}`;
  })();

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <style>{`
        @keyframes gl-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .gl { animation: gl-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="gl mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#7DB87D" }}>
          {weekLabel}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#0d1f10]">Grocery List</h1>
            <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>Ingredients for this week&apos;s meal plan</p>
          </div>
          {items.length > 0 && (
            <span
              className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full mb-1"
              style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}
            >
              {items.length} items
            </span>
          )}
        </div>
      </div>

      <div className="gl" style={{ animationDelay: "120ms" }}>
        <GroceryListView
          initialItems={items}
          initialFrom={weekStart}
          initialTo={weekEnd}
        />
      </div>
    </div>
  );
}
