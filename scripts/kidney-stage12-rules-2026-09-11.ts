// Kidney Disease stage 1-2: retire the potassium/phosphorus hard bans, keep
// the sodium/processed-food ones (2026-09-11). Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/kidney-stage12-rules-2026-09-11.ts [--apply]
//
// The stage 1-2 list carried a full late-stage renal diet (no legumes, nuts,
// seeds, whole grains, dairy, high-potassium fruit and veg), which left a
// vegan with tofu and substitutes. NKF/KDIGO restrict potassium and
// phosphorus by lab values, not by a stage 1-2 diagnosis; those foods now
// reach Clara as "moderate portions" guidance (lib/food-map CONDITION_GUIDANCE).
// "Chronic kidney disease – stage 3" keeps its full list. Authored, not
// client-supplied — needs the same clinician review as the other backfills.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const CONDITION = "Kidney Disease stage 1-2";
const RETIRE = [
  "banana", "orange", "potato", "tomato", "tomato sauce", "tomato paste", "avocado", "spinach", "pumpkin", "squash",
  "beets", "dried fruit", "prunes", "raisins", "dairy milk", "cheese", "whole milk", "seeds", "peanut butter",
  "lentils", "dark cola", "bran", "whole grain", "oat bran", "black beans", "white beans", "kidney beans",
  "lima beans", "pinto beans", "navy beans", "garbanzo beans", "chickpeas", "walnuts", "almonds", "cashews",
  "cashew nuts", "pecans", "pistachios", "peanuts", "hazelnuts", "greek yogurt", "plain yogurt", "dairy yogurt",
];

(async () => {
  const cond = await prisma.healthCondition.findFirst({
    where: { name: CONDITION, ownerPatientId: null },
    select: { id: true, bannedIngredients: { select: { id: true, name: true } } },
  });
  if (!cond) {
    console.log(`not found: ${CONDITION}`);
    await prisma.$disconnect();
    return;
  }
  const retire = new Set(RETIRE.map((n) => n.toLowerCase()));
  const rows = cond.bannedIngredients.filter((b) => retire.has(b.name.toLowerCase()));
  const kept = cond.bannedIngredients.filter((b) => !retire.has(b.name.toLowerCase()));
  console.log(`[${CONDITION}] retire ${rows.length}: ${rows.map((r) => r.name).join(", ") || "(none)"}`);
  console.log(`[${CONDITION}] keep ${kept.length}: ${kept.map((r) => r.name).join(", ")}`);
  if (apply && rows.length) {
    await prisma.healthConditionBannedIngredient.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await prisma.patient.updateMany({ where: { healthConditions: { some: { conditionId: cond.id } }, mealPlanStartDate: { not: null } }, data: { mealPlanStale: true } });
  }
  console.log(apply ? `Applied: ${rows.length} rows retired.` : `Dry run: ${rows.length} rows would be retired. Re-run with --apply.`);
  await prisma.$disconnect();
})();
