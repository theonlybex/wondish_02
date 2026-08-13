import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import { loadRestaurantMenu } from "@/lib/restaurants-page-server";
import { groupDishesBySection } from "@/lib/restaurant-menu-view";
import MenuDishCard from "@/components/restaurants/MenuDishCard";
import SafetyNote from "@/components/restaurants/SafetyNote";
import Badge from "@/components/ui/Badge";

// Phase 2 web (docs/restaurants/phase-2.md) — the restaurant menu with
// pass/fail highlighting. This is the pilot's first-touch consumer surface:
// the page a QR scanner lands on (Phase 3), so it must render signed out.
export const dynamic = "force-dynamic";

// generateMetadata and the page body both need the menu; cache makes that one
// load per request instead of two.
const getMenu = cache(async (slug: string, clerkId: string | null) =>
  loadRestaurantMenu({ slug, clerkId })
);

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const { userId } = await auth();
  const data = await getMenu(params.slug, userId ?? null);
  if (!data) return { title: "Restaurant" };
  return {
    title: data.restaurant.name,
    description:
      data.restaurant.description ??
      `See what you can eat at ${data.restaurant.name} in ${data.restaurant.neighborhood}.`,
  };
}

function formatVerified(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function RestaurantMenuPage({ params }: { params: { slug: string } }) {
  const { userId } = await auth();
  const data = await getMenu(params.slug, userId ?? null);
  if (!data) notFound();

  const { restaurant, dishes, hasProfile, lastVerifiedAt } = data;
  const sections = groupDishesBySection(dishes);
  const fitCount = dishes.filter((d) => d.verdict?.passed).length;

  return (
    <div className="min-h-screen bg-[#F8F7FA] pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <Link
          href="/restaurants"
          className="inline-flex items-center gap-1.5 -ml-2 px-2 py-2.5 rounded-lg text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span aria-hidden="true">←</span> All restaurants
        </Link>

        <header className="mt-3 mb-6">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold text-[#1E1A1A] leading-tight">
              {restaurant.name}
            </h1>
            {restaurant.cuisine && <Badge variant="info">{restaurant.cuisine}</Badge>}
          </div>
          <p className="text-sm mt-2" style={{ color: "#848181" }}>
            {restaurant.neighborhood}
          </p>
          {restaurant.description && (
            <p className="text-base mt-3 leading-relaxed" style={{ color: "#5C5757" }}>
              {restaurant.description}
            </p>
          )}
          {hasProfile && dishes.length > 0 && (
            <p className="text-sm mt-4 font-semibold text-[#1E1A1A] tabular-nums">
              {fitCount} of {dishes.length} dishes fit your plan
            </p>
          )}
        </header>

        {!hasProfile && (
          <div className="mb-5 rounded-2xl border border-[#EAE4CA] bg-white p-5">
            <p className="text-sm font-semibold text-[#1E1A1A] mb-1">
              {userId ? "Finish your profile to see what fits" : "Sign in to see what fits you"}
            </p>
            <p className="text-sm mb-3" style={{ color: "#848181" }}>
              You&rsquo;re seeing the full menu. Wondish can check every dish against your
              allergies, conditions and goals.
            </p>
            <Link
              href={userId ? "/profile?onboarding=true" : "/login"}
              className="inline-flex items-center min-h-[44px] px-5 rounded-xl bg-primary text-white text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {userId ? "Complete my profile" : "Sign in"}
            </Link>
          </div>
        )}

        {/* Required on every verdict surface — and shown even signed out, since
            the menu itself is third-party data we did not author. */}
        <div className="mb-6">
          <SafetyNote />
        </div>

        {lastVerifiedAt && (
          <p className="text-xs mb-6" style={{ color: "#ABA6A6" }}>
            Menu last verified by the restaurant on {formatVerified(lastVerifiedAt)}.
          </p>
        )}

        {dishes.length === 0 ? (
          <div className="rounded-2xl border border-[#EAE4CA] bg-white p-8 text-center">
            <p className="font-semibold text-[#1E1A1A] mb-1">No menu published yet</p>
            <p className="text-sm" style={{ color: "#848181" }}>
              {restaurant.name} hasn&rsquo;t published its dishes to Wondish yet.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sections.map(({ section, dishes: sectionDishes }) => (
              <section key={section}>
                <h2 className="text-[10px] tracking-[0.24em] uppercase font-bold mb-3" style={{ color: "#ABA6A6" }}>
                  {section}
                </h2>
                <div className="space-y-3">
                  {sectionDishes.map((dish) => (
                    <MenuDishCard key={dish.id} dish={dish} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
