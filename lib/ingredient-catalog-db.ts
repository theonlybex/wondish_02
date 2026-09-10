import { prisma } from "@/lib/db";
import { catalogItemNames } from "@/lib/ingredient-catalog";

// Resolve every catalog item name to an Ingredient id in TWO queries (plus one
// createMany the first time a name is missing) instead of one round-trip per
// name — 151 sequential Neon queries made /api/taste/ingredients take ~35 s
// and /api/pantry/catalog ~15 s, long enough for Clerk's session token to
// expire mid-page (intermittent 401s). Case-insensitive on name; when two rows
// differ only by case the first returned wins, matching the old findFirst.
export async function resolveCatalogIngredientIds(names: string[] = catalogItemNames()): Promise<Map<string, string>> {
  const idByName = new Map<string, string>();
  const lower = (s: string) => s.trim().toLowerCase();

  const load = async () => {
    const rows = await prisma.ingredient.findMany({
      where: { name: { in: names, mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    const byLower = new Map<string, string>();
    for (const r of rows) if (!byLower.has(lower(r.name))) byLower.set(lower(r.name), r.id);
    for (const n of names) {
      const id = byLower.get(lower(n));
      if (id) idByName.set(n, id);
    }
  };

  await load();
  const missing = names.filter((n) => !idByName.has(n));
  if (missing.length > 0) {
    // skipDuplicates covers a concurrent request creating the same name.
    await prisma.ingredient.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
    await load();
  }
  return idByName;
}
