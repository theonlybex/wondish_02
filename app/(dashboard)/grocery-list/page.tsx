import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import GroceryListView from "@/components/grocery/GroceryListView";

export const metadata = { title: "Grocery List" };

export default async function GroceryListPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!session.user.onboardingComplete) redirect("/profile?onboarding=true");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: session.user.id },
  });

  const menus = patient
    ? await prisma.menu.findMany({
        where: {
          patientId: patient.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        include: {
          recipe: {
            include: { ingredients: { include: { ingredient: true } } },
          },
        },
      })
    : [];

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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Grocery List</h1>
        <p className="text-[#8A8D93] text-sm mt-1">
          Ingredients aggregated from your meal plan
        </p>
      </div>

      <GroceryListView
        initialItems={items}
        initialFrom={weekStart}
        initialTo={weekEnd}
      />
    </div>
  );
}
