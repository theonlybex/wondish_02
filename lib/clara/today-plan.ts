import { prisma } from "@/lib/db";

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
          ingredients: { select: { note: true, ingredient: { select: { name: true } } } },
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
      const ings = m.recipe.ingredients.map((ri) => (ri.note ? `${ri.ingredient.name} (${ri.note})` : ri.ingredient.name)).join(", ");
      const steps = m.recipe.steps.length
        ? ` Steps: ${m.recipe.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`
        : "";
      const kcal = m.recipe.calories ? ` (~${Math.round(m.recipe.calories)} kcal)` : "";
      return `- ${m.mealType?.name ?? "Meal"}: ${m.recipe.name}${kcal}. Ingredients: ${ings}.${steps}`;
    });

  return `\n\nTODAY'S MEAL PLAN — the user may ask how to cook any of these, or for help while cooking. Walk them through the steps clearly and in detail, and answer follow-up cooking questions:\n${lines.join("\n")}`;
}
