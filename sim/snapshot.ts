// Rule-compliance simulation — step 1: READ-ONLY snapshot of the shared DB.
//
//   npm run sim:snapshot
//
// Reads (never writes) every profile rule list, the public recipe library with
// its allergen tags, the ingredient table and the meal types, plus the rule
// COMBINATIONS real users hold (rule names only — no ids, no personal data).
// Writes sim/.snapshot/snapshot.json (gitignored). The simulation itself
// (npm run sim:rules) runs offline against that file.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

(async () => {
  const banned = { select: { name: true } };
  const [allergies, avoids, conditions, preferences, motivations, triggerRules, mealTypes, physicalActivities, ingredients, recipes, patients] =
    await Promise.all([
      prisma.foodAllergy.findMany({ select: { name: true, bannedIngredients: banned }, orderBy: { name: "asc" } }),
      prisma.foodToAvoid.findMany({ select: { name: true, bannedIngredients: banned }, orderBy: { name: "asc" } }),
      // Built-in conditions only; a user's own custom conditions stay private.
      prisma.healthCondition.findMany({ where: { ownerPatientId: null }, select: { name: true, bannedIngredients: banned }, orderBy: { name: "asc" } }),
      prisma.foodPreference.findMany({ select: { name: true, bannedIngredients: banned }, orderBy: { name: "asc" } }),
      prisma.motivation.findMany({ select: { name: true, bannedIngredients: banned }, orderBy: { name: "asc" } }),
      prisma.triggerRule.findMany({
        where: { active: true },
        select: { code: true, category: true, baselineDays: true, trialDays: true, reintroductionDays: true, washoutDays: true, condition: { select: { name: true } } },
        orderBy: { code: "asc" },
      }),
      prisma.mealType.findMany(),
      prisma.physicalActivity.findMany(),
      prisma.ingredient.findMany({ select: { id: true, name: true, allergenGroups: true, groceryCategory: true } }),
      prisma.recipe.findMany({
        where: { isPublic: true },
        include: {
          mealType: { select: { name: true } },
          dishType: { select: { name: true } },
          ethnic: { select: { name: true } },
          ingredients: { select: { ingredientId: true, quantity: true, unit: true } },
        },
      }),
      prisma.patient.findMany({
        select: {
          foodAllergies: { select: { food: { select: { name: true } } } },
          foodToAvoid: { select: { food: { select: { name: true } } } },
          healthConditions: { select: { condition: { select: { name: true, ownerPatientId: true } } } },
          foodPreferences: { select: { food: { select: { name: true } } } },
          motivations: { select: { motivation: { select: { name: true } } } },
        },
      }),
    ]);

  // Distinct real combinations, as "kind:name" keys. Custom conditions are
  // counted but not named.
  const combos = new Map<string, number>();
  let customConditionHolders = 0;
  for (const p of patients) {
    const keys = [
      ...p.foodAllergies.map((x) => `allergy:${x.food.name}`),
      ...p.foodToAvoid.map((x) => `avoid:${x.food.name}`),
      ...p.healthConditions.filter((x) => !x.condition.ownerPatientId).map((x) => `condition:${x.condition.name}`),
      ...p.foodPreferences.map((x) => `diet:${x.food.name}`),
      ...p.motivations.map((x) => `goal:${x.motivation.name}`),
    ].sort();
    if (p.healthConditions.some((x) => x.condition.ownerPatientId)) customConditionHolders++;
    if (keys.length === 0) continue;
    const k = JSON.stringify(keys);
    combos.set(k, (combos.get(k) ?? 0) + 1);
  }

  const snapshot = {
    takenAt: new Date().toISOString(),
    rules: { allergies, avoids, conditions, preferences, motivations, triggerRules },
    mealTypes,
    physicalActivities,
    ingredients,
    recipes,
    realCombos: Array.from(combos, ([k, users]) => ({ rules: JSON.parse(k) as string[], users })),
    stats: { patients: patients.length, customConditionHolders },
  };
  const dir = join(__dirname, ".snapshot");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "snapshot.json");
  writeFileSync(file, JSON.stringify(snapshot));
  console.log(
    `snapshot → ${file}\n` +
      `  rules: ${allergies.length} allergies, ${avoids.length} avoids, ${conditions.length} conditions, ${preferences.length} diets, ${motivations.length} goals, ${triggerRules.length} trigger rules\n` +
      `  library: ${recipes.length} public recipes, ${ingredients.length} ingredients, ${mealTypes.length} meal types\n` +
      `  real users: ${patients.length} patients, ${combos.size} distinct rule combinations (${customConditionHolders} hold a custom condition, not exported)`
  );
  await prisma.$disconnect();
})();
