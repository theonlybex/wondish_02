// Dish skill (Clara-first slice 1): suggest one dish from what the person has
// eaten this week, or plan today's dishes. Both tools are READS: they generate
// and show, and never log or save anything.
//
// Clara proposes, the existing machinery disposes: the generator is the fridge
// generator's schema and parser, every candidate goes through the allergen
// filter and the same gates a generated plan dish passes (see
// gateGeneratedDishes), and a dish that fails is dropped — never returned with
// a warning. The per-serving numbers come from the dish's own amounts
// (pricedMacros), the same pricing the generator stores.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { createAnthropic } from "@/lib/anthropic";
import { CLARA_MODEL } from "@/lib/clara/anthropic-client";
import { loadIngredientGroups } from "@/lib/ingredient-catalog-db";
import { specifyCookingOil, oilAllowedBy } from "@/lib/clara/oil";
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText } from "@/lib/food-map";
import { derivePatientBans, buildDietMatchers, bannedNamesForPrompt, type DietMatchers } from "@/lib/diet-match";
import { dailySodiumLimitMg } from "@/lib/sodium-limit";
import { loadLevelSummary } from "@/lib/level-summary";
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import { applyAllergenFilter, parseFridgeRecipes, SUGGEST_RECIPES_SCHEMA, type FridgeRecipe } from "@/lib/fridge";
import { MAX_SERVINGS } from "@/lib/meal-log";
import {
  passesSanity,
  pricedMacros,
  reconcileCalories,
  repairProse,
  cooksWithUnlistedFat,
  toPlausibleDish,
  saltRuleLine,
  proteinOptionsFor,
  unitIsUsable,
} from "@/lib/clara/recipe-generation";
import {
  dishProblem,
  catalogFoodVocabulary,
  stepRinsesRawProtein,
  withoutRawProteinRinse,
  nameFromCookedForm,
  clampAddedSalt,
  clampCookingFat,
  repairAmount,
  saltRowTsp,
  readableProse,
  readableDescription,
  longestStepMinutes,
  statedOrImpliedMinutes,
  BREAKFAST_MAX_MINUTES,
  SNACK_MAX_MINUTES,
} from "@/lib/dish-plausibility";
import { priceDish, gramsOf } from "@/lib/staple-density";
import type { LevelKey, LevelSummary } from "@/lib/levels";
import { dishReasons, FIBRE_RICH_EXAMPLES, SODIUM_REASON_MAX_MG } from "@/lib/dish-reasons";
import type { ClaraPart, ClaraRecipe } from "../parts";
import type { ClaraContext, Skill, ToolResult } from "../types";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type DishMealType = (typeof MEAL_TYPES)[number];
export const OCCASIONS = ["normal", "eating_out", "guests", "little_time"] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** The answer boxes for "Anything happening today?", in OCCASIONS order. */
export const OCCASION_OPTIONS = ["A normal day", "Eating out", "Guests or a party at home", "Very little time"] as const;

/** The meals dish_plan_today plans. Snacks are suggested on request only. */
const PLANNED_MEALS: DishMealType[] = ["breakfast", "lunch", "dinner"];
const LITTLE_TIME_MINUTES = 20;
const GUEST_SERVINGS = 6;
const MAX_MINUTES = 600;

export const NOTHING_LOGGED_NOTE =
  "Nothing is logged yet this week, so this isn't based on what they've eaten. Say so plainly, and that logging meals lets you tailor the next one.";
export const COULDNT_FIT_NOTE =
  "I couldn't make one that fits right now. Tell them plainly and offer to try again; do not describe a dish.";
export const EATING_OUT_NOTE =
  "Dinner is out tonight, so it is not planned. Ask them to send the menu (a photo or the dish names) and you will help pick what fits.";
export const ALL_LOGGED_NOTE = "Every meal today is already logged, so there is nothing left to plan.";
const SUGGEST_SHOWN_NOTE =
  "The dish card and its steps are already shown under your message: name the dish and the reasons in a sentence or two, do not list the recipe.";
const PLAN_SHOWN_NOTE =
  "A card for each dish is already shown under your message: name each dish and its reasons briefly, do not list recipes. The steps are not shown yet; they come when the person picks a dish to cook.";

/** What the generator is asked for. `summary` lets it lean into this week's levels. */
export interface DishAsk {
  mealType: DishMealType;
  maxMinutes?: number;
  servings?: number;
  summary: LevelSummary;
  /** Set only while there are not enough logs: levels from the onboarding answers. */
  picture?: StartingPicture;
}

/** The onboarding "starting picture": levels they probably get little of / a lot of. */
export interface StartingPicture {
  little: FullLevelKey[];
  aLot: FullLevelKey[];
}

/** Absent, malformed or empty stored JSON is "no picture". Only known level keys are kept. */
export function parseStartingPicture(raw: unknown): StartingPicture | null {
  if (!raw || typeof raw !== "object") return null;
  const known = new Set<string>(LEVELS.map((l) => l.key));
  const keys = (v: unknown): FullLevelKey[] =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is FullLevelKey => typeof k === "string" && known.has(k)))] : [];
  const o = raw as Record<string, unknown>;
  const pic = { little: keys(o.little), aLot: keys(o.aLot) };
  return pic.little.length === 0 && pic.aLot.length === 0 ? null : pic;
}

/** Effects, injected so every handler path is unit-tested without a DB or a model. */
export interface DishDeps {
  loadSummary(patientId: string, today: string): Promise<LevelSummary>;
  /** Candidates that have ALREADY passed every server-side gate; [] when none did. */
  generate(ctx: ClaraContext, ask: DishAsk): Promise<FridgeRecipe[]>;
  loggedMealTypes(patientId: string, today: string): Promise<string[]>;
  /** Optional so older callers keep working; used only while logs are not enough. */
  loadStartingPicture?(patientId: string): Promise<StartingPicture | null>;
}

// ─── gates ──────────────────────────────────────────────────────────────────

export interface GateOptions {
  /** "Dinner" etc. — the slot the gates judge timing and breakfast-ness against. */
  mealTypeName: string;
  matchers: DietMatchers;
  groupsOf: (ingredientName: string) => readonly string[];
  catalogFoodTokens: Set<string>;
  sodiumLimitMg: number;
}

/**
 * The server-side filter every suggested dish passes, in the order
 * generateAndPersistRecipes (lib/clara/recipe-generation.ts) applies it to a
 * generated plan dish: allergen and diet filter, numeric sanity, meal type,
 * prose repaired from the ingredient list, raw-rinse removed, salt and cooking
 * fat clamped, then dishProblem on the priced dish, the generation-only checks
 * (unlisted frying fat, every amount with a unit) and a distinct name. What
 * fails is dropped. Basket and catalog-dedupe gates are not applied: these
 * dishes are shown, not added to the catalog or a pantry plan.
 *
 * Oil naming (specifyCookingOil) is the caller's, before this runs, so the
 * allergen groups it loads cover the named oil.
 */
export function gateGeneratedDishes(recipes: FridgeRecipe[], opts: GateOptions): FridgeRecipe[] {
  const out: FridgeRecipe[] = [];
  const seen = new Set<string>();
  const slot = opts.mealTypeName.toLowerCase();
  for (const raw of applyAllergenFilter(recipes, opts.matchers, opts.groupsOf)) {
    if (!passesSanity(raw)) continue;
    if ((raw.mealType ?? "").toLowerCase() !== slot) continue;

    const prosed0 = repairProse(raw, opts.catalogFoodTokens, seen);
    if (!prosed0) continue;
    const derinsed = prosed0.steps?.some(stepRinsesRawProtein)
      ? { ...prosed0, steps: prosed0.steps.map((s) => withoutRawProteinRinse(s) ?? s) }
      : prosed0;
    const cooked = nameFromCookedForm(derinsed.name, derinsed.steps);
    const prosed = cooked && !seen.has(cooked.trim().toLowerCase()) ? { ...derinsed, name: cooked } : derinsed;

    const salted = clampAddedSalt(prosed.amounts ?? [], prosed.perServing?.calories, opts.sodiumLimitMg);
    const fatted = clampCookingFat(salted.ingredients, prosed.steps, prosed.perServing?.calories);
    const r = salted.changed || fatted.changed ? { ...prosed, amounts: fatted.ingredients } : prosed;

    const candidate = toPlausibleDish(r, opts.mealTypeName);
    const priced = pricedMacros(r);
    if (priced) {
      candidate.macros = { protein: priced.protein, carbs: priced.carbs, fat: priced.fat };
      candidate.calories = priced.calories;
    }
    if (dishProblem(candidate, opts.catalogFoodTokens)) continue;
    if (cooksWithUnlistedFat(r)) continue;
    const plausible = toPlausibleDish(r, opts.mealTypeName);
    if (plausible.ingredients.some((i) => i.quantity == null)) continue;
    if (plausible.ingredients.some((i) => !unitIsUsable(i.name, i.unit))) continue;
    const nameKey = r.name.trim().toLowerCase();
    if (!nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    out.push(r);
  }
  return out;
}

// ─── the real generator ─────────────────────────────────────────────────────

const CANDIDATES = 3;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function dishSystemPrompt(a: {
  ask: DishAsk;
  foodMapText: string;
  bannedNames: string[];
  proteinOptions: string[];
  sodiumLimitMg: number;
}): string {
  const { ask } = a;
  const meal = capitalize(ask.mealType);
  const servings = ask.servings ?? 1;
  const leanInto: string[] = [];
  const fromAnswers = ask.picture !== undefined;
  const littleKeys: readonly string[] = ask.picture ? ask.picture.little : ask.summary.little;
  const aLotKeys: readonly string[] = ask.picture ? ask.picture.aLot : ask.summary.aLot;
  if (littleKeys.includes("fibre")) {
    leanInto.push(
      `- ${fromAnswers ? "From their answers they probably get little fibre" : "They have had little fibre this week"}: build every dish around a fibre-rich ingredient (${FIBRE_RICH_EXAMPLES}).`,
    );
  }
  if (aLotKeys.includes("sodium")) {
    leanInto.push(
      `- ${fromAnswers ? "From their answers they probably get a lot of sodium" : "They have had a lot of sodium this week"}: keep every serving at or under ${SODIUM_REASON_MAX_MG} mg of sodium — no soy sauce, stock cubes, bouillon, cured meats, salted cheese or pickles, and little or no added salt.`,
    );
  }
  return [
    `You are Clara, Wondish's nutrition assistant. Suggest ${CANDIDATES} different, realistic, home-cookable ${meal} dishes for this person to cook today. The app shows the first one that passes its checks.`,
    `Rules:`,
    `- mealType must be exactly "${meal}". servings is ${servings}; every amount and every perServing number is for ONE serving.`,
    servings > 1
      ? `- The app scales the amounts to ${servings} people, so write the steps WITHOUT amounts: "add the lentils", never "add 1 cup lentils" or "stir in 2 tablespoons of oil".`
      : ``,
    ask.maxMinutes !== undefined
      ? `- Each dish must take at most ${ask.maxMinutes} minutes in total (prepMinutes + cookMinutes), and no step may take longer than that.`
      : `- prepMinutes and cookMinutes: realistic whole minutes for a home cook. No single step may take longer than prepMinutes + cookMinutes.`,
    ask.mealType === "breakfast"
      ? `- This is BREAKFAST: morning food, under ${BREAKFAST_MAX_MINUTES} minutes in total, built on a breakfast protein (eggs, yoghurt, cottage cheese, cheese, nut butter, nuts, beans, tofu). Not a braise, a roast or a rice bowl.`
      : ask.mealType === "snack"
        ? `- This is a SNACK: small and quick, under ${SNACK_MAX_MINUTES} minutes in total, with no added salt. Fruit, yoghurt, nuts, toast, a boiled egg, raw vegetables and a dip.`
        : `- Each dish is a complete meal (protein + carb + vegetables where sensible).`,
    ...leanInto,
    `- Everyday dishes with common, individually named ingredients — no compound items, no brand names. usesIngredients lists EVERY ingredient; leave missingIngredients empty.`,
    `- Name the oil you cook with (e.g. "olive oil") in the ingredients and the steps — never "cooking oil", "oil" or "cooking spray". If a step sears, fries, sautés or browns anything, that fat MUST be in usesIngredients with its amount.`,
    `- amounts: one entry per usesIngredients item with the per-serving quantity and unit (g, oz, ml, cup, tablespoon, teaspoon, or "" only for naturally counted things like eggs). Same spelling as in usesIngredients. Grains, pasta and pulses in GRAMS of DRY weight.`,
    `- steps: 4–8 clear instructions a home cook can follow. EVERY meat, poultry and fish must be cooked by a step that names it.`,
    `- perServing macros must be realistic: protein*4 + carbs*4 + fat*9 within 5% of the calories. Include fiber.`,
    `- Name each dish by what is IN it and the method you actually use. The description may only mention food in usesIngredients. Every dish needs a distinct name.`,
    saltRuleLine(a.sodiumLimitMg),
    `- Cooking fat: one teaspoon per serving is normal and one tablespoon is the maximum; write the same amount in the steps as in amounts.`,
    a.proteinOptions.length > 0 && a.bannedNames.length > 0
      ? `- Protein sources that fit this person — build every main around one of them: ${a.proteinOptions.join(", ")}.`
      : ``,
    a.bannedNames.length > 0 ? `- NEVER include these ingredients or anything containing them: ${a.bannedNames.join(", ")}.` : ``,
    `\nTheir dietary profile (respect every line, especially condition guidance):\n${a.foodMapText}`,
    `\nCall the suggest_recipes tool with valid JSON only.`,
  ]
    .filter((l) => l.length > 0)
    .join("\n");
}

/** One model call, then the fridge parser, the oil repair and every gate. [] on any failure. */
async function generateGated(ctx: ClaraContext, ask: DishAsk): Promise<FridgeRecipe[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const patient = await prisma.patient.findFirst({ where: { id: ctx.patientId }, include: PATIENT_FOOD_MAP_INCLUDE });
  if (!patient) return [];
  // The person's own today decides which trigger trials are enforced.
  const bans = derivePatientBans(patient, new Date(`${ctx.today}T12:00:00`));
  const matchers = buildDietMatchers(bans);
  const sodiumLimitMg = dailySodiumLimitMg(patient.healthConditions.map((h) => h.condition.name));
  const meal = capitalize(ask.mealType);

  let msg: Anthropic.Message;
  try {
    msg = await createAnthropic({ timeout: 45_000, maxRetries: 0 }).messages.create({
      model: CLARA_MODEL,
      max_tokens: 4096, // three dishes with their steps (the fridge route's measured budget)
      thinking: { type: "disabled" },
      system: dishSystemPrompt({
        ask,
        foodMapText: buildFoodMapText(patient),
        bannedNames: bannedNamesForPrompt(bans),
        proteinOptions: proteinOptionsFor(matchers),
        sodiumLimitMg,
      }),
      tools: [
        { name: "suggest_recipes", description: "Return the suggested dishes.", input_schema: SUGGEST_RECIPES_SCHEMA },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" },
      messages: [{ role: "user", content: `Suggest the ${CANDIDATES} ${meal.toLowerCase()} dishes now.` }],
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn(`[clara-dish] generation failed: ${e?.status ?? ""} ${e?.message ?? String(err)}`);
    return [];
  }
  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const parsed = parseFridgeRecipes((toolUse?.input as { recipes?: unknown } | undefined)?.recipes, CANDIDATES, meal) ?? [];

  // Name the oil BEFORE the filter judges the dish, with an oil this person may have.
  const named = parsed.map((r) => specifyCookingOil(r, oilAllowedBy(matchers)));
  const groupsOf = await loadIngredientGroups(named.flatMap((r) => [...r.usesIngredients, ...r.missingIngredients]));
  const catalogFoodTokens = catalogFoodVocabulary(
    (await prisma.ingredient.findMany({ select: { name: true } })).map((i) => i.name),
  );
  const gated = gateGeneratedDishes(named, { mealTypeName: meal, matchers, groupsOf, catalogFoodTokens, sodiumLimitMg });
  if (gated.length === 0) console.info(`[clara-dish] ${meal}: parsed=${parsed.length} accepted=0`);
  return gated.map(readableAmounts);
}

/**
 * Amounts and prose as a cook reads them ("⅛ teaspoon", not "0.1 teaspoon").
 * repairForStorage's amount and prose steps without its oil step: that one
 * names an oil with no diet check, after the filter has already run.
 */
function readableAmounts(r: FridgeRecipe): FridgeRecipe {
  const amounts = r.amounts?.map((a) => {
    const fixed = repairAmount(a.quantity, a.unit, a.name);
    return fixed ? { ...a, quantity: fixed.quantity, unit: fixed.unit ?? "" } : a;
  });
  const steps = r.steps.map(readableProse);
  return {
    ...r,
    steps,
    description: readableDescription(r.description, steps),
    ...(amounts ? { amounts } : {}),
  };
}

const prismaDeps: DishDeps = {
  loadSummary: (patientId, today) => loadLevelSummary(patientId, today, 7),
  generate: generateGated,
  loadStartingPicture: async (patientId) => {
    const row = await prisma.patient.findUnique({ where: { id: patientId }, select: { startingPicture: true } });
    return parseStartingPicture(row?.startingPicture);
  },
  loggedMealTypes: async (patientId, today) => {
    const rows = await prisma.mealLog.findMany({
      where: { patientId, localDate: today, deletedAt: null },
      select: { mealType: true },
      distinct: ["mealType"],
    });
    return rows.map((r) => r.mealType);
  },
};

// ─── building the reply ─────────────────────────────────────────────────────

const LEVEL_NAME: Record<LevelKey, string> = {
  calories: "calories",
  protein: "protein",
  carbs: "carbs",
  fat: "fat",
  fibre: "fibre",
  sodium: "sodium",
};

/** null when no level has a word: an empty chip row says nothing. */
function levelsPart(summary: LevelSummary): ClaraPart | null {
  if (summary.little.length === 0 && summary.aLot.length === 0) return null;
  return {
    kind: "levels",
    little: summary.little.map((key) => ({ key, name: LEVEL_NAME[key] })),
    aLot: summary.aLot.map((key) => ({ key, name: LEVEL_NAME[key] })),
  };
}

interface BuiltDish {
  recipe: ClaraRecipe;
  dish: Extract<ClaraPart, { kind: "dish" }>;
  steps: Extract<ClaraPart, { kind: "steps" }>;
}

/** Stated (or step-implied) minutes; 0 when the dish names no time at all. May be fractional. */
function rawMinutesOf(r: FridgeRecipe, mealType: DishMealType): number {
  return statedOrImpliedMinutes(toPlausibleDish(r, capitalize(mealType)));
}

/**
 * The minutes the app shows: always a whole number of at least 1. The app
 * decodes `minutes` as an integer, so "Simmer 2.5 minutes" sent as 2.5 would
 * drop the whole dish card. Only call it for a dish that names a time.
 */
function minutesOf(r: FridgeRecipe, mealType: DishMealType): number {
  return Math.max(1, Math.round(rawMinutesOf(r, mealType)));
}

/** The dish as the app shows and cooks it. Numbers per serving, priced from its own amounts. */
function buildDish(r: FridgeRecipe, ask: DishAsk): BuiltDish {
  const priced = pricedMacros(r);
  const perServing = {
    calories: Math.round(priced?.calories ?? reconcileCalories(r) ?? r.perServing.calories),
    protein: priced?.protein ?? r.perServing.protein,
    carbs: priced?.carbs ?? r.perServing.carbs,
    fat: priced?.fat ?? r.perServing.fat,
    // Pricing has no fibre column; this is the dish's own declared figure. It
    // is stored for the log only — no reason is ever built on it.
    fibre: r.perServing.fiber,
    sodium: completeSodiumMg(r),
  };
  const minutes = minutesOf(r, ask.mealType);
  const recipe: ClaraRecipe = {
    name: r.name,
    servings: ask.servings ?? 1,
    minutes,
    ingredients: toPlausibleDish(r, ask.mealType).ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? "",
    })),
    steps: r.steps,
    perServing,
  };
  return {
    recipe,
    dish: {
      kind: "dish",
      dishId: r.id,
      name: r.name,
      minutes,
      calories: perServing.calories,
      reasons: ask.picture
        ? dishReasons(
            { ingredients: r.usesIngredients, sodium: perServing.sodium },
            // Only the levels the dish code can price: fibre and sodium.
            {
              little: ask.picture.little.includes("fibre") ? ["fibre"] : [],
              aLot: ask.picture.aLot.includes("sodium") ? ["sodium"] : [],
            },
            "answers",
          )
        : dishReasons({ ingredients: r.usesIngredients, sodium: perServing.sodium }, ask.summary),
      recipe,
    },
    steps: {
      kind: "steps",
      dishId: r.id,
      steps: r.steps.map((text, i) => {
        const stated = longestStepMinutes([text]);
        return { n: i + 1, text, timerMinutes: stated > 0 ? Math.round(stated) : null };
      }),
    },
  };
}

/**
 * The first gated candidate that also keeps to the asked time. A dish with no
 * time at all is skipped too: the card has to say how long it takes.
 */
function pickDish(recipes: FridgeRecipe[], ask: DishAsk): FridgeRecipe | null {
  const multi = (ask.servings ?? 1) > 1;
  for (const r of recipes) {
    if (rawMinutesOf(r, ask.mealType) <= 0) continue; // names no time at all
    const minutes = minutesOf(r, ask.mealType);
    if (ask.maxMinutes !== undefined && minutes > ask.maxMinutes) continue;
    // Amounts are per serving and the app scales them; a step that names an
    // amount would tell a cook for six to use one person's portion.
    if (multi && r.steps.some(stepStatesAmount)) continue;
    return r;
  }
  return null;
}

/**
 * Does a step state an amount of food? Two shapes:
 *   - a NUMBER (whole, decimal, "1/2", "1 1/2", "½", or a range "2-3" / "2 to
 *     3" / "2 or 3") followed, with an optional size word, by any word that is
 *     not a time, temperature, length, cut shape, piece of equipment or other
 *     non-amount (STEP_NOT_AN_AMOUNT): "Dice 1 onion", "Add 2 chicken breasts",
 *     "1tsp", "2-3 cloves". Denylist rather than allowlist, because the food
 *     noun can be anything; a stray false hit only drops a candidate dish.
 *   - a SPELLED amount ("a", "an", "one" … "four", "half", "quarter") before a
 *     kitchen unit: "one cup of lentils", "half a cup", "a pinch of salt".
 * Not amounts: "simmer 20 minutes", "for 5 min", "180°C", "350 F", "2 cm
 * pieces", "a 12-inch skillet", "Step 2:", "stir 2 or 3 times".
 * No existing pattern fits: the dish-plausibility ones are fat-only
 * (FAT_IN_STEP) or decimal-only (PROSE_AMOUNT), and both are module-private.
 */
const STEP_NUM = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)`;
const STEP_NUMBER_THEN_WORD = new RegExp(
  String.raw`(?<![\w.\/])${STEP_NUM}(?:\s*(?:-|–|to|or)\s*${STEP_NUM})?\s*(?:(?:large|medium|small|whole|fresh|big|ripe|heaping|level)\s+)?([a-z][a-z']*)`,
  "gi",
);
const STEP_NOT_AN_AMOUNT = new Set([
  // time
  "minute", "minutes", "min", "mins", "m", "hour", "hours", "hr", "hrs", "h", "second", "seconds", "sec", "secs", "s",
  "day", "days", "night", "nights", "times", "time",
  // temperature and length
  "degree", "degrees", "deg", "f", "c", "cm", "mm", "centimeter", "centimeters", "centimetre", "centimetres",
  "inch", "inches", "in",
  // joining words and step labels
  "to", "or", "and", "of", "x", "at", "on", "per", "until", "more", "then", "step", "steps",
  // cut shapes, portions and equipment: they say how, not how much food
  "piece", "pieces", "half", "halves", "quarter", "quarters", "wedge", "wedges", "strip", "strips", "chunk", "chunks",
  "cube", "cubes", "layer", "layers", "part", "parts", "batch", "batches", "side", "sides", "serving", "servings",
  "portion", "portions", "people", "person", "persons", "bowl", "bowls", "plate", "plates", "skillet", "skillets",
  "pan", "pans", "pot", "pots", "tray", "trays", "sheet", "sheets", "dish", "dishes", "ramekin", "ramekins",
  "jar", "jars", "glass", "glasses",
]);
const STEP_SPELLED_AMOUNT =
  /\b(?:a|an|one|two|three|four|half|quarter)\s+(?:(?:heaping|heaped|level|scant|generous|small|large)\s+)?(?:teaspoons?|tsp|tablespoons?|tbsp|cups?|grams?|ounces?|oz|pounds?|lbs?|lit(?:er|re)s?|millilit(?:er|re)s?|pinch(?:es)?|dash(?:es)?|splash(?:es)?|knob|handfuls?|cloves?|cans?|tins?|eggs?|slices?|sprigs?|stalks?|bunch(?:es)?)\b/i;

export function stepStatesAmount(step: string): boolean {
  if (STEP_SPELLED_AMOUNT.test(step)) return true;
  for (const m of step.matchAll(STEP_NUMBER_THEN_WORD)) {
    if (!STEP_NOT_AN_AMOUNT.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/**
 * Sodium per serving, only when every source of it is known: the dish prices
 * in full (no unweighable row behind the coverage minimum, which priceDish
 * counts as 0 mg) and every salty seasoning row has a weight priceDish can
 * turn into mg. Otherwise null — "only 120 mg" must never be an undercount.
 */
const SALT_ROW = /\bsalt\b/i;
// Seasonings priceDish skips from the calories but prices for sodium, each by
// a DENSITY row with a sodium figure (lib/staple-density.ts).
const SODIUM_PRICED_SEASONING = /\b(broths?|stocks?|bouillon|soy sauce|tamari|fish sauce|worcestershire|mustard|hot sauce|sriracha|olives?|capers?)\b/i;
// Salty names with no sodium figure anywhere: never priceable.
const SODIUM_UNPRICED_SEASONING = /\b(seasonings?|baking soda|baking powder|bicarbonate|miso|gochujang|bouillon cubes?|stock cubes?|oyster sauce|hoisin|teriyaki|cajun|adobo|furikake|msg)\b/i;

export function completeSodiumMg(r: FridgeRecipe): number | null {
  const ingredients = toPlausibleDish(r, "").ingredients;
  const priced = priceDish(ingredients, r.steps ?? null);
  if (!priced || priced.coverage < 1) return null;
  for (const i of ingredients) {
    if (SALT_ROW.test(i.name)) {
      const pinch = i.quantity != null && i.quantity > 0 && /\b(pinch(es)?|dash(es)?)\b/i.test(i.unit ?? "");
      if (saltRowTsp(i.quantity, i.unit) === null && !pinch) return null;
      continue;
    }
    if (SODIUM_UNPRICED_SEASONING.test(i.name)) return null;
    if (SODIUM_PRICED_SEASONING.test(i.name) && gramsOf(i.name, i.quantity, i.unit) === null) return null;
  }
  return priced.sodiumMg;
}

async function generateOne(deps: DishDeps, ctx: ClaraContext, ask: DishAsk): Promise<BuiltDish | null> {
  let recipes: FridgeRecipe[];
  try {
    recipes = await deps.generate(ctx, ask);
  } catch (err) {
    console.warn(`[clara-dish] generate threw: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
  const picked = pickDish(recipes, ask);
  return picked ? buildDish(picked, ask) : null;
}

/** What the model narrates from: the card's content, never the recipe itself. */
function dishForModel(b: BuiltDish, mealType: DishMealType) {
  return {
    mealType,
    dishId: b.dish.dishId,
    name: b.dish.name,
    minutes: b.dish.minutes,
    caloriesPerServing: b.dish.calories,
    servings: b.recipe.servings,
    reasons: b.dish.reasons.map((r) => r.text),
  };
}

const FULL_NAME = new Map<string, string>(LEVELS.map((l) => [l.key, l.name.toLowerCase()]));
export const ANSWERS_PHRASE = "from your answers";
const PICTURE_NOTE =
  "There are not enough logged meals yet, so this is based on their onboarding answers, not on logged meals. Say 'from your answers, you probably get little X' (or 'a lot of X'); never describe their body. Logging meals lets you tailor the next one.";

/** The picture applies only while logs are not enough and it names at least one level. */
async function pictureFor(deps: DishDeps, ctx: ClaraContext, summary: LevelSummary): Promise<StartingPicture | undefined> {
  if (summary.enoughLogs || !deps.loadStartingPicture) return undefined;
  return (await deps.loadStartingPicture(ctx.patientId)) ?? undefined;
}

function pictureForModel(pic: StartingPicture) {
  const names = (keys: FullLevelKey[]) => keys.map((k) => FULL_NAME.get(k) ?? k);
  return { source: "answers", phrase: ANSWERS_PHRASE, little: names(pic.little), aLot: names(pic.aLot) };
}

function levelsForModel(summary: LevelSummary) {
  return {
    fromDate: summary.fromDate,
    toDate: summary.toDate,
    daysCounted: summary.daysCounted,
    enoughLogs: summary.enoughLogs,
    little: summary.little,
    aLot: summary.aLot,
  };
}

const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });
const couldntFit = (): ToolResult => ({ ok: false, reason: "FAILED", message: COULDNT_FIT_NOTE });

/** undefined when absent; null when present but not a whole number in [min, max]. */
function optionalInt(v: unknown, min: number, max: number): number | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

export function makeDishHandlers(deps: DishDeps = prismaDeps) {
  const suggest = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const mealType = input.mealType;
    if (typeof mealType !== "string" || !(MEAL_TYPES as readonly string[]).includes(mealType)) {
      return invalid(`mealType must be one of ${MEAL_TYPES.join(", ")}`);
    }
    const maxMinutes = optionalInt(input.maxMinutes, 1, MAX_MINUTES);
    if (maxMinutes === null) return invalid(`maxMinutes must be a whole number from 1 to ${MAX_MINUTES}`);
    const servings = optionalInt(input.servings, 1, MAX_SERVINGS);
    if (servings === null) return invalid(`servings must be a whole number from 1 to ${MAX_SERVINGS}`);

    const summary = await deps.loadSummary(ctx.patientId, ctx.today);
    const picture = await pictureFor(deps, ctx, summary);
    const ask: DishAsk = {
      mealType: mealType as DishMealType,
      summary,
      ...(picture ? { picture } : {}),
      ...(maxMinutes !== undefined ? { maxMinutes } : {}),
      ...(servings !== undefined ? { servings } : {}),
    };
    const built = await generateOne(deps, ctx, ask);
    if (!built) return couldntFit();
    const levels = picture ? null : levelsPart(summary);

    return {
      ok: true,
      data: {
        dish: dishForModel(built, ask.mealType),
        levels: picture ? pictureForModel(picture) : levelsForModel(summary),
        ...(picture ? { note: PICTURE_NOTE } : summary.daysCounted === 0 ? { note: NOTHING_LOGGED_NOTE } : {}),
        shown: SUGGEST_SHOWN_NOTE,
      },
      parts: [...(levels ? [levels] : []), built.dish, built.steps],
    };
  };

  const planToday = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const occasion = input.occasion ?? "normal";
    if (typeof occasion !== "string" || !(OCCASIONS as readonly string[]).includes(occasion)) {
      return invalid(`occasion must be one of ${OCCASIONS.join(", ")}`);
    }

    const [summary, logged] = await Promise.all([
      deps.loadSummary(ctx.patientId, ctx.today),
      deps.loggedMealTypes(ctx.patientId, ctx.today),
    ]);
    const picture = await pictureFor(deps, ctx, summary);
    const loggedSet = new Set(logged.map((m) => m.toLowerCase()));
    const eatingOut = occasion === "eating_out";
    const meals = PLANNED_MEALS.filter((m) => !loggedSet.has(m) && !(eatingOut && m === "dinner"));

    const notes = {
      ...(picture ? { note: PICTURE_NOTE } : summary.daysCounted === 0 ? { note: NOTHING_LOGGED_NOTE } : {}),
      ...(eatingOut ? { eatingOut: EATING_OUT_NOTE } : {}),
    };
    if (meals.length === 0) {
      return {
        ok: true,
        data: {
          dishes: [],
          alreadyLogged: PLANNED_MEALS.filter((m) => loggedSet.has(m)),
          ...(eatingOut ? {} : { allLogged: ALL_LOGGED_NOTE }),
          ...notes,
        },
      };
    }

    const asks: DishAsk[] = meals.map((mealType) => ({
      mealType,
      summary,
      ...(picture ? { picture } : {}),
      ...(occasion === "little_time" ? { maxMinutes: LITTLE_TIME_MINUTES } : {}),
      ...(occasion === "guests" && mealType === "dinner" ? { servings: GUEST_SERVINGS } : {}),
    }));
    const built = await Promise.all(asks.map((ask) => generateOne(deps, ctx, ask)));
    const made = asks.map((ask, i) => ({ ask, b: built[i] })).filter((x): x is { ask: DishAsk; b: BuiltDish } => x.b !== null);
    if (made.length === 0) return couldntFit();

    return {
      ok: true,
      data: {
        dishes: made.map(({ ask, b }) => dishForModel(b, ask.mealType)),
        alreadyLogged: PLANNED_MEALS.filter((m) => loggedSet.has(m)),
        couldNotFill: asks.filter((_, i) => built[i] === null).map((a) => a.mealType),
        levels: picture ? pictureForModel(picture) : levelsForModel(summary),
        ...notes,
        shown: PLAN_SHOWN_NOTE,
      },
      parts: made.map(({ b }) => b.dish),
    };
  };

  return { suggest, planToday };
}

const handlers = makeDishHandlers();

export const dishSkill: Skill = {
  name: "dish",
  promptFragment: [
    "About your dish_ tools: dish_suggest makes ONE dish to cook now, chosen from what they have eaten this week (the levels); dish_plan_today makes one dish for each of today's meals they have not logged yet. Both only suggest — nothing is logged or saved, and the app shows each dish as a card with its reasons and steps, so name the dish and its reasons briefly instead of writing out the recipe.",
    "Talk about what they have EATEN, never their body: \"you've had little fibre this week\", never \"your fibre is low\". When the result's levels say source answers (not enough logs yet), say \"from your answers, you probably get little fibre\". The only level words are little, on track, within limit and a lot.",
    "If the result has a note that nothing is logged yet, say so plainly and still offer the dish. If a dish comes back as couldn't make one that fits, say exactly that and offer to try again — never describe a dish you were not given.",
    `Before dish_plan_today, ask "Anything happening today?" once with ask_choices, options exactly "${OCCASION_OPTIONS[0]}", "${OCCASION_OPTIONS[1]}", "${OCCASION_OPTIONS[2]}", "${OCCASION_OPTIONS[3]}" — then pass occasion normal, eating_out, guests or little_time. It is optional: if they already said what today is like, skip the question. When they are eating out, ask them to send the menu.`,
  ].join(" "),
  tools: [
    {
      def: {
        name: "dish_suggest",
        description:
          "Make ONE new dish for them to cook, based on what they have eaten this week. Use for 'what should I eat', 'what should I cook tonight', 'give me a dinner idea'. NOT for what is already on their meal plan (plan_get) and NOT for whether a named dish fits them (answer directly). Suggests only; logs nothing.",
        input_schema: {
          type: "object",
          properties: {
            mealType: { type: "string", enum: [...MEAL_TYPES], description: "Which meal the dish is for." },
            maxMinutes: { type: "number", description: "Most minutes the dish may take in total, when they are short of time." },
            servings: { type: "number", description: "How many people it serves; omit for one." },
          },
          required: ["mealType"],
        },
      },
      handler: handlers.suggest,
    },
    {
      def: {
        name: "dish_plan_today",
        description:
          "Make one dish for each of today's meals they have not logged yet. Use for 'plan my day', 'plan today's dishes', 'what should I eat today'. NOT for the saved meal plan (plan_get). Suggests only; logs nothing.",
        input_schema: {
          type: "object",
          properties: {
            occasion: {
              type: "string",
              enum: [...OCCASIONS],
              description: "From their answer to 'Anything happening today?': normal, eating_out (dinner left out), guests (dinner for 6), little_time (20 minutes a dish). Omit for normal.",
            },
          },
        },
      },
      handler: handlers.planToday,
    },
  ],
};
