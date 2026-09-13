import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  derivePatientBans,
  buildDietMatchers,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import {
  validateFridgeRecipeSnapshot,
  applyAllergenFilter,
  SUGGEST_RECIPES_SCHEMA,
  type FridgeRecipe,
} from "@/lib/fridge";
import {
  passesSanity,
  persistValidatedRecipes,
  normalizeCuisine,
  CLARA_RECIPE_TAG,
} from "@/lib/clara/recipe-generation";
import {
  resolveMacroProfile,
  getMacroPercentages,
} from "@/lib/caloric-engine";
import { guardAiSpend } from "@/lib/ai-budget";
import { buildFoodMapText } from "@/lib/food-map";
import { fitBasket, freeStaplesFor } from "@/lib/clara/recipe-generation";

// POST /api/meal-plan/[menuId]/clara-swap — the user asks Clara for something
// else in this slot ("what would you like instead?") and Clara generates a
// single replacement dish that fits: same meal type, ~same calories, the
// patient's macro profile and diet bans, plus the user's free-text request and
// optional cuisine. Deterministic gates (allergen filter + macro/calorie
// sanity) run after generation, then it replaces the menu row.
//
// AI-billed (Haiku) → guarded by the per-user daily swap quota + global ceiling.

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Clara is not configured in this environment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { request: rawRequest, cuisine: rawCuisine } = (body ?? {}) as {
    request?: unknown;
    cuisine?: unknown;
  };
  const request = typeof rawRequest === "string" ? rawRequest.trim().slice(0, 300) : "";
  const cuisine = normalizeCuisine(rawCuisine);

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id, planVersion: patient.activePlanVersion },
    include: { recipe: { select: { calories: true } }, mealType: true },
  });
  if (!menu || !menu.mealTypeId || !menu.mealType) {
    return NextResponse.json({ error: "Menu not found" }, { status: 404 });
  }

  // AI spend guard (charge-before-model): per-user daily swap quota + global
  // ceiling. A rejected request costs zero tokens.
  const guard = await guardAiSpend(userId, "swap");
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const targetCalories = menu.recipe.calories && menu.recipe.calories > 0
    ? Math.round(menu.recipe.calories)
    : 500;
  const mealTypeName = menu.mealType.name;

  // Same macro target + bans the plan builder uses.
  const macroProfile = resolveMacroProfile(
    patient.healthConditions.map((hc) => hc.condition.name),
    patient.motivations.map((pm) => pm.motivation.name)
  );
  const macro = getMacroPercentages(macroProfile);
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const bannedNames = [...allergyNames, ...exactBanned.map((b) => b.name)];

  // Basket constraint, same as week generation: a swapped dish must be
  // cookable from what the user owns (plus free staples). Before 2026-09-11
  // swaps ignored the basket and brought in lemon, tahini etc.
  const pantry = await prisma.patientPantryItem.findMany({ where: { patientId: patient.id }, select: { ingredient: { select: { name: true } } } });
  const basket = pantry.map((p) => p.ingredient.name);
  const freeStaples = freeStaplesFor(matchers);
  const basketLine = basket.length > 0
    ? `- Every dish may use ONLY these ingredients${freeStaples.length ? ` (plus ${freeStaples.join(", ")})` : ""}: ${basket.join(", ")}. Use no other ingredient — if the request needs one you don't have, make the closest dish from this list.`
    : ``;

  const system = [
    `You are Clara, Wondish's nutrition assistant. Generate ONE ${cuisine ? cuisine + " " : ""}${mealTypeName.toLowerCase()} dish to replace one the user didn't want.`,
    `Rules:`,
    `- mealType must be exactly "${mealTypeName}".`,
    `- Target ≈${targetCalories} kcal per serving (within ±20%).`,
    `- Aim near this macro split by calories: ~${Math.round(macro.protein)}% protein, ~${Math.round(macro.carbs)}% carbs, ~${Math.round(macro.fat)}% fat.`,
    `- Everyday home-cookable dish; usesIngredients lists EVERY ingredient (common, individually named); leave missingIngredients empty.`,
    `- perServing macros must be realistic and self-consistent.`,
    cuisine ? `- The dish must be authentic ${cuisine} cuisine.` : ``,
    request ? `- Honour the user's request: "${request}".` : `- Pick something appealing and different.`,
    basketLine,
    bannedNames.length > 0 ? `- NEVER include these ingredients or anything containing them: ${bannedNames.join(", ")}.` : ``,
    // Conditions without ingredient bans (GERD, IBS, PCOS…) only reach the
    // model through this profile text — see the 2026-09-11 condition audit.
    `\nThe diner's profile (respect every line, especially condition guidance):\n${buildFoodMapText(patient)}`,
  ].join("\n");

  let candidate: FridgeRecipe | null = null;
  try {
    const anthropic = createAnthropic();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1536,
      thinking: { type: "disabled" },
      system,
      tools: [
        {
          name: "suggest_recipes",
          description: "Return exactly one replacement dish.",
          input_schema: SUGGEST_RECIPES_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" },
      messages: [{ role: "user", content: request || "Give me a different dish for this slot." }],
    });
    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const rawList = (toolUse?.input as { recipes?: unknown } | undefined)?.recipes;
    const parsed = Array.isArray(rawList)
      ? rawList.map((item) => validateFridgeRecipeSnapshot(item)).filter((r): r is FridgeRecipe => r !== null)
      : [];
    // Deterministic gates: diet-safe + within the basket (names rewritten to
    // the pantry's catalog spelling) + sane numbers. The model's claim is
    // never trusted.
    candidate = applyAllergenFilter(parsed, matchers).find((r) => (basket.length === 0 || fitBasket(r, basket)) && passesSanity(r)) ?? null;
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json({ error: "Clara couldn't swap that — try again." }, { status: 502 });
  }

  if (!candidate) {
    return NextResponse.json(
      {
        error: basket.length > 0
          ? "Clara couldn't make that from your ingredients — add what you need under Ingredients, or try a different request."
          : "Clara couldn't find a safe alternative — try rewording your request.",
      },
      { status: 422 }
    );
  }

  // Persist under the slot's meal type (so it reads as that slot) + cuisine.
  const [createdId] = await persistValidatedRecipes(
    [{ recipe: candidate, mealTypeId: menu.mealTypeId }],
    [CLARA_RECIPE_TAG, "clara-swap"],
    "complete meal",
    cuisine
  );
  if (!createdId) {
    return NextResponse.json({ error: "Clara couldn't save that dish — try again." }, { status: 502 });
  }

  await prisma.menu.update({ where: { id: params.menuId }, data: { recipeId: createdId } });

  // Return the new recipe in the shape the client's onSwapped expects.
  const recipe = await prisma.recipe.findUnique({
    where: { id: createdId },
    include: {
      mealType: true,
      dishType: true,
      ethnic: true,
      ingredients: { include: { ingredient: true } },
    },
  });
  return NextResponse.json({ recipe });
}
