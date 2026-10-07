// Ingredient rows linked to the wrong Wondish 01 form (2026-10-07). Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/fix-ingredient-forms-2026-10-07.ts [--apply]
//
// The importer resolves aliased workbook rows to one catalog ingredient and
// the FIRST form processed claims it (lib/workbooks/ingredient-plan):
//
// - "Crushed tomatoes" (23 recipes) was claimed by the "Pizza sauce" form via
//   the "pizza sauce" alias, inheriting soybean oil → BIG9-SOY, plus corn
//   syrup/corn/salt components. Soy-allergic diners never saw crushed
//   tomatoes. The workbook's own "Canned crushed tomatoes" form (170501,
//   components: tomatoes) went to a separate row. Keep the link (moving it
//   would make a re-import attach 170501 to both rows) and take 170501's
//   components and groups instead.
// - "soy sauce" (53 recipes, and the catalog's "Soy sauce") is linked to the
//   "Low-sodium gluten-free soy sauce" form, so it carries no wheat tag —
//   but ordinary soy sauce is brewed with wheat, and that is what a diner
//   buys from the shopping list. Add BIG9-WHEAT (safe option, as with oats).
//
// Idempotent: a second run plans nothing. --apply writes a rollback JSON
// next to this script before touching rows. A re-import keeps both fixes:
// the importer only writes components/groups on attach/move, and both rows
// are already linked (idempotent "holder" path).
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { findWorkbook, readForms, readBig9 } from "../lib/workbooks/read";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

(async () => {
  const forms = new Map(readForms(findWorkbook("Wondish_01")).map((f) => [f.formId, f]));
  const big9 = readBig9(findWorkbook("Wondish_03"));
  const crushedForm = forms.get("170501");
  if (!crushedForm || !/crushed tomato/i.test(crushedForm.canonicalName)) throw new Error("Wondish 01 form 170501 is not 'Canned crushed tomatoes' — workbook changed, stop.");
  const crushedGroups = Array.from(new Set(big9.filter((b) => b.formId === "170501").map((b) => b.allergenGroup)));

  const rows = await prisma.ingredient.findMany({
    where: { name: { in: ["Crushed tomatoes", "soy sauce"], mode: "insensitive" } },
    select: { id: true, name: true, formId: true, canonicalId: true, groceryCategory: true, components: true, allergenGroups: true, _count: { select: { recipes: true } } },
  });

  type Change = { id: string; name: string; before: Record<string, unknown>; after: Record<string, unknown> };
  const changes: Change[] = [];
  for (const r of rows) {
    const before = { formId: r.formId, canonicalId: r.canonicalId, groceryCategory: r.groceryCategory, components: r.components, allergenGroups: r.allergenGroups };
    if (r.name.toLowerCase() === "crushed tomatoes") {
      const after = { ...before, groceryCategory: crushedForm.groceryCategory, components: crushedForm.components, allergenGroups: crushedGroups };
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ id: r.id, name: r.name, before, after });
    } else if (r.name.toLowerCase() === "soy sauce") {
      if (r.allergenGroups.includes("BIG9-WHEAT")) continue;
      const after = { ...before, components: Array.from(new Set([...r.components, "wheat"])), allergenGroups: [...r.allergenGroups, "BIG9-WHEAT"] };
      changes.push({ id: r.id, name: r.name, before, after });
    }
  }

  for (const r of rows) console.log(`  ${r.name} (${r.id}) — ${r._count.recipes} recipes`);
  for (const c of changes) console.log(`→ ${c.name}\n    before ${JSON.stringify(c.before)}\n    after  ${JSON.stringify(c.after)}`);
  if (changes.length === 0) console.log("Nothing to change.");
  if (!apply) {
    console.log(`Dry run: ${changes.length} row(s) would change. Re-run with --apply.`);
    return prisma.$disconnect();
  }
  const backup = `scripts/fix-ingredient-forms-2026-10-07.rollback-${Date.now()}.json`;
  fs.writeFileSync(backup, JSON.stringify(changes.map((c) => ({ id: c.id, name: c.name, restore: c.before })), null, 2));
  console.log(`rollback → ${backup}`);
  for (const c of changes) await prisma.ingredient.update({ where: { id: c.id }, data: c.after as never });
  console.log(`Applied: ${changes.length} row(s).`);
  await prisma.$disconnect();
})();
