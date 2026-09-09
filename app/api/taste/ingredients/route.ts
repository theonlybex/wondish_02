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
import { classifyIngredient, type CategoryKey } from "@/lib/ingredient-categories";

// Leveled ingredient discovery: proteins first, then the other food groups.
// Each level is one category's most dish-unlocking ingredients.
const LEVELS: { key: CategoryKey; title: string }[] = [
  { key: "protein", title: "Proteins" },
  { key: "carb", title: "Grains & Carbs" },
  { key: "vegetable", title: "Vegetables" },
  { key: "fruit", title: "Fruits" },
  { key: "dairy", title: "Dairy" },
  { key: "fat", title: "Fats & Oils" },
];
const PER_LEVEL = 8;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const edit = new URL(req.url).searchParams.get("edit") === "1";

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ levels: [] });

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;

  // Eatable public recipes only, so a banned ingredient never enters a deck.
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

  // Bucket every ingredient into its category, then build a level per category
  // in the fixed order — most dish-unlocking first, capped per level.
  const byCategory = new Map<CategoryKey, { id: string; name: string; count: number }[]>();
  for (const [id, { name, count }] of counts) {
    if (STAPLE_NAMES.has(name.trim().toLowerCase())) continue;
    if (!edit && likedById.has(id)) continue; // onboarding: unrated only
    const cat = classifyIngredient(name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ id, name, count });
  }

  const levels = LEVELS.map(({ key, title }) => {
    const items = (byCategory.get(key) ?? [])
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, PER_LEVEL)
      .map((i) => ({
        id: i.id,
        name: i.name,
        emoji: getIngredientEmoji(i.name),
        dishCount: i.count,
        liked: likedById.has(i.id) ? (likedById.get(i.id) as boolean) : null,
      }));
    return { key, title, ingredients: items };
  }).filter((l) => l.ingredients.length > 0); // drop empty levels

  return NextResponse.json({ levels });
}
