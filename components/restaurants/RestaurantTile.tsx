// Phase 2 — one restaurant in the consumer directory.
//
// The match summary is the reason to tap: "6 of 14 dishes fit you" is the
// promise the pilot sells. It is null for a diner with no profile (and when a
// restaurant has no published menu — a "0 of 0 fit" bar would be a lie), in
// which case the tile stays neutral rather than implying a result.
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import type { RestaurantListItemDTO } from "@/lib/restaurants";

export default function RestaurantTile({ restaurant }: { restaurant: RestaurantListItemDTO }) {
  const summary = restaurant.matchSummary;
  const noneFit = summary != null && summary.passed === 0;

  return (
    <Link
      href={`/restaurants/${restaurant.slug}`}
      className="block rounded-2xl border border-[#EAE4CA] bg-white p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-[#1E1A1A] leading-snug">{restaurant.name}</h2>
          <p className="text-xs mt-1" style={{ color: "#848181" }}>
            {restaurant.neighborhood}
          </p>
        </div>
        {restaurant.cuisine && <Badge variant="info">{restaurant.cuisine}</Badge>}
      </div>

      {summary != null && (
        <div className="mt-3.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold tabular-nums text-[#1E1A1A]">
              {summary.passed} of {summary.total} dishes fit you
            </span>
          </div>
          {/* Width alone would be colour-free but shape-only; the count above
              carries the same fact in words for anyone who can't see the bar. */}
          <div
            className="h-1.5 w-full rounded-full bg-[#EDEAE0] overflow-hidden"
            role="presentation"
          >
            <div
              className={`h-full rounded-full ${noneFit ? "bg-error/60" : "bg-success"}`}
              style={{ width: `${Math.round((summary.passed / summary.total) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}
