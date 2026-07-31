import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PATIENT_DIET_INCLUDE, derivePatientBans, buildDietMatchers } from "@/lib/diet-match";
import { computeVerdict } from "@/lib/restaurants";
import { parseRestaurantExchangeInput, toExchangeDTO } from "@/lib/plan-exchanges";

// Creates a PENDING RestaurantPlanExchange (spec 2026-07-30-plan-exchanges-
// design.md). The slot to displace is chosen later in the Meal Plan screen —
// no meal-type field here. Macros are a server-priced whole-dish snapshot;
// parseRestaurantExchangeInput rejects any client-sent macro keys.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = parseRestaurantExchangeInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Serving parity with app/api/restaurants/[slug]/route.ts — the dish and its
  // restaurant must both be PUBLISHED (and the dish available) to be accepted.
  const dish = await prisma.restaurantDish.findFirst({
    where: { id: parsed.value.restaurantDishId, status: "PUBLISHED", available: true },
    include: {
      restaurant: { select: { name: true, status: true } },
      ingredients: { select: { name: true } },
    },
  });
  if (!dish || dish.restaurant.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Dish not found" }, { status: 404 });
  }

  // Informational verdict — the user's choice wins (Restaurants-surface
  // parity: any verdict may be added; the UI shows the conflicts).
  const matchers = buildDietMatchers(derivePatientBans(patient));
  const verdict = computeVerdict(dish.ingredients.map((i) => i.name), matchers);

  const incomplete =
    dish.calories == null || dish.protein == null || dish.carbs == null ||
    dish.fat == null || dish.fiber == null;

  const row = await prisma.restaurantPlanExchange.create({
    data: {
      patientId: patient.id,
      localDate: parsed.value.localDate,
      planVersion: patient.activePlanVersion,
      servings: parsed.value.servings,
      restaurantDishId: dish.id,
      name: dish.name,
      restaurantName: dish.restaurant.name,
      calories: dish.calories,
      protein: dish.protein,
      carbs: dish.carbs,
      fat: dish.fat,
      fiber: dish.fiber,
      incomplete,
    },
  });

  return NextResponse.json(
    { exchange: toExchangeDTO(row, "RESTAURANT", new Set()), verdict },
    { status: 201 }
  );
}
