// Health-condition ban-list clean-up from the 2026-09-11 condition audit
// (docs/qa/condition-audit-2026-09-11.md). Dry-run by default, idempotent.
//   set -a; source .env.local; set +a
//   npx tsx scripts/condition-rules-2026-09-11.ts [--apply]
//
// Rules of thumb applied:
//   - a bare word that also names a different product is replaced by the
//     specific products ("sugar" banned "Sugar-free granola"; "butter" banned
//     almond/peanut butter; "beans" banned the plant-based egg and green beans;
//     "kidney" banned kidney beans)
//   - rows that can never match a catalog name are replaced by the names the
//     catalog uses ("white rice" → Jasmine/Basmati rice; "nuts" → walnuts…)
//   - Celiac drops the rows that only matched gluten-FREE products; wheat
//     products are now caught by the BIG9-WHEAT component group
//     (lib/diet-match CONDITION_GROUPS), which covers every workbook-03
//     deployable AVOID row that resolves to an ingredient in use.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const CHANGES: Record<string, { remove: string[]; add: string[] }> = {
  "Celiac Disease": {
    remove: ["gluten", "pasta", "crackers", "flour"],
    add: ["wheat flour", "bread flour", "flour tortillas", "spaghetti", "penne", "macaroni", "sliced bread", "whole wheat bread", "pita bread", "naan"],
  },
  "Heart Disease": {
    remove: ["sugar", "butter"],
    add: ["cane sugar", "granulated sugar", "unsalted butter", "salted butter"],
  },
  "High Cholesterol": {
    remove: ["butter", "kidney"],
    add: ["unsalted butter", "salted butter", "beef kidney", "lamb kidney"],
  },
  "Kidney Disease stage 1-2": {
    remove: ["beans", "nuts", "yogurt"],
    add: [
      "black beans", "white beans", "kidney beans", "lima beans", "pinto beans", "navy beans", "garbanzo beans", "chickpeas",
      "walnuts", "almonds", "cashews", "cashew nuts", "pecans", "pistachios", "peanuts", "hazelnuts",
      "greek yogurt", "plain yogurt", "dairy yogurt",
    ],
  },
  "Thyroid Disorder": {
    remove: ["sugar"],
    add: ["white sugar", "cane sugar", "granulated sugar"],
  },
  "Type 2 Diabetes": {
    remove: ["sugar"],
    add: ["granulated sugar", "jasmine rice", "basmati rice", "sliced bread", "flour tortillas", "orange juice", "apple juice"],
  },
};

(async () => {
  let removed = 0;
  let added = 0;
  for (const [name, change] of Object.entries(CHANGES)) {
    const cond = await prisma.healthCondition.findFirst({ where: { name }, select: { id: true, bannedIngredients: { select: { id: true, name: true } } } });
    if (!cond) { console.log(`[skip] ${name}: not in DB`); continue; }
    const have = new Map(cond.bannedIngredients.map((b) => [b.name.toLowerCase(), b.id]));
    const toRemove = change.remove.filter((n) => have.has(n.toLowerCase()));
    const toAdd = change.add.filter((n) => !have.has(n.toLowerCase()));
    removed += toRemove.length;
    added += toAdd.length;
    console.log(`${name}: -${toRemove.length}${toRemove.length ? " (" + toRemove.join(", ") + ")" : ""}  +${toAdd.length}${toAdd.length ? " (" + toAdd.join(", ") + ")" : ""}`);
    if (!apply) continue;
    if (toRemove.length) await prisma.healthConditionBannedIngredient.deleteMany({ where: { id: { in: toRemove.map((n) => have.get(n.toLowerCase())!) } } });
    if (toAdd.length) await prisma.healthConditionBannedIngredient.createMany({ data: toAdd.map((n) => ({ conditionId: cond.id, name: n })), skipDuplicates: true });
  }
  console.log(`${apply ? "APPLIED" : "DRY RUN"}: removed ${removed}, added ${added}`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
