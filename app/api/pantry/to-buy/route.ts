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
import { aggregateNeeds, toBase, formatPurchase } from "@/lib/grocery-quantities";

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

  const ranked = rankToBuy({
    recipes,
    pantry: new Set(pantry.map((p) => p.ingredientId)),
    liked: new Set(prefs.map((p) => p.ingredientId)),
    cap: 50,
  });

  // Best-effort purchase amounts for this week's plan (Wondish 06). Never
  // fails the list: any error just leaves `needed` off.
  const needed = await weeklyNeeds(patient.id, patient.activePlanVersion, ranked.map((i) => i.ingredientId)).catch((e) => {
    console.warn("[to-buy] weekly amounts skipped:", e instanceof Error ? e.message : e);
    return new Map<string, { amount: string; approx: boolean }>();
  });
  const items = ranked.map((i) => {
    const n = needed.get(i.ingredientId);
    return n ? { ...i, needed: n } : i;
  });

  return NextResponse.json({ items });
}

// Sum the next 7 days of the active plan per ingredient (recipe rows are
// per-serving), convert to g / mL / count with the ingredient's conversion
// rows, and round UP to a practical purchase amount.
async function weeklyNeeds(
  patientId: string,
  planVersion: number,
  ingredientIds: string[]
): Promise<Map<string, { amount: string; approx: boolean }>> {
  const out = new Map<string, { amount: string; approx: boolean }>();
  if (ingredientIds.length === 0) return out;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: { patientId, planVersion, date: { gte: start, lte: end } },
    select: { recipe: { select: { ingredients: { select: { ingredientId: true, quantity: true, unit: true } } } } },
  });
  const wanted = new Set(ingredientIds);
  const rows = menus.flatMap((m) => m.recipe.ingredients).filter((ri) => wanted.has(ri.ingredientId));
  if (rows.length === 0) return out;

  const needs = aggregateNeeds(rows);
  const conversions = await prisma.ingredientUnitConversion.findMany({
    where: { ingredientId: { in: Array.from(needs.keys()) } },
    select: { ingredientId: true, unit: true, baseQuantity: true, baseUnit: true, confidence: true },
  });
  for (const n of toBase(needs, conversions)) {
    out.set(n.ingredientId, { amount: formatPurchase(n.base, n.baseUnit), approx: n.approx || n.unconverted.length > 0 });
  }
  return out;
}
