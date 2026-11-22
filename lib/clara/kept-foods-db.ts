import { prisma } from "@/lib/db";
import { resolveCatalogIngredientIds } from "@/lib/ingredient-catalog-db";
import { hasAnyBan, type DietMatchers } from "@/lib/diet-match";
import { splitKeptFoods, visibleRows, type CatalogRow, type KeptFoods } from "./kept-foods";

export { visibleRows };
export type { CatalogRow };

/** DB: the catalog x marks rows for one patient. `matchers` decides what is banned. */
export async function loadCatalogRows(patientId: string, matchers: DietMatchers): Promise<CatalogRow[]> {
  const [idByName, pantry, liked] = await Promise.all([
    resolveCatalogIngredientIds(),
    prisma.patientPantryItem.findMany({ where: { patientId }, select: { ingredientId: true } }),
    prisma.patientIngredientPreference.findMany({ where: { patientId, liked: true }, select: { ingredientId: true } }),
  ]);
  // Component tags too: a name-only check lets allergen-tagged items through.
  const groupRows = hasAnyBan(matchers)
    ? await prisma.ingredient.findMany({ where: { id: { in: Array.from(idByName.values()) } }, select: { id: true, allergenGroups: true } })
    : [];
  return visibleRows({
    idByName,
    groupsById: new Map(groupRows.map((r) => [r.id, r.allergenGroups])),
    matchers,
    atHomeIds: new Set(pantry.map((p) => p.ingredientId)),
    likedIds: new Set(liked.map((p) => p.ingredientId)),
  });
}

/** DB: what the dish skill needs. */
export async function loadKeptFoods(patientId: string, matchers: DietMatchers): Promise<KeptFoods> {
  return splitKeptFoods(await loadCatalogRows(patientId, matchers));
}
