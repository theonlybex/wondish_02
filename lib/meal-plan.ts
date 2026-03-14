import { prisma } from "@/lib/db";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function generateMealPlan(
  patientId: string,
  startDate: Date,
  endDate: Date
) {
  // Get patient allergies to exclude
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { foodAllergies: { include: { food: true } } },
  });

  const allergyNames = patient?.foodAllergies.map((a) => a.food.name) ?? [];

  // Get all meal types
  const mealTypes = await prisma.mealType.findMany();

  // Delete existing menus in range
  await prisma.menu.deleteMany({
    where: {
      patientId,
      date: { gte: startDate, lte: endDate },
    },
  });

  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    for (const mealType of mealTypes) {
      // Get recipes for this meal type, excluding allergen ingredients
      const recipes = await prisma.recipe.findMany({
        where: {
          mealTypeId: mealType.id,
          isPublic: true,
          ...(allergyNames.length
            ? {
                NOT: {
                  ingredients: {
                    some: {
                      ingredient: {
                        name: { in: allergyNames, mode: "insensitive" },
                      },
                    },
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });

      let pool = shuffleArray(recipes);

      // Fallback: any recipe for this meal type
      if (pool.length === 0) {
        const fallback = await prisma.recipe.findFirst({
          where: { mealTypeId: mealType.id, isPublic: true },
          select: { id: true },
        });
        if (fallback) pool = [fallback];
      }

      if (pool.length === 0) continue;

      menus.push({
        patientId,
        recipeId: pool[0].id,
        mealTypeId: mealType.id,
        date: new Date(current),
      });
    }

    current.setDate(current.getDate() + 1);
  }

  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }

  return menus.length;
}
