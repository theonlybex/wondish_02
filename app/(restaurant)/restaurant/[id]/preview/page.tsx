import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import { serializeRestaurantDetail, serializeDish, type DishDTO } from "@/lib/restaurants";
import Badge from "@/components/ui/Badge";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Preview` : "Preview" };
}

// Phase 6a M4 — preview as a diner (design §5.6). Renders the exact DTOs the
// consumer endpoints serve (serializeRestaurantDetail + serializeDish) with
// matchers: null, so staff see what a diner without a profile sees: sections,
// prices, kcal, "Wondish pick" — and nothing that isn't live.
export default async function RestaurantPreviewPage({ params }: { params: { id: string } }) {
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id },
    include: { ethnic: { select: { name: true } } },
  });
  if (!restaurant) notFound();

  const dishRows = await prisma.restaurantDish.findMany({
    where: { restaurantId: restaurant.id, status: "PUBLISHED", available: true, deletedAt: null },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: { ingredients: { select: { name: true } } },
  });

  const detail = serializeRestaurantDetail({
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    description: restaurant.description,
    neighborhood: restaurant.neighborhood,
    cuisineName: restaurant.ethnic?.name ?? null,
  });

  const dishes = dishRows.map((row) =>
    serializeDish(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        currency: row.currency,
        section: row.section,
        sortOrder: row.sortOrder,
        isRecommended: row.isRecommended,
        calories: row.calories,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        fiber: row.fiber,
      },
      row.ingredients.map((i) => i.name),
      null // a diner with no profile — verdicts are null by contract
    )
  );

  const sections: [string, DishDTO[]][] = [];
  for (const dish of dishes) {
    const last = sections[sections.length - 1];
    if (last && last[0] === dish.section) last[1].push(dish);
    else sections.push([dish.section, [dish]]);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Preview</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          This is your menu exactly as a diner without a dietary profile sees it in the app.
          Drafts, dishes in review, and 86&rsquo;d dishes don&rsquo;t appear.
        </p>
      </div>

      {restaurant.status !== "PUBLISHED" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 text-sm text-amber-800">
          {restaurant.name} isn&rsquo;t listed on Wondish yet — diners can&rsquo;t see this page
          until your Wondish contact publishes the restaurant.
        </div>
      )}

      <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6 max-w-2xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-[#1E1A1A]">{detail.name}</h2>
          <p className="text-xs mt-1" style={{ color: "#848181" }}>
            {detail.neighborhood}
            {detail.cuisine ? ` · ${detail.cuisine}` : ""}
          </p>
          {detail.description && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: "#6E6868" }}>
              {detail.description}
            </p>
          )}
        </div>

        {sections.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: "#ABA6A6" }}>
            No live dishes yet — submit dishes for publishing and they&rsquo;ll appear here once
            approved.
          </p>
        ) : (
          sections.map(([section, rows]) => (
            <div key={section} className="mb-6 last:mb-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: "#848181" }}>
                {section}
              </p>
              <div className="divide-y divide-[#F5F1DD]">
                {rows.map((dish) => (
                  <div key={dish.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold text-sm text-[#1E1A1A]">
                        {dish.name}
                        {dish.isRecommended && (
                          <span className="ml-2 align-middle">
                            <Badge variant="primary">Wondish pick</Badge>
                          </span>
                        )}
                      </p>
                      {dish.price && (
                        <p className="text-sm font-semibold tabular-nums text-[#1E1A1A] shrink-0">${dish.price}</p>
                      )}
                    </div>
                    {dish.description && (
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#848181" }}>
                        {dish.description}
                      </p>
                    )}
                    <p className="text-xs mt-1" style={{ color: "#ABA6A6" }}>
                      {dish.calories != null ? `${Math.round(dish.calories)} kcal · ` : ""}
                      {dish.ingredients.join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <p className="text-[11px] mt-6 pt-4 border-t border-[#F5F1DD] leading-relaxed" style={{ color: "#ABA6A6" }}>
          Ingredient and nutrition details are provided by the restaurant. Diners with a dietary
          profile also see personal allergy and diet verdicts computed from your ingredient lists.
        </p>
      </div>
    </div>
  );
}
