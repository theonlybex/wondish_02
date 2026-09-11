import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  ingredientGroupsOf,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import { rankToBuy } from "@/lib/to-buy";

// Smart stocking list: ingredients to buy to unlock the most dishes — favorites
// first, then by dish-count — filtered to what the user does not already own.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("pantry-to-buy", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;

  const [recipesRaw, pantry, prefs] = await Promise.all([
    prisma.recipe.findMany({
      where: { isPublic: true, ingredients: { some: {} } },
      select: { ingredients: { select: { ingredientId: true, ingredient: { select: { name: true, allergenGroups: true } } } } },
    }),
    prisma.patientPantryItem.findMany({ where: { patientId: patient.id }, select: { ingredientId: true } }),
    prisma.patientIngredientPreference.findMany({
      where: { patientId: patient.id, liked: true },
      select: { ingredientId: true },
    }),
  ]);

  const recipes = (hasBans
    ? recipesRaw.filter((r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers, ingredientGroupsOf(r.ingredients)).passed)
    : recipesRaw
  ).map((r) => ({ ingredients: r.ingredients.map((ri) => ({ ingredientId: ri.ingredientId, name: ri.ingredient.name })) }));

  const items = rankToBuy({
    recipes,
    pantry: new Set(pantry.map((p) => p.ingredientId)),
    liked: new Set(prefs.map((p) => p.ingredientId)),
    cap: 50,
  });

  return NextResponse.json({ items });
}
