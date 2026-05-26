/**
 * Copies ingredients from base recipes to their variants that have no ingredients.
 * Also copies description if the variant is missing one.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const noIngredients = await prisma.recipe.findMany({
    where: { ingredients: { none: {} } },
    select: { id: true, name: true, description: true },
  });

  const hasIngredients = await prisma.recipe.findMany({
    where: { ingredients: { some: {} } },
    select: {
      name: true,
      description: true,
      ingredients: {
        select: {
          ingredientId: true,
          quantity: true,
          unit: true,
        },
      },
    },
  });

  const baseMap = new Map(hasIngredients.map((r) => [r.name.trim().toLowerCase(), r]));

  let inherited = 0;
  let skipped   = 0;

  for (const r of noIngredients) {
    const name = r.name.trim();
    // Strip variant suffix — try both ' , V...' and ', V...' patterns
    const p1 = name.replace(/ , V.*$/i, "").trim();
    const p2 = name.replace(/, V.*$/i, "").trim();

    const base =
      (p1 !== name && baseMap.get(p1.toLowerCase())) ||
      (p2 !== name && baseMap.get(p2.toLowerCase()));

    if (!base || base.ingredients.length === 0) {
      skipped++;
      continue;
    }

    await prisma.recipeIngredient.createMany({
      data: base.ingredients.map((bi) => ({
        recipeId:     r.id,
        ingredientId: bi.ingredientId,
        quantity:     bi.quantity,
        unit:         bi.unit,
      })),
      skipDuplicates: true,
    });

    if (!r.description && base.description) {
      await prisma.recipe.update({
        where: { id: r.id },
        data:  { description: base.description },
      });
    }

    inherited++;
  }

  console.log(`Inherited ingredients: ${inherited}`);
  console.log(`Skipped (no base found): ${skipped}`);

  // Final tally
  const stillMissing = await prisma.recipe.count({ where: { ingredients: { none: {} } } });
  console.log(`Still missing ingredients: ${stillMissing}`);
}

main().finally(() => prisma.$disconnect());
