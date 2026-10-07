import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  hasAnyBan,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import { tasteLevels } from "@/lib/ingredient-catalog";
import { resolveCatalogIngredientIds } from "@/lib/ingredient-catalog-db";

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

  // Without the diner's own dislikes: this is where a "not for me" is seen and undone.
  const bans = derivePatientBans(patient, new Date(), { dislikes: false });
  const matchers = buildDietMatchers(bans);
  const hasBans = hasAnyBan(matchers);

  // Resolve every catalog item name → Ingredient id (batched find-or-create).
  const [idByName, prefs] = await Promise.all([
    resolveCatalogIngredientIds(),
    prisma.patientIngredientPreference.findMany({
      where: { patientId: patient.id },
      select: { ingredientId: true, liked: true },
    }),
  ]);
  const likedById = new Map(prefs.map((p) => [p.ingredientId, p.liked]));
  // Component tags too: a name-only check let BIG9-tagged items through.
  const groupRows = hasBans
    ? await prisma.ingredient.findMany({ where: { id: { in: Array.from(idByName.values()) } }, select: { id: true, allergenGroups: true } })
    : [];
  const groupsById = new Map(groupRows.map((r) => [r.id, r.allergenGroups]));
  const isBanned = (name: string) =>
    hasBans && !evaluateDishAgainstProfile([name], matchers, [groupsById.get(idByName.get(name) ?? "") ?? []]).passed;

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
