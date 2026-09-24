import { prisma } from "@/lib/db";
import { displayDishName } from "@/lib/dish-name";

// A text block describing the user's dishes for `localDate`, appended to Clara's
// system prompt so she knows exactly what they're cooking today and can answer
// cooking questions ("how do I make my lunch?", "what temperature?") in detail.
export async function buildTodaysPlanText(patientId: string, localDate: string): Promise<string> {
  const parts = localDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "";
  const [y, m, d] = parts;
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { activePlanVersion: true },
  });
  if (!patient) return "";

  const menus = await prisma.menu.findMany({
    where: { patientId, planVersion: patient.activePlanVersion, date: { gte: start, lte: end } },
    include: {
      mealType: { select: { name: true } },
      recipe: {
        select: {
          name: true,
          steps: true,
          calories: true,
          prepTime: true,
          cookTime: true,
          servings: true,
          protein: true,
          carbs: true,
          fat: true,
          // Quantities were missing until 2026-09-24, and Clara said so: asked
          // to list a dish's ingredients with amounts she answered "the recipe
          // plan doesn't include specific quantities — just the ingredients
          // themselves", while the app's own dish panel printed every one. She
          // was describing her context accurately; the context was wrong.
          ingredients: {
            select: { note: true, quantity: true, unit: true, ingredient: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (menus.length === 0) return "";

  const order = ["breakfast", "lunch", "dinner", "snack"];
  const rank = (n?: string) => {
    const i = order.indexOf((n ?? "").toLowerCase());
    return i < 0 ? 99 : i;
  };
  const lines = menus
    .sort((a, b) => rank(a.mealType?.name) - rank(b.mealType?.name))
    .map((m) => {
      const ings = m.recipe.ingredients
        .map((ri) => {
          const amount = ri.quantity != null ? `${ri.quantity}${ri.unit ? ` ${ri.unit}` : ""} ` : "";
          return `${amount}${ri.ingredient.name}${ri.note ? ` (${ri.note})` : ""}`;
        })
        .join(", ");
      const steps = m.recipe.steps.length
        ? ` Steps: ${m.recipe.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`
        : "";
      const kcal = m.recipe.calories ? ` (~${Math.round(m.recipe.calories)} kcal` : "";
      const macros =
        kcal && (m.recipe.protein != null || m.recipe.carbs != null || m.recipe.fat != null)
          ? `; ${Math.round(m.recipe.protein ?? 0)}g protein, ${Math.round(m.recipe.carbs ?? 0)}g carbs, ${Math.round(m.recipe.fat ?? 0)}g fat)`
          : kcal
            ? ")"
            : "";
      const time =
        (m.recipe.prepTime ?? 0) + (m.recipe.cookTime ?? 0) > 0
          ? ` Takes ${(m.recipe.prepTime ?? 0) + (m.recipe.cookTime ?? 0)} min in total${m.recipe.servings && m.recipe.servings > 1 ? `, serves ${m.recipe.servings}` : ""}.`
          : "";
      return `- ${m.mealType?.name ?? "Meal"}: ${displayDishName(m.recipe.name)}${kcal}${macros}.${time} Ingredients (amounts are per serving): ${ings}.${steps}`;
    });

  // The closing instruction exists because of what Clara said without it: she
  // answered a plan question correctly, then 40 seconds later told the same
  // user "I don't have access to a recipe database or your meal plan details"
  // when asked about a different dish, and told another "I don't have a tool to
  // see what's in your meal plan right now". She had the plan in front of her
  // both times. A wrong denial is worse than a wrong answer — it teaches the
  // user the feature does not work.
  return (
    `\n\nTODAY'S MEAL PLAN — this IS the user's plan, straight from their account. ` +
    `The amounts, timings and macros below are exactly what the app shows them, so quote them directly; ` +
    `never tell the user you cannot see their plan or that it has no quantities. ` +
    `If they ask about a dish that is NOT in this list, say plainly that it is not in their plan this week and offer to help anyway. ` +
    `They may ask how to cook any of these, or for help mid-cook — walk them through the steps clearly and answer follow-ups:\n${lines.join("\n")}`
  );
}
