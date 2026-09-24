import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"");
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const acct = await prisma.account.findFirst({ where: { email: "qa.bot2.0924@wondish.io" }, select: { id: true } });
const patient = await prisma.patient.findFirst({ where: { accountId: acct.id }, select: { id: true } });
const pantry = await prisma.patientPantryItem.findMany({ where: { patientId: patient.id }, select: { ingredient: { select: { name: true } } } });
const basket = new Set(pantry.map(p => p.ingredient.name));
const { buildMealPlanMenus, dishProtein } = await import("./lib/meal-plan.ts");
const { dishProblem, catalogFoodVocabulary } = await import("./lib/dish-plausibility.ts");
const start = new Date(); start.setHours(0,0,0,0);
const t0 = Date.now();
const res = await buildMealPlanMenus(patient.id, start, 997, { windowDays: 7, basket });
const ids = [...new Set(res.rows.map(r => r.recipeId))];
console.log(`rows=${res.rows.length} distinct=${ids.length} coverage=${(res.coreCoverage*100).toFixed(0)}% (${res.filledCoreSlots}/${res.expectedCoreSlots}) in ${((Date.now()-t0)/1000).toFixed(1)}s`);
const recipes = await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id:true, name:true, description:true, tags:true, steps:true,
  calories:true, protein:true, carbs:true, fat:true, prepTime:true, cookTime:true,
  ingredients: { select: { quantity:true, unit:true, ingredient: { select: { name:true, groceryCategory:true } } } } } });
const vocab = catalogFoodVocabulary((await prisma.ingredient.findMany({ select: { name: true } })).map(i => i.name));
const mt = Object.fromEntries((await prisma.mealType.findMany({ select: { id:true, name:true } })).map(m => [m.id, m.name]));
const byId = Object.fromEntries(recipes.map(r => [r.id, r]));
let bad = 0; const counts = {}; const protDay = {}; let cupGrains = 0;
for (const r of res.rows) {
  const rec = byId[r.recipeId]; const day = r.date.toISOString().slice(0,10);
  counts[rec.name] = (counts[rec.name]??0)+1;
  const ings = rec.ingredients.map(ri => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, category: ri.ingredient.groceryCategory }));
  const p = dishProblem({ name: rec.name, description: rec.description, steps: rec.steps, mealTypeName: mt[r.mealTypeId],
    prepMinutes: rec.prepTime, cookMinutes: rec.cookTime, calories: rec.calories, macros: { carbs: rec.carbs, fat: rec.fat },
    generated: (rec.tags??[]).some(t=>/clara/i.test(t)), ingredients: ings }, vocab);
  if (p) { console.log(`  DEFECT ${p}: ${mt[r.mealTypeId]} — ${rec.name}`); bad++; }
  for (const i of ings) if (/rice|pasta|spaghetti|oats|quinoa/i.test(i.name) && /cup/i.test(i.unit ?? "")) cupGrains++;
  const dp = dishProtein(rec.ingredients);
  if (dp) { protDay[day] ??= {}; protDay[day][dp] = (protDay[day][dp]??0)+1; }
}
for (const [d,pp] of Object.entries(protDay).sort()) { const w = Math.max(...Object.values(pp)); if (w > 2) console.log(`  PROTEIN3 ${d} ${JSON.stringify(pp)}`); }
console.log(`max repeat: ${Math.max(...Object.values(counts))}  cup-measured grains: ${cupGrains}  defects: ${bad}`);
await prisma.$disconnect();
