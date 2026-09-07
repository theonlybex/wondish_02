import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
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
import { guardAiSpend } from "@/lib/ai-budget";
import {
  computeAllMetrics,
  computeMealCalories,
  resolveSex,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";

// POST /api/pantry/cook-day — Clara builds ONE full day of meals (breakfast /
// lunch / dinner / snack) from the patient's pantry, sized to their personal
// daily calorie target from the caloric engine. Limited to ~once per day
// (charge-before-model, one retry headroom) — this is the "AI helps once a
// day" surface, not an unlimited generator.
//
// Same doctrine as every AI surface here: Clara proposes, the deterministic
// machinery disposes — word-boundary allergen filter, macro sanity bounds,
// and a pantry-coverage check (≤1 missing ingredient per dish; staples free).
// Survivors persist as ordinary public Recipe rows, so they immediately count
// as "cookable now" and are loggable like any dish.

export const maxDuration = 60;

const STAPLES = new Set(["salt", "pepper", "water", "black pepper"]);

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Clara is not configured in this environment." },
      { status: 503 }
    );
  }

  // Cuisine must be chosen before any generation. A body without a cuisine key
  // at all is rejected; an explicit "Surprise me" resolves to null (no
  // constraint) and is allowed.
  let cuisineRaw: unknown;
  try {
    const body = await req.json();
    cuisineRaw = (body as { cuisine?: unknown })?.cuisine;
  } catch {
    cuisineRaw = undefined;
  }
  if (cuisineRaw == null || cuisineRaw === "") {
    return NextResponse.json({ error: "Pick a cuisine first." }, { status: 422 });
  }
  const cuisine = normalizeCuisine(cuisineRaw);

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: { ...PATIENT_DIET_INCLUDE, physicalActivity: true, gender: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const pantry = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredientId: true, ingredient: { select: { name: true } } },
  });
  if (pantry.length < 3) {
    return NextResponse.json(
      { error: "Add at least 3 ingredients so Clara has something to cook with." },
      { status: 422 }
    );
  }

  // Anthropic spend guard (charge-before-model): per-user daily quota + global
  // daily ceiling.
  const guard = await guardAiSpend(userId, "cookDay");
  if (!guard.ok) {
    return NextResponse.json(
      {
        error:
          guard.status === 429 && guard.error.startsWith("You've")
            ? "Clara already cooked your day today — update your fridge and come back tomorrow."
            : guard.error,
      },
      { status: guard.status }
    );
  }

  // ── Daily calorie target from the same engine the meal plan uses ───────────
  let dailyCalories = 2000;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth, patient.gender?.name);
    if (sex) {
      const input: CaloricProfileInput = {
        sex,
        birthday: new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit: patient.heightUnit === "in" ? "in" : "cm",
        cbwValue: patient.weight,
        cbwUnit: (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue: patient.goalWeight,
        utbwUnit: (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      dailyCalories = Math.round(computeAllMetrics(input).dailyCalories);
    }
  }
  const mealCals = computeMealCalories(dailyCalories);

  const mealTypes = await prisma.mealType.findMany();
  const order = ["breakfast", "lunch", "dinner", "snack"];
  const slots = mealTypes
    .filter((mt) => order.includes(mt.name.toLowerCase()))
    .sort((a, b) => order.indexOf(a.name.toLowerCase()) - order.indexOf(b.name.toLowerCase()));
  if (slots.length === 0) {
    return NextResponse.json({ error: "No meal types configured." }, { status: 500 });
  }

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const bannedNames = [...allergyNames, ...exactBanned.map((b) => b.name)];
  const onHandNames = pantry.map((p) => p.ingredient.name);
  const onHandLower = new Set(onHandNames.map((n) => n.toLowerCase()));

  const system = [
    `You are Clara, Wondish's nutrition assistant. Build ONE full day of home-cooked meals from ONLY what the user has at home.`,
    `On hand: ${onHandNames.join(", ")}.`,
    `Free staples you may also use: salt, pepper, water.`,
    `Generate exactly one dish per meal type:`,
    ...slots.map(
      (s) => `- ${s.name}: target ≈${Math.round(mealCals[s.name.toLowerCase()] ?? dailyCalories / slots.length)} kcal per serving`
    ),
    `The four dishes together must land within ±10% of ${dailyCalories} kcal total.`,
    `Rules:`,
    `- usesIngredients may ONLY contain items from the on-hand list (plus the free staples), named exactly as given.`,
    `- List EVERY ingredient in usesIngredients; leave missingIngredients empty.`,
    `- perServing macros must be realistic and self-consistent (protein/carbs/fat roughly explain the calories).`,
    `- mealType must be exactly one of: ${slots.map((s) => s.name).join(", ")}.`,
    cuisine ? `- EVERY dish must be authentic ${cuisine} cuisine (using only the on-hand ingredients).` : ``,
    bannedNames.length > 0
      ? `- NEVER include these ingredients or anything containing them: ${bannedNames.join(", ")}.`
      : ``,
  ].join("\n");

  let recipes: FridgeRecipe[];
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      system,
      tools: [
        {
          name: "suggest_recipes",
          description: "Return one dish per requested meal type for the day.",
          input_schema: SUGGEST_RECIPES_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" },
      messages: [{ role: "user", content: `Cook my whole day from my fridge now.` }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const rawList = (toolUse?.input as { recipes?: unknown } | undefined)?.recipes;
    recipes = Array.isArray(rawList)
      ? rawList
          .map((item) => validateFridgeRecipeSnapshot(item))
          .filter((r): r is FridgeRecipe => r !== null)
      : [];
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status === 429) {
      return NextResponse.json({ error: "Clara is busy — try again in a moment." }, { status: 429 });
    }
    return NextResponse.json(
      { error: "Clara couldn't cook right now. Nothing was used up — try again." },
      { status: 502 }
    );
  }

  // ── Deterministic gates ────────────────────────────────────────────────────
  const slotByName = new Map(slots.map((s) => [s.name.toLowerCase(), s]));
  const filled = new Map<string, { recipe: FridgeRecipe; mealTypeId: string }>();
  for (const r of applyAllergenFilter(recipes, matchers)) {
    if (!passesSanity(r)) continue;
    const slot = slotByName.get((r.mealType ?? "").toLowerCase());
    if (!slot || filled.has(slot.id)) continue;
    // Pantry coverage: every ingredient on hand (staples free); allow at most
    // one miss so a near-perfect day isn't discarded — the miss is surfaced.
    const missing = r.usesIngredients.filter(
      (n) => !onHandLower.has(n.trim().toLowerCase()) && !STAPLES.has(n.trim().toLowerCase())
    );
    if (missing.length > 1) continue;
    filled.set(slot.id, { recipe: r, mealTypeId: slot.id });
  }

  if (filled.size === 0) {
    return NextResponse.json(
      { error: "Clara couldn't build a safe day from these ingredients — add a few more and retry." },
      { status: 422 }
    );
  }

  const accepted = Array.from(filled.values());
  const createdIds = await persistValidatedRecipes(accepted, [CLARA_RECIPE_TAG, "pantry-day"], undefined, cuisine);
  const createdRows = await prisma.recipe.findMany({
    where: { id: { in: createdIds } },
    select: {
      id: true, name: true, emoji: true, description: true, calories: true,
      protein: true, carbs: true, fat: true,
      mealType: { select: { name: true } },
      ingredients: { select: { ingredient: { select: { name: true } } } },
    },
  });
  const bySlotOrder = createdRows.sort(
    (a, b) =>
      order.indexOf((a.mealType?.name ?? "").toLowerCase()) -
      order.indexOf((b.mealType?.name ?? "").toLowerCase())
  );
  const totalCalories = Math.round(
    bySlotOrder.reduce((s, r) => s + (r.calories ?? 0), 0)
  );

  return NextResponse.json({
    meals: bySlotOrder.map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      description: r.description,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      mealType: r.mealType?.name ?? null,
      ingredients: r.ingredients.map((ri) => ri.ingredient.name),
    })),
    totalCalories,
    targetCalories: dailyCalories,
    slotsFilled: filled.size,
    slotsRequested: slots.length,
  });
}
