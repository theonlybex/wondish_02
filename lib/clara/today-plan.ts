import { prisma } from "@/lib/db";
import { displayDishName } from "@/lib/dish-name";

/**
 * Sodium from a dish's added salt, in mg. One definition for the per-dish line
 * and the day total, so the two cannot disagree with each other or with the
 * rail (lib/meal-plan.ts dishSodiumMg uses the same constants).
 */
function dishSodium(
  ingredients: readonly { quantity: number | null; unit: string | null; ingredient: { name: string } }[]
): number {
  let mg = 0;
  for (const ri of ingredients) {
    if (!/\bsalt\b/i.test(ri.ingredient.name)) continue;
    const q = ri.quantity ?? 0;
    if (q <= 0) continue;
    const u = ri.unit ?? "";
    if (/\b(tsp|teaspoons?)\b/i.test(u)) mg += q * 2325;
    else if (/\b(tbsp|tablespoons?)\b/i.test(u)) mg += q * 6975;
    else if (/\b(pinch|pinches|dash(es)?)\b/i.test(u)) mg += q * (2325 / 16);
    else if (/^\s*(g|gram|grams|gr)\s*$/i.test(u)) mg += q * 393;
  }
  return mg;
}

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

  // Tomorrow as well as today. Asked "what's in my plan tomorrow?" Clara said
  // "I can only see today's meal plan on my end" — honest about her context and
  // wrong about the app's, which holds the whole week. It is an obvious first
  // question and "check the other screen" is a poor answer from an assistant
  // looking at the same database.
  //
  // Names and numbers only, no steps: the steps are what make the block large,
  // and nobody asks how to cook tomorrow's dinner while standing in today's
  // kitchen. She is told the distinction so she does not offer what she lacks.
  const tomorrowStart = new Date(start);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const tomorrow = await prisma.menu.findMany({
    where: { patientId, planVersion: patient.activePlanVersion, date: { gte: tomorrowStart, lte: tomorrowEnd } },
    include: {
      mealType: { select: { name: true } },
      recipe: { select: { name: true, calories: true } },
    },
  });

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
      // The dish's own sodium, computed the same way the rail computes it.
      //
      // Given only the day's total, Clara did the per-dish arithmetic herself
      // and got it wrong in the direction that matters: asked about one
      // breakfast she answered "0.15 teaspoon × 5,800 mg = 870 mg of sodium".
      // A teaspoon of salt weighs ~6,000 mg but contains ~2,325 mg of SODIUM —
      // she had confused the salt with the mineral, by a factor of 2.5, on a
      // figure someone on a sodium restriction acts on. The contradiction was
      // inside one reply: the 1,802 mg day total she quoted in the same sentence
      // is the app's, computed at 2,325 mg per teaspoon.
      //
      // So she is given the number instead of the ingredients to convert.
      const dishMg = Math.round(dishSodium(m.recipe.ingredients ?? []));
      const sodium = dishMg > 0 ? ` Added salt in this dish: ${dishMg.toLocaleString()} mg of sodium.` : "";
      return `- ${m.mealType?.name ?? "Meal"}: ${displayDishName(m.recipe.name)}${kcal}${macros}.${time}${sodium} Ingredients (amounts are per serving): ${ings}.${steps}`;
    });

  // The closing instruction exists because of what Clara said without it: she
  // answered a plan question correctly, then 40 seconds later told the same
  // user "I don't have access to a recipe database or your meal plan details"
  // when asked about a different dish, and told another "I don't have a tool to
  // see what's in your meal plan right now". She had the plan in front of her
  // both times. A wrong denial is worse than a wrong answer — it teaches the
  // user the feature does not work.

  // The day's added salt, computed the same way the app's own rail computes it.
  // Asked how much salt was in a dish, Clara answered "about 1.2 grams of
  // sodium" for a quarter teaspoon (581 mg) and, on another day, totalled the
  // plan at "1.4 teaspoons … well within the recommendation" when her own
  // itemisation came to 0.95 tsp and the rail said 2,210 mg. She was doing
  // arithmetic she should not have to do, and contradicting the screen.
  const sodiumMg = Math.round(menus.reduce((sum, m) => sum + dishSodium(m.recipe.ingredients ?? []), 0));
  const saltLine = sodiumMg > 0
    ? `\nADDED SALT FOR THE DAY: ${sodiumMg.toLocaleString()} mg of sodium, against a 2,300 mg daily guideline` +
      `${sodiumMg > 2300 ? " — that is OVER the guideline, say so plainly" : ""}. Quote this figure, and the per-dish figures above, rather than converting teaspoons yourself — a teaspoon of salt WEIGHS about 6,000 mg but contains about 2,325 mg of sodium, and confusing the two overstates every answer by 2.5x. Never call a number over 2,300 mg "well within" anything.`
    : "";

  const tomorrowLine =
    tomorrow.length > 0
      ? `\n\nTOMORROW'S PLAN (names and calories only — you do NOT have tomorrow's ingredients or steps, so offer to walk through them when the day comes rather than guessing): ` +
        tomorrow
          .sort((a, b) => rank(a.mealType?.name) - rank(b.mealType?.name))
          .map(
            (m) =>
              `${m.mealType?.name ?? "Meal"} ${displayDishName(m.recipe.name)}` +
              `${m.recipe.calories ? ` (~${Math.round(m.recipe.calories)} kcal)` : ""}`
          )
          .join("; ") +
        `. If they ask about any day beyond tomorrow, say plainly that you can see today and tomorrow and point them at the plan screen.`
      : "";

  return (
    `\n\nTODAY'S MEAL PLAN — this IS the user's plan, straight from their account. ` +
    `The amounts, timings and macros below are exactly what the app shows them, so quote them directly; ` +
    `never tell the user you cannot see their plan or that it has no quantities. ` +
    `If they ask about a dish that is NOT in this list, say plainly that it is not in their plan this week and offer to help anyway. ` +
    `They may ask how to cook any of these, or for help mid-cook — walk them through the steps clearly and answer follow-ups:\n${lines.join("\n")}${saltLine}${tomorrowLine}`
  );
}
