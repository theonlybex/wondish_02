import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import { tasteLevels, catalogItemNames } from "@/lib/ingredient-catalog";

// GET /api/taste/ingredients — the curated ingredient catalog as levels of
// grouped, selectable items (proteins first). Each item resolves to a real
// Ingredient id and carries the patient's current like state. Allergen/avoid
// items are dropped. (No longer derived from recipe rows.)
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ levels: [] });

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;
  const isBanned = (name: string) => hasBans && !evaluateDishAgainstProfile([name], matchers).passed;

  // Resolve every catalog item name → Ingredient id (find-or-create).
  const names = catalogItemNames();
  const idByName = new Map<string, string>();
  for (const name of names) {
    const existing = await prisma.ingredient.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) { idByName.set(name, existing.id); continue; }
    try {
      const created = await prisma.ingredient.create({ data: { name }, select: { id: true } });
      idByName.set(name, created.id);
    } catch {
      const winner = await prisma.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (winner) idByName.set(name, winner.id);
    }
  }

  const prefs = await prisma.patientIngredientPreference.findMany({
    where: { patientId: patient.id },
    select: { ingredientId: true, liked: true },
  });
  const likedById = new Map(prefs.map((p) => [p.ingredientId, p.liked]));

  const levels = tasteLevels()
    .map((level) => ({
      key: level.key,
      title: level.title,
      items: level.items
        .filter((name) => !isBanned(name) && idByName.has(name))
        .map((name) => {
          const id = idByName.get(name)!;
          return { id, name, liked: likedById.get(id) === true };
        }),
    }))
    .filter((l) => l.items.length > 0);

  return NextResponse.json({ levels });
}
