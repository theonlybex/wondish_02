// Calories from a list of foods with gram amounts (2026-11-14, user request:
// Clara asks questions "to find grams of ingredients inside" a photo).
//
// Clara's eye decides WHAT is on the plate and HOW MUCH; the numbers come
// from the same per-100 g food table the dish cards are priced with
// (lib/staple-density.ts), so a photo meal and a cooked dish agree. Foods the
// table does not know come back as `unknown` for Clara to estimate herself.
import { priceDish } from "@/lib/staple-density";
import type { ToolResult } from "./types";

export const MAX_FOOD_ROWS = 20;
export const MAX_FOOD_GRAMS = 3000;

/**
 * The table is per 100 g as bought: grains dry, meat raw. A photo shows food
 * as served, so cooked grains and pasta are priced at their cooked density
 * (priceDish's own "cooked" rule) and cooked meat and fish at ~1.3x raw,
 * because they lose about a quarter of their weight in water.
 */
const COOKS_WET = /\b(rice|pasta|spaghetti|macaroni|penne|noodles?|couscous|orzo|oats?|oatmeal|quinoa|bulgur|farro|barley|millet|lentils?|chickpeas?|beans?)\b/i;
const COOKS_DRY = /\b(chicken|turkey|beef|steak|sirloin|pork|bacon|ham|salmon|tuna|cod|tilapia|haddock|catfish|trout|sole|pollock|fish|shrimp|prawns?)\b/i;
export const COOKED_MEAT_FACTOR = 1.3;

export interface FoodRow {
  name: string;
  grams: number;
  /** Grams as served (cooked). False for dry or raw weights. */
  asServed: boolean;
}

export interface PricedFoodRow {
  name: string;
  grams: number;
  /** "food data": priced from the table. "negligible": herbs, spices, lemon, etc. "unknown": not in the table. */
  source: "food data" | "negligible" | "unknown";
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function priceFoodRow(row: FoodRow): PricedFoodRow {
  const cookedGrain = row.asServed && COOKS_WET.test(row.name);
  const priced = priceDish([{ name: row.name, quantity: row.grams, unit: "g", note: cookedGrain ? "cooked" : null }]);
  const base = { name: row.name, grams: row.grams };
  // Nothing priceable at all: priceDish skips seasonings (salt, herbs, lemon,
  // garlic, soy sauce...) as carrying no meaningful calories.
  if (priced === null) return { ...base, source: "negligible", calories: 0, protein: 0, carbs: 0, fat: 0 };
  if (priced.coverage < 1) return { ...base, source: "unknown", calories: null, protein: null, carbs: null, fat: null };
  const k = row.asServed && !cookedGrain && COOKS_DRY.test(row.name) ? COOKED_MEAT_FACTOR : 1;
  const protein = priced.protein * k;
  const carbs = priced.carbs * k;
  const fat = priced.fat * k;
  return {
    ...base,
    source: "food data",
    calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
    protein: r1(protein),
    carbs: r1(carbs),
    fat: r1(fat),
  };
}

export interface FoodTotals {
  rows: PricedFoodRow[];
  /** Sum of the rows the table priced (unknown rows are NOT in it). */
  known: { calories: number; protein: number; carbs: number; fat: number };
  unknown: string[];
}

export function priceFoods(rows: readonly FoodRow[]): FoodTotals {
  const priced = rows.map(priceFoodRow);
  const known = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const p of priced) {
    if (p.calories === null) continue;
    known.calories += p.calories;
    known.protein += p.protein ?? 0;
    known.carbs += p.carbs ?? 0;
    known.fat += p.fat ?? 0;
  }
  return {
    rows: priced,
    known: { calories: Math.round(known.calories), protein: r1(known.protein), carbs: r1(known.carbs), fat: r1(known.fat) },
    unknown: priced.filter((p) => p.source === "unknown").map((p) => p.name),
  };
}

/** Reads the tool input; a message for Clara when it is wrong. */
export function parseFoodRows(input: Record<string, unknown>): { ok: true; rows: FoodRow[] } | { ok: false; message: string } {
  const raw = input.foods;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: "foods must be a non-empty list" };
  if (raw.length > MAX_FOOD_ROWS) return { ok: false, message: `At most ${MAX_FOOD_ROWS} foods` };
  const rows: FoodRow[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, message: "each food needs name and grams" };
    const f = item as Record<string, unknown>;
    const name = typeof f.name === "string" ? f.name.trim().slice(0, 80) : "";
    const grams = typeof f.grams === "number" ? f.grams : NaN;
    if (name.length === 0) return { ok: false, message: "each food needs a name" };
    if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_FOOD_GRAMS) {
      return { ok: false, message: `grams for "${name}" must be between 0 and ${MAX_FOOD_GRAMS}` };
    }
    rows.push({ name, grams, asServed: f.asServed !== false });
  }
  return { ok: true, rows };
}

export const UNKNOWN_FOODS_NOTE =
  "Foods in `unknown` are not in the food data: estimate those yourself, add them to the known totals, and say which part is your own estimate.";

export async function foodsNutritionHandler(_ctx: unknown, input: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseFoodRows(input);
  if (!parsed.ok) return { ok: false, reason: "INVALID_INPUT", message: parsed.message };
  const totals = priceFoods(parsed.rows);
  return { ok: true, data: { ...totals, ...(totals.unknown.length > 0 ? { note: UNKNOWN_FOODS_NOTE } : {}) } };
}

export const foodsNutritionDef = {
  name: "foods_nutrition",
  description:
    "Calories, protein, carbs and fat for a list of foods with gram amounts, from Wondish's food data (the same data dish cards use). Use it whenever you estimate a meal from a photo or from amounts the user gave, once you know the grams. List oil, butter, dressing and sauce as their own rows. Foods it does not know come back in `unknown`: estimate those yourself.",
  input_schema: {
    type: "object" as const,
    properties: {
      foods: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Plain food name, e.g. 'white rice', 'chicken breast', 'olive oil'." },
            grams: { type: "number", description: "Grams of this food in the serving." },
            asServed: {
              type: "boolean",
              description: "True (default) when the grams are as served/cooked, as in a photo. False for dry or raw weights.",
            },
          },
          required: ["name", "grams"],
        },
      },
    },
    required: ["foods"],
  },
};
