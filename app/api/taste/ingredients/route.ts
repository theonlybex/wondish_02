import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import { computeIngredientDishCounts, STAPLE_NAMES } from "@/lib/to-buy";
import { getIngredientEmoji } from "@/lib/ingredient-emoji";

const DECK_SIZE = 20;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const edit = new URL(req.url).searchParams.get("edit") === "1";

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ ingredients: [] });

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;

  // Eatable public recipes only, so a banned ingredient never enters the deck.
  const recipes = await prisma.recipe.findMany({
    where: { isPublic: true, ingredients: { some: {} } },
    select: { ingredients: { select: { ingredientId: true, ingredient: { select: { name: true } } } } },
  });
  const eatable = (hasBans
    ? recipes.filter((r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers).passed)
    : recipes
  ).map((r) => ({ ingredients: r.ingredients.map((ri) => ({ ingredientId: ri.ingredientId, name: ri.ingredient.name })) }));

  const counts = computeIngredientDishCounts(eatable);

  // Current ratings (for edit-mode badges and onboarding exclusion).
  const prefs = await prisma.patientIngredientPreference.findMany({
    where: { patientId: patient.id },
    select: { ingredientId: true, liked: true },
  });
  const likedById = new Map(prefs.map((p) => [p.ingredientId, p.liked]));

  const ranked = Array.from(counts.entries())
    .filter(([, v]) => !STAPLE_NAMES.has(v.name.trim().toLowerCase()))
    .filter(([id]) => (edit ? true : !likedById.has(id))) // onboarding: unrated only
    .sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name))
    .slice(0, DECK_SIZE)
    .map(([id, v]) => ({
      id,
      name: v.name,
      emoji: getIngredientEmoji(v.name),
      dishCount: v.count,
      liked: likedById.has(id) ? (likedById.get(id) as boolean) : null,
    }));

  return NextResponse.json({ ingredients: ranked });
}
