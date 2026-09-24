import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"");
}
const { PrismaClient } = await import("@prisma/client");
const { macrosContradictAmounts, grainIsMeasuredDry } = await import("./lib/staple-density.ts");
const { dishProblem, catalogFoodVocabulary } = await import("./lib/dish-plausibility.ts");
const prisma = new PrismaClient();
// Bot 2's named worst cases
for (const name of ["Roasted Turkey Breast with Cauliflower and Basmati Rice","Ground Turkey and Broccoli Bowl with Basmati Rice","Simple Chicken and Brown Rice Bowl","Turkey Breast and Bell Pepper Rice Bowl","Turkey Breast with Broccoli and Basmati Rice"]) {
  const r = await prisma.recipe.findFirst({ where: { name }, select: { name:true, steps:true, carbs:true, fat:true,
    ingredients: { select: { quantity:true, unit:true, ingredient: { select: { name:true } } } } } });
  if (!r) { console.log(`${name}: not found`); continue; }
  const ings = r.ingredients.map(i => ({ name: i.ingredient.name, quantity: i.quantity, unit: i.unit }));
  console.log(`${r.name}\n   dry-evidence=${grainIsMeasuredDry(r.steps)} → ${macrosContradictAmounts({carbs:r.carbs,fat:r.fat}, ings, r.steps) ?? "OK"}`);
}
// Pool cost
const vocab = catalogFoodVocabulary((await prisma.ingredient.findMany({ select: { name: true } })).map(i => i.name));
const recipes = await prisma.recipe.findMany({ where: { isPublic: true }, select: { name:true, description:true, tags:true, steps:true, calories:true, carbs:true, fat:true, prepTime:true, cookTime:true,
  mealType: { select: { name:true } }, ingredients: { select: { quantity:true, unit:true, ingredient: { select: { name:true, groceryCategory:true } } } } } });
const counts = {}; const byType = {};
for (const r of recipes) {
  const t = r.mealType?.name ?? "(none)";
  byType[t] ??= { total:0, kept:0 }; byType[t].total++;
  const p = dishProblem({ name: r.name, description: r.description, steps: r.steps, mealTypeName: t, prepMinutes: r.prepTime, cookMinutes: r.cookTime,
    calories: r.calories, macros: { carbs: r.carbs, fat: r.fat }, generated: (r.tags??[]).some(x=>/clara/i.test(x)),
    ingredients: r.ingredients.map(ri => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, category: ri.ingredient.groceryCategory })) }, vocab);
  if (p) counts[p] = (counts[p]??0)+1; else byType[t].kept++;
}
const rej = Object.values(counts).reduce((a,b)=>a+b,0);
console.log(`\npool ${recipes.length}; rejected ${rej} (${(rej/recipes.length*100).toFixed(1)}%)`, JSON.stringify(counts));
for (const [t,v] of Object.entries(byType)) console.log(`  ${t.padEnd(11)} ${v.kept}/${v.total}`);
await prisma.$disconnect();
