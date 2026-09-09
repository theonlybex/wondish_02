import { CLARA_RECIPE_TAG } from "@/lib/cuisines";

// Library hygiene: the Clara-generated recipe cache grows every generation.
// This prunes "clara"-tagged public dishes that no plan or log references and
// that are older than a cutoff — keeping the catalog (and the dedupe checks)
// lean. Curated (non-clara) dishes are never touched. Dry-run by default.

export interface PrunePrisma {
  recipe: {
    findMany(args: unknown): Promise<{ id: string }[]>;
    delete(args: unknown): Promise<unknown>;
  };
}

export async function pruneClaraLibrary(
  prisma: PrunePrisma,
  opts: { olderThanDays?: number; apply?: boolean; now?: Date } = {}
): Promise<{ candidates: string[]; deleted: number }> {
  const olderThanDays = opts.olderThanDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanDays * 86400000);

  const rows = await prisma.recipe.findMany({
    where: {
      isPublic: true,
      tags: { has: CLARA_RECIPE_TAG },
      createdAt: { lt: cutoff },
      // Never prune a dish an active/any plan or a log still points at (Menu
      // FK is Restrict; MealLog is SetNull but we keep those too as "in use").
      menus: { none: {} },
      mealLogs: { none: {} },
    },
    select: { id: true },
  });
  const candidates = rows.map((r) => r.id);

  if (!opts.apply) return { candidates, deleted: 0 };

  let deleted = 0;
  for (const id of candidates) {
    try {
      await prisma.recipe.delete({ where: { id } });
      deleted += 1;
    } catch {
      // A dish that gained a reference between the scan and the delete (or any
      // FK we didn't anticipate) is simply skipped — the batch keeps going.
    }
  }
  return { candidates, deleted };
}
