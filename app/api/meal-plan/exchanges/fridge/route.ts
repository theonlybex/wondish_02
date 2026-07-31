import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseFridgeExchangeInput, toExchangeDTO } from "@/lib/plan-exchanges";

// Creates a PENDING FridgePlanExchange (spec 2026-07-30-plan-exchanges-
// design.md). The generated recipe exists nowhere server-side, so the row
// stores a full client-supplied snapshot — validated by the same rules the
// fridge generator's own output obeys (existing FRIDGE MealLog precedent).
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = parseFridgeExchangeInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, activePlanVersion: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { recipe } = parsed.value;
  const row = await prisma.fridgePlanExchange.create({
    data: {
      patientId: patient.id,
      localDate: parsed.value.localDate,
      planVersion: patient.activePlanVersion,
      servings: parsed.value.servings,
      fridgeRecipeId: parsed.value.fridgeRecipeId,
      name: recipe.name,
      emoji: recipe.emoji || null,
      mealType: recipe.mealType,
      usesIngredients: recipe.usesIngredients,
      steps: recipe.steps,
      calories: recipe.perServing.calories,
      protein: recipe.perServing.protein,
      carbs: recipe.perServing.carbs,
      fat: recipe.perServing.fat,
      fiber: recipe.perServing.fiber,
    },
  });

  return NextResponse.json({ exchange: toExchangeDTO(row, "FRIDGE", new Set()) }, { status: 201 });
}
