import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const recipes = await p.recipe.findMany({
    select: { id: true, name: true, mealType: { select: { name: true } } },
    orderBy: [{ mealType: { name: "asc" } }, { name: "asc" }],
  });
  for (const r of recipes) {
    console.log(`[${r.mealType?.name ?? "?"}] ${r.name}`);
  }
  console.log(`\nTotal: ${recipes.length}`);
}
main().finally(() => p.$disconnect());
