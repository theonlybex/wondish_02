// Phase D: workbook 03 "Health Restriction Rules" → HealthCondition.bannedIngredients.
// Dry-run by default; `--apply` writes; idempotent.
//   set -a; source .env.local; set +a
//   npx tsx scripts/import-condition-rules.ts [--apply]
//
// Imported: DEPLOYABLE rows whose action is DO_NOT_AUTO_INCLUDE or AVOID, for
// a profile factor we map (lib/workbooks/condition-map), whose ingredient_id
// resolves to an Ingredient.formId we hold. Everything else is reported.
// Celiac skips gluten-free products (its wheat products are caught by the
// BIG9-WHEAT component group; a name row would ban the safe substitutes).
import { PrismaClient } from "@prisma/client";
import { findWorkbook, readHealthRules } from "../lib/workbooks/read";
import { CONDITION_FACTOR_MAP } from "../lib/workbooks/condition-map";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const IMPORT_ACTIONS = new Set(["DO_NOT_AUTO_INCLUDE", "AVOID"]);
// Workbook rows we do not import (dry-run review 2026-09-11): the Fatty Liver
// factor's DO_NOT_AUTO_INCLUDE list names explicitly unsweetened / sugar-free
// products and vinegars, which contradicts the rule's intent (added sugar,
// alcohol). Kept out until the client confirms them.
const RETIRED = new Set<string>([
  "sugar-free granola",
  "plain unsweetened almond milk yogurt",
  "almond milk",
  "unsweetened applesauce",
  "unsweetened coconut flakes",
  "unsweetened soymilk",
  "unsweetened vanilla almond milk",
  "red wine vinegar",
  "no salt-no sugar added tomato sauce",
]);

(async () => {
  const rules = readHealthRules(findWorkbook("Wondish_03"));
  const ingredients = await prisma.ingredient.findMany({ where: { formId: { not: null } }, select: { name: true, formId: true } });
  const nameByForm = new Map(ingredients.map((i) => [i.formId!, i.name]));
  const conditions = await prisma.healthCondition.findMany({ select: { id: true, name: true, bannedIngredients: { select: { name: true } } } });
  const condByName = new Map(conditions.map((c) => [c.name, c]));

  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const plan = new Map<string, Set<string>>(); // conditionId → names to add
  for (const r of rules) {
    if (r.gate !== "DEPLOYABLE") { skip(`gate ${r.gate || "?"}`); continue; }
    if (!IMPORT_ACTIONS.has(r.action)) { skip(`action ${r.action}`); continue; }
    const names = CONDITION_FACTOR_MAP[r.profileFactorId];
    if (!names) { skip(`unmapped factor ${r.profileFactorId}`); continue; }
    const ingredient = nameByForm.get(r.ingredientFormId);
    if (!ingredient) { skip("form id not in catalog"); continue; }
    if (RETIRED.has(ingredient.toLowerCase())) { skip("retired name"); continue; }
    for (const condName of names) {
      const cond = condByName.get(condName);
      if (!cond) { skip(`condition ${condName} not in DB`); continue; }
      if (condName === "Celiac Disease" && /gluten-free/i.test(ingredient)) { skip("celiac gluten-free product"); continue; }
      if (cond.bannedIngredients.some((b) => b.name.toLowerCase() === ingredient.toLowerCase())) { skip("already banned"); continue; }
      const set = plan.get(cond.id) ?? new Set<string>();
      set.add(ingredient);
      plan.set(cond.id, set);
    }
  }

  let total = 0;
  for (const [condId, names] of plan) {
    const cond = conditions.find((c) => c.id === condId)!;
    total += names.size;
    console.log(`${cond.name}: +${names.size} → ${[...names].join(", ")}`);
  }
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${total} rows to add. Skipped: ${JSON.stringify(skipped)}`);
  if (!apply) return;
  for (const [condId, names] of plan) {
    await prisma.healthConditionBannedIngredient.createMany({ data: [...names].map((name) => ({ conditionId: condId, name })), skipDuplicates: true });
  }
  console.log("applied");
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
