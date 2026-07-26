import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { PATIENT_DIET_INCLUDE, derivePatientBans, buildDietMatchers, type DietMatchers } from "@/lib/diet-match";
import {
  parseListQuery,
  buildRestaurantListWhere,
  RESTAURANT_LIST_ORDER_BY,
  paginateListRows,
  buildCuisineFacet,
  computeMatchSummary,
  serializeRestaurantListItem,
} from "@/lib/restaurants";

// ─── GET /api/restaurants — consumer directory (list) ────────────────────────
// Published-only; server-computed matchSummary per restaurant (null ⇔ no
// Patient row for the caller); cuisines facet is server-wide (never
// page-derived). See lib/restaurants.ts for all pure logic — this route is
// thin: auth → rate-limit → parse → derive matchers once → fetch → serialize.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user burst: 120 reads / 60s (same posture as GET /api/meal-log).
  const { success } = await rateLimit("restaurants-list", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const parsed = parseListQuery({
    cuisine: searchParams.get("cuisine"),
    neighborhood: searchParams.get("neighborhood"),
    cursor: searchParams.get("cursor"),
    limit: searchParams.get("limit"),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const query = parsed.value;

  // "No profile" ⇔ no Patient row for this account — matchers derived ONCE
  // per request and threaded through every serializer below. A Patient with
  // zero ban sources still yields non-null (empty) matchers, so its
  // restaurants get real (all-pass) matchSummary counts, not null.
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  const matchers: DietMatchers | null = patient ? buildDietMatchers(derivePatientBans(patient)) : null;

  const where = buildRestaurantListWhere({ cuisine: query.cuisine, neighborhood: query.neighborhood }, query.cursor);
  const rows = await prisma.restaurant.findMany({
    where,
    orderBy: RESTAURANT_LIST_ORDER_BY,
    take: query.limit + 1, // one extra row to detect the last page deterministically
    select: {
      id: true,
      slug: true,
      name: true,
      neighborhood: true,
      ethnic: { select: { name: true } },
    },
  });
  const { pageRows, nextCursor } = paginateListRows(rows, query.limit);

  // matchSummary is computed over each restaurant's served (PUBLISHED +
  // available) dishes, page-scoped — only fetched when a profile exists.
  const dishesByRestaurant = new Map<string, string[][]>();
  if (matchers && pageRows.length > 0) {
    const dishRows = await prisma.restaurantDish.findMany({
      where: { restaurantId: { in: pageRows.map((r) => r.id) }, status: "PUBLISHED", available: true },
      select: { restaurantId: true, ingredients: { select: { name: true } } },
    });
    for (const dish of dishRows) {
      const list = dishesByRestaurant.get(dish.restaurantId) ?? [];
      list.push(dish.ingredients.map((i) => i.name));
      dishesByRestaurant.set(dish.restaurantId, list);
    }
  }

  const restaurants = pageRows.map((row) =>
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
  );

  // Server facet list: distinct sorted cuisine names across ALL published
  // restaurants — an independent, unfiltered/unpaginated query. groupBy makes
  // the DB do the deduplication (rows returned = distinct ethnicIds, not all
  // published restaurants); buildCuisineFacet keeps the exact null-drop +
  // dedupe-by-name + sort semantics the wire contract pins (two Ethnic rows
  // sharing a name still collapse to one facet entry).
  const facetGroups = await prisma.restaurant.groupBy({
    by: ["ethnicId"],
    where: { status: "PUBLISHED" },
  });
  const facetEthnicIds = facetGroups
    .map((g) => g.ethnicId)
    .filter((id): id is string => id !== null);
  const facetEthnics = facetEthnicIds.length
    ? await prisma.ethnic.findMany({
        where: { id: { in: facetEthnicIds } },
        select: { name: true },
      })
    : [];
  const cuisines = buildCuisineFacet(facetEthnics.map((e) => e.name));

  return NextResponse.json({ restaurants, cuisines, nextCursor });
}
