import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { validateSwapCandidate } from "@/lib/meal-plan";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { recipeId } = (body ?? {}) as { recipeId?: unknown };
  if (typeof recipeId !== "string" || recipeId.length === 0) {
    return NextResponse.json({ error: "recipeId is required" }, { status: 400 });
  }

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id, planVersion: patient.activePlanVersion },
  });
  if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 });

  // isPublic parity with every serving surface (audit Task 18): a private
  // recipe id could previously be swapped in and read back in full.
  const newRecipe = await prisma.recipe.findFirst({
    where: { id: recipeId, isPublic: true },
    include: {
      dishType:    true,
      ingredients: { include: { ingredient: true } },
    },
  });
  if (!newRecipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  // Shared swap gate (S3 extraction — lib/meal-plan.ts validateSwapCandidate):
  // meal-type match, diet bans, macro alignment, same-day family (beverage
  // exemption) and same-meal sub-family rules, exact route-era messages.
  const dayStart = new Date(menu.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(menu.date);
  dayEnd.setHours(23, 59, 59, 999);

  const sameDayMenus = await prisma.menu.findMany({
    where: {
      patientId:   patient.id,
      planVersion: patient.activePlanVersion,
      id:          { not: params.menuId },
      date:        { gte: dayStart, lte: dayEnd },
    },
    include: {
      recipe: {
        select: {
          family:    true,
          subFamily: true,
          dishType:  { select: { name: true } },
        },
      },
    },
  });

  const verdict = validateSwapCandidate(patient, menu, newRecipe, sameDayMenus);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.message }, { status: 400 });
  }

  const updated = await prisma.menu.update({
    where: { id: params.menuId },
    data: { recipeId },
    include: { recipe: { include: { mealType: true, dishType: true } }, mealType: true },
  });

  return NextResponse.json(updated);
}
