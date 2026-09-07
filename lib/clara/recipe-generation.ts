import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import {
  validateFridgeRecipeSnapshot,
  applyAllergenFilter,
  SUGGEST_RECIPES_SCHEMA,
  type FridgeRecipe,
} from "@/lib/fridge";
import type { DietMatchers } from "@/lib/diet-match";

// ── Clara catalog top-up ─────────────────────────────────────────────────────
//
// The meal-plan builder calls this when a meal type's eligible recipe pool is
// thin. Clara PROPOSES dishes; the same deterministic machinery that governs
// DB dishes DISPOSES: parseFridgeRecipes validates shape, applyAllergenFilter
// re-checks every ingredient by word boundary (F-D7 doctrine — the model's own
// fitsPlan is never trusted), and calorie/macro sanity bounds reject junk.
// Survivors are persisted as ordinary public Recipe rows tagged CLARA_RECIPE_TAG,
// so selection, macros, journal, swaps, and logging all work unchanged — and
// every generation permanently grows the shared catalog.
//
// Fail-soft is a hard requirement: any error (no key, 401, 429, timeout,
// malformed output) returns [] and the plan builds from the DB pool alone.

export const CLARA_RECIPE_TAG = "clara";

// Cuisine constants live in the client-safe lib/cuisines module; re-exported
// here so server call sites can keep importing from one place.
export { CUISINES, normalizeCuisine, type Cuisine } from "@/lib/cuisines";

// Structured recipe generation runs on Haiku — cheapest model, and the
// deterministic gates (allergen filter, macro/calorie sanity, builder
// selection) catch any quality slip regardless of model.
const MODEL = "claude-haiku-4-5";
const MAX_DISHES_PER_BUILD = 32; // cost ceiling per generation (covers a full week: 4 slots × 7)
const CAL_MIN = 80;
const CAL_MAX = 1400;

export interface TopUpRequest {
  mealTypeId: string;
  mealTypeName: string;
  count: number;
  targetCalories: number; // per-serving hint for the prompt
}

interface TopUpArgs {
  requests: TopUpRequest[];
  bannedNames: string[]; // prompt-side exclusion (defense: filter re-checks after)
  matchers: DietMatchers; // deterministic post-filter
  existingNames: Set<string>; // lowercased catalog names, for dedupe
  // Target macro split (percentages, e.g. {protein:30,carbs:40,fat:30}) so
  // generated dishes tend to match the patient's macro profile — the builder's
  // pickByMotivation still scores them by macroDeviation on selection.
  macroTarget?: { protein: number; carbs: number; fat: number };
  // Chosen cuisine (real name, not "Surprise me") — every dish is that cuisine
  // and is stamped with the matching Ethnic row.
  cuisine?: string | null;
}

function systemPrompt(args: TopUpArgs, total: number): string {
  const perType = args.requests
    .map((r) => `- ${r.count} × ${r.mealTypeName} (target ≈${Math.round(r.targetCalories)} kcal per serving)`)
    .join("\n");
  const banned =
    args.bannedNames.length > 0
      ? `\nNEVER include these ingredients or anything containing them: ${args.bannedNames.join(", ")}.`
      : "";
  const macro = args.macroTarget
    ? `\n- Aim each dish near this macro split by calories: ~${Math.round(args.macroTarget.protein)}% protein, ~${Math.round(args.macroTarget.carbs)}% carbs, ~${Math.round(args.macroTarget.fat)}% fat.`
    : "";
  const cuisine = args.cuisine
    ? `\n- EVERY dish must be authentic ${args.cuisine} cuisine.`
    : "";
  return [
    `You are Clara, Wondish's nutrition assistant. Generate ${total} realistic, home-cookable ${args.cuisine ? args.cuisine + " " : ""}dishes to expand a meal-plan catalog:`,
    perType,
    `Rules:`,
    `- Everyday dishes with common, individually named ingredients (e.g. "chicken breast", "brown rice", "olive oil") — no compound items, no brand names.`,
    `- Each dish is a COMPLETE MEAL for its slot (protein + carb + veg where sensible), close to the stated per-serving calorie target.`,
    `- usesIngredients lists EVERY ingredient in the dish; leave missingIngredients empty.`,
    `- perServing macros must be realistic and self-consistent (protein/carbs/fat roughly explain the calories).${macro}`,
    `- mealType must be exactly one of: ${args.requests.map((r) => r.mealTypeName).join(", ")}.`,
    args.cuisine ? `- Vary proteins and dishes within ${args.cuisine} cuisine; avoid near-duplicates.` : `- Vary cuisines and proteins; avoid near-duplicates of each other.`,
    cuisine,
    banned,
  ].join("\n");
}

/** Reject dishes with implausible numbers before they reach the catalog. */
export function passesSanity(r: FridgeRecipe): boolean {
  const p = r.perServing;
  if (!p) return false;
  if (!(p.calories >= CAL_MIN && p.calories <= CAL_MAX)) return false;
  if (p.protein < 0 || p.carbs < 0 || p.fat < 0 || (p.fiber ?? 0) < 0) return false;
  // 4/4/9 within a generous ±35% band — catches hallucinated macro rows.
  const derived = p.protein * 4 + p.carbs * 4 + p.fat * 9;
  if (derived > 0 && (derived < p.calories * 0.65 || derived > p.calories * 1.35)) return false;
  if (!r.usesIngredients || r.usesIngredients.length < 2 || r.usesIngredients.length > 25) return false;
  return true;
}

/**
 * Generate, validate, and persist top-up recipes. Returns the created recipe
 * ids ([] on any failure — the builder proceeds with the DB pool alone).
 */
export async function generateAndPersistRecipes(args: TopUpArgs): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const requests = args.requests.filter((r) => r.count > 0);
  if (requests.length === 0) return [];

  const total = Math.min(
    requests.reduce((s, r) => s + r.count, 0),
    MAX_DISHES_PER_BUILD
  );

  let recipes: FridgeRecipe[];
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "disabled" }, // latency: same C6 call style as fridge/dish-checker
      system: systemPrompt(args, total),
      tools: [
        {
          name: "suggest_recipes",
          description: "Return the generated catalog dishes.",
          input_schema: SUGGEST_RECIPES_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" },
      messages: [
        {
          role: "user",
          content: `Generate the ${total} dishes now. Return every ingredient in usesIngredients.`,
        },
      ],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const rawList = (toolUse?.input as { recipes?: unknown } | undefined)?.recipes;
    // Per-item validation (validateFridgeRecipeSnapshot = the fridge module's
    // parseOneRecipe) instead of parseFridgeRecipes, whose cap is 5 — top-ups
    // may validly carry up to MAX_DISHES_PER_BUILD.
    recipes = Array.isArray(rawList)
      ? rawList
          .map((item) => validateFridgeRecipeSnapshot(item))
          .filter((r): r is FridgeRecipe => r !== null)
      : [];
  } catch {
    return []; // fail-soft: AI outage must never break plan generation
  }

  // Deterministic gates — model claims are never trusted.
  const typeByName = new Map(requests.map((r) => [r.mealTypeName.toLowerCase(), r]));
  const seen = new Set(args.existingNames);
  const accepted: { recipe: FridgeRecipe; mealTypeId: string }[] = [];
  for (const r of applyAllergenFilter(recipes, args.matchers)) {
    if (accepted.length >= total) break;
    if (!passesSanity(r)) continue;
    const slot = typeByName.get((r.mealType ?? "").toLowerCase());
    if (!slot) continue;
    const nameKey = r.name.trim().toLowerCase();
    if (!nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    accepted.push({ recipe: r, mealTypeId: slot.mealTypeId });
  }
  if (accepted.length === 0) return [];
  // dishType "complete meal" so the builder's primary-dish step (Step 1) can
  // select these under the full calorie-window + macro + variety rules, not
  // just as fallback filler.
  return persistValidatedRecipes(accepted, [CLARA_RECIPE_TAG], "complete meal", args.cuisine ?? null);
}

/**
 * Persist already-validated generated dishes as public Recipe rows.
 * Shared by the catalog top-up above and the pantry cook-day route.
 * `dishTypeName`, when given, is resolved/created and attached so the dishes
 * are selectable by the builder's dish-type-scoped steps.
 */
export async function persistValidatedRecipes(
  accepted: { recipe: FridgeRecipe; mealTypeId: string }[],
  tags: string[],
  dishTypeName?: string,
  cuisineName?: string | null
): Promise<string[]> {
  let dishTypeId: string | null = null;
  if (dishTypeName) {
    const dt = await prisma.dishType.upsert({
      where: { name: dishTypeName },
      update: {},
      create: { name: dishTypeName },
      select: { id: true },
    });
    dishTypeId = dt.id;
  }
  let ethnicId: string | null = null;
  if (cuisineName) {
    const eth = await prisma.ethnic.upsert({
      where: { name: cuisineName },
      update: {},
      create: { name: cuisineName },
      select: { id: true },
    });
    ethnicId = eth.id;
  }
  // Resolve ingredient names → rows, case-insensitively, creating the missing
  // ones (Ingredient.name is unique; a P2002 race falls back to the winner).
  const allNames = Array.from(
    new Set(accepted.flatMap((a) => a.recipe.usesIngredients.map((n) => n.trim()).filter(Boolean)))
  );
  const idByLower = new Map<string, string>();
  for (const name of allNames) {
    const existing = await prisma.ingredient.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) {
      idByLower.set(name.toLowerCase(), existing.id);
      continue;
    }
    try {
      const created = await prisma.ingredient.create({ data: { name }, select: { id: true } });
      idByLower.set(name.toLowerCase(), created.id);
    } catch {
      const winner = await prisma.ingredient.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (winner) idByLower.set(name.toLowerCase(), winner.id);
    }
  }

  const createdIds: string[] = [];
  for (const { recipe, mealTypeId } of accepted) {
    const ingredientIds = Array.from(
      new Set(
        recipe.usesIngredients
          .map((n) => idByLower.get(n.trim().toLowerCase()))
          .filter((id): id is string => Boolean(id))
      )
    );
    if (ingredientIds.length < 2) continue;
    try {
      const row = await prisma.recipe.create({
        data: {
          name: recipe.name.trim(),
          description: recipe.description ?? null,
          emoji: recipe.emoji ?? null,
          calories: recipe.perServing.calories,
          protein: recipe.perServing.protein,
          carbs: recipe.perServing.carbs,
          fat: recipe.perServing.fat,
          fiber: recipe.perServing.fiber ?? null,
          servings: recipe.servings && recipe.servings > 0 ? Math.round(recipe.servings) : 1,
          isPublic: true,
          tags,
          mealTypeId,
          dishTypeId,
          ethnicId,
          ingredients: { create: ingredientIds.map((ingredientId) => ({ ingredientId })) },
        },
        select: { id: true },
      });
      createdIds.push(row.id);
    } catch {
      // One bad row must not sink the batch.
    }
  }
  return createdIds;
}
