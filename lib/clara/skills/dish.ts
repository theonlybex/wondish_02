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
import { foodMatches, proteinRuleOn, NO_KEPT_FOODS, type KeptFoods } from "@/lib/clara/kept-foods";
import { keptFoodsFrom, loadCatalogRows, loadKeptMarks } from "@/lib/clara/kept-foods-db";
import { groceryGroups, type GroceryGroup } from "@/lib/clara/grocery";
import { brainFrom, steerForAsk, NO_BRAIN_ROWS, type AskSteer, type BrainRows, type DishBrain } from "@/lib/clara/dish-brain";
import { builtOn, eggsOnlyKitchen, proteinKind } from "@/lib/clara/dish-protein";
import { dishShape, judgeDish, keepWayOfCooking, starchFamily, type DishShape, type DishVerdict } from "@/lib/clara/dish-judge";
import { plainSwap, swapInRecipe, swapOptions } from "@/lib/clara/exchange";
import { RULES_PROMPT, ruleTools } from "@/lib/clara/skills/rules";
import { chooseProtein, fnv1a, fromHomeLine, requestedProtein, sameProteinKind, type FromHome } from "@/lib/clara/protein-rule";
import { targetLines } from "@/lib/clara/meal-target";
import { exampleAllergenGroups, steerLines, levelCeilings } from "@/lib/clara/level-steer";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import { loadBrainRows } from "@/lib/clara/dish-brain-db";
import { DEFAULT_DISH_RULES, DISH_RULE_KEYS, ruleFood, ruleFoodMatches, storedRulesFrom, type DishRules } from "@/lib/clara/dish-rules";
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
import { dishReasons } from "@/lib/dish-reasons";
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
  /**
   * Set by dish_plan_today only. Lunch and dinner are made at the same time on the
   * same chosen protein, so each is told its part of the day: a lighter lunch, a
   * fuller dinner. Prompt only; no gate reads it.
   */
  dayPlan?: boolean;
  /**
   * The ingredients check before cooking (piece B): they were about to cook `dish` and do not
   * have `from`. Set together with `wants` (what takes its place) and `without`.
   */
  swap?: { dish: string; from: string; ingredients: string[]; steps: string[]; calories: number; others: string[] };
  /** Foods they said they do not have: told to the generator, and a dish that uses one is dropped by the judge. */
  without?: string[];
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
  /**
   * Every candidate the judge did not fail, "pass" or "relaxed", before
   * `accept` is asked. A "relaxed" one is reported here only, never returned:
   * it is ladder step 2 (generateOne).
   */
  judged?: (j: JudgedDish) => void;
}

/** A dish that passed the gates, with the judge's verdict and its "from your kitchen" line (null when nothing is marked). */
export interface JudgedDish {
  recipe: FridgeRecipe; verdict: DishVerdict; fromHome: FromHome | null;
  /** Set by the generator: built on the protein chosen for today. Absent from the library and when no protein is chosen. */
  onTodaysProtein?: boolean;
}

export type CandidateTrace = {
  /** ms since the generator started. */
  ms: number;
  name: string;
  /**
   * "kept": the judge failed it on the at-home protein rule. "judge": the judge
   * failed it on honesty or a level limit. "relaxed": only the size or the
   * protein share failed; kept aside for ladder step 2.
   */
  stage: "parse" | "safety" | "gates" | "kept" | "judge" | "relaxed" | "card" | "accepted";
  /** The judge's reasons, when the judge dropped it. */
  reasons?: string[];
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
   * `judged` hears the verdict of each recipe returned.
   */
  library?(ctx: ClaraContext, ask: DishAsk, signal?: AbortSignal, judged?: (j: JudgedDish) => void): Promise<FridgeRecipe[]>;
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
    const prosed1 = cooked && !seen.has(cooked.trim().toLowerCase()) ? { ...derinsed, name: cooked } : derinsed;
    // A name rebuilt from the ingredients keeps how the dish is cooked (see keepWayOfCooking).
    const withWay = keepWayOfCooking(raw.name, prosed1.name, [...prosed1.usesIngredients, ...prosed1.missingIngredients]);
    const prosed = withWay !== prosed1.name && !seen.has(withWay.trim().toLowerCase()) ? { ...prosed1, name: withWay } : prosed1;

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
/** Today's dish names in the "already open today" sentence: the latest 6, each at most 60 characters. */
const MAX_USED_TODAY_IN_PROMPT = 6;
const MAX_USED_TODAY_NAME = 60;
/** A dish name for the prompt: no quotes, breaks or semicolons, cut at a word, never ending on "and" or "with". */
export function promptDishName(name: string): string {
  const clean = name.replace(/["\n\r;]+/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_USED_TODAY_NAME) return clean;
  const cut = clean.slice(0, MAX_USED_TODAY_NAME + 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/(\s+(and|with|on|over|in|of|the|a))+$/i, "").trim();
}
/** At-home proteins a breakfast can be built on. */
const BREAKFAST_PROTEIN_KEYS: ReadonlySet<string> = new Set(["egg", "greek yogurt", "cottage cheese", "tofu", "bean"]);

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

/** Craft lines every dish prompt carries, placed after the naming line. */
export const DISH_CRAFT_LINES: readonly string[] = [
  `- One person's portion of dry rice is 45–80 g.`,
  `- Never name a dish "X-free" or "no X": name it by what is in it.`,
  `- A dish named after a preparation must contain what that preparation needs: a bolognese has tomato, a curry has spices, a scramble has egg, a pesto has basil.`,
  `- Ingredient names are plain food names, with no comma and no state or cut after it: "jasmine rice", "carrots" — never "jasmine rice, dry" or "carrots, peeled and sliced".`,
] as const;

// Catalog name (lowercased) → its group title, for grouping the at-home list.
const CATALOG_GROUP_OF = new Map<string, string>();
for (const g of INGREDIENT_CATALOG) for (const item of g.items) if (!CATALOG_GROUP_OF.has(item.toLowerCase())) CATALOG_GROUP_OF.set(item.toLowerCase(), g.title);

/** "Group: a, b; Other: c" — groups in catalog order, names in the given order, names outside the catalog last under Other. Names are not yet cleaned. */
function groupedAtHome(names: readonly string[]): { title: string; names: string[] }[] {
  const byTitle = new Map<string, string[]>();
  for (const n of names) {
    const title = CATALOG_GROUP_OF.get(n.trim().toLowerCase()) ?? "Other";
    byTitle.set(title, [...(byTitle.get(title) ?? []), n]);
  }
  const order = [...INGREDIENT_CATALOG.map((g) => g.title), "Other"];
  return order.filter((t) => byTitle.has(t)).map((t) => ({ title: t, names: byTitle.get(t)! }));
}

/** What a main may be built on, besides their eggs, in an eggs-only kitchen. */
const MEAT_FREE_PROTEINS = ["beans", "lentils", "chickpeas", "tofu", "Greek yogurt", "cottage cheese"] as const;
const orWords = (w: readonly string[]) => (w.length > 1 ? `${w.slice(0, -1).join(", ")} or ${w[w.length - 1]}` : w.join(""));

const MAX_RECENT_IN_PROMPT = 8;
const LUNCH_STYLES = ["a bowl", "a warm salad", "a wrap or a sandwich", "a quick skillet", "a soup"] as const;
const DINNER_STYLES = ["a tray bake or a roast", "a pan dish with a sauce", "a stir-fry", "a stew or a curry", "stuffed or baked vegetables", "a skillet with a cooked side"] as const;
const SLOW_STYLE = /bake|roast|stew|stuffed/;
/** The kind of dish today's lunch or dinner leans to: fixed for a person and day, different day to day. */
export function styleOfTheDay(patientId: string, today: string, mealType: "lunch" | "dinner", maxMinutes?: number): string {
  return shapeOfTheDay({ patientId, today, mealType, maxMinutes, protein: null, homeStarches: [], used: [] }).style;
}

/**
 * Today's dish, chosen in code: a kind of dish and, when they have a starch at home, which one.
 * It starts where the day's rotation points and moves on past anything that would repeat a dish they
 * had today or in the last days (the same protein, starch and way of cooking) or that needs bread
 * they do not have. Live run 6, 2026-11-22: a fixed "make it a bowl" on a salmon day, after a salmon
 * rice skillet, asked for the very repeat the judge then turned down.
 */
export function shapeOfTheDay(a: {
  patientId: string; today: string; mealType: "lunch" | "dinner"; maxMinutes?: number;
  /** Today's protein key, or null when none is chosen. */
  protein: string | null;
  /** The starches they have at home, one name per family. */
  homeStarches: readonly { family: string; name: string }[];
  /** Dish names they had today or in the last days, or were just shown. */
  used: readonly string[];
  /** Shapes already taken that have no name yet (a day plan's lunch, when choosing its dinner). */
  usedShapes?: readonly DishShape[];
}): { style: string; starch: string | null } {
  const all: readonly string[] = a.mealType === "lunch" ? LUNCH_STYLES : DINNER_STYLES;
  const hasBread = a.homeStarches.some((x) => x.family === "bread");
  const styles = all
    .filter((x) => !(a.maxMinutes !== undefined && a.maxMinutes <= 30 && SLOW_STYLE.test(x)))
    // A wrap needs the bread; with a marked kitchen that has none, it is not asked for.
    .filter((x) => !(a.homeStarches.length > 0 && !hasBread && /wrap|sandwich/.test(x)));
  const [y, m, d] = a.today.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const start = fnv1a(`${a.patientId}|${a.mealType}`) + dayNumber;
  // In a wrap the bread is the starch.
  const starchesFor = (style: string) =>
    /wrap|sandwich/.test(style) ? a.homeStarches.filter((x) => x.family === "bread") : a.homeStarches.filter((x) => x.family !== "bread" || a.homeStarches.length === 1);
  const protein = a.protein && a.protein.startsWith("ground ") ? a.protein.slice(7) : a.protein;
  const usedShapes = [...a.used.map(dishShape), ...(a.usedShapes ?? [])];
  const repeats = (style: string, family: string | null) => {
    const way = dishShape(style).way;
    return usedShapes.some((u) => u.way === way && (protein === null || u.protein === protein) && (family === null || u.starch === family));
  };
  let fallback: { style: string; starch: string | null } | null = null;
  for (let i = 0; i < styles.length; i++) {
    const style = styles[(start + i) % styles.length];
    const starches = starchesFor(style);
    const options: (typeof starches[number] | null)[] = starches.length > 0 ? starches.map((_, k) => starches[(start + i + k) % starches.length]) : [null];
    for (const opt of options) {
      const pick = { style, starch: opt?.name ?? null };
      fallback ??= pick;
      if (!repeats(style, opt?.family ?? null)) return pick;
    }
  }
  return fallback ?? { style: styles[0] ?? all[0], starch: null };
}

/** The day plan's lunch and dinner lines (see DishAsk.dayPlan). */
// No "lighter" or "fuller": the size lines say how big each is (the lunch is the bigger of the two).
export const DAY_PLAN_LUNCH_LINE = `- This is the day's lunch: make it the quicker of the day's two main dishes.`;
export const DAY_PLAN_DINNER_LINE = `- This is the day's dinner: make it the more cooked of the day's two main dishes, and a different kind of dish from the lunch.`;

export function dishSystemPrompt(a: {
  ask: DishAsk;
  foodMapText: string;
  /** forbiddenWordsForPrompt: every banned name and allergy word. */
  bannedNames: string[];
  proteinOptions: string[];
  sodiumLimitMg: number;
  /** What they keep at home and love; used only when `brain` is absent (the brain carries its own). */
  kept?: KeptFoods;
  /** Everything the dish brain knows about them. Absent: a brain built from `kept` alone (no reads). */
  brain?: DishBrain;
  /** Who and which day, for today's protein and the rotation. */
  who?: { patientId: string; today: string };
}): string {
  const { ask } = a;
  const brain = a.brain ?? brainFrom({ kept: a.kept ?? NO_KEPT_FOODS });
  const steer = safeSteerForAsk(brain, ask, a.who ?? { patientId: "", today: "1970-01-01" });
  const kept = brain.kept;
  // Catalog names, but cleaned like the avoid names all the same: no quotes, no line breaks.
  const cleanOne = (n: string) => n.replace(/["\n\r]+/g, "");
  const clean = (names: readonly string[]) => names.map(cleanOne).join(", ");
  const meal = capitalize(ask.mealType);
  const homeKeys = new Set(brain.home.map((p) => p.key));
  const homeMeats = brain.home.filter((p) => p.cls === "meat").map((p) => p.name);
  // Anything marked at home (under the switches): the wording turns to what they have.
  const homeNames = [...kept.proteinNames, ...kept.atHome];
  const marked = homeNames.length > 0;
  // Level examples, for everyone with a ban: never a food their diet bans ("walnuts" for a tree-nut
  // allergy, "beef" for a vegetarian), through the same check as liked foods. A line whose every
  // example is banned is stated without examples.
  const dietMatchers = brain.matchers && hasAnyBan(brain.matchers) ? brain.matchers : null;
  // Nor a food their own rule rules out ("spinach" as the iron example beside "Never put spinach").
  const notRuled = (food: string) => !brain.ruleFoods.some((f) => ruleFoodMatches(f, food));
  const dietKeeps = dietMatchers
    ? (food: string) => notRuled(food) && evaluateDishAgainstProfile([food], dietMatchers, [exampleAllergenGroups(food)]).passed
    : brain.ruleFoods.length > 0 ? notRuled : undefined;
  /** The foods this prompt names in passing ("an onion, garlic, a lemon"), without the ones their rules rule out. */
  const named = (foods: readonly string[]) => foods.filter(notRuled);
  // Lunch and dinner in an eggs-only kitchen: any meat-free protein will do (see eggsOnlyKitchen).
  const isMainMeal = ask.mealType === "lunch" || ask.mealType === "dinner";
  const freeMain = steer.ruleOn && isMainMeal && eggsOnlyKitchen(brain.home);
  // The at-home protein rule replaces today's protein line, banned names or not.
  let proteinLine = "";
  if (steer.need === "skip") {
    // One lunch in two, with protein on track: a dish with no meat, fish or eggs at its centre.
    proteinLine = `- Make this ${meal} without meat, fish or eggs: a salad, a vegetable plate, a soup, or a potato or grain dish. They are getting enough protein this week, so this one does not need it.`;
  } else if (steer.ruleOn && steer.choice) {
    // Lunch and dinner with no request of their own: built on ONE at-home protein, chosen in code.
    const choiceName = cleanOne(steer.choice.name);
    // Protein is a need of the day (see proteinNeed): asked for when they need it, optional when
    // the week is on track, kept modest when a condition calls for that.
    proteinLine = steer.need === "push"
      // One protein to a dish: with a small kitchen the model put an egg on four beef dishes in six (live run 4).
      ? `- Build this ${meal} on ${choiceName}, which they have at home.`
      : steer.need === "hold"
        ? `- Their condition calls for modest protein: keep the protein portion of this ${meal} small. If it has a protein food, make it ${choiceName}, which they have at home.`
        : brain.rules.mainsOnProtein
          ? `- This ${meal} does not have to be built on a protein: they are getting enough this week, so a salad, a vegetable plate or a potato dish is fine too. If it has a protein at its centre, make it ${choiceName}, which they have at home.`
          // Their own switch, not their week: nothing is claimed about how much protein they get.
          : `- This ${meal} does not have to be built on a protein: a salad, a vegetable plate or a potato dish is fine too. If it has a protein at its centre, make it ${choiceName}, which they have at home.`;
    if (steer.choice.why === "today" && brain.usedToday.length > 0) {
      const used = brain.usedToday.slice(-MAX_USED_TODAY_IN_PROMPT).map(promptDishName);
      proteinLine += ` It is already open today, so make a different dish from: ${used.join("; ")}. Different means another starch or another way of cooking; the same dish with its name reworded, or with one food added, does not count.`;
    }
    proteinLine += homeMeats.length > 0
      ? ` Any other meat, fish or seafood in it must be one of these, which they have at home: ${clean(homeMeats)}; use no other meat, fish or seafood: not in an ingredient, the dish name, the description or a step.`
      : ` Use no meat, fish or seafood: not in an ingredient, the dish name, the description or a step.`;
    if (steer.need === "push") {
      proteinLine += ` This protein is the heart of the dish. Where a line above says to build the dish on or around another food, add a portion of that food to this dish instead; do not replace ${choiceName}. Use that one protein only: no egg on top and no second meat or fish.`;
    }
  } else if (freeMain) {
    const eggs = clean(brain.home.filter((p) => p.cls === "egg").map((p) => p.name));
    const others = MEAT_FREE_PROTEINS.filter((f) => dietKeeps?.(f) ?? true);
    const orOthers = others.length > 0 ? `, or ${ask.wants === undefined ? "" : "another meat-free one: "}${orWords(others)}` : ``;
    proteinLine = (ask.wants === undefined && steer.need === "push"
      ? `- Build this ${meal} on a meat-free protein: ${eggs}, which they have at home${orOthers}.`
      : `- If this dish has a protein food, make it ${eggs}, which they have at home${orOthers}.`)
      + ` Use no meat, fish or seafood: not in an ingredient, the dish name, the description or a step.`;
  } else if (steer.ruleOn) {
    // Breakfast, a snack and a request: any protein food must be at home, none is required.
    proteinLine = `- If this dish has a protein food (meat, fish, seafood, eggs, tofu, tempeh, seitan, or beans, lentils, chickpeas, Greek yogurt or cottage cheese as its main protein), it must be one they have at home: ${clean(brain.home.map((p) => p.name))}. No other meat, fish or seafood may appear in any dish: not in an ingredient, the dish name, the description or a step.`;
    // A lunch or dinner request that names no protein ("a stir-fry") still leans on the protein a
    // plain main would be built on today, so eggs do not stand in for the salmon they have.
    // Same inputs as steerForAsk's choice, without the request; no read.
    const isMain = ask.mealType === "lunch" || ask.mealType === "dinner";
    const wants = ask.wants?.trim();
    const lean = isMain && wants && requestedProtein(wants) === null
      ? chooseProtein({
          mealType: ask.mealType,
          home: brain.home,
          usedToday: [...brain.usedToday, ...(ask.avoid ?? [])],
          ...(a.who ?? { patientId: "", today: "1970-01-01" }),
          rules: brain.rules,
        })
      : null;
    if (lean) {
      proteinLine += ` If this dish has a protein at its centre, make it ${cleanOne(lean.name)}, which they have at home; a dish that needs no protein (pancakes, a salad, a soup) stays as asked.`;
    }
  } else if (a.proteinOptions.length > 0 && a.bannedNames.length > 0) {
    // Not for an exchange: the dish is given, and "build every main around lean beef" was said to someone exchanging their beef for mushrooms.
    proteinLine = ask.swap ? "" : `- Protein sources that fit this person — build every main around one of them: ${a.proteinOptions.join(", ")}.`;
  }
  // A day plan makes lunch and dinner at once on the same chosen protein, with nothing else keeping
  // them apart (final review, 2026-11-21): the same protein in different dishes.
  const dayPlanLine = ask.dayPlan && (steer.choice || freeMain)
    ? ask.mealType === "lunch"
      ? DAY_PLAN_LUNCH_LINE
      : ask.mealType === "dinner"
        ? DAY_PLAN_DINNER_LINE
        : ``
    : ``;
  // The week stays varied two ways (live run, 2026-11-22: one rice bowl four times in a week):
  // what their log says they had in the last days is not repeated, and each day leans to a
  // different kind of dish, by person and day like the protein rotation. Neither is checked by the judge.
  const plainMain = isMainMeal && ask.wants === undefined;
  const recent = [...new Set(brain.usedRecently.map(promptDishName).filter(Boolean))].slice(-MAX_RECENT_IN_PROMPT);
  const recentLine = plainMain && recent.length > 0
    ? `- They had these in the last few days; make a clearly different dish, not one of these and not a small variation of one (the same protein, starch and way of cooking under another name): ${recent.join("; ")}.`
    : ``;
  const whoIs = a.who ?? { patientId: "", today: "1970-01-01" };
  const homeStarches: { family: string; name: string }[] = [];
  for (const n of homeNames) {
    const family = starchFamily(n);
    if (family && !homeStarches.some((x) => x.family === family)) homeStarches.push({ family, name: cleanOne(n) });
  }
  const shapeFor = (mealType: "lunch" | "dinner", usedShapes: readonly DishShape[] = []) =>
    shapeOfTheDay({
      patientId: whoIs.patientId, today: whoIs.today, mealType, maxMinutes: ask.maxMinutes,
      protein: steer.need === "skip" ? null : steer.choice?.key ?? null, homeStarches,
      used: [...brain.usedToday, ...brain.usedRecently, ...(ask.avoid ?? [])],
      usedShapes,
    });
  // A day plan writes lunch and dinner at the same moment, so neither can see the other (live runs
  // 3-5: the same beef-and-rice dish as a bowl and as a skillet). Code decides both kinds up front:
  // the dinner's kind is chosen with the lunch's already taken.
  const lunchTaken = (): DishShape[] => {
    const lunch = shapeFor("lunch");
    const key = steer.choice?.key ?? null;
    return [{ protein: key && key.startsWith("ground ") ? key.slice(7) : key, starch: lunch.starch ? starchFamily(lunch.starch) : null, way: dishShape(lunch.style).way }];
  };
  const shape = plainMain
    ? shapeFor(ask.mealType as "lunch" | "dinner", ask.dayPlan && ask.mealType === "dinner" ? lunchTaken() : [])
    : null;
  const styleLine = shape && brain.rules.keepWeekVaried
    ? `- To keep their week varied, make today's ${meal} ${shape.style}${shape.starch ? `, with ${shape.starch} as its starch,` : ""} if that suits what they have; otherwise the nearest thing to it.`
    : ``;
  const atHome = kept.atHome.slice(0, MAX_AT_HOME_IN_PROMPT);
  const atHomeLine = atHome.length > 0
    ? `- Build every dish mainly from what they have at home and their kitchen basics; where a classic ingredient is missing, use the closest at-home food. You may add a few common fresh ingredients (${named(["an onion", "garlic", "a lemon", "a herb"]).join(", ")}) when the dish needs them. Use the at-home foods that make a good dish, not all of them at once: one starch (rice, potatoes, pasta or bread) per dish. At home: ${groupedAtHome(atHome).map((g) => `${g.title}: ${clean(g.names)}`).join("; ")}.`
    : ``;
  const basicsLine = brain.basics.length > 0
    ? `- Kitchen basics they always have: ${clean(brain.basics)}. Common fresh seasonings (${named(["lemon", "garlic", "fresh herbs", "pepper"]).join(", ")}) may be used too; list each one you use in ingredients with its amount. Cook with one of these fats${atHome.length > 0 ? " or with an oil from the at-home list" : ""}.`
    : ``;
  // A favourite protein they do not have at home would contradict the rule.
  const favorites = steer.ruleOn
    ? brain.favourites.filter((f) => {
        const k = proteinKind(f);
        return !k || homeKeys.has(k.key) || (freeMain && k.cls !== "meat");
      })
    : brain.favourites;
  // Breakfast and snack: with the rule on, name only the proteins they have.
  const orList = (names: readonly string[]) => names.map(cleanOne).join(" or ");
  const morning = brain.home.filter((p) => BREAKFAST_PROTEIN_KEYS.has(p.key)).map((p) => p.name);
  // The line that breaks the tie with the level lines, which sit below the breakfast and snack lines.
  const ADD_DONT_REPLACE = ` Add what the lines below ask for to this; do not replace it.`;
  // A time limit shorter than the meal's own wins, so one prompt never gives two.
  const breakfastMinutes = Math.min(BREAKFAST_MAX_MINUTES, ask.maxMinutes ?? BREAKFAST_MAX_MINUTES);
  const snackMinutes = Math.min(SNACK_MAX_MINUTES, ask.maxMinutes ?? SNACK_MAX_MINUTES);
  let breakfastLine = `- This is BREAKFAST: morning food, under ${breakfastMinutes} minutes in total, built on a breakfast protein (${named(["eggs", "yoghurt", "cottage cheese", "cheese", "nut butter", "nuts", "beans", "tofu"]).join(", ")}). Not a braise, a roast or a rice bowl.`;
  let snackLine = `- This is a SNACK: small and quick, under ${snackMinutes} minutes in total, with no added salt. ${named(["Fruit", "yoghurt", "nuts", "toast", "a boiled egg"]).join(", ")}, raw vegetables and a dip.`;
  if (steer.ruleOn) {
    breakfastLine = (morning.length > 0
      ? `- This is BREAKFAST: morning food, under ${breakfastMinutes} minutes in total, built on ${orList(morning)}${morning.length > 1 ? "," : ""} or on ${orWords(named(["cheese", "nut butter", "nuts"]))}. Not a braise, a roast or a rice bowl.`
      : `- This is BREAKFAST: morning food, under ${breakfastMinutes} minutes in total, built on ${orWords(named(["cheese", "nut butter", "nuts"]))}, or on ${orList(brain.home.map((p) => p.name))} if one suits a breakfast. Not a braise, a roast or a rice bowl.`) + ADD_DONT_REPLACE;
    const eggs = brain.home.some((p) => p.key === "egg");
    const yoghurt = homeNames.some((n) => /\byogh?urt\b/i.test(n));
    snackLine = `- This is a SNACK: small and quick, under ${snackMinutes} minutes in total, with no added salt. ${named(["Fruit", ...(yoghurt ? ["yoghurt"] : []), "nuts", "toast", ...(eggs ? ["a boiled egg"] : [])]).join(", ")}, raw vegetables and a dip.${ADD_DONT_REPLACE}`;
  }
  // Level examples, with the rule on: only proteins the dish may use. A main keeps the chosen meat
  // and any other protein at home; a breakfast or snack keeps no meat or fish; a request keeps what is at home.
  const choiceKey = steer.ruleOn && steer.choice ? steer.choice.key : null;
  const ruleKeeps = steer.ruleOn
    ? (food: string) => {
        const k = proteinKind(food);
        if (!k) return true;
        if (k.cls !== "meat") return freeMain || homeKeys.has(k.key);
        if (choiceKey !== null) return sameProteinKind(choiceKey, k.key);
        if (ask.mealType === "snack" || ask.mealType === "breakfast") return false;
        return brain.home.some((p) => p.cls === "meat" && sameProteinKind(p.key, k.key));
      }
    : undefined;
  const keepExample = ruleKeeps && dietKeeps
    ? (food: string) => ruleKeeps(food) && dietKeeps(food)
    : ruleKeeps ?? dietKeeps;
  const sodiumMax = steer.ceilings.sodium !== undefined && steer.ceilings.sodium < a.sodiumLimitMg
    ? Math.floor(steer.ceilings.sodium / 10) * 10
    : null;
  // The protein line already builds the dish on the chosen protein; a second "behind on protein:
  // build on eggs" line beside it put eggs on top of every beef and salmon dish (live run, 2026-11-22).
  const steered = steer.ruleOn && steer.choice && steer.need === "push"
    ? steer.levels.filter((l) => !(l.key === "protein" && l.direction === "more"))
    : steer.levels;
  const levelLines = steerLines(steered, {
    ...(sodiumMax !== null ? { sodiumMaxMg: sodiumMax } : {}),
    ...(marked ? { atHome: homeNames } : {}),
    ...(keepExample ? { keepExample } : {}),
    // The protein (a main's chosen one, or the breakfast or snack base) is the dish; fibre is added to it.
    ...(steer.ruleOn ? { fibreAdded: true } : {}),
  });
  const opening = steer.ruleOn || marked
    ? `The app shows the first one that passes its checks, so put first the dish that follows every rule below most closely, then the next.`
    : `The app shows the first one that passes its checks, so put the simplest, surest fit first.`;
  const servings = ask.servings ?? 1;
  const units = DISH_UNITS.filter((u) => u !== "").join(", ");
  return [
    ask.swap
      // An exchange is one dish written again, not a new dish to think up (live swap run 2, 2026-11-22:
      // "what they asked for is the dish's main idea ... the simplest first" turned a potato skillet into a seared fillet on rice).
      ? `You are Clara, Wondish's nutrition assistant. This person is about to cook a ${meal} and is missing one ingredient. Write the SAME dish again with the exchange below, ${CANDIDATES} times, the version closest to the original first. The app shows the first one that passes its checks.`
      : `You are Clara, Wondish's nutrition assistant. Suggest ${CANDIDATES} different, realistic, home-cookable ${meal} dishes for this person to cook today. ${opening}`,
    `Rules:`,
    `- Every dish is a ${meal}. servings is ${servings}; every amount and every perServing number is for ONE serving.`,
    servings > 1
      ? `- The app scales the amounts to ${servings} people, so write the steps WITHOUT amounts: "add the lentils", never "add 1 cup lentils" or "stir in 2 tablespoons of oil".`
      : ``,
    ask.maxMinutes !== undefined
      ? `- Each dish must take at most ${ask.maxMinutes} minutes in total (prepMinutes + cookMinutes), and no step may take longer than that.`
      : `- prepMinutes and cookMinutes: realistic whole minutes for a home cook. No single step may take longer than prepMinutes + cookMinutes.`,
    ask.mealType === "breakfast"
      ? breakfastLine
      : ask.mealType === "snack"
        ? snackLine
        : steer.need === "push"
          ? `- Each dish is a complete meal (protein + carb + vegetables where sensible).`
          : `- Each dish is a complete meal: a carb and vegetables, with a protein only where it suits.`,
    ...levelLines,
    ask.swap && ask.wants !== undefined
      ? `- THE EXCHANGE: use ${cleanOne(ask.wants)} in place of ${cleanOne(ask.swap.from)}, and name the dish with it. Every other rule here still applies in full.`
      : ask.wants !== undefined
      ? `- THE REQUEST: they asked to cook "${ask.wants.replace(/["\n\r]+/g, "").replace(/\s+/g, " ").trim()}". Every one of the ${CANDIDATES} dishes must be that: what they asked for is the dish's main idea and is named in the dish name. Make ${CANDIDATES} versions of it, the simplest first, not ${CANDIDATES} unrelated dishes. Where a line above says to build the dish around another ingredient, add that ingredient to this dish instead. Every other rule here still applies in full. If a rule forbids part of what they asked for, the rule wins: use a food that fits in its place and name the dish by what is really in it.`
      : ``,
    ask.swap
      ? `- They were about to cook "${promptDishName(ask.swap.dish)}" but do not have ${cleanOne(ask.swap.from)}: write that same dish with what they asked for in its place. Keep every other ingredient and its amount, and the way it is cooked; change only what the exchange needs (how long the new food cooks, the step that prepares it, the name). Make it the same size, about ${Math.round(ask.swap.calories)} kcal a serving: if the new food has fewer calories, use more of it and more of the dish's starch, or add a filling food that fits the rules here (canned or already cooked beans or lentils, cheese, nuts), so it is still a meal. The dish as it was — ingredients: ${ask.swap.ingredients.map((x) => cleanOne(x).replace(/;/g, "")).join("; ")}. Steps: ${ask.swap.steps.map((x, i) => `${i + 1}) ${cleanOne(x)}`).join(" ")}`
      : ``,
    ask.without && ask.without.length > 0
      ? `- They do not have these, so no dish may use them, not in an ingredient, the name or a step: ${ask.without.map(cleanOne).join(", ")}.`
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
    ...DISH_CRAFT_LINES,
    // ONE sodium figure in the whole prompt: the ceiling the judge holds the dish to, and the salt
    // that leaves room for (a quarter teaspoon of salt is about 580 mg). Live run, 2026-11-22: three
    // figures that disagreed cost a salty-week person every generated dish.
    sodiumMax !== null
      ? `- Sodium and salt: each serving must stay at or under ${sodiumMax} mg of sodium in total, counting what is already in the food (stock, sauces, cheese, bread). That leaves room for at most ${sodiumMax >= 1000 ? "a quarter teaspoon" : sodiumMax >= 600 ? "an eighth of a teaspoon" : "a pinch"} of salt per serving.${a.sodiumLimitMg < 2300 ? " Avoid salty additions (soy sauce, stock cubes, bouillon, cured meats, salted cheese, pickles)." : ""}`
      : saltRuleLine(a.sodiumLimitMg),
    `- Cooking fat: one teaspoon per serving is normal and one tablespoon is the maximum; write the same amount in the steps as in ingredients.`,
    // A macro split asks for ~30% protein: not said to someone who needs no push (or a modest portion).
    ...(ask.swap
      // The floor said to the model is higher than the one the judge holds it to: told "between 372 and 663", it wrote 372 (live swap run 3).
      ? [`- Size: keep each serving at about ${Math.round(ask.swap.calories)} kcal, as the dish was, and no less than ${Math.ceil(ask.swap.calories * 0.9)} kcal. If the new food has fewer calories, use more of it, more of the dish's starch (up to a full portion) and up to a tablespoon of the cooking fat. Do not put "extra" or the amounts in the name.`]
      : targetLines(steer.need === "push" ? steer.target : { ...steer.target, split: null }, ask.mealType, brain.rules.mainsOnProtein)),
    proteinLine,
    dayPlanLine,
    recentLine,
    styleLine,
    // For an exchange the dish's own foods are kept, all of them.
    ask.swap ? atHomeLine.replace(" Use the at-home foods that make a good dish, not all of them at once: one starch (rice, potatoes, pasta or bread) per dish.", "") : atHomeLine,
    basicsLine,
    favorites.length > 0
      ? `- These are their favourite foods; at least one of the dishes should feature one when it suits the meal: ${clean(favorites)}.`
      : ``,
    // Their own rules, in their words. Below every rule of the app and above the diet's words, which they never override.
    brain.userRules.length > 0
      ? `- Their own rules for their dishes; follow each one, except where a rule about their diet, allergies or safety here says otherwise: ${brain.userRules.map((r) => cleanOne(r).replace(/;/g, ",")).join("; ")}.`
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

/**
 * The person as they are for THIS dish: a food they just said they do not have is not at home
 * (live swap run, 2026-11-22: "Build this Dinner on Ground beef" was said to someone who had just
 * tapped "I don't have this" on the beef, and the variety line asked for the rice they lacked).
 * The marks themselves are not changed.
 */
function personWithout(person: Person, without: readonly string[] | undefined): Person {
  if (!without || without.length === 0) return person;
  const gone = (name: string) => without.some((w) => foodMatches(w, name));
  const goneKeys = new Set(without.map((w) => proteinKind(w)?.key).filter((k): k is string => !!k));
  const kept: KeptFoods = {
    proteinKeys: person.kept.proteinKeys.filter((k) => !goneKeys.has(k)),
    proteinNames: person.kept.proteinNames.filter((n) => !gone(n)),
    atHome: person.kept.atHome.filter((n) => !gone(n)),
    favorites: person.kept.favorites,
  };
  const brain: DishBrain = {
    ...person.brain,
    kept: { ...person.brain.kept, proteinKeys: person.brain.kept.proteinKeys.filter((k) => !goneKeys.has(k)), proteinNames: person.brain.kept.proteinNames.filter((n) => !gone(n)), atHome: person.brain.kept.atHome.filter((n) => !gone(n)) },
    home: person.brain.home.filter((p) => !goneKeys.has(p.key) && !gone(p.name)),
    basics: person.brain.basics.filter((n) => !gone(n)),
  };
  return { ...person, kept, brain };
}

/** The live switches. A mutable object only so the simulation (and piece D) can flip one; all on. */
export const dishRulesNow: { rules: DishRules } = { rules: { ...DEFAULT_DISH_RULES } };

/**
 * This person's rules: their switches from "How Clara cooks" (a switch is on only when both theirs
 * and the live one are; the live ones are all on outside the simulation) and their own rules that
 * are switched on. A missing or malformed stored value is every switch on and no rules.
 */
function rulesFor(patient: { claraRules?: unknown }): { rules: DishRules; userRules: string[] } {
  const stored = storedRulesFrom(patient.claraRules ?? null);
  const rules = { ...stored.switches };
  for (const k of DISH_RULE_KEYS) rules[k] = stored.switches[k] && dishRulesNow.rules[k];
  return { rules, userRules: stored.mine.filter((r) => r.on).map((r) => r.text) };
}

/**
 * A food their own rule rules out is not something to cook from, whatever is marked: "Never put
 * spinach in my dishes" beside "At home: Spinach" in one prompt (live rules run, 2026-11-22).
 */
function keptWithoutRuleFoods(kept: KeptFoods, userRules: readonly string[]): KeptFoods {
  const foods = userRules.map(ruleFood).filter((f): f is string => f !== null);
  if (foods.length === 0) return kept;
  const ok = (name: string) => !foods.some((f) => ruleFoodMatches(f, name));
  const proteinNames = kept.proteinNames.filter(ok);
  return {
    proteinNames,
    proteinKeys: kept.proteinKeys.filter((k) => proteinNames.some((n) => proteinKind(n)?.key === k)),
    atHome: kept.atHome.filter(ok),
    favorites: kept.favorites.filter(ok),
  };
}

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
        brain: safeBrainFrom({ kept: keptWithoutRuleFoods(kept, rulesFor(patient).userRules), ...rulesFor(patient), rows: brainRows, today: ctx.today, patient, matchers, sodiumLimitMg }),
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
  note: (name: string, stage: CandidateTrace["stage"], reasons?: string[]) => void,
  steer: AskSteer,
): Promise<JudgedDish | null> {
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
  // The judge runs after the gates: the protein rule, honesty, size, protein share and the level ceilings.
  const judged = judgeGated(r, ask, person, steer);
  if (judged.verdict.level === "fail") {
    note(label, judged.verdict.reasons.some((x) => x.startsWith("protein:")) ? "kept" : "judge", judged.verdict.reasons);
    return null;
  }
  seen.add(r.name.trim().toLowerCase());
  return judged;
}

/**
 * The judge (lib/clara/dish-judge.ts) on a dish that already passed every gate,
 * with the numbers the card will show: the readable recipe, priced as buildDish
 * prices it, sodium only when it is fully known. The level ceilings come from
 * the steer and hold with every switch off.
 */
function judgeGated(gated: FridgeRecipe, ask: DishAsk, person: Person, steer: AskSteer): JudgedDish {
  const r = readableAmounts(gated);
  const ingredients = toPlausibleDish(r, capitalize(ask.mealType)).ingredients.map((i) => ({
    name: i.name,
    quantity: i.quantity ?? null,
    unit: i.unit ?? "",
  }));
  const card = cardNumbers(r);
  const verdict = judgeDish({
    mealType: ask.mealType,
    ...(ask.wants !== undefined ? { wants: ask.wants } : {}),
    name: r.name,
    ingredients,
    steps: r.steps,
    calories: card.calories,
    proteinG: card.protein,
    known: card.sodium !== null ? { sodium: card.sodium } : {},
    home: person.brain.home,
    rules: person.brain.rules,
    // An exchange is sized against the dish it came from, not the meal.
    targetCalories: ask.swap ? null : steer.target.calories,
    ...(ask.swap ? { mustKeep: { names: ask.swap.others, calories: ask.swap.calories, band: SWAP_REWRITE_BAND } } : {}),
    ceilings: steer.ceilings,
    notLike: [...person.brain.usedToday, ...person.brain.usedRecently, ...(ask.avoid ?? [])],
    ...(steer.need === "skip" ? { skipProtein: true } : {}),
    ...(ask.without && ask.without.length > 0 ? { without: ask.without } : {}),
    // The foods their own rules rule out.
    ...(person.brain.ruleFoods.length > 0 ? { ruleFoods: person.brain.ruleFoods } : {}),
  });
  const fromHome = fromHomeLine(ingredients.map((i) => i.name), person.brain.kept, builtOn(ingredients, r.steps));
  return { recipe: r, verdict, fromHome };
}

/** The steer for one ask: the protein to build on, the size and the level ceilings. Once per generator or library call. */
function steerFor(ctx: ClaraContext, ask: DishAsk, person: Person): AskSteer {
  return safeSteerForAsk(person.brain, ask, { patientId: ctx.patientId, today: ctx.today });
}

/**
 * steerForAsk, and never a throw: a bug or a malformed value in it rejected the generator and the
 * library alike, so every request for that person ended "couldn't make one" (final review,
 * 2026-11-21). The fallback steers nothing (no protein rule, no choice, no size, no levels) but
 * keeps every limit: the sodium ceiling is their daily sodium limit and the other upper limits stand.
 */
function safeSteerForAsk(brain: DishBrain, ask: DishAsk, who: { patientId: string; today: string }): AskSteer {
  try {
    return steerForAsk(brain, ask, who);
  } catch (err) {
    console.warn(`[clara-dish] the steer failed; serving without it: ${(err as Error)?.message ?? String(err)}`);
    let ceilings: AskSteer["ceilings"];
    try {
      ceilings = levelCeilings({ mealType: ask.mealType, sodiumLimitMg: brain.sodiumLimitMg, week: [] });
    } catch {
      ceilings = { sodium: brain.sodiumLimitMg };
    }
    return {
      ruleOn: false,
      choice: null,
      need: "free",
      target: { calories: null, dayCalories: null, band: null, split: null, leanings: [] },
      levels: [],
      ceilings,
    };
  }
}

/**
 * brainFrom, and never a throw (see safeSteerForAsk): with the reads first, then without them,
 * then the smallest brain that still carries their diet and their sodium limit.
 */
function safeBrainFrom(a: Parameters<typeof brainFrom>[0] & { matchers: DietMatchers; sodiumLimitMg: number }): DishBrain {
  try {
    return brainFrom(a);
  } catch (err) {
    console.warn(`[clara-dish] the dish brain failed to build; serving without its reads: ${(err as Error)?.message ?? String(err)}`);
  }
  try {
    return brainFrom({ ...a, rows: NO_BRAIN_ROWS });
  } catch {
    return {
      rules: a.rules ?? { ...DEFAULT_DISH_RULES },
      userRules: [],
      ruleFoods: [],
      kept: NO_KEPT_FOODS,
      usedRecently: [],
      home: [],
      favourites: [],
      basics: [],
      dayCalories: null,
      conditionNames: [],
      motivationNames: [],
      sodiumLimitMg: a.sodiumLimitMg,
      week: [],
      picture: null,
      today: null,
      usedToday: [],
      matchers: a.matchers,
    };
  }
}

/**
 * ONE streamed model call with a schema-constrained answer, each dish gated
 * the moment it is complete. Stops reading as soon as one gated dish passes
 * `accept` (or the signal fires) and returns the gated dishes so far; with a
 * request, also at a relaxed dish that says it and fits the card (served by
 * generateOne as ladder step 2, never returned here). [] on
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
  const note = (name: string, stage: CandidateTrace["stage"], reasons?: string[]) => opts.trace?.({ ms: Date.now() - t0, name, stage, ...(reasons ? { reasons } : {}) });
  const [loaded, catalogFoodTokens] = await Promise.all([personFor(ctx, loadRows), catalogTokens()]);
  if (!loaded || opts.signal?.aborted) return [];
  const person = personWithout(loaded, ask.without);
  const meal = capitalize(ask.mealType);
  const steer = steerFor(ctx, ask, person);
  // With a protein chosen for today, the stream stops early only on a dish built on it.
  // Only while the protein is pushed: with need "free" or "hold" any passing dish may end it
  // (live run, 2026-11-22: an egg dish was never "on choice", so every such request read the whole answer).
  const onChoice = (j: JudgedDish) => !steer.choice || steer.need !== "push" || (j.verdict.builtOn !== null && sameProteinKind(j.verdict.builtOn, steer.choice.key));
  // What they asked to cook, if anything: a relaxed dish that says it may end the stream (below).
  const wantsNow = ask.wants;

  // Our own controller: aborted by the deadline, or by us once a dish is accepted.
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const accepted: JudgedDish[] = [];
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
          brain: person.brain,
          who: { patientId: ctx.patientId, today: ctx.today },
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
        const gotten = await gateOne(item, ask, person, catalogFoodTokens, seen, note, steer);
        if (!gotten) continue;
        const j: JudgedDish = steer.choice && onChoice(gotten) ? { ...gotten, onTodaysProtein: true } : gotten;
        const r = j.recipe;
        opts.judged?.(j);
        if (j.verdict.level === "relaxed") {
          note(r.name, "relaxed");
          // A requested dish ("pancakes", "a soup") is still sized and protein-checked, so its first
          // candidate is often relaxed, and reading on cost the whole stream (final review, 2026-11-21).
          // One that says the request and fits the card ends the stream: generateOne serves it at
          // once as ladder step 2, from `judged`. Never returned here, never a "fail" (gateOne drops those).
          if (
            wantsNow !== undefined &&
            matchesRequest(wantsNow, r.name, r.usesIngredients) &&
            pickDish([r], ask) !== null &&
            (!opts.accept || opts.accept(r)) &&
            onChoice(j)
          ) {
            break read;
          }
          continue;
        }
        accepted.push(j);
        if ((!opts.accept || opts.accept(r)) && onChoice(j)) {
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
  // Dishes built on today's protein first; otherwise the order they arrived in (a stable sort).
  return accepted
    .map((j, i) => ({ j, i, first: steer.choice && onChoice(j) ? 0 : 1 }))
    .sort((a, b) => a.first - b.first || a.i - b.i)
    .map((x) => x.j.recipe);
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
  // No brain reads: the reminder names a library dish and never uses them.
  const [person, recent] = await Promise.all([personFor(ctx, async () => NO_BRAIN_ROWS), recentFor(ctx)]);
  if (!person) return {};
  const out: Partial<Record<DishMealType, string>> = {};
  for (const mealType of meals) {
    const pool = await libraryPool(mealType);
    // proteinRule undefined = rankLibrary's default (the at-home protein rule on when it applies).
    const nameFor = () =>
      suggestionName(
        rankLibrary(
          pool,
          { mealType, little: [], aLot: [] },
          { patient: person.patient, matchers: person.matchers, seed: `${patientId}|${today}|${mealType}`, kept: person.kept },
          recent,
          stepStatesAmount,
        ),
      );
    // Only a dish chat would serve too (owner, 2026-11-22): with nothing at-home-friendly the
    // reminder goes out without a dish name, never naming a protein they do not have.
    const name = nameFor();
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
 * Each recipe kept is judged like a generated dish: a "fail" is dropped (the
 * protein rule never gives way), "pass" and "relaxed" are both kept (ladder
 * step 3 keeps the diet and protein checks only) and reported to `judged`.
 */
async function libraryGated(
  ctx: ClaraContext,
  ask: DishAsk,
  signal?: AbortSignal,
  judged?: (j: JudgedDish) => void,
  loadRows?: BrainRowsLoader,
): Promise<FridgeRecipe[]> {
  const [loadedPerson, pool, recent, catalogFoodTokens] = await Promise.all([
    personFor(ctx, loadRows),
    libraryPool(ask.mealType),
    recentFor(ctx),
    catalogTokens(),
  ]);
  const person = loadedPerson ? personWithout(loadedPerson, ask.without) : loadedPerson;
  if (!person || signal?.aborted) return [];
  const meal = capitalize(ask.mealType);
  const steer = steerFor(ctx, ask, person);
  // Removed 2026-11 (dish brain, "Always answers"): the second pass that ranked again with `proteinRule: false` when nothing passed. The protein rule is never relaxed.
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
    { patient: person.patient, matchers: person.matchers, seed: `${ctx.patientId}|${ctx.today}|${ask.mealType}`, kept: person.brain.kept },
    recent,
    stepStatesAmount,
  );
  if (ranked.length === 0) return [];
  const oil = oilAllowedBy(person.matchers);
  const candidates = ranked.map((r) => specifyCookingOil(libraryToFridge(r, meal, ask.servings ?? 1, `frg_${crypto.randomUUID()}`), oil));
  if (signal?.aborted) return [];
  // The same catalog lookup a generated dish gets, for every candidate at once.
  const groupsOf = await loadIngredientGroups(candidates.flatMap((r) => [...r.usesIngredients, ...r.missingIngredients]));
  const out: JudgedDish[] = [];
  for (let i = 0; i < candidates.length && out.length < LIBRARY_KEEP && !signal?.aborted; i += LIBRARY_CHUNK) {
    const gated = gateGeneratedDishes(candidates.slice(i, i + LIBRARY_CHUNK), {
      mealTypeName: meal,
      matchers: person.matchers,
      groupsOf,
      catalogFoodTokens,
      sodiumLimitMg: person.sodiumLimitMg,
    });
    for (const r of gated) {
      if (!fibreIsPlausible(r) || !pickDish([r], ask)) continue;
      const j = judgeGated(r, ask, person, steer);
      if (j.verdict.level !== "fail") out.push(j);
    }
  }
  const kept = out.slice(0, LIBRARY_KEEP);
  for (const j of kept) judged?.(j);
  return kept.map((j) => j.recipe);
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
async function liveRequestConflicts(ctx: ClaraContext, wants: string, loadRows?: BrainRowsLoader): Promise<string[]> {
  const person = await personFor(ctx, loadRows);
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
    library: (ctx, ask, signal, judged) => libraryGated(ctx, ask, signal, judged, io.brainRows),
    // The same loader as the dish: the person is memoised per call, so the first load decides the rows.
    requestConflicts: (ctx, wants) => liveRequestConflicts(ctx, wants, io.brainRows),
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

/** The per-serving numbers the card shows (and the judge judges), priced from the dish's own amounts. */
function cardNumbers(r: FridgeRecipe): ClaraRecipe["perServing"] {
  const priced = pricedMacros(r);
  return {
    calories: Math.round(priced?.calories ?? reconcileCalories(r) ?? r.perServing.calories),
    protein: priced?.protein ?? r.perServing.protein,
    carbs: priced?.carbs ?? r.perServing.carbs,
    fat: priced?.fat ?? r.perServing.fat,
    // Pricing has no fibre column; this is the dish's own declared figure. It
    // is stored for the log only — no reason is ever built on it.
    fibre: r.perServing.fiber,
    sodium: completeSodiumMg(r),
  };
}

/**
 * The dish as the app shows and cooks it. Numbers per serving, priced from its
 * own amounts. `judged.fromHome`, when there is one, rides on the dish part;
 * otherwise the part has no fromHome key at all.
 */
function buildDish(r: FridgeRecipe, ask: DishAsk, source: DishSource, judged?: JudgedDish): BuiltDish {
  const perServing = cardNumbers(r);
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
      ...(judged?.fromHome ? { fromHome: judged.fromHome } : {}),
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
 *
 * The ladder (dish brain, "Always answers"): a generated dish the judge fully
 * passed → a generated dish it passed with only the size or protein share
 * relaxed (reported through `judged`, never returned) → a library recipe →
 * the honest message. With `wants`, each step first looks for a dish that says
 * the request, and only after the library do the generated dishes that do not
 * (a full pass, then a relaxed one). A dep that never calls `judged` behaves
 * exactly as before.
 */
async function generateOne(deps: DishDeps, ctx: ClaraContext, ask: DishAsk): Promise<BuiltDish | null> {
  const budget = deps.budgetMs ?? DISH_BUDGET_MS;
  const started = Date.now();
  // What the judge said about each dish the deps hand back, and the relaxed generated dishes in arrival order.
  const judgedBy = new Map<FridgeRecipe, JudgedDish>();
  const relaxedDishes: FridgeRecipe[] = [];
  // Full passes as they were reported: if the deadline wins the race (`late`), a dish already in hand is not lost.
  const passedDishes: JudgedDish[] = [];
  const onGenerated = (j: JudgedDish) => {
    judgedBy.set(j.recipe, j);
    if (j.verdict.level === "relaxed") relaxedDishes.push(j.recipe);
    if (j.verdict.level === "pass") passedDishes.push(j);
  };
  // Fired once a generated dish is served: the library stops making queries.
  const libraryStop = new AbortController();
  const library: Promise<FridgeRecipe[]> = deps.library
    ? deps.library(ctx, ask, libraryStop.signal, (j) => judgedBy.set(j.recipe, j)).catch((err) => {
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
      .generate(ctx, ask, { signal: deadline.signal, accept: (r) => pickDish([r], ask) !== null && saysRequest(r), judged: onGenerated })
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
  // A relaxed dish is never a full pass, even from a dep that also returned it.
  recipes = recipes.filter((r) => judgedBy.get(r)?.verdict.level !== "relaxed");
  // The deadline won (or the generator returned nothing) after it had reported full passes: serve from those,
  // today's protein first, then arrival order. Only "pass" verdicts are here; pickDish still judges each below.
  if (recipes.length === 0 && passedDishes.length > 0) {
    recipes = passedDishes
      .map((j, i) => ({ j, i }))
      .sort((a, b) => Number(!!b.j.onTodaysProtein) - Number(!!a.j.onTodaysProtein) || a.i - b.i)
      .map((x) => x.j.recipe);
  }
  // OFF 2026-11 (Clara-first, spec §8.6): with `wants`, a generated dish that says the request is picked first, and one that does not waits behind a matching library recipe. Restore: uncomment this line and delete the `picked` line and the `unmatched` line below it.
  // const picked = pickDish(recipes, ask);
  const picked = pickDish(recipes.filter(saysRequest), ask);
  if (picked) {
    libraryStop.abort();
    return buildDish(picked, ask, "generated", judgedBy.get(picked));
  }
  // Ladder step 2: a generated dish with only the size or protein share relaxed, before any stored recipe.
  // Read here, where the library is read: the generator has returned or the budget has passed, so no extra wait.
  // Of the relaxed ones, a dish that is not a repeat of what they just had comes first.
  // Then a repeat; a dish with a second protein (an egg on the beef) last of all.
  const rank = (r: FridgeRecipe) => { const why = judgedBy.get(r)?.verdict.reasons ?? []; return why.includes("proteins") ? 2 : why.includes("repeat") ? 1 : 0; };
  const relaxedInOrder = [0, 1, 2].flatMap((n) => relaxedDishes.filter((r) => rank(r) === n));
  const relaxedPick = pickDish(relaxedInOrder.filter(saysRequest), ask);
  if (relaxedPick) {
    libraryStop.abort();
    return buildDish(relaxedPick, ask, "generated", judgedBy.get(relaxedPick));
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
  if (fromLibrary) return buildDish(fromLibrary, ask, "library", judgedBy.get(fromLibrary));
  if (unmatched) return buildDish(unmatched, ask, "generated", judgedBy.get(unmatched));
  // Only with `wants`: a relaxed generated dish that does not say the request, the very last resort.
  const relaxedUnmatched = wants !== undefined ? pickDish(relaxedDishes, ask) : null;
  return relaxedUnmatched ? buildDish(relaxedUnmatched, ask, "generated", judgedBy.get(relaxedUnmatched)) : null;
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
      dayPlan: true,
    }));
    // One ctx object for the whole call: the person loads once for all its dishes.
    const call = { ...ctx };
    const built = await Promise.all(asks.map((ask) => generateOne(deps, call, ask)));
    const made = asks.map((ask, i) => ({ ask, b: built[i] })).filter((x): x is { ask: DishAsk; b: BuiltDish } => x.b !== null);
    // Both kept as they are (no second call), but a lunch and a dinner that came out as one dish is seen.
    const nameOf = (m: DishMealType) => made.find((x) => x.ask.mealType === m)?.b.dish.name.trim().replace(/\s+/g, " ").toLowerCase();
    const lunchName = nameOf("lunch");
    if (lunchName && lunchName === nameOf("dinner")) console.warn(`[clara-dish] day plan: lunch and dinner are the same dish`);
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

// ─── The ingredients check before cooking (piece B) ──────────────────────────

export type SwapResult =
  | { ok: true; how: "exchanged" | "rewritten" | "new"; dish: BuiltDish["dish"]; steps: BuiltDish["steps"] }
  | { ok: false; status: 404 | 422; message: string };

export const SWAP_NOT_IN_DISH = "That ingredient is not in this dish.";
export const SWAP_NOT_OFFERED = "That is not one of the exchanges for this ingredient.";
/** A code-made exchange is served only when the dish's calories stay within this share of what they were. */
export const SWAP_CALORIE_BAND = 0.15;
/** A rewritten exchange stays between these shares of the original's calories (a non-protein option is lighter, so the floor is lower than the ceiling is high). */
export const SWAP_REWRITE_BAND = { min: 0.8, max: 1.25 } as const;
export const SWAP_COULDNT = "I couldn't make that change fit you. Try another one, or a different dish.";

/** The dish as the generator would have written it, so it goes through the very same gates. */
function itemFromRecipe(recipe: ClaraRecipe): Record<string, unknown> {
  const prep = Math.max(1, Math.round(recipe.minutes / 3));
  return {
    name: recipe.name,
    description: recipe.name,
    ingredients: recipe.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
    steps: recipe.steps,
    prepMinutes: Math.min(prep, recipe.minutes),
    cookMinutes: Math.max(0, recipe.minutes - prep),
    perServing: {
      calories: recipe.perServing.calories, protein: recipe.perServing.protein, carbs: recipe.perServing.carbs,
      fat: recipe.perServing.fat, fiber: recipe.perServing.fibre ?? 0,
    },
  };
}

/**
 * What the person can do about an ingredient they do not have, and doing it:
 *  - `options`: the exchanges on offer, chosen in code (lib/clara/exchange.ts), diet-checked;
 *  - `apply`: a like-for-like exchange is made in code (the line, the steps, the name), re-priced
 *    and put through every gate and the judge; any other exchange (a protein, or one the gates
 *    turn down) is rewritten by the generator as a request for the replacement;
 *  - `without`: "nothing similar": a different dish that does not use the food.
 * A replacement the server did not offer is refused, so no free text from the app reaches the generator.
 */
export function makeSwapHandlers(deps: DishDeps = prismaDeps) {
  const inDish = (recipe: ClaraRecipe, ingredient: string) =>
    recipe.ingredients.some((i) => i.name.trim().toLowerCase() === ingredient.trim().toLowerCase());

  const optionsFor = async (ctx: ClaraContext, recipe: ClaraRecipe, ingredient: string) => {
    const person = await personFor(ctx);
    if (!person) return null;
    const banned = hasAnyBan(person.matchers);
    return swapOptions({
      ingredient,
      inDish: recipe.ingredients.map((i) => i.name),
      // Kitchen basics are in the house too (oil, butter, dried herbs).
      atHome: [...person.kept.proteinNames, ...person.kept.atHome, ...person.brain.basics],
      home: person.brain.home,
      // The diet, and their own "no such food" rules: an exchange the judge would turn down is not offered.
      allowed: (food) =>
        !person.brain.ruleFoods.some((f) => ruleFoodMatches(f, food))
        && (!banned || evaluateDishAgainstProfile([food], person.matchers, [exampleAllergenGroups(food)]).passed),
    });
  };

  const options = async (ctx: ClaraContext, a: { recipe: ClaraRecipe; ingredient: string }) => {
    if (!inDish(a.recipe, a.ingredient)) return { ok: false as const, status: 422 as const, message: SWAP_NOT_IN_DISH };
    const found = await optionsFor({ ...ctx }, a.recipe, a.ingredient);
    if (!found) return { ok: false as const, status: 404 as const, message: "Profile not found" };
    return { ok: true as const, ...found };
  };

  const serve = (how: "exchanged" | "rewritten" | "new", built: BuiltDish | null): SwapResult =>
    built ? { ok: true, how, dish: built.dish, steps: built.steps } : { ok: false, status: 422, message: SWAP_COULDNT };

  const apply = async (
    ctx: ClaraContext,
    a: { mealType: DishMealType; recipe: ClaraRecipe; ingredient: string; replacement: string },
  ): Promise<SwapResult> => {
    if (!inDish(a.recipe, a.ingredient)) return { ok: false, status: 422, message: SWAP_NOT_IN_DISH };
    const call = { ...ctx };
    const offered = await optionsFor(call, a.recipe, a.ingredient);
    if (!offered) return { ok: false, status: 404, message: "Profile not found" };
    const to = offered.options.find((o) => o.name.trim().toLowerCase() === a.replacement.trim().toLowerCase());
    if (!to) return { ok: false, status: 422, message: SWAP_NOT_OFFERED };
    const summary = claimableSummary(await deps.loadSummary(call.patientId, call.today));
    const ask: DishAsk = {
      mealType: a.mealType,
      summary,
      ...(a.recipe.servings > 1 ? { servings: a.recipe.servings } : {}),
      wants: to.name,
      swap: {
        dish: a.recipe.name, from: a.ingredient,
        ingredients: a.recipe.ingredients.map((i) => `${i.quantity ?? ""} ${i.unit} ${i.name}`.replace(/\s+/g, " ").trim()),
        steps: a.recipe.steps,
        calories: a.recipe.perServing.calories,
        // What a rewrite must keep: every food of the dish but the one exchanged and the pinches.
        others: a.recipe.ingredients.map((i) => i.name).filter((n) => n.trim().toLowerCase() !== a.ingredient.trim().toLowerCase() && !/^(salt|water|pepper|black pepper)$/i.test(n.trim())),
      },
      without: [a.ingredient],
    };
    if (plainSwap(a.ingredient, to.name)) {
      const swapped = swapInRecipe(a.recipe, a.ingredient, to.name);
      const whole = swapped ? await personFor(call) : null;
      const person = whole ? personWithout(whole, ask.without) : null;
      if (swapped && person) {
        const judged = await gateOne(itemFromRecipe(swapped), ask, person, await catalogTokens(), new Set(), () => {}, steerFor(call, ask, person));
        const built = judged ? buildDish(judged.recipe, ask, "generated", judged) : null;
        // Like for like keeps the dish the size it was: within 15% of its calories. Past that the
        // amounts no longer fit the new food (a cup of cooked rice read as dry), so the generator rewrites it.
        const was = a.recipe.perServing.calories;
        if (built && was > 0 && Math.abs(built.dish.calories - was) <= SWAP_CALORIE_BAND * was) return serve("exchanged", built);
      }
    }
    const rewritten = await generateOne(deps, call, ask);
    if (rewritten) return serve("rewritten", rewritten);
    // The same dish cannot be made with it (mushrooms in place of the beef came out a third lighter
    // and were refused, live run 2026-11-22): a dish of its own with the food they chose, not a refusal.
    const { swap: _swap, ...fresh } = ask;
    const other = await generateOne(deps, call, { ...fresh, avoid: [a.recipe.name] });
    // Only a dish that really uses the food they chose.
    // By the food's own word ("salmon" for "Salmon fillets", "chicken" for "Boneless chicken breasts").
    const kind = proteinKind(to.name)?.key;
    const uses = other?.dish.recipe?.ingredients.some((i) => ruleFoodMatches(to.name, i.name) || (kind !== undefined && proteinKind(i.name)?.key === kind)) ?? false;
    return serve("new", uses ? other : null);
  };

  const without = async (
    ctx: ClaraContext,
    a: { mealType: DishMealType; recipe: ClaraRecipe; ingredient: string },
  ): Promise<SwapResult> => {
    if (!inDish(a.recipe, a.ingredient)) return { ok: false, status: 422, message: SWAP_NOT_IN_DISH };
    const call = { ...ctx };
    const summary = claimableSummary(await deps.loadSummary(call.patientId, call.today));
    const ask: DishAsk = {
      mealType: a.mealType,
      summary,
      ...(a.recipe.servings > 1 ? { servings: a.recipe.servings } : {}),
      avoid: [a.recipe.name],
      without: [a.ingredient],
    };
    return serve("new", await generateOne(deps, call, ask));
  };

  return { options, apply, without };
}

// ─── The Grocery list (lib/clara/grocery.ts) ─────────────────────────────────

/**
 * What to buy, for the app's Grocery tab: the same person the dishes are made for (their week on
 * the Numbers list, their first-run answers, their diet) and the catalog with their marks. No
 * model call. null when there is no such patient.
 */
export async function groceryListFor(patientId: string, today: string): Promise<{ groups: GroceryGroup[]; visibleIds: Set<string> } | null> {
  const person = await personFor({ patientId, today } as ClaraContext);
  if (!person) return null;
  const all = await loadCatalogRows(patientId, person.matchers);
  // Never a food their own rule rules out: "no salmon" and "For omega-3: Salmon fillets" (review, 2026-11-22).
  const rows = all.filter((r) => !person.brain.ruleFoods.some((f) => ruleFoodMatches(f, r.name)));
  return {
    groups: groceryGroups({ rows, week: person.brain.week, picture: person.brain.picture }),
    visibleIds: new Set(rows.map((r) => r.id)),
  };
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
    RULES_PROMPT,
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
    // "How Clara cooks": the person's own rules, added and removed by telling Clara (lib/clara/skills/rules.ts).
    ...ruleTools(),
  ],
};
