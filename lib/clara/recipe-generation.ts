import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import {
  validateFridgeRecipeSnapshot,
  applyAllergenFilter,
  SUGGEST_RECIPES_SCHEMA,
  type FridgeRecipe,
} from "@/lib/fridge";
import { evaluateDishAgainstProfile, type DietMatchers } from "@/lib/diet-match";
import { findBasketMatch } from "@/lib/basket-match";

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

// Single source of truth is the pure cuisines module; import for internal use
// and re-export so existing importers of these symbols keep working.
import { CLARA_RECIPE_TAG, normalizeCuisine, CUISINES, type Cuisine } from "@/lib/cuisines";
export { CLARA_RECIPE_TAG, normalizeCuisine, CUISINES, type Cuisine };

// Structured recipe generation runs on Haiku — cheapest model, and the
// deterministic gates (allergen filter, macro/calorie sanity, builder
// selection) catch any quality slip regardless of model.
const MODEL = "claude-haiku-4-5";
const MAX_DISHES_PER_BUILD = 32; // cost ceiling per generation (covers a full week: 4 slots × 7)
// One API call per meal type, at most this many dishes each. A dish with its
// 5–10 steps is ~600 output tokens; 8 dishes sit well inside MAX_OUTPUT_TOKENS.
// (A single 21-dish call at 4096 tokens truncated the tool JSON → 0 dishes.)
const MAX_DISHES_PER_CALL = 8;
const MAX_OUTPUT_TOKENS = 8192;
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
  // Basket constraint: when set, every generated dish may use ONLY these
  // ingredient names (plus free staples). Enforced in the prompt AND by a
  // deterministic post-filter (the model's claim is never trusted).
  allowedIngredients?: string[];
}

// Staples the basket clause hands out for free — minus any the profile bans.
// The prompt used to say "(plus salt, pepper, water)" while the ban line said
// "NEVER include salt": the model obeyed the first, the filter enforced the
// second, and a Hypertension profile got 0 of 28 dishes.
const FREE_STAPLES = ["salt", "pepper", "water"] as const;
export function freeStaplesFor(matchers: DietMatchers): string[] {
  return FREE_STAPLES.filter((s) => evaluateDishAgainstProfile([s], matchers).passed);
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
  const free = freeStaplesFor(args.matchers);
  const basket = args.allowedIngredients && args.allowedIngredients.length > 0
    ? `\n- Every dish may use ONLY these ingredients${free.length > 0 ? ` (plus ${free.join(", ")})` : ""}: ${args.allowedIngredients.join(", ")}. Use no other ingredient.`
    : "";
  return [
    `You are Clara, Wondish's nutrition assistant. Generate ${total} realistic, home-cookable ${args.cuisine ? args.cuisine + " " : ""}dishes to expand a meal-plan catalog:`,
    perType,
    `Rules:`,
    `- Everyday dishes with common, individually named ingredients (e.g. "chicken breast", "brown rice", "olive oil") — no compound items, no brand names.`,
    `- Name each dish by what is IN it, like a menu would ("Apple Slices with Olive Oil Drizzle"). Never name a dish by what it lacks — no "X-Free", "No-X" or "-less" in names.`,
    `- prepMinutes and cookMinutes: realistic whole minutes for a home cook (prep = washing/chopping/mixing, cook = time on heat; 0 for no-cook dishes).`,
    `- Each dish is a COMPLETE MEAL for its slot (protein + carb + veg where sensible), close to the stated per-serving calorie target.`,
    `- usesIngredients lists EVERY ingredient in the dish; leave missingIngredients empty.`,
    `- amounts: one entry per usesIngredients item with the PER-SERVING quantity and unit (g, oz, lb, ml, cup, tablespoon, teaspoon, or "" for whole items like eggs). Same spelling as in usesIngredients.`,
    `- steps: provide 5–10 clear, numbered cooking instructions a home cook can follow (prep, cook, assemble, serve). Every dish MUST have real steps.`,
    `- perServing macros must be realistic and self-consistent (protein/carbs/fat roughly explain the calories).${macro}`,
    `- mealType must be exactly one of: ${args.requests.map((r) => r.mealTypeName).join(", ")}.`,
    args.cuisine
      ? `- Vary proteins and dishes within ${args.cuisine} cuisine; avoid near-duplicates.`
      : `- Vary the cuisine across the dishes (e.g. Italian, Mexican, Chinese, Thai, Indian, Japanese, Mediterranean, American, French, Korean, Middle Eastern) and set each dish's "cuisine" field to that cuisine. Avoid near-duplicates.`,
    cuisine,
    basket,
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
export function chunkTopUpRequests(
  requests: TopUpRequest[],
  cap: number = MAX_DISHES_PER_CALL
): TopUpRequest[][] {
  return requests
    .filter((r) => r.count > 0)
    .map((r) => [{ ...r, count: Math.min(r.count, cap) }]);
}

/** One generation call for one chunk; [] on any failure (fail-soft). */
async function generateChunk(args: TopUpArgs, chunk: TopUpRequest[]): Promise<FridgeRecipe[]> {
  const total = chunk.reduce((s, r) => s + r.count, 0);
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: "disabled" }, // latency: same C6 call style as fridge/dish-checker
      system: systemPrompt({ ...args, requests: chunk }, total),
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
    if (msg.stop_reason === "max_tokens") {
      // Truncated tool JSON never parses; make the failure visible in server logs.
      console.warn(`[recipe-generation] ${chunk[0]?.mealTypeName} top-up hit max_tokens (${MAX_OUTPUT_TOKENS}); dropping chunk`);
    }
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const rawList = (toolUse?.input as { recipes?: unknown } | undefined)?.recipes;
    // Per-item validation (validateFridgeRecipeSnapshot = the fridge module's
    // parseOneRecipe) instead of parseFridgeRecipes, whose cap is 5 — top-ups
    // may validly carry up to MAX_DISHES_PER_CALL.
    return Array.isArray(rawList)
      ? rawList
          .map((item) => validateFridgeRecipeSnapshot(item))
          .filter((r): r is FridgeRecipe => r !== null)
      : [];
  } catch (err) {
    // fail-soft: AI outage must never break plan generation — but say why.
    const e = err as { status?: number; message?: string };
    console.warn(`[recipe-generation] ${chunk[0]?.mealTypeName} top-up failed: ${e?.status ?? ""} ${e?.message ?? String(err)}`);
    return [];
  }
}

export async function generateAndPersistRecipes(args: TopUpArgs): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  // One call per meal type, in parallel: keeps each response inside the output
  // budget and the whole top-up inside the route's time limit.
  const chunks = chunkTopUpRequests(args.requests);
  if (chunks.length === 0) return [];
  const requests = chunks.flat();
  const total = Math.min(
    requests.reduce((s, r) => s + r.count, 0),
    MAX_DISHES_PER_BUILD
  );

  const recipes = (await Promise.all(chunks.map((c) => generateChunk(args, c)))).flat();

  // Deterministic gates — model claims are never trusted.
  const typeByName = new Map(requests.map((r) => [r.mealTypeName.toLowerCase(), r]));
  const seen = new Set(args.existingNames);
  // Basket constraint (deterministic): reject any dish using an ingredient not
  // in the allowed basket (staples are free). The prompt asks for it; this
  // enforces it.
  // Tolerant match (lib/basket-match): "chicken breast" ↔ "Boneless chicken
  // breasts". A matched name is rewritten to the basket's catalog name before
  // persisting, so the dish points at the same Ingredient row the pantry,
  // What-to-buy and the allergen groups use — no fragment rows like
  // "olive oil" next to "Extra virgin olive oil".
  const allowed = args.allowedIngredients ?? null;
  const withinBasket = (r: FridgeRecipe): boolean => {
    if (!allowed) return true;
    const canonical: string[] = [];
    const rename = new Map<string, string>();
    for (const n of r.usesIngredients) {
      const m = findBasketMatch(n, allowed);
      if (m === null) return false;
      const target = m === "" ? n.trim() : m;
      rename.set(n.trim().toLowerCase(), target);
      canonical.push(target);
    }
    r.usesIngredients = Array.from(new Set(canonical));
    // Amounts follow the rename so they still match by name at persist time.
    if (r.amounts) r.amounts = r.amounts.map((a) => ({ ...a, name: rename.get(a.name.trim().toLowerCase()) ?? a.name }));
    return true;
  };
  const accepted: { recipe: FridgeRecipe; mealTypeId: string }[] = [];
  const rejected: Record<string, number> = {};
  const reject = (why: string, r: FridgeRecipe) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
    if (process.env.AI_DEBUG) console.warn(`[recipe-generation] rejected (${why}): ${r.name}`);
  };
  const filtered = applyAllergenFilter(recipes, args.matchers);
  rejected.allergen = recipes.length - filtered.length;
  // Which ban terms did the rejecting, so a wipe-out is diagnosable from the
  // log line alone (e.g. {"salt":28} → a condition rule, not an allergy).
  const banTerms: Record<string, number> = {};
  if (rejected.allergen > 0) {
    const kept = new Set(filtered);
    for (const r of recipes) {
      if (kept.has(r)) continue;
      const { violations } = evaluateDishAgainstProfile([r.name, ...r.usesIngredients, ...r.missingIngredients, ...r.steps], args.matchers);
      for (const term of new Set(violations.map((v) => v.term))) banTerms[term] = (banTerms[term] ?? 0) + 1;
      if (process.env.AI_DEBUG) console.warn(`[recipe-generation] rejected (allergen): ${r.name} — ${violations.map((v) => `${v.term}←${v.ingredient}`).slice(0, 3).join(", ")}`);
    }
  }
  for (const r of filtered) {
    if (accepted.length >= total) break;
    if (!withinBasket(r)) { reject("out-of-basket", r); continue; }
    if (!passesSanity(r)) { reject("sanity", r); continue; }
    const slot = typeByName.get((r.mealType ?? "").toLowerCase());
    if (!slot) { reject("meal-type", r); continue; }
    const nameKey = r.name.trim().toLowerCase();
    if (!nameKey || seen.has(nameKey)) { reject("duplicate-name", r); continue; }
    seen.add(nameKey);
    accepted.push({ recipe: r, mealTypeId: slot.mealTypeId });
  }
  console.info(`[recipe-generation] generated=${recipes.length} accepted=${accepted.length} rejected=${JSON.stringify(rejected)}${rejected.allergen > 0 ? ` banTerms=${JSON.stringify(banTerms)}` : ""}`);
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
  // Cuisine per dish: the batch cuisine (a specific request) wins; otherwise
  // each dish carries its own cuisine (mixed generation). Ethnics are upserted
  // once each and cached across the batch.
  const ethnicCache = new Map<string, string>();
  const resolveEthnic = async (raw: string | null | undefined): Promise<string | null> => {
    const name = raw ? normalizeCuisine(raw) : null;
    if (!name) return null;
    const key = name.toLowerCase();
    const cached = ethnicCache.get(key);
    if (cached) return cached;
    const eth = await prisma.ethnic.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });
    ethnicCache.set(key, eth.id);
    return eth.id;
  };
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
    // Batch cuisine wins (a specific request); else the dish's own cuisine.
    const ethnicId = await resolveEthnic(cuisineName ?? recipe.cuisine ?? null);
    try {
      const row = await prisma.recipe.create({
        data: {
          name: recipe.name.trim(),
          description: recipe.description ?? null,
          steps: Array.isArray(recipe.steps) ? recipe.steps.filter((s) => typeof s === "string" && s.trim()) : [],
          emoji: recipe.emoji ?? null,
          calories: recipe.perServing.calories,
          protein: recipe.perServing.protein,
          carbs: recipe.perServing.carbs,
          fat: recipe.perServing.fat,
          fiber: recipe.perServing.fiber ?? null,
          servings: recipe.servings && recipe.servings > 0 ? Math.round(recipe.servings) : 1,
          prepTime: recipe.prepMinutes ?? null,
          cookTime: recipe.cookMinutes ?? null,
          isPublic: true,
          tags,
          mealTypeId,
          dishTypeId,
          ethnicId,
          ingredients: {
            create: ingredientIds.map((ingredientId) => {
              // Per-serving amount by name (usesIngredients and amounts share
              // the basket's canonical spelling after withinBasket).
              const amount = recipe.amounts?.find((a) => idByLower.get(a.name.trim().toLowerCase()) === ingredientId);
              return amount
                ? { ingredientId, quantity: amount.quantity, unit: amount.unit || null }
                : { ingredientId };
            }),
          },
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
