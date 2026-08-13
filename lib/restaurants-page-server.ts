// Phase 2 web — data loading for the consumer restaurant pages.
//
// Server components read the database directly rather than calling
// /api/restaurants over HTTP: that endpoint is auth-gated (401 signed out),
// and the whole point of these pages is that a QR scanner who has never
// signed in still sees the menu (Phase 3 lands here). Every verdict and
// summary is produced by the SAME pure functions the API routes use
// (lib/restaurants.ts), so the two surfaces cannot drift.
//
// `matchers === null` is the "no profile" signal end to end: signed out, or
// signed in with no Patient row. It yields verdict: null / matchSummary: null,
// which the UI renders as "we don't know yet" — never as "this fits you".
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  PATIENT_DIET_INCLUDE,
  derivePatientBans,
  buildDietMatchers,
  type DietMatchers,
} from "@/lib/diet-match";
import {
  computeMatchSummary,
  serializeRestaurantListItem,
  serializeRestaurantDetail,
  serializeDish,
  type RestaurantListItemDTO,
  type RestaurantDetailDTO,
  type DishDTO,
} from "@/lib/restaurants";

/// React-cached: a page and its metadata both need the matchers, and the
/// directory calls this once for the whole render.
export const getDietMatchers = cache(async (clerkId: string | null): Promise<DietMatchers | null> => {
  if (!clerkId) return null;
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId } },
    include: PATIENT_DIET_INCLUDE,
  });
  return patient ? buildDietMatchers(derivePatientBans(patient)) : null;
});

export interface DirectoryResult {
  items: RestaurantListItemDTO[];
  /// Server-wide facet, never derived from the current page, so a filter
  /// chip never disappears just because this page has none of that cuisine.
  cuisines: string[];
  hasProfile: boolean;
}

export async function loadRestaurantDirectory(args: {
  clerkId: string | null;
  cuisine?: string | null;
}): Promise<DirectoryResult> {
  const matchers = await getDietMatchers(args.clerkId);

  const [rows, cuisineRows] = await Promise.all([
    prisma.restaurant.findMany({
      where: {
        status: "PUBLISHED",
        ...(args.cuisine ? { ethnic: { name: args.cuisine } } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        neighborhood: true,
        ethnic: { select: { name: true } },
      },
    }),
    // Facet over every published restaurant, not the filtered set.
    prisma.restaurant.findMany({
      where: { status: "PUBLISHED", ethnic: { isNot: null } },
      distinct: ["ethnicId"],
      select: { ethnic: { select: { name: true } } },
      orderBy: { ethnicId: "asc" },
    }),
  ]);

  // Only pay for the dish scan when there is a profile to match against.
  const dishesByRestaurant = new Map<string, string[][]>();
  if (matchers && rows.length > 0) {
    const dishRows = await prisma.restaurantDish.findMany({
      where: {
        restaurantId: { in: rows.map((r) => r.id) },
        status: "PUBLISHED",
        available: true,
        deletedAt: null,
      },
      select: { restaurantId: true, ingredients: { select: { name: true } } },
    });
    for (const dish of dishRows) {
      const list = dishesByRestaurant.get(dish.restaurantId) ?? [];
      list.push(dish.ingredients.map((i) => i.name));
      dishesByRestaurant.set(dish.restaurantId, list);
    }
  }

  return {
    items: rows.map((row) =>
      serializeRestaurantListItem(
        {
          id: row.id,
          slug: row.slug,
          name: row.name,
          neighborhood: row.neighborhood,
          cuisineName: row.ethnic?.name ?? null,
        },
        computeMatchSummary(dishesByRestaurant.get(row.id) ?? [], matchers)
      )
    ),
    cuisines: cuisineRows
      .map((r) => r.ethnic?.name)
      .filter((n): n is string => Boolean(n))
      .sort((a, b) => a.localeCompare(b)),
    hasProfile: matchers !== null,
  };
}

export interface MenuResult {
  restaurant: RestaurantDetailDTO;
  dishes: DishDTO[];
  hasProfile: boolean;
  /// Oldest verification across served dishes — drives the freshness note.
  /// null when any served dish has never been verified.
  lastVerifiedAt: Date | null;
}

export async function loadRestaurantMenu(args: {
  slug: string;
  clerkId: string | null;
}): Promise<MenuResult | null> {
  const restaurant = await prisma.restaurant.findFirst({
    where: { slug: args.slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      neighborhood: true,
      ethnic: { select: { name: true } },
    },
  });
  if (!restaurant) return null;

  const [matchers, dishRows] = await Promise.all([
    getDietMatchers(args.clerkId),
    prisma.restaurantDish.findMany({
      where: {
        restaurantId: restaurant.id,
        status: "PUBLISHED",
        available: true,
        deletedAt: null,
      },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      include: { ingredients: { select: { name: true } } },
    }),
  ]);

  // Oldest-wins, matching the portal's freshness rule: a single freshly
  // approved dish must not reset the whole menu's clock, and a dish that was
  // never verified means the menu as a whole is unverified.
  let lastVerifiedAt: Date | null = null;
  if (dishRows.length > 0 && dishRows.every((d) => d.lastVerifiedAt !== null)) {
    lastVerifiedAt = dishRows.reduce<Date>(
      (min, d) => (d.lastVerifiedAt! < min ? d.lastVerifiedAt! : min),
      dishRows[0].lastVerifiedAt!
    );
  }

  return {
    restaurant: serializeRestaurantDetail({
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      description: restaurant.description,
      neighborhood: restaurant.neighborhood,
      cuisineName: restaurant.ethnic?.name ?? null,
    }),
    dishes: dishRows.map((row) =>
      serializeDish(row, row.ingredients.map((i) => i.name), matchers)
    ),
    hasProfile: matchers !== null,
    lastVerifiedAt,
  };
}
