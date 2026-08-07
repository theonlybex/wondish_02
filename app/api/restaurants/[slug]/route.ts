import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { PATIENT_DIET_INCLUDE, derivePatientBans, buildDietMatchers, type DietMatchers } from "@/lib/diet-match";
import { serializeRestaurantDetail, serializeDish } from "@/lib/restaurants";

// ─── GET /api/restaurants/[slug] — consumer menu (detail) ────────────────────
// 404s unless the restaurant is PUBLISHED (exact error string, per contract);
// dishes served are PUBLISHED + available only. Server-computed verdict per
// dish (null ⇔ no Patient row for the caller). See lib/restaurants.ts for all
// pure logic — this route is thin: auth → rate-limit → fetch → derive
// matchers once → serialize.
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user burst: 120 reads / 60s (same posture as GET /api/meal-log).
  const { success } = await rateLimit("restaurants-detail", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const restaurant = await prisma.restaurant.findFirst({
    where: { slug: params.slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      neighborhood: true,
      ethnic: { select: { name: true } },
    },
  });
  if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  // "No profile" ⇔ no Patient row for this account — matchers derived ONCE
  // per request. A Patient with zero ban sources still yields non-null
  // (empty) matchers, so every dish gets a real (all-pass) verdict, not null.
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  const matchers: DietMatchers | null = patient ? buildDietMatchers(derivePatientBans(patient)) : null;

  const dishRows = await prisma.restaurantDish.findMany({
    where: { restaurantId: restaurant.id, status: "PUBLISHED", available: true, deletedAt: null },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { id: "asc" }], // deterministic
    include: { ingredients: { select: { name: true } } },
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
        // Whole-dish macros (additive 2026-08-04): the DTO declared these on
        // day one, but this call predates them — without the passthrough the
        // menu served calories: null for every dish that has real numbers.
        calories: row.calories,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        fiber: row.fiber,
      },
      row.ingredients.map((i) => i.name),
      matchers
    )
  );

  return NextResponse.json({
    restaurant: serializeRestaurantDetail({
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      description: restaurant.description,
      neighborhood: restaurant.neighborhood,
      cuisineName: restaurant.ethnic?.name ?? null,
    }),
    dishes,
  });
}
