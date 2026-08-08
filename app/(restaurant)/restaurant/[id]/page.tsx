import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import { needsVerifyNudge } from "@/lib/restaurant-activity";
import Badge from "@/components/ui/Badge";
import VerifyMenuBanner from "@/components/restaurant/VerifyMenuBanner";

// generateMetadata and the page body both need the restaurant; `cache` makes
// that one query per request instead of two. The database is a network hop
// away (~100ms from a dev laptop), so duplicate round trips are the dominant
// cost of a page render, not the queries themselves.
const getRestaurant = cache((id: string) =>
  prisma.restaurant.findUnique({ where: { id }, include: { ethnic: { select: { name: true } } } })
);

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await getRestaurant(params.id);
  return { title: restaurant ? `${restaurant.name} · Portal` : "Restaurant" };
}

// Phase 6a M2 — restaurant dashboard (design §5.1): publish state, nutrition
// coverage, review status, and the door into the menu manager. Server-gated
// by staff membership (SUPER bypasses).
export default async function RestaurantDashboardPage({ params }: { params: { id: string } }) {
  // Shares the layout's gate via React `cache` — same guarantee, one query.
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);

  // M3 — recent ops decisions (design §7): approvals confirm, rejections
  // carry the note staff need to act on.
  const decisionWindow = new Date();
  decisionWindow.setDate(decisionWindow.getDate() - 30);

  // Independent of each other — one round trip's worth of latency, not three.
  const [restaurant, dishes, decisions] = await Promise.all([
    getRestaurant(params.id),
    prisma.restaurantDish.findMany({
      where: { restaurantId: params.id, deletedAt: null },
      select: { status: true, available: true, calories: true, lastVerifiedAt: true },
    }),
    prisma.restaurantDishRevision.findMany({
      where: {
        restaurantId: params.id,
        status: { in: ["APPROVED", "REJECTED"] },
        reviewedAt: { gte: decisionWindow },
      },
      orderBy: { reviewedAt: "desc" },
      take: 5,
      include: { dish: { select: { name: true } } },
    }),
  ]);
  if (!restaurant) notFound();
  const published = dishes.filter((d) => d.status === "PUBLISHED").length;
  const inReview = dishes.filter((d) => d.status === "PENDING_REVIEW").length;
  const missingNutrition = dishes.filter((d) => d.calories == null).length;

  // Freshness (design §7): the OLDEST verification across live dishes drives
  // the quarterly nudge — newest-wins would let one freshly approved dish
  // reset the whole menu's clock while older ingredient lists go stale
  // (audit fix). A live dish never stamped counts as "never verified".
  const liveDishes = dishes.filter((d) => d.status === "PUBLISHED");
  const lastVerified = liveDishes.some((d) => d.lastVerifiedAt === null)
    ? null
    : liveDishes.reduce<Date | null>(
        (min, d) => (d.lastVerifiedAt && (!min || d.lastVerifiedAt < min) ? d.lastVerifiedAt : min),
        null
      );
  const showVerifyNudge = needsVerifyNudge(lastVerified, published, new Date());

  const cards = [
    { label: "Dishes live", value: `${published} / ${dishes.length}` },
    { label: "Awaiting review", value: String(inReview) },
    { label: "Missing nutrition", value: String(missingNutrition) },
    {
      label: "Menu verified",
      value: lastVerified
        ? lastVerified.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "—",
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#1E1A1A]">{restaurant.name}</h1>
            <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
              {restaurant.neighborhood}
              {restaurant.ethnic?.name ? ` · ${restaurant.ethnic.name}` : ""}
              {gate.ctx.membership
                ? ` · you are ${gate.ctx.membership.role === "OWNER" ? "an owner" : "a manager"}`
                : " · Wondish ops"}
            </p>
          </div>
          <Badge variant={restaurant.status === "PUBLISHED" ? "success" : "neutral"}>
            {restaurant.status === "PUBLISHED" ? "Listed on Wondish" : restaurant.status}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-[#EAE4CA] rounded-2xl p-4">
            <p className="text-2xl font-bold text-[#1E1A1A] tabular-nums">{c.value}</p>
            <p className="text-xs mt-1" style={{ color: "#848181" }}>{c.label}</p>
          </div>
        ))}
      </div>

      {decisions.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: "#848181" }}>
            Review decisions
          </p>
          <div className="space-y-2">
            {decisions.map((d) => {
              const approved = d.status === "APPROVED";
              const what = d.kind === "PUBLISH" ? "publish" : "menu changes";
              return (
                <div
                  key={d.id}
                  className={`rounded-2xl px-4 py-3 text-sm border ${
                    approved
                      ? "bg-success/5 border-success/20 text-[#1E1A1A]"
                      : "bg-error/5 border-error/20 text-[#1E1A1A]"
                  }`}
                >
                  <span className="font-semibold">{d.dish.name}</span>
                  {approved ? ` — ${what} approved` : ` — ${what} rejected`}
                  {d.reviewedAt && (
                    <span className="text-xs" style={{ color: "#848181" }}>
                      {" "}
                      · {d.reviewedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                  {!approved && d.reviewNote && (
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: "#848181" }}>
                      &ldquo;{d.reviewNote}&rdquo; — fix it in the menu editor and resubmit.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showVerifyNudge && (
        <VerifyMenuBanner
          restaurantId={restaurant.id}
          lastVerified={lastVerified ? lastVerified.toISOString() : null}
        />
      )}

      {missingNutrition > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 text-sm text-amber-800">
          {missingNutrition} {missingNutrition === 1 ? "dish is" : "dishes are"} missing calories —
          diners use them to fit your dishes into their day, so filling them in makes your menu
          easier to choose.
        </div>
      )}

      <Link
        href={`/restaurant/${restaurant.id}/menu`}
        className="inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold px-5 py-3 rounded-xl hover:bg-primary-dark transition-colors"
      >
        Manage menu →
      </Link>
    </div>
  );
}
