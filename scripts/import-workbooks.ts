// Import the Wondish workbooks (01/02/03/06) into the DB. Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/import-workbooks.ts --phase a            # ingredients: ids, classification, Big-9 groups, conversions
//   npx tsx scripts/import-workbooks.ts --phase b            # library recipes: quantities, author steps, nutrition, lineage
//   npx tsx scripts/import-workbooks.ts --phase all --apply
// Idempotent: a second run plans zero changes. Every apply writes a rollback
// JSON next to the script before touching rows.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { findWorkbook, readForms, readRecipeRows, readBig9, readConversions } from "../lib/workbooks/read";
import { planIngredientUpdates } from "../lib/workbooks/ingredient-plan";
import { phaseB } from "./import-workbooks-b";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const phaseArg = process.argv.indexOf("--phase");
const phase = phaseArg >= 0 ? process.argv[phaseArg + 1] : "all";

async function phaseA() {
  const forms = readForms(findWorkbook("Wondish_01"));
  const recipeRows = readRecipeRows(findWorkbook("Wondish_02"));
  const big9 = readBig9(findWorkbook("Wondish_03"));
  const conversions = readConversions(findWorkbook("Wondish_06"));
  const dbIngredients = await prisma.ingredient.findMany({ select: { id: true, name: true, formId: true } });
  const aliases = JSON.parse(fs.readFileSync("data/ingredient-aliases.json", "utf8")).aliases as Record<string, string | null>;
  const plan = planIngredientUpdates({ forms, recipeRows, big9, conversions, dbIngredients, aliases });
  console.log(`[A] ${apply ? "APPLY" : "DRY RUN"}: attach=${plan.attach.length} create=${plan.create.length} conversions=${plan.conversions.length} conflicts=${plan.conflicts.length}`);
  for (const c of plan.conflicts) console.log("  conflict:", c.formId, c.reason);
  if (!apply) {
    console.log("  create sample:", plan.create.slice(0, 10).map((c) => c.name).join(" | "));
    return;
  }
  fs.writeFileSync(`workbooks-rollback-A-${Date.now()}.json`, JSON.stringify({ attach: plan.attach.map((x) => x.ingredientId), create: plan.create.map((x) => x.name) }));
  for (const x of plan.attach) {
    await prisma.ingredient.update({ where: { id: x.ingredientId }, data: { formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups } });
  }
  for (const x of plan.create) {
    await prisma.ingredient.upsert({
      where: { name: x.name },
      update: { formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups },
      create: { name: x.name, formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups },
    });
  }
  const byForm = new Map((await prisma.ingredient.findMany({ where: { formId: { not: null } }, select: { id: true, formId: true } })).map((i) => [i.formId!, i.id]));
  let convWritten = 0;
  for (const c of plan.conversions) {
    const ingredientId = byForm.get(c.formId);
    if (!ingredientId) continue;
    await prisma.ingredientUnitConversion.upsert({
      where: { ingredientId_unit: { ingredientId, unit: c.unit } },
      update: { baseQuantity: c.baseQuantity, baseUnit: c.baseUnit, confidence: c.confidence },
      create: { ingredientId, unit: c.unit, baseQuantity: c.baseQuantity, baseUnit: c.baseUnit, confidence: c.confidence },
    });
    convWritten++;
  }
  console.log(`[A] applied: attached ${plan.attach.length}, created ${plan.create.length}, conversions ${convWritten}`);
}

(async () => {
  if (phase === "a" || phase === "all") await phaseA();
  if (phase === "b" || phase === "all") await phaseB(prisma, apply);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
