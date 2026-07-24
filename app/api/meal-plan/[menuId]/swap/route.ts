import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveMacroProfile, getMacroPercentages } from "@/lib/caloric-engine";
import { macroDeviation } from "@/lib/macros";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";

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

  // Meal type must match
  if (menu.mealTypeId && newRecipe.mealTypeId !== menu.mealTypeId) {
    return NextResponse.json({ error: "Recipe not suitable for this meal slot" }, { status: 400 });
  }

  // Banned ingredient check — word-boundary allergy blocking + exact-name
  // avoid/condition/preference/motivation matching, via the shared engine.
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed } = evaluateDishAgainstProfile(
    newRecipe.ingredients.map((ri) => ri.ingredient.name),
    matchers
  );
  if (!passed) {
    return NextResponse.json({ error: "Recipe contains ingredients you cannot eat" }, { status: 400 });
  }

  // Macro alignment check — replacement must not deviate more than 50 percentage
  // points (summed across protein/carbs/fat) from the patient's macro profile.
  const conditionNames  = patient.healthConditions.map((hc) => hc.condition.name);
  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);
  const macroTarget     = getMacroPercentages(resolveMacroProfile(conditionNames, motivationNames));
  if (newRecipe.calories && newRecipe.calories > 0) {
    const deviation = macroDeviation(
      { calories: newRecipe.calories, protein: newRecipe.protein, carbs: newRecipe.carbs, fat: newRecipe.fat },
      macroTarget
    );
    if (deviation > 0.50) {
      return NextResponse.json(
        { error: "Recipe macros do not align with your nutrition profile" },
        { status: 400 }
      );
    }
  }

  // Family / subfamily constraints — check against all other menus on the same day
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

  // Family rule: same family cannot appear twice on the same day.
  // Exception: beverages not tagged fruity/veggie.
  if (newRecipe.family) {
    const dishTypeName = newRecipe.dishType?.name?.toLowerCase() ?? "";
    const familyLower  = newRecipe.family.toLowerCase();
    const exempt = dishTypeName === "beverage" &&
      !familyLower.includes("fruity") && !familyLower.includes("veggie");

    if (!exempt) {
      const familyConflict = sameDayMenus.some((m) => {
        if (m.recipe.family !== newRecipe.family) return false;
        const otherDishType = m.recipe.dishType?.name?.toLowerCase() ?? "";
        const otherFamily   = m.recipe.family?.toLowerCase() ?? "";
        const otherExempt   = otherDishType === "beverage" &&
          !otherFamily.includes("fruity") && !otherFamily.includes("veggie");
        return !otherExempt;
      });
      if (familyConflict) {
        return NextResponse.json(
          { error: "A dish from the same family is already in today's plan" },
          { status: 400 }
        );
      }
    }
  }

  // Sub-family rule: same sub-family cannot appear twice within the same meal type.
  if (newRecipe.subFamily) {
    const sameMealConflict = sameDayMenus.some(
      (m) => m.mealTypeId === menu.mealTypeId && m.recipe.subFamily === newRecipe.subFamily
    );
    if (sameMealConflict) {
      return NextResponse.json(
        { error: "A dish from the same sub-family is already in this meal" },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.menu.update({
    where: { id: params.menuId },
    data: { recipeId },
    include: { recipe: { include: { mealType: true, dishType: true } }, mealType: true },
  });

  return NextResponse.json(updated);
}
