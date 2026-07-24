// Pure Fridge generation lib — zero Next/Prisma imports. Backs POST /api/fridge
// (thin route over this + lib/food-map.ts). See docs/superpowers/plans/
// 2026-07-20-ios-phase4-fridge.md (Task 1) and its Cycle-5 execution amendment.
//
// F-D7 (allergen guarantee): applyAllergenFilter is a deterministic
// server-side guard, independent of the model's own self-certified
// fitsPlan/conflicts. It REUSES lib/diet-match.ts's word-boundary matchers
// (buildDietMatchers over derivePatientBans) rather than hand-rolling a
// second ban-union/matching engine — "butter" must not ban "butternut
// squash"; multi-word banned terms match as phrases.
//
// F-D8 (macro plausibility): perServing is model-invented and written
// verbatim to the nutrition ledger, so implausible calories (deviating from
// the 4P+4C+9F energy-balance estimate by more than 50 kcal AND 40%) are
// normalized toward the macro-derived estimate before the recipe is ever
// returned.

import crypto from "crypto";
import { MAX_MACRO, MAX_SERVINGS } from "@/lib/meal-log";
import { escapeRe, type DietMatchers } from "@/lib/diet-match";

export const MAX_INGREDIENTS = 30;
const MAX_INGREDIENT_LEN = 80;

// ── FridgeRecipe ─────────────────────────────────────────────────────────

export interface FridgePerServing {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface FridgeRecipe {
  id: string;
  name: string;
  description: string;
  emoji: string;
  usesIngredients: string[];
  missingIngredients: string[];
  steps: string[];
  mealType: string;
  servings: number;
  perServing: FridgePerServing;
  fitsPlan: boolean;
  conflicts: string[];
}

// ── normalizeIngredients ────────────────────────────────────────────────────
// Trim, drop empties, case-insensitive dedupe, cap each item <= 80 chars,
// cap count at MAX_INGREDIENTS, stable order (first occurrence wins).
export function normalizeIngredients(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const capped = trimmed.length > MAX_INGREDIENT_LEN ? trimmed.slice(0, MAX_INGREDIENT_LEN) : trimmed;
    const key = capped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(capped);
    if (out.length >= MAX_INGREDIENTS) break;
  }
  return out;
}

// ── parseFridgeRecipes ──────────────────────────────────────────────────────

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string");
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

// servings clamps into the open-at-zero interval (0, MAX_SERVINGS]. Missing
// or non-positive input defaults to 1 (mirrors lib/meal-log.ts's own
// checkServings convention for a missing servings field).
function clampServings(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  if (n <= 0) return 1;
  return Math.min(MAX_SERVINGS, n);
}

// F-D8: if calories deviates from the 4*protein + 4*carbs + 9*fat
// energy-balance estimate by more than 50 kcal AND more than 40% relative,
// normalize calories toward the macro-derived estimate.
function plausibleCalories(calories: number, protein: number, carbs: number, fat: number): number {
  const derived = 4 * protein + 4 * carbs + 9 * fat;
  const diff = Math.abs(calories - derived);
  if (diff <= 50) return calories;
  const implausible = derived > 0 ? diff / derived > 0.4 : true;
  return implausible ? derived : calories;
}

function parseOneRecipe(raw: unknown, mealTypeHint?: string): FridgeRecipe | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;

  if (!isNonEmptyStringArray(r.steps)) return null;
  const steps = (r.steps as string[]).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return null;

  if (typeof r.perServing !== "object" || r.perServing === null) return null;
  if (typeof r.fitsPlan !== "boolean") return null;

  const ps = r.perServing as Record<string, unknown>;
  const protein = clampNumber(ps.protein, 0, MAX_MACRO, 0);
  const carbs = clampNumber(ps.carbs, 0, MAX_MACRO, 0);
  const fat = clampNumber(ps.fat, 0, MAX_MACRO, 0);
  const fiber = clampNumber(ps.fiber, 0, MAX_MACRO, 0);
  const rawCalories = clampNumber(ps.calories, 0, MAX_MACRO, 0);
  const calories = clampNumber(plausibleCalories(rawCalories, protein, carbs, fat), 0, MAX_MACRO, 0);

  return {
    id: `frg_${crypto.randomUUID()}`,
    name,
    description: typeof r.description === "string" ? r.description : "",
    emoji: typeof r.emoji === "string" ? r.emoji : "",
    usesIngredients: coerceStringArray(r.usesIngredients),
    missingIngredients: coerceStringArray(r.missingIngredients),
    steps,
    mealType: typeof r.mealType === "string" && r.mealType ? r.mealType : mealTypeHint ?? "dinner",
    servings: clampServings(r.servings),
    perServing: { calories, protein, carbs, fat, fiber },
    fitsPlan: r.fitsPlan,
    conflicts: coerceStringArray(r.conflicts),
  };
}

// Validates the model's tool-use JSON. Returns null ONLY when `raw` is not a
// usable array (unrecoverable junk -> route emits 502). A valid array that
// yields zero surviving recipes returns [] (a legitimate "no recipes
// possible" result, NOT an error).
export function parseFridgeRecipes(
  raw: unknown,
  maxRecipes: number,
  mealTypeHint?: string
): FridgeRecipe[] | null {
  if (!Array.isArray(raw)) return null;

  const cap = clampNumber(maxRecipes, 1, 5, 3);
  const out: FridgeRecipe[] = [];
  for (const item of raw) {
    const parsed = parseOneRecipe(item, mealTypeHint);
    if (parsed) out.push(parsed);
    if (out.length >= cap) break;
  }
  return out;
}

// ── applyAllergenFilter (F-D7) ──────────────────────────────────────────────
// Reuses lib/diet-match.ts's word-boundary matchers — never raw substring.
// allergyMatchers are already \b-anchored, singular-stemmed RegExps.
// exactBanned entries are exact ingredient/food names (possibly multi-word);
// matched as \b-anchored phrases against the recipe's free text.
function recipeSearchText(recipe: FridgeRecipe): string {
  return [recipe.name, ...recipe.usesIngredients, ...recipe.missingIngredients, ...recipe.steps]
    .join(" \n ")
    .toLowerCase();
}

export function applyAllergenFilter(recipes: FridgeRecipe[], matchers: DietMatchers): FridgeRecipe[] {
  const exactPatterns = matchers.exactBanned.map((b) => new RegExp(`\\b${escapeRe(b.name)}\\b`, "i"));

  return recipes.filter((recipe) => {
    const text = recipeSearchText(recipe);
    if (matchers.allergyMatchers.some((m) => m.test(text))) return false;
    if (exactPatterns.some((re) => re.test(text))) return false;
    return true;
  });
}

// ── buildFridgePrompt ────────────────────────────────────────────────────────

export function buildFridgePrompt(ingredients: string[], mealType?: string): string {
  const list = ingredients.length > 0 ? ingredients.join(", ") : "(none supplied)";
  const lines = [`Ingredients on hand: ${list}.`];
  if (mealType) lines.push(`Meal type: ${mealType}.`);
  lines.push(
    "Call the suggest_recipes tool with your recipe suggestions. Respond ONLY via that tool call — do not reply with plain text."
  );
  return lines.join("\n");
}

// ── FRIDGE_SYSTEM_PROMPT ─────────────────────────────────────────────────────

export function FRIDGE_SYSTEM_PROMPT(foodMapText: string, maxRecipes: number): string {
  return `You are Clara, a warm and knowledgeable personal food advisor helping the user cook from what's already in their fridge/pantry.

Their dietary profile:
${foodMapText}

Generate up to ${maxRecipes} recipes usable from the supplied ingredients plus common pantry staples (oil, butter, flour, soy sauce, salt, etc.). Every ingredient the recipe assumes — including any staple — MUST be listed in usesIngredients or missingIngredients; assume nothing off-list. This is critical: a recipe that silently assumes an unlisted staple can hide an allergen from the safety filter.

Strictly forbid anything in the patient's allergies, restricted-from-allergies, foods-to-avoid, or banned-ingredient lists above. Bias recipe choice toward their stated preferences and goal/dietary pattern.

For each recipe, compute plausible per-serving macros (calories should be approximately 4*protein + 4*carbs + 9*fat), set fitsPlan and list any conflicts with their profile, and write steps as plain sentences.

Call the suggest_recipes tool with valid JSON only.`;
}

// ── SUGGEST_RECIPES_SCHEMA ───────────────────────────────────────────────────

export const SUGGEST_RECIPES_SCHEMA: { type: "object"; properties: Record<string, unknown>; required: string[] } = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          emoji: { type: "string" },
          usesIngredients: { type: "array", items: { type: "string" } },
          missingIngredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          mealType: { type: "string" },
          servings: { type: "number" },
          perServing: {
            type: "object",
            properties: {
              calories: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              fiber: { type: "number" },
            },
            required: ["calories", "protein", "carbs", "fat", "fiber"],
          },
          fitsPlan: { type: "boolean" },
          conflicts: { type: "array", items: { type: "string" } },
        },
        required: ["name", "steps", "perServing", "fitsPlan"],
      },
    },
  },
  required: ["recipes"],
};
