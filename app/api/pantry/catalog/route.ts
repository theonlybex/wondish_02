import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import { resolveCatalogIngredientIds } from "@/lib/ingredient-catalog-db";

// GET /api/pantry/catalog — the full ingredient catalog grouped by category,
// with each item resolved to a real Ingredient id and a `favorite` flag (from
// the taste picks). Drives the category sections on the What-I-have and
// What-to-buy screens; the client derives "owned" from the pantry.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const [idByName, favs] = await Promise.all([
    resolveCatalogIngredientIds(),
    prisma.patientIngredientPreference.findMany({
      where: { patientId: patient.id, liked: true },
      select: { ingredientId: true },
    }),
  ]);
  const favoriteIds = new Set(favs.map((f) => f.ingredientId));

  const categories = INGREDIENT_CATALOG.map((c) => ({
    key: c.key,
    title: c.title,
    items: c.items
      .filter((name) => idByName.has(name))
      .map((name) => {
        const id = idByName.get(name)!;
        return { id, name, favorite: favoriteIds.has(id) };
      }),
  }));

  return NextResponse.json({ categories });
}
