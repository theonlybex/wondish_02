import Anthropic from "@anthropic-ai/sdk";
import { createAnthropic } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  validateFridgeRecipeSnapshot,
  applyAllergenFilter,
  SUGGEST_RECIPES_SCHEMA,
  type FridgeRecipe,
} from "@/lib/fridge";
import { evaluateDishAgainstProfile, type DietMatchers } from "@/lib/diet-match";
import { findBasketMatch, ingredientTokens } from "@/lib/basket-match";
import { priceDish, PRICING_COVERAGE_MIN, type PricedDish } from "@/lib/staple-density";
import {
  dishProblem,
  phrasePromisesMissingFood,
  breakfastIsQuickEnough as quickEnough,
  BREAKFAST_MAX_MINUTES,
  TITLE_NON_FOOD,
  type PlausibleDish,
} from "@/lib/dish-plausibility";

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
// A breakfast people will actually cook on a weekday. Observed 2026-09-24: a
// generated week served braised chicken thighs (15 min prep + 35 min cook) at
// 8am on all seven days, because the prompt only constrained calories and the
// slot name. Rejecting a slow "breakfast" is better than shipping one — an
// empty breakfast pool trips the thin-plan gate, which tells the user to add
// breakfast ingredients, and that is the honest answer to a basket of meat,
// rice and vegetables.
// The value itself lives in lib/dish-plausibility.ts and is re-exported below.

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
  // Food-word vocabulary from the ingredient catalog, used to catch a dish
  // whose NAME promises an ingredient it does not contain. Optional: without
  // it the title gate is skipped (older callers behave exactly as before).
  catalogFoodTokens?: Set<string>;
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
  // The diner's profile as the food map renders it (allergies, diets,
  // conditions + guidance). Until 2026-09-11 generation saw only the flat ban
  // list, so a GERD or IBS profile was cooked for like a healthy one.
  profileContext?: string;
}

// Staples the basket clause hands out for free — minus any the profile bans.
// The prompt used to say "(plus salt, pepper, water)" while the ban line said
// "NEVER include salt": the model obeyed the first, the filter enforced the
// second, and a Hypertension profile got 0 of 28 dishes.
// Widened 2026-09-24 to match what lib/basket-coverage.ts BASKET_STAPLES
// actually accepts. The narrow list was the cause of a P1: the prompt said
// only salt, pepper and water were free, so Clara wrote "heat a light spray of
// cooking oil" into the steps and could not list the oil — 13 of 25 dishes in
// one week told the reader to sear in a dry pan, and the oil was invisible to
// both the shopping list and the macros. The kitchen is assumed to have these,
// and the basket filter already lets a dish use them, so the prompt may as
// well say so. Profile bans still remove any of them (freeStaplesFor).
const FREE_STAPLES = [
  "salt", "pepper", "water",
  "olive oil", "cooking oil", "butter",
  "garlic powder", "onion powder", "paprika", "cumin", "oregano", "thyme", "cinnamon",
] as const;
export function freeStaplesFor(matchers: DietMatchers): string[] {
  return FREE_STAPLES.filter((s) => evaluateDishAgainstProfile([s], matchers).passed);
}

// Protein sources that survive the profile's bans. A restrictive profile
// (Vegan + Kidney: legumes and nuts banned) otherwise gets a week of grains
// and vegetables because the model is told what to avoid, never what is
// left to build a main around (QA 2026-09-11). Only used without a basket —
// with one, the basket is the whole menu.
const PROTEIN_OPTIONS = [
  "chicken breast", "turkey breast", "lean beef", "pork loin", "salmon", "tuna", "cod", "shrimp", "eggs",
  "greek yogurt", "cottage cheese", "tofu", "tempeh", "edamame", "lentils", "chickpeas", "black beans",
  "seitan", "plant-based egg", "meatless chicken", "quinoa", "peanut butter", "almonds",
] as const;
export function proteinOptionsFor(matchers: DietMatchers): string[] {
  return PROTEIN_OPTIONS.filter((p) => evaluateDishAgainstProfile([p], matchers).passed);
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
  const proteinOptions = basket ? [] : proteinOptionsFor(args.matchers);
  const proteins = proteinOptions.length > 0 && args.bannedNames.length > 0
    ? `\n- Protein sources that fit this diner — build every main around one of them: ${proteinOptions.join(", ")}.`
    : "";
  return [
    `You are Clara, Wondish's nutrition assistant. Generate ${total} realistic, home-cookable ${args.cuisine ? args.cuisine + " " : ""}dishes to expand a meal-plan catalog:`,
    perType,
    `Rules:`,
    `- Everyday dishes with common, individually named ingredients (e.g. "chicken breast", "brown rice", "olive oil") — no compound items, no brand names.`,
    `- Name each dish by what is IN it, like a menu would ("Apple Slices with Olive Oil Drizzle"). Never name a dish by what it lacks — no "X-Free", "No-X" or "-less" in names.`,
    `- prepMinutes and cookMinutes: realistic whole minutes for a home cook (prep = washing/chopping/mixing, cook = time on heat; 0 for no-cook dishes).`,
    `- Each dish is a COMPLETE MEAL for its slot (protein + carb + veg where sensible), close to the stated per-serving calorie target.`,
    `- Match the dish to the TIME OF DAY, not just the calorie target. A Breakfast must be something people actually eat in the morning and must be quick — under ${BREAKFAST_MAX_MINUTES} minutes prep+cook in total. Eggs, oats, toast, yoghurt, fruit, a quick scramble or hash are breakfasts. Braised or roasted meat, curries, stews and rice bowls are NOT breakfasts, however well they hit the calorie target. If the available ingredients cannot make a real breakfast, return fewer Breakfast dishes rather than serving a dinner at 8am.`,
    `- usesIngredients lists EVERY ingredient in the dish; leave missingIngredients empty.`,
    `- amounts: one entry per usesIngredients item with the PER-SERVING quantity and unit (g, oz, lb, ml, cup, tablespoon, teaspoon, or "" for whole items like eggs). Same spelling as in usesIngredients.`,
    `- steps: provide 5–10 clear, numbered cooking instructions a home cook can follow (prep, cook, assemble, serve). Every dish MUST have real steps.`,
    `- perServing macros must be realistic and self-consistent: protein*4 + carbs*4 + fat*9 must come within 5% of the calories you state. The calories are recomputed from your macros, so wrong macros change the dish.${macro}`,
    // These three rules exist because they are what the deterministic gates
    // reject for. Stating them recovered acceptance from 3-of-24 to well over
    // half: a rejected dish costs a whole generation slot and thins the pool,
    // which is how a week ends up serving one dish seven times.
    `- The DESCRIPTION may only mention food that is in usesIngredients. Do not describe bread as "whole grain" unless the listed bread is whole grain, and do not mention a herb, citrus or sauce you did not list.`,
    `- If any step sears, fries, sautés or browns something, the fat used MUST be in usesIngredients with its amount. A dry pan is not a recipe.`,
    `- Salt must never exceed 1 teaspoon per serving, and under half a teaspoon for anything below 450 kcal.`,
    // Grains in cups are unreadable: three quarters of a cup of rice is ~139 g
    // dry and ~145 g COOKED, a threefold difference in carbohydrate, and one
    // QA week understated itself by ~750 kcal/day because the amounts and the
    // macros had been written on different readings. Grams, dry, always.
    `- State grains, pasta and pulses in GRAMS of DRY weight (never cups), and count their full dry carbohydrate — about 75 g per 100 g of rice, pasta or flour. One person's portion of dry rice is 45-80 g; 150 g is two servings.`,
    `- No single step may take longer than prepMinutes + cookMinutes. If the rice needs 45 minutes, the dish takes at least 45 minutes.`,
    `- Name the dish by the method you actually use. Do not call it "Grilled" if the steps sear it in a skillet, or "Roasted" if nothing goes in an oven — and never let the description contradict the title.`,
    `- A dish named after a preparation must contain what that preparation needs: a bolognese has tomato, a curry has spices, a scramble has egg, a pesto has basil.`,
    `- A Snack is a small, quick thing eaten between meals: fruit, yoghurt, nuts, toast, a boiled egg, raw vegetables and a dip. Under 15 minutes in total and no plated rice-and-protein dinners.`,
    `- Every dish needs a DISTINCT name — no two dishes in this batch may share a name.`,
    `- mealType must be exactly one of: ${args.requests.map((r) => r.mealTypeName).join(", ")}.`,
    args.cuisine
      ? `- Vary proteins and dishes within ${args.cuisine} cuisine; avoid near-duplicates.`
      : `- Vary the cuisine across the dishes (e.g. Italian, Mexican, Chinese, Thai, Indian, Japanese, Mediterranean, American, French, Korean, Middle Eastern) and set each dish's "cuisine" field to that cuisine. Avoid near-duplicates.`,
    cuisine,
    basket,
    proteins,
    banned,
    args.profileContext ? `\nThe diner's profile (respect every line, especially condition guidance):\n${args.profileContext}` : "",
  ].join("\n");
}

/**
 * Basket gate, shared by generation and the Clara swap: every ingredient must
 * resolve to a basket entry or a free staple (lib/basket-match). Matched
 * names are rewritten IN PLACE to the basket's catalog spelling (amounts
 * follow), so the persisted dish points at the pantry's Ingredient rows.
 */
export function fitBasket(r: FridgeRecipe, allowed: readonly string[]): boolean {
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
  if (r.amounts) r.amounts = r.amounts.map((a) => ({ ...a, name: rename.get(a.name.trim().toLowerCase()) ?? a.name }));
  return true;
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

  // Salt per serving. Observed 2026-09-24: a generated breakfast carried
  // "Salt 1.5 teaspoon" — about 9 g of salt, ~3.5 g sodium, more than a whole
  // day's recommended intake in ONE meal, in a product used by people managing
  // blood pressure. Nothing flagged it. 1 teaspoon (~2.3 g sodium) is already
  // generous for a single plate, so anything above that is a hallucinated
  // quantity rather than a recipe.
  const saltAmount = r.amounts?.find((a) => /\bsalt\b/i.test(a.name));
  if (saltAmount && /teaspoon|tsp/i.test(saltAmount.unit) && saltAmount.quantity > 1) return false;
  if (saltAmount && /tablespoon|tbsp/i.test(saltAmount.unit) && saltAmount.quantity >= 1) return false;

  return true;
}

/** How far a dish's stated calories may sit from its own macro rows. */
export const CALORIE_MACRO_TOLERANCE = 0.05;

/**
 * Make a dish's calorie count agree with its own macro rows.
 *
 * The ±35% band above exists to catch hallucinated macros; it is far too wide
 * to be a promise to the user. Measured over two QA weeks on 2026-09-24: 26 of
 * 48 dishes overstated their calories against protein×4 + carbs×4 + fat×9, by
 * up to +20.5%, and the error was positive in every single case — never once a
 * deflation. A dish claiming 805 kcal yields about 668. Someone eating to a
 * deficit is short ~120 kcal per lunch against the number the app shows them,
 * which is the opposite of the tool's purpose.
 *
 * Tightening the gate would only have thrown those dishes away. The numbers
 * are not independent facts: calories ARE the macros, so the stated figure is
 * derived rather than trusted, and the card, the ring and the weekly total
 * can no longer disagree with the ingredient rows underneath them.
 *
 * Fibre makes 4/4/9 approximate (it sits inside carbs at ~2 kcal/g), which is
 * why a 5% band is kept rather than rewriting every value.
 */
/**
 * The dish's nutrition, computed from its own amounts when they can be priced.
 *
 * Returns null when the ingredients are not fully known, in which case the
 * model's own figures stand (and dishProblem's floor still checks them).
 */
export function pricedMacros(r: FridgeRecipe, mealTypeName = ""): PricedDish | null {
  const dish = toPlausibleDish(r, mealTypeName);
  const priced = priceDish(dish.ingredients, r.steps ?? null);
  if (!priced || priced.coverage < PRICING_COVERAGE_MIN) return null;
  // A priced dish still has to be a plausible plate; if the arithmetic lands
  // outside the calorie window the amounts are wrong, not the maths, and the
  // sanity gate should see the model's own number instead.
  if (priced.calories < CAL_MIN || priced.calories > CAL_MAX) return null;
  return priced;
}

export function reconcileCalories(r: FridgeRecipe): number | null {
  const p = r.perServing;
  if (!p) return null;
  const derived = p.protein * 4 + p.carbs * 4 + p.fat * 9;
  if (derived <= 0) return null;
  if (Math.abs(derived - p.calories) <= p.calories * CALORIE_MACRO_TOLERANCE) return null;
  const reconciled = Math.round(derived);
  // Never reconcile a dish out of the plausible calorie window — if the macros
  // imply 40 kcal for a dinner, the dish itself is wrong, not just its total.
  if (reconciled < CAL_MIN || reconciled > CAL_MAX) return null;
  return reconciled;
}

/**
 * Does the dish NAME promise food the dish does not contain?
 *
 * Clara names dishes after what she meant to cook, not what she listed:
 * observed 2026-09-24 in a real week — "…with Brown Rice" built on jasmine
 * rice, "…with Almond Butter" containing none, "Grilled Salmon with Broccoli
 * and Lemon" with no lemon, "Oatmeal with Sliced Carrots and Cinnamon" with no
 * cinnamon. A tester shopping from those names buys food the recipe never
 * uses, which is worse than a plain name.
 *
 * The check is vocabulary-driven rather than word-listed: a title token only
 * has to be satisfied when the ingredient CATALOG knows it as food. So
 * "Oatmeal", "Taco Bowl", "Hash" and "Skillet" are ignored (not ingredients),
 * while "lemon", "cinnamon" and "brown" (from brown rice) must appear in the
 * dish. Staples count as satisfied — the kitchen is assumed to have them — so
 * "…and Herbs" passes; that is a deliberate looseness, since the alternative
 * rejects good dishes over a seasoning.
 */
// The gates live in lib/dish-plausibility.ts now, because running them only
// here was the bug: dishes admitted before a gate existed stayed in the pool
// and the builder selected them anyway. That module is the single definition;
// this file adapts a generated recipe to its shape and adds the two checks
// that only make sense while the model is still in the loop (see below).
//
// Re-exported so existing callers and tests keep one import site.
export { BREAKFAST_MAX_MINUTES, TITLE_NON_FOOD, phrasePromisesMissingFood };

/** A generated recipe in the shape the shared predicate understands. */
export function toPlausibleDish(r: FridgeRecipe, mealTypeName: string): PlausibleDish {
  const byName = new Map((r.amounts ?? []).map((a) => [a.name.trim().toLowerCase(), a]));
  return {
    name: r.name,
    description: r.description ?? null,
    steps: r.steps ?? null,
    macros: r.perServing ? { carbs: r.perServing.carbs, fat: r.perServing.fat } : null,
    calories: r.perServing?.calories ?? null,
    mealTypeName,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    generated: true,
    ingredients: r.usesIngredients.map((n) => {
      const a = byName.get(n.trim().toLowerCase());
      return { name: n, quantity: a?.quantity ?? null, unit: a?.unit ?? null };
    }),
  };
}

export function titlePromisesMissingFood(r: FridgeRecipe, catalogFoodTokens: Set<string>): string | null {
  return phrasePromisesMissingFood(r.name, r.usesIngredients, catalogFoodTokens);
}

export function breakfastIsQuickEnough(r: FridgeRecipe, mealTypeName: string): boolean {
  return quickEnough({
    name: r.name,
    mealTypeName,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    ingredients: [],
  });
}

/**
 * Does the DESCRIPTION promise food the dish does not contain?
 *
 * Generation-only, and the reason is asymmetry: a lying sentence can be fixed
 * by asking the model again, which costs one retry. At selection there is
 * nothing to ask, and refusing a stored dish over its prose would thin the
 * pool for a lesser sin than a lying title.
 *
 * Observed 2026-09-24, after the title gate shipped: "Poached Salmon with
 * Zucchini and Toast" — title clean — described as made with "toasted
 * whole-grain bread" when the ingredient is plain sliced bread. Cleaning the
 * title alone just moved the claim one line down the card.
 */
export function descriptionPromisesMissingFood(r: FridgeRecipe, catalogFoodTokens: Set<string>): string | null {
  if (!r.description) return null;
  return phrasePromisesMissingFood(r.description, r.usesIngredients, catalogFoodTokens);
}

/**
 * Do the steps cook in a fat the dish never lists?
 *
 * 13 of 25 dishes in one QA week said to sear, sauté or brown something and
 * listed no oil or butter. The kitchen is assumed to have oil (it is a staple),
 * but the dish still has to SAY so: the amount feeds the macros, and a reader
 * following the steps has no idea whether a teaspoon or a tablespoon was
 * costed into the 800 kcal on the card.
 */
const FAT_METHOD = /\b(sear|seared|searing|saut[ée]|saut[ée]ed|fry|fried|frying|pan-?fry|brown the|stir-?fry|grease|coat the pan)\b/i;
export function cooksWithUnlistedFat(r: FridgeRecipe): boolean {
  if (!r.steps?.some((s) => FAT_METHOD.test(s))) return false;
  return !r.usesIngredients.some((n) => /\b(oil|butter|ghee|margarine|cooking spray|lard|tallow)\b/i.test(n));
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
    const anthropic = createAnthropic();
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
  const withinBasket = (r: FridgeRecipe): boolean => (allowed ? fitBasket(r, allowed) : true);
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

    // The same predicate the builder applies at selection — salt, seasoning
    // quantities, slot timing, and the title's promise.
    //
    // Judged against the macros that will actually be STORED. Without this the
    // gate rejected a dish for a macro/amount contradiction it was about to
    // fix by pricing: acceptance fell to 1 of 29 generated dishes, which
    // starved the pool far worse than the defect being caught.
    const candidate = toPlausibleDish(r, slot.mealTypeName);
    const priced = pricedMacros(r);
    if (priced) {
      candidate.macros = { carbs: priced.carbs, fat: priced.fat };
      candidate.calories = priced.calories;
    }
    const problem = dishProblem(candidate, args.catalogFoodTokens ?? new Set());
    if (problem) { reject(problem, r); continue; }

    // Generation-only, because Clara is in the loop and can be asked again.
    if (cooksWithUnlistedFat(r)) { reject("cooks-without-listing-fat", r); continue; }
    // EVERY ingredient needs an amount here, not just one. dishProblem only
    // refuses a stored dish when no row has a quantity at all; at generation
    // the standard is the whole list, because a half-measured dish becomes a
    // grocery list that silently under-counts.
    const plausible = toPlausibleDish(r, slot.mealTypeName);
    if (plausible.ingredients.some((i) => i.quantity == null)) { reject("missing-amounts", r); continue; }
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
          // Priced from the dish's own amounts where possible (pricedMacros),
          // else the model's macros with calories reconciled to them
          // (reconcileCalories). The write point is the only place either
          // needs to happen, so a dish cannot be stored disagreeing with
          // itself or with its ingredients.
          ...(() => {
            const priced = pricedMacros(recipe); // slot-independent arithmetic
            if (priced) {
              return { calories: priced.calories, protein: priced.protein, carbs: priced.carbs, fat: priced.fat };
            }
            return {
              calories: reconcileCalories(recipe) ?? recipe.perServing.calories,
              protein: recipe.perServing.protein,
              carbs: recipe.perServing.carbs,
              fat: recipe.perServing.fat,
            };
          })(),
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
