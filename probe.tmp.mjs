import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g,"");
}
const { PrismaClient } = await import("@prisma/client");
const { macrosContradictAmounts, macroFloor } = await import("./lib/staple-density.ts");
const prisma = new PrismaClient();
const recipes = await prisma.recipe.findMany({ where: { isPublic: true }, select: { name:true, tags:true, carbs:true, fat:true, calories:true,
  mealType: { select: { name:true } }, ingredients: { select: { quantity:true, unit:true, ingredient: { select: { name:true } } } } } });
let hit = 0, gen = 0, lib = 0; const samples = [];
for (const r of recipes) {
  const ings = r.ingredients.map(i => ({ name: i.ingredient.name, quantity: i.quantity, unit: i.unit }));
  const isGen = (r.tags??[]).some(t=>/clara/i.test(t));
  const why = isGen ? macrosContradictAmounts({ carbs: r.carbs, fat: r.fat }, ings) : null;
  if (why) { hit++; gen++; if (samples.length<8) samples.push([r.name, why]); }
}
console.log(`pool ${recipes.length}: contradicted ${hit} (${(hit/recipes.length*100).toFixed(1)}%) — generated ${gen}, library ${lib}`);
for (const [n,w] of samples) console.log(`  ${n}\n     ${w}`);
// The three cases bot 2 named
const cases = ["Chicken Thighs with Brown Rice and Roasted Broccoli","Turkey Breast Stir-Fry with Cauliflower and Basmati Rice","Ground Turkey and Broccoli Bowl with Basmati Rice","Baked Chicken Breast with Carrots and Jasmine Rice"];
for (const name of cases) {
  const r = recipes.find(x => x.name === name);
  if (!r) { console.log(`\n${name}: not found`); continue; }
  const ings = r.ingredients.map(i => ({ name: i.ingredient.name, quantity: i.quantity, unit: i.unit }));
  const f = macroFloor(ings);
  console.log(`\n${name}\n   declared C=${r.carbs} F=${r.fat} | floor C=${f.carbs.toFixed(0)} F=${f.fat.toFixed(0)} | ${macrosContradictAmounts({carbs:r.carbs,fat:r.fat},ings) ?? "OK"}`);
}
await prisma.$disconnect();
