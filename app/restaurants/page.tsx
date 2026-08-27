import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { loadRestaurantDirectory } from "@/lib/restaurants-page-server";
import RestaurantTile from "@/components/restaurants/RestaurantTile";
import CuisineFilter from "@/components/restaurants/CuisineFilter";

// Phase 2 web (docs/restaurants/phase-2.md) — the consumer directory. Lives in
// (main), not (dashboard): a QR scanner who has never signed in must be able
// to reach it (Phase 3 lands here), so it renders for signed-out visitors too.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Restaurants",
  description: "See exactly what you can eat at restaurants near you.",
};

export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: { cuisine?: string };
}) {
  const { userId } = await auth();
  const cuisine = searchParams.cuisine?.trim() || null;
  const { items, cuisines, hasProfile } = await loadRestaurantDirectory({
    clerkId: userId ?? null,
    cuisine,
  });

  return (
    // The page shell (background, top padding) belongs to layout.tsx, which
    // differs between the public and dashboard chromes.
    <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E1A1A] mb-3">Restaurants</h1>
          <p className="text-[#848181] text-lg max-w-xl">
            {hasProfile
              ? "Every menu checked against your plan — see what fits before you sit down."
              : "See what fits your diet before you sit down."}
          </p>
        </header>

        {!hasProfile && (
          <div className="mb-8 rounded-2xl border border-[#EAE4CA] bg-white p-5">
            <p className="text-sm text-[#1E1A1A] font-semibold mb-1">
              {userId ? "Finish your profile to see what fits" : "Sign in to see what fits you"}
            </p>
            <p className="text-sm mb-3" style={{ color: "#848181" }}>
              {userId
                ? "We match every dish against your allergies, conditions and goals — that needs your profile."
                : "Wondish checks each dish against your allergies, conditions and goals."}
            </p>
            <Link
              href={userId ? "/profile?onboarding=true" : "/login"}
              className="inline-flex items-center min-h-[44px] px-5 rounded-xl bg-primary text-white text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {userId ? "Complete my profile" : "Sign in"}
            </Link>
          </div>
        )}

        <div className="mb-6">
          <CuisineFilter cuisines={cuisines} active={cuisine} />
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-[#EAE4CA] bg-white p-8 text-center">
            <p className="font-semibold text-[#1E1A1A] mb-1">
              {cuisine ? `No ${cuisine} restaurants yet` : "No restaurants yet"}
            </p>
            <p className="text-sm" style={{ color: "#848181" }}>
              {cuisine ? (
                <>
                  Try{" "}
                  <Link href="/restaurants" className="text-primary font-semibold hover:underline">
                    all cuisines
                  </Link>
                  .
                </>
              ) : (
                "We're adding restaurants in your area — check back soon."
              )}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => (
              <RestaurantTile key={r.id} restaurant={r} />
            ))}
          </div>
        )}
    </div>
  );
}
