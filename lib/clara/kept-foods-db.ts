import { prisma } from "@/lib/db";
import { resolveCatalogIngredientIds } from "@/lib/ingredient-catalog-db";
import { hasAnyBan, type DietMatchers } from "@/lib/diet-match";
import { NO_KEPT_FOODS, splitKeptFoods, visibleRows, type CatalogRow, type KeptFoods } from "./kept-foods";

export { visibleRows };
export type { CatalogRow };

/** One person's marks, as ingredient ids. Always read fresh. */
export interface KeptMarks {
  atHomeIds: ReadonlySet<string>;
  likedIds: ReadonlySet<string>;
}

/** DB: the person's marks. Needs only the patient id, so it can start before anything else is loaded. */
export async function loadKeptMarks(patientId: string): Promise<KeptMarks> {
  const [pantry, liked] = await Promise.all([
    prisma.patientPantryItem.findMany({ where: { patientId }, select: { ingredientId: true } }),
    prisma.patientIngredientPreference.findMany({ where: { patientId, liked: true }, select: { ingredientId: true } }),
  ]);
  return { atHomeIds: new Set(pantry.map((p) => p.ingredientId)), likedIds: new Set(liked.map((p) => p.ingredientId)) };
}

// The catalog's name -> id map changes only when the catalog does: cached like
// the other catalog reads (10 minutes). The marks themselves are never cached.
const CATALOG_IDS_MS = 10 * 60_000;
let catalogIdsAt = 0;
let catalogIdsValue: Promise<Map<string, string>> | null = null;
function catalogIds(): Promise<Map<string, string>> {
  if (!catalogIdsValue || Date.now() - catalogIdsAt > CATALOG_IDS_MS) {
    catalogIdsAt = Date.now();
    const p = resolveCatalogIngredientIds();
    catalogIdsValue = p;
    p.catch(() => {
      if (catalogIdsValue === p) catalogIdsValue = null;
    });
  }
  return catalogIdsValue;
}

/** DB: catalog x marks, minus what `matchers` bans. `onlyIds` limits the allergen-group query to those ids. */
async function rowsFor(marks: KeptMarks, matchers: DietMatchers, onlyIds?: ReadonlySet<string>): Promise<CatalogRow[]> {
  const idByName = await catalogIds();
  const ids = Array.from(idByName.values()).filter((id) => !onlyIds || onlyIds.has(id));
  // Component tags too: a name-only check lets allergen-tagged items through.
  const groupRows = hasAnyBan(matchers) && ids.length > 0
    ? await prisma.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, allergenGroups: true } })
    : [];
  return visibleRows({
    idByName,
    groupsById: new Map(groupRows.map((r) => [r.id, r.allergenGroups])),
    matchers,
    atHomeIds: marks.atHomeIds,
    likedIds: marks.likedIds,
  });
}

/** DB: the catalog x marks rows for one patient (the app's ingredients screen). `matchers` decides what is banned. */
export async function loadCatalogRows(patientId: string, matchers: DietMatchers): Promise<CatalogRow[]> {
  return rowsFor(await loadKeptMarks(patientId), matchers);
}

/**
 * What the dish skill needs, from marks already read. Nothing marked: NO_KEPT_FOODS
 * with no further query. Otherwise only the marked foods' allergen groups are read.
 */
export async function keptFoodsFrom(marks: KeptMarks, matchers: DietMatchers): Promise<KeptFoods> {
  if (marks.atHomeIds.size === 0 && marks.likedIds.size === 0) return NO_KEPT_FOODS;
  const marked = new Set([...marks.atHomeIds, ...marks.likedIds]);
  return splitKeptFoods((await rowsFor(marks, matchers, marked)).filter((r) => r.atHome || r.favorite));
}

/** DB: what the dish skill needs, in one call. */
export async function loadKeptFoods(patientId: string, matchers: DietMatchers): Promise<KeptFoods> {
  return keptFoodsFrom(await loadKeptMarks(patientId), matchers);
}
