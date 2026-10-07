import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import { resolveCatalogIngredientIds } from "@/lib/ingredient-catalog-db";
import { CUISINE_STAPLES } from "@/lib/cuisine-ingredients";
import { PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { ingredientBanCheck } from "@/lib/ingredient-bans";

// GET /api/pantry/catalog — the full ingredient catalog grouped by category,
// with each item resolved to a real Ingredient id and a `favorite` flag (from
// the taste picks). Drives the category sections on the What-I-have and
// What-to-buy screens; the client derives "owned" from the pantry.
//
// Items the profile bans carry `bannedBy` (the rule labels). What-to-buy
// hides them — it offered a vegetarian sirloin and bacon because this route
// never checked the profile (QA 2026-10-07) — and lists them, with `bans`,
// behind its "Banned ingredients" button. What-I-have still shows them: a
// household can own what one member does not eat.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const stapleNames = Array.from(new Set(Object.values(CUISINE_STAPLES).flat().map((n) => n.trim())));
  const [idByName, favs, stapleRows] = await Promise.all([
    resolveCatalogIngredientIds(),
    prisma.patientIngredientPreference.findMany({
      where: { patientId: patient.id, liked: true },
      select: { ingredientId: true },
    }),
    prisma.ingredient.findMany({
      where: { name: { in: stapleNames, mode: "insensitive" } },
      select: { name: true, allergenGroups: true },
    }),
  ]);
  const favoriteIds = new Set(favs.map((f) => f.ingredientId));
  const groupRows = await prisma.ingredient.findMany({
    where: { id: { in: Array.from(idByName.values()) } },
    select: { id: true, allergenGroups: true },
  });
  const groupsById = new Map(groupRows.map((r) => [r.id, r.allergenGroups]));
  const groupsByStaple = new Map(stapleRows.map((r) => [r.name.trim().toLowerCase(), r.allergenGroups]));

  const check = ingredientBanCheck(patient);

  const resolved = INGREDIENT_CATALOG.map((c) => ({
    key: c.key,
    title: c.title,
    items: c.items.filter((name) => idByName.has(name)).map((name) => ({ name, id: idByName.get(name)! })),
  }));
  const flat = resolved.flatMap((c) => c.items);
  const itemReasons = check.reasonsForMany(flat.map((it) => ({ name: it.name, allergenGroups: groupsById.get(it.id) ?? [] })));
  const reasonsById = new Map(flat.map((it, i) => [it.id, itemReasons[i]]));

  const categories = resolved.map((c) => ({
    key: c.key,
    title: c.title,
    items: c.items.map(({ id, name }) => {
      const bannedBy = reasonsById.get(id) ?? [];
      return { id, name, favorite: favoriteIds.has(id), ...(bannedBy.length > 0 ? { bannedBy } : {}) };
    }),
  }));

  // Cuisine staples are generic words ("chicken", "fish sauce"); keyed lowercased.
  const stapleReasons = check.reasonsForMany(stapleNames.map((name) => ({ name, allergenGroups: groupsByStaple.get(name.toLowerCase()) ?? [] })));
  const cuisineStaples: Record<string, string[]> = {};
  stapleNames.forEach((name, i) => {
    if (stapleReasons[i].length > 0) cuisineStaples[name.toLowerCase()] = stapleReasons[i];
  });

  return NextResponse.json({ categories, bans: { rules: check.rules, cuisineStaples } });
}
