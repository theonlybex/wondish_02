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
import { derivePatientBans, buildDietMatchers, bannedNamesForPrompt, evaluateDishAgainstProfile, hasAnyBan, type DerivedBans, type DietMatchers } from "@/lib/diet-match";
import { dailySodiumLimitMg } from "@/lib/sodium-limit";
import { currentStartingPicture } from "@/lib/onboarding";
import { loadClaraLevelSummary } from "@/lib/level-summary";
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import { applyAllergenFilter, parseFridgeRecipes, type FridgeRecipe } from "@/lib/fridge";
import { DISH_OUTPUT_SCHEMA, DISH_UNITS, DishItemExtractor, toFridgeItem } from "@/lib/clara/dish-output";
import { libraryToFridge, matchesRequest, rankLibrary, suggestionName, type LibraryRecipe, type RecentDishes } from "@/lib/clara/dish-library";
import { breaksProteinRule, proteinKey, proteinRuleOn, NO_KEPT_FOODS, type KeptFoods } from "@/lib/clara/kept-foods";
import { keptFoodsFrom, loadKeptMarks } from "@/lib/clara/kept-foods-db";
import { brainFrom, NO_BRAIN_ROWS, type BrainRows, type DishBrain } from "@/lib/clara/dish-brain";
import { loadBrainRows } from "@/lib/clara/dish-brain-db";
import { DEFAULT_DISH_RULES, type DishRules } from "@/lib/clara/dish-rules";
import crypto from "crypto";
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
/** The longest `wants` (what they asked to cook, in their words). */
const MAX_WANTS_CHARS = 80;

// OFF 2026-11 (Clara-first, spec §8.6): these two notes asked for a sentence about logging after every dish (owner: "remove all extra words"). The rule itself is unchanged: no claim about their week. Restore: uncomment these four lines and delete the two constants below them.
// export const NOTHING_LOGGED_NOTE =
//   "Nothing is logged yet this week, so this isn't based on what they've eaten. Say so plainly, and that logging meals lets you tailor the next one.";
// export const NOT_ENOUGH_LOGS_NOTE =
//   "Not enough is logged yet this week to say what they have had little or a lot of, so make no such claim. Say plainly that a few more days of logged meals lets you tailor the next dish.";
export const NOTHING_LOGGED_NOTE =
  "Nothing is logged yet this week, so this isn't based on what they've eaten: make no claim about their week. Say that in a few plain words (for example \"not based on your logs yet\") and add nothing about logging unless they ask.";
export const NOT_ENOUGH_LOGS_NOTE =
  "Not enough is logged yet this week to say what they have had little or a lot of, so make no such claim. Say in a few plain words that it is not based on their logs yet, and add nothing about logging unless they ask.";
export const COULDNT_FIT_NOTE =
  "I couldn't make one that fits right now. Tell them plainly and offer to try again; do not describe a dish.";
export const EATING_OUT_NOTE =
  "Dinner is out tonight, so it is not planned. Ask them to send the menu (a photo or the dish names) and you will help pick what fits.";
export const ALL_LOGGED_NOTE = "Every meal today is already logged, so there is nothing left to plan.";

// ─── what the model is told when they asked to cook something particular ────
// (dish_suggest's `wants`). None of these says a dish was "made" for them.

/** The served dish says what they asked for: the reply can open with it. */
export const requestAnsweredNote = (wants: string) =>
  // OFF 2026-11 (Clara-first, spec §8.6): "then the reasons" asked for text the card already shows. Restore: uncomment this line and delete the line below it.
  // `This dish answers their request to cook "${wants}": open by saying it is a way to cook that which fits them (for example "Here's a way to cook ${wants} that fits you"), then the reasons.`;
  `This dish answers their request to cook "${wants}": say it is a way to cook that which fits them (for example "Here's a way to cook ${wants} that fits you"). The card shows the rest.`;
/** A dish is served, but its name and ingredients do not say what they asked for. */
export const requestNotMatchedNote = (wants: string) =>
  `They asked to cook "${wants}", and this dish's name and ingredients do not say that. If it is not what they asked for, say so plainly and say what it is instead; never present it as "${wants}".`;
/** What they asked for breaks one of their own rules: no dish was looked for. */
export const cannotFitRequestNote = (wants: string, because: readonly string[]) =>
  `What they asked to cook ("${wants}") does not fit them: it goes against their profile (${because.join("; ")}). No dish was looked for and none is shown. Tell them plainly why, do not describe a dish, and offer to suggest a dish that does fit them (if they say yes, call dish_suggest again without wants).`;
/** Nothing safe that is what they asked for could be served (the model's dishes failed or ran out of time, and no library recipe matches). */
export const couldntMakeRequestNote = (wants: string) =>
  `I couldn't put together "${wants}" in a way that fits them right now, and no library recipe matches it. No dish is shown. Tell them plainly, do not describe a dish, and offer to try again or to suggest a different dish that fits them (dish_suggest without wants).`;

// OFF 2026-11 (Clara-first, spec §8.6): these two notes invited a paragraph around the card (name, reasons, time and calories again). Restore: uncomment these four lines and delete the two constants below them.
// const SUGGEST_SHOWN_NOTE =
//   "The dish card and its steps are already shown under your message: name the dish and the reasons in a sentence or two, do not list the recipe.";
// const PLAN_SHOWN_NOTE =
//   "A card for each dish is already shown under your message: name each dish and its reasons briefly, do not list recipes. The steps are not shown yet; they come when the person picks a dish to cook.";
const SUGGEST_SHOWN_NOTE =
  "The dish card is already shown under your message with the dish's name, time, calories, reasons, ingredients and steps: repeat none of it. Say only that here is the dish (its name is enough), plus whatever a note in this result tells you to say. No recipe, no closing offer.";
const PLAN_SHOWN_NOTE =
  "A card for each dish is already shown under your message with its name and reasons: repeat none of it, and list no recipes. Say only that today's dishes are below, plus whatever a note in this result tells you to say. The steps are not shown yet; they come when the person picks a dish to cook.";

/** What the generator is asked for. `summary` lets it lean into this week's levels. */
export interface DishAsk {
  mealType: DishMealType;
  maxMinutes?: number;
  servings?: number;
  summary: LevelSummary;
  /** Set only while there are not enough logs: levels from the onboarding answers. */
  picture?: StartingPicture;
  /**
   * What they asked to cook, in their words ("eggs", "a chicken stir-fry"):
   * the dish's main idea. Absent for "what should I eat". Travels the same
   * path as maxMinutes: into the generator prompt, the library ranking and
   * the pick; every gate runs on the result exactly as without it.
   */
  wants?: string;
  /**
   * Dishes this chat already showed them ("something else"): the generator is
   * told not to repeat them, and a dish with one of these names is never served.
   */
  avoid?: string[];
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

/** What generateOne hands the generator: the deadline, and the test that lets it stop early. */
export interface GenerateOptions {
  /** Aborted when the time budget runs out: return what passed the gates so far. */
  signal?: AbortSignal;
  /**
   * The card's own test (pickDish). The generator may stop reading the model
   * as soon as one gated candidate passes it — the dish is served while the
   * model would still be writing the others.
   */
  accept?: (r: FridgeRecipe) => boolean;
  /** Simulation/diagnostics only: where each candidate ended up. */
  trace?: (e: CandidateTrace) => void;
}

export type CandidateTrace = {
  /** ms since the generator started. */
  ms: number;
  name: string;
  /** "kept": the dish uses a meat or fish they have not marked as at home (the at-home protein rule). */
  stage: "parse" | "safety" | "gates" | "kept" | "card" | "accepted";
};

/** Effects, injected so every handler path is unit-tested without a DB or a model. */
export interface DishDeps {
  loadSummary(patientId: string, today: string): Promise<LevelSummary>;
  /** Candidates that have ALREADY passed every server-side gate; [] when none did. */
  generate(ctx: ClaraContext, ask: DishAsk, opts?: GenerateOptions): Promise<FridgeRecipe[]>;
  /**
   * The safety net: library recipes that ALREADY passed the planner's rule
   * filter and every gate a generated dish passes, best first; [] when none.
   * Started alongside the model call, read only when no generated dish is served.
   */
  library?(ctx: ClaraContext, ask: DishAsk, signal?: AbortSignal): Promise<FridgeRecipe[]>;
  /** The model's time budget per dish, ms (DISH_BUDGET_MS when absent). */
  budgetMs?: number;
  loggedMealTypes(patientId: string, today: string): Promise<string[]>;
  /** Optional so older callers keep working; used only while logs are not enough. */
  loadStartingPicture?(patientId: string): Promise<StartingPicture | null>;
  /**
   * Why what they asked to cook breaks one of THEIR rules ("allergy: egg"),
   * [] when it does not. Asked before any dish is looked for, only when
   * `wants` is set. A pre-check, not the safety gate: the gates still judge
   * every dish that is served.
   */
  requestConflicts?(ctx: ClaraContext, wants: string): Promise<string[]>;
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
/**
 * The model's time budget per dish. Measured in docs/qa/clara-fast-dishes.md:
 * past it, the model call is aborted and the library dish (already chosen in
 * parallel) is served instead, so the person always has an answer by then.
 */
export const DISH_BUDGET_MS = 8_000;
/** After the budget, how long the generator may take to hand back what it already gated. */
const ABORT_GRACE_MS = 300;
/** More fibre than this in one serving is not a real dish. */
const MAX_FIBRE_G = 40;
/** Three lean dishes on Haiku 5.5's tokenizer, with room; the stream usually stops after the first. */
const DISH_MAX_TOKENS = 4096;

/** The most at-home (non-protein) foods named in the generator prompt. */
const MAX_AT_HOME_IN_PROMPT = 40;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The words no part of a generated dish may contain: the SAME ban data the
 * safety gate judges with (bannedNamesForPrompt, plus every allergy matcher's
 * term). Prompt-only: it saves candidates the gate would refuse ("coconut
 * milk" for a dairy allergy), and the gate still has the final say.
 */
export function forbiddenWordsForPrompt(bans: DerivedBans, matchers: DietMatchers): string[] {
  const seen = new Set<string>();
  return [...bannedNamesForPrompt(bans), ...matchers.allergyMatchers.map((m) => m.term)].filter((w) => {
    const k = w.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function dishSystemPrompt(a: {
  ask: DishAsk;
  foodMapText: string;
  /** forbiddenWordsForPrompt: every banned name and allergy word. */
  bannedNames: string[];
  proteinOptions: string[];
  sodiumLimitMg: number;
  /** What they keep at home and love. Absent or NO_KEPT_FOODS: the prompt is exactly as before. */
  kept?: KeptFoods;
}): string {
  const { ask } = a;
  const kept = a.kept ?? NO_KEPT_FOODS;
  // Catalog names, but cleaned like the avoid names all the same: no quotes, no line breaks.
  const clean = (names: readonly string[]) => names.map((n) => n.replace(/["\n\r]+/g, "")).join(", ");
  // The at-home protein rule replaces the protein line, banned names or not.
  const ruleOn = proteinRuleOn(kept, ask.wants);
  // Every at-home meat, fish or seafood, whichever catalog group it sits in.
  const keptMeats = [...kept.proteinNames, ...kept.atHome].filter((n) => proteinKey(n) !== null);
  // Mains are built on them only at lunch and dinner with no request of their own;
  // breakfast, a snack and a request get the exclusion alone.
  const buildOnKept = ruleOn && ask.wants === undefined && (ask.mealType === "lunch" || ask.mealType === "dinner");
  const keptProteinLine = !ruleOn
    ? null
    : buildOnKept
      ? `- Proteins they have at home, and others that fit them — build every main around one of them: ${clean([
          ...kept.proteinNames,
          ...kept.atHome.filter((n) => proteinKey(n) !== null),
          ...a.proteinOptions.filter((o) => proteinKey(o) === null),
        ])}. Use no other meat, fish or seafood in any dish: not in an ingredient, the dish name, the description or a step.`
      : `- If a dish uses meat, fish or seafood, use only these, which they have at home: ${clean(keptMeats)}. No other meat, fish or seafood may appear in any dish: not in an ingredient, the dish name, the description or a step.`;
  // A favourite meat they do not have at home would contradict the rule.
  const favorites = ruleOn ? kept.favorites.filter((f) => !breaksProteinRule([f], kept)) : kept.favorites;
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
  const units = DISH_UNITS.filter((u) => u !== "").join(", ");
  return [
    `You are Clara, Wondish's nutrition assistant. Suggest ${CANDIDATES} different, realistic, home-cookable ${meal} dishes for this person to cook today. The app shows the first one that passes its checks, so put the simplest, surest fit first.`,
    `Rules:`,
    `- Every dish is a ${meal}. servings is ${servings}; every amount and every perServing number is for ONE serving.`,
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
    ask.wants !== undefined
      ? `- THE REQUEST: they asked to cook "${ask.wants.replace(/["\n\r]+/g, "").replace(/\s+/g, " ").trim()}". Every one of the ${CANDIDATES} dishes must be that: what they asked for is the dish's main idea and is named in the dish name. Make ${CANDIDATES} versions of it, the simplest first, not ${CANDIDATES} unrelated dishes. Where a line above says to build the dish around another ingredient, add that ingredient to this dish instead. Every other rule here still applies in full. If a rule forbids part of what they asked for, the rule wins: use a food that fits in its place and name the dish by what is really in it.`
      : ``,
    ask.avoid && ask.avoid.length > 0
      ? `- They were already shown these and asked for something else: suggest a clearly different dish, not one of these and not a small variation of one: ${ask.avoid.map((n) => n.replace(/["\n\r]+/g, "")).join("; ")}.`
      : ``,
    `- Everyday dishes with common, individually named ingredients — no compound items, no brand names.`,
    `- ingredients: EVERY ingredient, each with its per-serving quantity and unit (${units}; "" only for eggs). Grains, pasta and pulses in GRAMS of DRY weight. Use the same ingredient name in the steps.`,
    `- Name the oil you cook with (e.g. "olive oil") in the ingredients and the steps — never "cooking oil", "oil" or "cooking spray". If a step sears, fries, sautés or browns anything, that fat MUST be in ingredients with its amount.`,
    `- steps: 4–6 short, clear instructions a home cook can follow. EVERY meat, poultry and fish must be cooked by a step that names it.`,
    `- perServing macros must be realistic: protein*4 + carbs*4 + fat*9 within 5% of the calories. Include fiber.`,
    `- Name each dish by what is IN it and the method you actually use. description is one short sentence and may only mention food in ingredients. Every dish needs a distinct name.`,
    saltRuleLine(a.sodiumLimitMg),
    `- Cooking fat: one teaspoon per serving is normal and one tablespoon is the maximum; write the same amount in the steps as in ingredients.`,
    keptProteinLine
      ? keptProteinLine
      : a.proteinOptions.length > 0 && a.bannedNames.length > 0
        ? `- Protein sources that fit this person — build every main around one of them: ${a.proteinOptions.join(", ")}.`
        : ``,
    kept.atHome.length > 0
      ? `- They usually have these at home; prefer them where they fit: ${clean(kept.atHome.slice(0, MAX_AT_HOME_IN_PROMPT))}.`
      : ``,
    favorites.length > 0
      ? `- These are their favourite foods; at least one of the dishes should feature one when it suits the meal: ${clean(favorites)}.`
      : ``,
    a.bannedNames.length > 0
      ? `- FORBIDDEN WORDS (this person's allergies and rules): no ingredient name, dish name, description or step may contain any of these words — not even inside a longer name or a plant-based, "-free" or "no …" phrase. If "milk" is forbidden, "coconut milk", "almond milk" and "milk-free" are out too; if "butter" is, "peanut butter" is out. Choose ingredients whose names contain none of them: ${a.bannedNames.join(", ")}.`
      : ``,
    `\nTheir dietary profile (respect every line, especially condition guidance):\n${a.foodMapText}`,
  ]
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Everything about this person the generator and the library need, loaded once per request. */
interface Person {
  patient: NonNullable<Awaited<ReturnType<typeof loadPatient>>>;
  bans: DerivedBans;
  matchers: DietMatchers;
  sodiumLimitMg: number;
  /** What they keep at home and love, through the same matchers (a banned or disliked food is never here). */
  kept: KeptFoods;
  /** Everything the dish brain knows about them (lib/clara/dish-brain.ts), under the live switches. */
  brain: DishBrain;
}

/** The live switches. A mutable object only so the simulation (and piece D) can flip one; all on. */
export const dishRulesNow: { rules: DishRules } = { rules: { ...DEFAULT_DISH_RULES } };

/** The brain reads, injectable so tests can stand in for the database (createLiveDishDeps). */
type BrainRowsLoader = (patientId: string, today: string) => Promise<BrainRows>;

function loadPatient(id: string) {
  return prisma.patient.findFirst({ where: { id }, include: PATIENT_FOOD_MAP_INCLUDE });
}

/** The longest the at-home and favourite marks may hold up a dish, ms. */
const KEPT_FOODS_BUDGET_MS = 1_500;

/** `work`, or `fallback` once `ms` pass. The timer is always cleared and never keeps the process alive. */
async function withinMs<T>(ms: number, work: Promise<T>, fallback: T, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

// One load per tool call: dish_plan_today asks for up to three dishes with the
// same ctx, and the generator and the library both need the person.
const personMemo = new WeakMap<ClaraContext, Promise<Person | null>>();
function personFor(ctx: ClaraContext, loadRows: BrainRowsLoader = loadBrainRows): Promise<Person | null> {
  let p = personMemo.get(ctx);
  if (!p) {
    p = (async () => {
      // The marks and the brain reads need only the id: read them alongside the patient, not after.
      const marks = loadKeptMarks(ctx.patientId);
      marks.catch(() => {}); // handled below; never an unhandled rejection if the patient is missing
      const rows = Promise.resolve().then(() => loadRows(ctx.patientId, ctx.today));
      rows.catch(() => {}); // as above
      const patient = await loadPatient(ctx.patientId);
      if (!patient) return null;
      // The person's own today decides which trigger trials are enforced.
      const bans = derivePatientBans(patient, new Date(`${ctx.today}T12:00:00`));
      const matchers = buildDietMatchers(bans);
      // Never fails or stalls the dish: without the marks, dishes are as they were before them.
      // The marks and the brain reads wait together, so the two caps overlap: 1.5 s at worst, not 3.
      const [kept, brainRows] = await Promise.all([
        withinMs(
          KEPT_FOODS_BUDGET_MS,
          marks.then((m) => keptFoodsFrom(m, matchers)),
          NO_KEPT_FOODS,
          () => console.warn(`[clara-dish] kept foods took longer than ${KEPT_FOODS_BUDGET_MS} ms; serving without them`),
        ).catch((err) => {
          console.warn(`[clara-dish] kept foods failed to load: ${(err as Error)?.message ?? String(err)}`);
          return NO_KEPT_FOODS;
        }),
        // Each read already fails soft (loadBrainRows); this catch is for an injected loader that rejects.
        withinMs(
          KEPT_FOODS_BUDGET_MS,
          rows,
          NO_BRAIN_ROWS,
          () => console.warn(`[clara-dish] brain reads took longer than ${KEPT_FOODS_BUDGET_MS} ms; serving without them`),
        ).catch((err) => {
          console.warn(`[clara-dish] brain reads failed to load: ${(err as Error)?.message ?? String(err)}`);
          return NO_BRAIN_ROWS;
        }),
      ]);
      const sodiumLimitMg = dailySodiumLimitMg(patient.healthConditions.map((h) => h.condition.name));
      return {
        patient,
        bans,
        matchers,
        sodiumLimitMg,
        kept,
        brain: brainFrom({ kept, rules: dishRulesNow.rules, rows: brainRows, today: ctx.today, patient, matchers, sodiumLimitMg }),
      };
    })();
    personMemo.set(ctx, p);
    p.catch(() => personMemo.delete(ctx));
  }
  return p;
}

/** A small in-process cache: the catalog and the library change rarely, and every dish reads them. */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let value: Promise<T> | null = null;
  return () => {
    if (!value || Date.now() - at > ttlMs) {
      at = Date.now();
      value = load();
      value.catch(() => {
        value = null;
      });
    }
    return value;
  };
}

const CACHE_MS = 10 * 60_000;
const catalogTokens = cached(CACHE_MS, async () =>
  catalogFoodVocabulary((await prisma.ingredient.findMany({ select: { name: true } })).map((i) => i.name)),
);

/**
 * The card logs the dish's declared fibre (pricing has no fibre column). A
 * figure above the carbs — the declared carbs or the priced carbs the card
 * shows — is a typo ("fiber": 180 seen live), not a dish, and there is no
 * deterministic repair, so the dish is not used.
 */
export function fibreIsPlausible(r: FridgeRecipe): boolean {
  const fibre = r.perServing.fiber;
  if (!(fibre >= 0 && fibre <= MAX_FIBRE_G && fibre <= r.perServing.carbs)) return false;
  const priced = pricedMacros(r);
  return !priced || fibre <= priced.carbs;
}

/**
 * One candidate through the oil repair and every gate, alone. null when it
 * fails; `trace` (diagnostics only) says where.
 */
async function gateOne(
  item: unknown,
  ask: DishAsk,
  person: Person,
  catalogFoodTokens: Set<string>,
  seen: Set<string>,
  note: (name: string, stage: CandidateTrace["stage"]) => void,
): Promise<FridgeRecipe | null> {
  const meal = capitalize(ask.mealType);
  const raw = toFridgeItem(item, meal, ask.servings ?? 1);
  const label = typeof (item as { name?: unknown })?.name === "string" ? String((item as { name: string }).name) : "?";
  const parsed = raw ? parseFridgeRecipes([raw], 1, meal) ?? [] : [];
  if (parsed.length === 0) {
    note(label, "parse");
    return null;
  }
  // Name the oil BEFORE the filter judges the dish, with an oil this person may have.
  const named = specifyCookingOil(parsed[0], oilAllowedBy(person.matchers));
  const groupsOf = await loadIngredientGroups([...named.usesIngredients, ...named.missingIngredients]);
  const gated = gateGeneratedDishes([named], {
    mealTypeName: meal,
    matchers: person.matchers,
    groupsOf,
    catalogFoodTokens,
    sodiumLimitMg: person.sodiumLimitMg,
  });
  const r = gated[0];
  if (r && !fibreIsPlausible(r)) {
    note(label, "gates");
    return null;
  }
  if (!r || seen.has(r.name.trim().toLowerCase())) {
    note(label, applyAllergenFilter([named], person.matchers, groupsOf).length === 0 ? "safety" : "gates");
    return null;
  }
  if (proteinRuleOn(person.kept, ask.wants) && breaksProteinRule([...r.usesIngredients, ...r.missingIngredients], person.kept)) {
    note(label, "kept");
    return null;
  }
  seen.add(r.name.trim().toLowerCase());
  return readableAmounts(r);
}

/**
 * ONE streamed model call with a schema-constrained answer, each dish gated
 * the moment it is complete. Stops reading as soon as one gated dish passes
 * `accept` (or the signal fires) and returns the gated dishes so far. [] on
 * any failure. Never retries: the library is the fallback, not a second call.
 */
/** The one SDK call the generator makes; a fake in tests (createLiveDishDeps). */
export type DishModelClient = Pick<Anthropic, "messages">;
const defaultDishClient = (): DishModelClient => createAnthropic({ timeout: 45_000, maxRetries: 0 });

async function generateGated(
  ctx: ClaraContext,
  ask: DishAsk,
  opts: GenerateOptions = {},
  client: () => DishModelClient = defaultDishClient,
  loadRows?: BrainRowsLoader,
): Promise<FridgeRecipe[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const t0 = Date.now();
  const note = (name: string, stage: CandidateTrace["stage"]) => opts.trace?.({ ms: Date.now() - t0, name, stage });
  const [person, catalogFoodTokens] = await Promise.all([personFor(ctx, loadRows), catalogTokens()]);
  if (!person || opts.signal?.aborted) return [];
  const meal = capitalize(ask.mealType);

  // Our own controller: aborted by the deadline, or by us once a dish is accepted.
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const accepted: FridgeRecipe[] = [];
  const seen = new Set<string>();
  try {
    const stream = await client().messages.create(
      {
        model: CLARA_MODEL,
        max_tokens: DISH_MAX_TOKENS,
        thinking: { type: "disabled" },
        stream: true,
        system: dishSystemPrompt({
          ask,
          foodMapText: buildFoodMapText(person.patient),
          bannedNames: forbiddenWordsForPrompt(person.bans, person.matchers),
          proteinOptions: proteinOptionsFor(person.matchers),
          sodiumLimitMg: person.sodiumLimitMg,
          kept: person.kept,
        }),
        // Structured outputs: the answer always parses (no more malformed or stringified lists).
        output_config: { format: { type: "json_schema", schema: DISH_OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: "user", content: `Suggest the ${CANDIDATES} ${meal.toLowerCase()} dishes now.` }],
      },
      { signal: stop.signal },
    );
    const items = new DishItemExtractor();
    let stopReason: string | null = null;
    read: for await (const ev of stream) {
      if (ev.type === "message_delta") stopReason = ev.delta.stop_reason ?? stopReason;
      if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
      for (const item of items.push(ev.delta.text)) {
        const r = await gateOne(item, ask, person, catalogFoodTokens, seen, note);
        if (!r) continue;
        accepted.push(r);
        if (!opts.accept || opts.accept(r)) {
          note(r.name, "accepted");
          break read;
        }
        note(r.name, "card");
      }
      if (stop.signal.aborted) break;
    }
    // No user content in the log: the meal and the stop reason only.
    if (stopReason === "refusal") console.warn(`[clara-dish] ${meal}: stop_reason refusal (the model declined); the library dish covers it`);
  } catch (err) {
    if (!stop.signal.aborted) {
      const e = err as { status?: number; message?: string };
      console.warn(`[clara-dish] generation failed: ${e?.status ?? ""} ${e?.message ?? String(err)}`);
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    stop.abort(); // ends the stream if we stopped early; a no-op after a full read
  }
  if (accepted.length === 0) console.info(`[clara-dish] ${meal}: accepted=0 in ${Date.now() - t0} ms`);
  return accepted;
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

// ─── the library safety net ─────────────────────────────────────────────────

const LIBRARY_SELECT = {
  id: true, name: true, steps: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, sodium: true,
  prepTime: true, cookTime: true, servings: true,
  ingredients: { select: { quantity: true, unit: true, ingredient: { select: { name: true, allergenGroups: true } } } },
} as const;

const mealTypeIds = cached(CACHE_MS, async () => new Map((await prisma.mealType.findMany()).map((m) => [m.name.toLowerCase(), m.id])));
const poolByMeal = new Map<string, () => Promise<LibraryRecipe[]>>();
function libraryPool(mealType: DishMealType): Promise<LibraryRecipe[]> {
  let load = poolByMeal.get(mealType);
  if (!load) {
    load = cached(CACHE_MS, async () => {
      const id = (await mealTypeIds()).get(mealType);
      if (!id) return [];
      return (await prisma.recipe.findMany({ where: { isPublic: true, mealTypeId: id }, select: LIBRARY_SELECT })) as unknown as LibraryRecipe[];
    });
    poolByMeal.set(mealType, load);
  }
  return load();
}

/** What they logged in the last 7 days: never offered again as the fallback. Once per tool call. */
const recentMemo = new WeakMap<ClaraContext, Promise<RecentDishes>>();
function recentFor(ctx: ClaraContext): Promise<RecentDishes> {
  let p = recentMemo.get(ctx);
  if (!p) {
    p = recentDishes(ctx.patientId, ctx.today);
    recentMemo.set(ctx, p);
    p.catch(() => recentMemo.delete(ctx));
  }
  return p;
}

async function recentDishes(patientId: string, today: string): Promise<RecentDishes> {
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const rows = await prisma.mealLog.findMany({
    where: { patientId, localDate: { gte: from.toISOString().slice(0, 10) }, deletedAt: null },
    select: { recipeId: true, name: true },
  });
  return {
    recipeIds: new Set(rows.map((r) => r.recipeId).filter((x): x is string => !!x)),
    names: new Set(rows.map((r) => r.name.trim().toLowerCase())),
  };
}

/**
 * One dish name per meal for the phone's meal notification (2026-11-17,
 * owner: "How does <dish> sound for lunch, <name>?"). The same library pool,
 * rule filter and "not one of their recent dishes" as the fallback above; no
 * model call. A meal with nothing suitable is left out.
 */
export async function mealSuggestionNames(
  patientId: string,
  today: string,
  meals: readonly DishMealType[],
): Promise<Partial<Record<DishMealType, string>>> {
  const ctx = { patientId, today } as ClaraContext;
  const [person, recent] = await Promise.all([personFor(ctx), recentFor(ctx)]);
  if (!person) return {};
  const out: Partial<Record<DishMealType, string>> = {};
  for (const mealType of meals) {
    const pool = await libraryPool(mealType);
    // proteinRule undefined = rankLibrary's default (the at-home protein rule on when it applies).
    const nameFor = (proteinRule?: false) =>
      suggestionName(
        rankLibrary(
          pool,
          { mealType, little: [], aLot: [] },
          { patient: person.patient, matchers: person.matchers, seed: `${patientId}|${today}|${mealType}`, kept: person.kept, proteinRule },
          recent,
          stepStatesAmount,
        ),
      );
    // As the dish fallback: with nothing at-home-friendly, a name as before beats none.
    const name = nameFor() ?? (proteinRuleOn(person.kept, undefined) ? nameFor(false) : null);
    if (name) out[mealType] = name;
  }
  return out;
}

/** How many ranked library recipes are gated at a time (CPU only), until enough pass. */
const LIBRARY_CHUNK = 12;
const LIBRARY_KEEP = 3;

/**
 * Library recipes for this ask, ranked by rankLibrary (the planner's rule
 * filter first) and then put through gateGeneratedDishes exactly like a
 * generated dish, oil repair included. Keeps the first few that pass.
 * `signal` fires once a generated dish is served: from then on no further
 * query is made (the allergen groups for every ranked candidate are loaded in
 * ONE query, after the check).
 * With the at-home protein rule on and nothing passing, it ranks and gates
 * once more without that rule: a dish they could cook beats no dish.
 */
async function libraryGated(ctx: ClaraContext, ask: DishAsk, signal?: AbortSignal, loadRows?: BrainRowsLoader): Promise<FridgeRecipe[]> {
  const [person, pool, recent, catalogFoodTokens] = await Promise.all([
    personFor(ctx, loadRows),
    libraryPool(ask.mealType),
    recentFor(ctx),
    catalogTokens(),
  ]);
  if (!person || signal?.aborted) return [];
  const meal = capitalize(ask.mealType);
  // proteinRule undefined = rankLibrary's default (the rule on when it applies to this ask).
  const rankAndGate = async (proteinRule?: false): Promise<FridgeRecipe[]> => {
    const ranked = rankLibrary(
      pool,
      {
        mealType: ask.mealType,
        maxMinutes: ask.maxMinutes,
        servings: ask.servings,
        little: ask.picture ? ask.picture.little : ask.summary.little,
        aLot: ask.picture ? ask.picture.aLot : ask.summary.aLot,
        ...(ask.wants !== undefined ? { wants: ask.wants } : {}),
      },
      { patient: person.patient, matchers: person.matchers, seed: `${ctx.patientId}|${ctx.today}|${ask.mealType}`, kept: person.kept, proteinRule },
      recent,
      stepStatesAmount,
    );
    if (ranked.length === 0) return [];
    const oil = oilAllowedBy(person.matchers);
    const candidates = ranked.map((r) => specifyCookingOil(libraryToFridge(r, meal, ask.servings ?? 1, `frg_${crypto.randomUUID()}`), oil));
    if (signal?.aborted) return [];
    // The same catalog lookup a generated dish gets, for every candidate at once.
    const groupsOf = await loadIngredientGroups(candidates.flatMap((r) => [...r.usesIngredients, ...r.missingIngredients]));
    const out: FridgeRecipe[] = [];
    for (let i = 0; i < candidates.length && out.length < LIBRARY_KEEP && !signal?.aborted; i += LIBRARY_CHUNK) {
      const gated = gateGeneratedDishes(candidates.slice(i, i + LIBRARY_CHUNK), {
        mealTypeName: meal,
        matchers: person.matchers,
        groupsOf,
        catalogFoodTokens,
        sodiumLimitMg: person.sodiumLimitMg,
      });
      for (const r of gated) if (fibreIsPlausible(r) && pickDish([r], ask)) out.push(readableAmounts(r));
    }
    return out.slice(0, LIBRARY_KEEP);
  };
  const out = await rankAndGate();
  if (out.length > 0 || !proteinRuleOn(person.kept, ask.wants) || signal?.aborted) return out;
  return rankAndGate(false);
}

const BAN_SOURCE_WORDS: Record<string, string> = {
  allergy: "allergy",
  avoid: "a food they avoid",
  condition: "the food list for their condition",
  preference: "their diet",
  motivation: "their goal",
  trial: "a food they are testing as a trigger",
  dislike: "a food they dislike",
};

/**
 * Does what they asked to cook name something their own rules forbid? The
 * SAME matchers the gates judge with, run over the request's words (and the
 * catalog's allergen groups for a food whose name says nothing, like ghee).
 * "peanut-free", "no peanuts" and "without peanuts" say what to leave out, so
 * those words are not judged. Returns the reasons, [] when there are none.
 */
async function liveRequestConflicts(ctx: ClaraContext, wants: string): Promise<string[]> {
  const person = await personFor(ctx);
  if (!person || !hasAnyBan(person.matchers)) return [];
  const asked = wants
    .replace(/[\p{L}-]+[- ]free\b/giu, " ")
    .replace(/\b(?:no|without)\s+[\p{L}-]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!asked) return [];
  const names = [...new Set([asked, asked.replace(/s$/i, "")])].filter((n) => n.length > 0);
  const groupsOf = await loadIngredientGroups(names);
  const { violations } = evaluateDishAgainstProfile(names, person.matchers, names.map((n) => groupsOf(n)));
  const reasons = violations.map((v) => `${BAN_SOURCE_WORDS[v.source] ?? v.source}: ${v.term.replace(/^BIG9-/, "").replace(/-/g, " ").toLowerCase()}`);
  return [...new Set(reasons)];
}

/** The live budget. A mutable object only so the offline simulation can shorten it (sim/clara-first.sim.ts). */
export const dishTiming = { budgetMs: DISH_BUDGET_MS };

/**
 * The production effects. `client` replaces the model client (tests drive the
 * real gates with a fake stream); everything else is the real code.
 */
export function createLiveDishDeps(
  io: { client?: () => DishModelClient; brainRows?: (patientId: string, today: string) => Promise<BrainRows> } = {},
): DishDeps {
  return {
    get budgetMs() {
      return dishTiming.budgetMs;
    },
    // Claims only where Numbers says the same (simulation finding 2).
    loadSummary: (patientId, today) => loadClaraLevelSummary(patientId, today, 7),
    generate: (ctx, ask, opts) => generateGated(ctx, ask, opts, io.client, io.brainRows),
    library: (ctx, ask, signal) => libraryGated(ctx, ask, signal, io.brainRows),
    requestConflicts: liveRequestConflicts,
    loadStartingPicture: async (patientId) => {
      // Computed now from the answers and the live pills (the stored column can be stale).
      const row = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { usualEating: true, supplements: { where: { deletedAt: null }, select: { name: true } } },
      });
      return parseStartingPicture(row && currentStartingPicture(row.usualEating, row.supplements.map((x) => x.name)));
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
}

const prismaDeps: DishDeps = createLiveDishDeps();

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

/** Where the served dish came from: made now by the model, or the public recipe library. */
export type DishSource = "generated" | "library";

interface BuiltDish {
  source: DishSource;
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
function buildDish(r: FridgeRecipe, ask: DishAsk, source: DishSource): BuiltDish {
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
    source,
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
  const shown = new Set((ask.avoid ?? []).map((n) => n.trim().toLowerCase()));
  for (const r of recipes) {
    if (shown.has(r.name.trim().toLowerCase())) continue; // the dish they were just shown
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One dish for one ask, within the time budget, with no second model call:
 *   - the library pick starts at once, alongside the model call;
 *   - the model call stops at the first gated dish that fits the card, or at
 *     the budget (then whatever it already gated still counts);
 *   - no generated dish → the library dish, through the same card;
 *   - neither → null, and the person hears "couldn't make one that fits".
 * With `ask.wants` the order is: a generated dish that says the request
 * (matchesRequest) → a library recipe that says it → a fitting generated dish
 * that does not (served, and flagged to the model as not what they asked) →
 * null. An unrelated library recipe is never served for a request.
 */
async function generateOne(deps: DishDeps, ctx: ClaraContext, ask: DishAsk): Promise<BuiltDish | null> {
  const budget = deps.budgetMs ?? DISH_BUDGET_MS;
  const started = Date.now();
  // Fired once a generated dish is served: the library stops making queries.
  const libraryStop = new AbortController();
  const library: Promise<FridgeRecipe[]> = deps.library
    ? deps.library(ctx, ask, libraryStop.signal).catch((err) => {
        console.warn(`[clara-dish] library failed: ${(err as Error)?.message ?? String(err)}`);
        return [];
      })
    : Promise.resolve([]);

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), budget);
  let recipes: FridgeRecipe[] = [];
  // They asked to cook something particular: a dish that says so (the gates can
  // rename a dish from its ingredients and lose the word) is the one to stop at.
  const wants = ask.wants;
  const saysRequest = (r: FridgeRecipe) => wants === undefined || matchesRequest(wants, r.name, r.usesIngredients);
  try {
    // OFF 2026-11 (Clara-first, spec §8.6): with `wants`, the early stop also needs the dish to say the request; without it the test is the same. Restore: uncomment these two lines and delete the two below them.
    // const generated = deps
    //   .generate(ctx, ask, { signal: deadline.signal, accept: (r) => pickDish([r], ask) !== null })
    const generated = deps
      .generate(ctx, ask, { signal: deadline.signal, accept: (r) => pickDish([r], ask) !== null && saysRequest(r) })
      .catch((err) => {
        console.warn(`[clara-dish] generate threw: ${(err as Error)?.message ?? String(err)}`);
        return [] as FridgeRecipe[];
      });
    // A generator that ignores the signal still cannot hold the person past the budget.
    const late = new Promise<FridgeRecipe[]>((resolve) => {
      deadline.signal.addEventListener("abort", () => void sleep(ABORT_GRACE_MS).then(() => resolve([])), { once: true });
    });
    recipes = await Promise.race([generated, late]);
  } finally {
    clearTimeout(timer);
  }
  // OFF 2026-11 (Clara-first, spec §8.6): with `wants`, a generated dish that says the request is picked first, and one that does not waits behind a matching library recipe. Restore: uncomment this line and delete the `picked` line and the `unmatched` line below it.
  // const picked = pickDish(recipes, ask);
  const picked = pickDish(recipes.filter(saysRequest), ask);
  if (picked) {
    libraryStop.abort();
    return buildDish(picked, ask, "generated");
  }
  // Only with `wants`: a fitting generated dish that does not say the request. Served last, and flagged to the model.
  const unmatched = wants !== undefined ? pickDish(recipes, ask) : null;

  // The library had the whole budget to load; it gets a little more, never unbounded.
  const waitMs = Math.max(0, started + budget + LIBRARY_GRACE_MS - Date.now());
  // OFF 2026-11 (Clara-first, spec §8.6): with `wants`, a library recipe is served only when it says the request, and a generated dish that does not say it is the last resort. Restore: uncomment these two lines and delete the lines below them.
  // const fromLibrary = pickDish(await Promise.race([library, sleep(waitMs).then(() => [] as FridgeRecipe[])]), ask);
  // return fromLibrary ? buildDish(fromLibrary, ask, "library") : null;
  const offered = await Promise.race([library, sleep(waitMs).then(() => [] as FridgeRecipe[])]);
  // They asked to cook something particular: an unrelated library dish is never the answer
  // (the live library already ranks only matches; this holds for any library dep).
  const fromLibrary = pickDish(offered.filter(saysRequest), ask);
  if (fromLibrary) return buildDish(fromLibrary, ask, "library");
  return unmatched ? buildDish(unmatched, ask, "generated") : null;
}

/** After the budget, how long a slow library load may still be waited for. */
const LIBRARY_GRACE_MS = 1_500;

/** What the model narrates from: the card's content, never the recipe itself. */
export const LIBRARY_NOTE =
  "This dish is from the Wondish recipe library, not made just now: never say you made, created or invented it for them. Say it is a recipe from the library that fits them.";

/** Does the served dish say what they asked to cook (its name or its ingredients)? */
function answersRequest(b: BuiltDish, wants: string): boolean {
  return matchesRequest(wants, b.dish.name, b.recipe.ingredients.map((i) => i.name));
}

function dishForModel(b: BuiltDish, mealType: DishMealType, wants?: string) {
  return {
    mealType,
    source: b.source,
    ...(b.source === "library" ? { note: LIBRARY_NOTE } : {}),
    ...(wants !== undefined ? { askedFor: wants, answersRequest: answersRequest(b, wants) } : {}),
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
// OFF 2026-11 (Clara-first, spec §8.6): the last sentence invited a line about logging after every dish. Restore: uncomment these two lines and delete the constant below them.
// const PICTURE_NOTE =
//   "There are not enough logged meals yet, so this is based on their onboarding answers, not on logged meals. Say 'from your answers, you probably get little X' (or 'a lot of X'); never describe their body. Logging meals lets you tailor the next one.";
const PICTURE_NOTE =
  "There are not enough logged meals yet, so this is based on their onboarding answers, not on logged meals. If you give a reason, say 'from your answers, you probably get little X' (or 'a lot of X'); never describe their body, and add nothing about logging unless they ask.";

/**
 * The levels Clara may speak from. Without enough logs (the same rule that
 * keeps Numbers' words null) there is no "little / a lot" claim: the lists are
 * emptied, so no chip row, no reason and no prompt lean-in is built from a
 * day or two of logs. The starting picture, when there is one, replaces them.
 */
function claimableSummary(summary: LevelSummary): LevelSummary {
  return summary.enoughLogs ? summary : { ...summary, little: [], aLot: [] };
}

/** The note for the model: the picture's, nothing logged, or not enough logged yet. */
function levelsNote(summary: LevelSummary, picture: StartingPicture | undefined) {
  if (picture) return { note: PICTURE_NOTE };
  if (summary.daysCounted === 0) return { note: NOTHING_LOGGED_NOTE };
  if (!summary.enoughLogs) return { note: NOT_ENOUGH_LOGS_NOTE };
  return {};
}

/** The picture applies only while logs are not enough and it names at least one level. */
async function pictureFor(deps: DishDeps, ctx: ClaraContext, summary: LevelSummary): Promise<StartingPicture | undefined> {
  if (summary.enoughLogs || !deps.loadStartingPicture) return undefined;
  try {
    return (await deps.loadStartingPicture(ctx.patientId)) ?? undefined;
  } catch {
    // A failed picture load must not fail the dish: fall back to the not-enough-logs path.
    return undefined;
  }
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

/** undefined when absent; null when present but not text of 1 to MAX_WANTS_CHARS characters once trimmed. */
function optionalWants(v: unknown): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return null;
  const text = v.replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= MAX_WANTS_CHARS ? text : null;
}

const MAX_AVOID = 12;
/** undefined when absent or empty; null when present but not a list. Non-text and blank entries are dropped. */
function optionalAvoid(v: unknown): string[] | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return null;
  const names = v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim().slice(0, 120)).filter((x) => x.length > 0);
  return names.length > 0 ? names.slice(-MAX_AVOID) : undefined;
}

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
    const wants = optionalWants(input.wants);
    if (wants === null) return invalid(`wants must be 1 to ${MAX_WANTS_CHARS} characters: what they asked to cook, in their words`);
    const avoid = optionalAvoid(input.avoid);
    if (avoid === null) return invalid("avoid must be a list of dish names");

    // A fresh object per tool call: the person (and their rules) is loaded once
    // for this call, never carried over from an earlier one.
    const call = { ...ctx };
    // What they asked for names something their own rules forbid (eggs, with an
    // egg allergy): say so instead of looking for a dish. If the check itself
    // fails, go on — every served dish still passes the gates.
    if (wants !== undefined && deps.requestConflicts) {
      let because: string[] = [];
      try {
        because = await deps.requestConflicts(call, wants);
      } catch (err) {
        console.warn(`[clara-dish] request check failed: ${(err as Error)?.message ?? String(err)}`);
      }
      if (because.length > 0) return { ok: false, reason: "FAILED", message: cannotFitRequestNote(wants, because) };
    }

    const loaded = await deps.loadSummary(ctx.patientId, ctx.today);
    const picture = await pictureFor(deps, ctx, loaded);
    const summary = claimableSummary(loaded);
    const ask: DishAsk = {
      mealType: mealType as DishMealType,
      summary,
      ...(picture ? { picture } : {}),
      ...(maxMinutes !== undefined ? { maxMinutes } : {}),
      ...(servings !== undefined ? { servings } : {}),
      ...(wants !== undefined ? { wants } : {}),
      ...(avoid !== undefined ? { avoid } : {}),
    };
    // OFF 2026-11 (Clara-first, spec §8.6): the per-call ctx copy is now made above (`call`) so the request check and the dish share one person load, and a missed request gets its own message. Restore: uncomment these lines and delete the two below them.
    // // A fresh object per tool call: the person (and their rules) is loaded once
    // // for this call, never carried over from an earlier one.
    // const built = await generateOne(deps, { ...ctx }, ask);
    // if (!built) return couldntFit();
    const built = await generateOne(deps, call, ask);
    if (!built) return wants !== undefined ? { ok: false, reason: "FAILED", message: couldntMakeRequestNote(wants) } : couldntFit();
    const levels = picture ? null : levelsPart(summary);

    return {
      ok: true,
      data: {
        dish: dishForModel(built, ask.mealType, wants),
        levels: picture ? pictureForModel(picture) : levelsForModel(summary),
        ...levelsNote(summary, picture),
        ...(wants !== undefined ? { request: answersRequest(built, wants) ? requestAnsweredNote(wants) : requestNotMatchedNote(wants) } : {}),
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

    const [loaded, logged] = await Promise.all([
      deps.loadSummary(ctx.patientId, ctx.today),
      deps.loggedMealTypes(ctx.patientId, ctx.today),
    ]);
    const picture = await pictureFor(deps, ctx, loaded);
    const summary = claimableSummary(loaded);
    const loggedSet = new Set(logged.map((m) => m.toLowerCase()));
    const eatingOut = occasion === "eating_out";
    const meals = PLANNED_MEALS.filter((m) => !loggedSet.has(m) && !(eatingOut && m === "dinner"));

    const notes = {
      ...levelsNote(summary, picture),
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
    // One ctx object for the whole call: the person loads once for all its dishes.
    const call = { ...ctx };
    const built = await Promise.all(asks.map((ask) => generateOne(deps, call, ask)));
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

/** The production effects, for the live simulation (sim/clara-fast-live.sim.ts) to wrap with a trace. */
export const liveDishDeps: DishDeps = prismaDeps;

const handlers = makeDishHandlers();

export const dishSkill: Skill = {
  name: "dish",
  promptFragment: [
    // OFF 2026-11 (Clara-first, spec §8.6): the opening now also covers a request to cook something particular (dish_suggest's wants). Restore: uncomment this line and delete the two strings below it.
    // "About your dish_ tools: dish_suggest suggests ONE dish to cook now, chosen from what they have eaten this week (the levels); dish_plan_today suggests one dish for each of today's meals they have not logged yet. A dish is either made just now or taken from the Wondish recipe library — each result's source says which; for a library dish follow its note and never say you made or created it. Both only suggest — nothing is logged or saved, and the app shows each dish as a card with its reasons and steps, so name the dish and its reasons briefly instead of writing out the recipe.",
    "About your dish_ tools: dish_suggest suggests ONE dish to cook now, fitted to what they have eaten this week (the levels) — either one you pick for them, or the dish they asked to cook; dish_plan_today suggests one dish for each of today's meals they have not logged yet. A dish is either made just now or taken from the Wondish recipe library — each result's source says which; for a library dish follow its note and never say you made or created it. Both only suggest — nothing is logged or saved, and the app shows each dish as a card with its reasons and steps, so do not repeat what the card shows and never write out the recipe.",
    "When they ask to cook or make something particular (\"help me cook eggs\", \"how do I make pancakes\", \"cook salmon with me\"), call dish_suggest with wants set to what they asked for, in their words, and the mealType that dish is usually eaten as unless they say which meal. Do NOT write the recipe or the steps in your reply: only the dish card opens step-by-step cooking with timers. Follow the result's request note: when the dish answers their request, say it is a way to cook that which fits them; when the note says the dish is not what they asked for, say so. If the result says what they asked for does not fit them, tell them why in plain words and offer a dish that does fit; if it says it couldn't put that together right now, say exactly that and offer to try again. A plain technique question with no dish to cook (\"how long do I boil an egg?\") needs no tool: answer it in text.",
    "Talk about what they have EATEN, never their body: \"you've had little fibre this week\", never \"your fibre is low\". When the result's levels say source answers (not enough logs yet), say \"from your answers, you probably get little fibre\". The only level words are little, on track, within limit and a lot.",
    "If the result has a note that nothing (or not enough) is logged yet, say so in a few plain words, make no little or a lot claim, and still offer the dish. If a dish comes back as couldn't make one that fits, say exactly that and offer to try again — never describe a dish you were not given.",
    `Before dish_plan_today, ask "Anything happening today?" once with ask_choices, options exactly "${OCCASION_OPTIONS[0]}", "${OCCASION_OPTIONS[1]}", "${OCCASION_OPTIONS[2]}", "${OCCASION_OPTIONS[3]}" — then pass occasion normal, eating_out, guests or little_time. It is optional: if they already said what today is like, skip the question. When they are eating out, ask them to send the menu.`,
  ].join(" "),
  tools: [
    {
      def: {
        name: "dish_suggest",
        description:
          // OFF 2026-11 (Clara-first, spec §8.6): the description now also sends a request to cook something particular here, with wants. Restore: uncomment this line and delete the string below it.
          // "Suggest ONE dish for them to cook, based on what they have eaten this week: made just now, or a recipe from the Wondish library when that fits better or faster (the result's source says which). Use for 'what should I eat', 'what should I cook tonight', 'give me a dinner idea'. NOT for what is already on their meal plan (plan_get) and NOT for whether a named dish fits them (answer directly). Suggests only; logs nothing.",
          "Suggest ONE dish for them to cook, based on what they have eaten this week: made just now, or a recipe from the Wondish library when that fits better or faster (the result's source says which). The app shows it as a dish card, the only thing that opens step-by-step cooking with timers. Use for 'what should I eat', 'what should I cook tonight', 'give me a dinner idea'. ALSO use, with wants, whenever they ask to cook or make something particular: 'help me cook eggs', 'how do I make pancakes', 'cook salmon with me', 'I want to make a lentil soup' — pass what they asked for in wants instead of writing the recipe yourself. NOT for what is already on their meal plan (plan_get) and NOT for whether a named dish fits them (answer directly). NOT for a plain technique question with no dish to cook ('how long do I boil an egg?': answer directly). Suggests only; logs nothing.",
        input_schema: {
          type: "object",
          properties: {
            mealType: { type: "string", enum: [...MEAL_TYPES], description: "Which meal the dish is for." },
            maxMinutes: { type: "number", description: "Most minutes the dish may take in total, when they are short of time." },
            servings: { type: "number", description: "How many people it serves; omit for one." },
            wants: {
              type: "string",
              description:
                "What they asked to cook, in their words, short (1 to 80 characters): 'eggs', 'scrambled eggs', 'a chicken stir-fry'. Set it only when they named a dish or an ingredient to cook; omit it for 'what should I eat'.",
            },
            avoid: {
              type: "array",
              items: { type: "string" },
              description: "Names of dishes you already showed them in this chat, when they ask for something else or another one, so the same dish does not come back.",
            },
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
          "Suggest one dish for each of today's meals they have not logged yet (each made just now or from the recipe library; each result's source says which). Use for 'plan my day', 'plan today's dishes', 'what should I eat today'. NOT for the saved meal plan (plan_get). Suggests only; logs nothing.",
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
