// Calories from a list of foods with gram amounts (2026-11-14, user request:
// Clara asks questions "to find grams of ingredients inside" a photo).
//
// Clara's eye decides WHAT is on the plate and HOW MUCH; the numbers come
// from the same per-100 g food table the dish cards are priced with
// (lib/staple-density.ts), so a photo meal and a cooked dish agree. Foods the
// table does not know come back as `unknown` for Clara to estimate herself.
import { pricePlainFood } from "@/lib/staple-density";
import type { ToolResult } from "./types";

export const MAX_FOOD_ROWS = 20;
export const MAX_FOOD_GRAMS = 3000;

/**
 * The table is per 100 g as bought: grains dry, meat raw. A photo shows food
 * as served, so cooked grains and pulses are priced at their cooked density
 * (pricePlainFood's `cooked`) and cooked meat and fish at ~1.3x raw, because
 * they lose about a quarter of their weight in water.
 */
const COOKS_DRY = /\b(chicken|turkey|beef|steak|sirloin|pork|bacon|ham|salmon|tuna|cod|tilapia|haddock|catfish|trout|sole|pollock|fish|shrimp|prawns?)\b/i;
export const COOKED_MEAT_FACTOR = 1.3;

export interface FoodRow {
  name: string;
  grams: number;
  /** Grams as served (cooked). False for dry or raw weights. */
  asServed: boolean;
  /** Clara's own figures for that many grams. Used only when the food data does not know the food. */
  own?: FoodFigures;
}

export interface FoodFigures {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
  const priced = pricePlainFood(row.name, row.grams, row.asServed);
  const base = { name: row.name, grams: row.grams };
  // Only a seasoning on its own (salt, herbs, lemon juice, garlic, soy sauce) counts as nothing. A food whose
  // name merely holds such a word ("garlic bread", "cinnamon roll") is unknown, so the caller's estimate is used.
  if (priced.kind === "seasoning") return { ...base, source: "negligible", calories: 0, protein: 0, carbs: 0, fat: 0 };
  if (priced.kind === "unknown") return { ...base, source: "unknown", calories: null, protein: null, carbs: null, fat: null };
  const k = row.asServed && !priced.shrunk && !priced.asEaten && COOKS_DRY.test(row.name) ? COOKED_MEAT_FACTOR : 1;
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

export interface MealTotals extends FoodFigures {
  /** Foods the table did not know: Clara's own figures were used for them. */
  estimated: string[];
  /** Foods the table did not know and Clara gave no figures for: NOT in the totals. */
  missing: string[];
}

/**
 * One meal's numbers, added up here and nowhere else: each food from the food
 * table, and Clara's own figure only for a food the table does not know. The
 * photo flow, the quick log and logs_create all use this, so the number Clara
 * says, the number logged and the number on the Numbers tab are one sum.
 */
export function mealTotals(rows: readonly FoodRow[]): MealTotals {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  const estimated: string[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const priced = priceFoodRow(row);
    if (priced.calories !== null) {
      calories += priced.calories; protein += priced.protein ?? 0; carbs += priced.carbs ?? 0; fat += priced.fat ?? 0;
    } else if (row.own) {
      estimated.push(row.name);
      calories += row.own.calories; protein += row.own.protein; carbs += row.own.carbs; fat += row.own.fat;
    } else {
      missing.push(row.name);
    }
  }
  return { calories: Math.round(calories), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), estimated, missing };
}

/** Clara's own figures on a food row: all four numbers, or nothing. */
function ownFigures(f: Record<string, unknown>): FoodFigures | undefined {
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const calories = n(f.calories), protein = n(f.protein), carbs = n(f.carbs), fat = n(f.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return undefined;
  return { calories, protein, carbs, fat };
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
    const own = ownFigures(f);
    rows.push({ name, grams, asServed: f.asServed !== false, ...(own ? { own } : {}) });
  }
  return { ok: true, rows };
}

export const MISSING_FOODS_NOTE =
  "The foods in `missing` are not in the food data and came without your own figures, so `totals` leaves them out: call foods_nutrition again with the same foods and your own calories, protein, carbs and fat on those rows.";

/** A message naming the foods nobody has figures for. */
export function missingFoodsMessage(missing: readonly string[]): string {
  return `No figures for: ${missing.join(", ")}. Send the same foods again with your own calories, protein, carbs and fat on those rows.`;
}

export async function foodsNutritionHandler(_ctx: unknown, input: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseFoodRows(input);
  if (!parsed.ok) return { ok: false, reason: "INVALID_INPUT", message: parsed.message };
  const { estimated, missing, ...totals } = mealTotals(parsed.rows);
  const rows = parsed.rows.map(priceFoodRow);
  if (missing.length > 0) return { ok: true, data: { rows, totals, estimated, missing, note: MISSING_FOODS_NOTE } };
  return {
    ok: true,
    data: { rows, totals, estimated, shown: SHOWN_NOTE },
    say: mealSummaryText(parsed.rows, totals, estimated),
  };
}

export const SHOWN_NOTE =
  "The app has already written the foods with their grams and these totals into your reply (the `say` text). Do not write them again.";

/** The priced meal as the person reads it: the foods with grams, the totals, and what is Clara's own estimate. */
export function mealSummaryText(rows: readonly FoodRow[], totals: FoodFigures, estimated: readonly string[]): string {
  const foods = rows.map((r) => `${r.name} ${Math.round(r.grams)} g`).join(", ");
  const lines = [
    `${foods.charAt(0).toUpperCase()}${foods.slice(1)}.`,
    `Per serving: ${totals.calories} kcal, ${totals.protein} g protein, ${totals.carbs} g carbs, ${totals.fat} g fat.`,
  ];
  if (estimated.length > 0) lines.push(`My own estimate: ${estimated.join(", ")}.`);
  return lines.join("\n");
}

const OWN_FIGURE = "Your own figure for that many grams. Used only when the food data does not know the food.";

/** The foods list both foods_nutrition and logs_create take. */
export const FOODS_INPUT = {
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
      calories: { type: "number", description: OWN_FIGURE },
      protein: { type: "number", description: OWN_FIGURE },
      carbs: { type: "number", description: OWN_FIGURE },
      fat: { type: "number", description: OWN_FIGURE },
    },
    required: ["name", "grams"],
  },
} as const;

export const foodsNutritionDef = {
  name: "foods_nutrition",
  description:
    "Calories, protein, carbs and fat for a list of foods with gram amounts, from Wondish's food data (the same data dish cards use). Use it whenever you estimate a meal from a photo or from amounts the user gave, once you know the grams. List oil, butter, dressing and sauce as their own rows, and give your own calories, protein, carbs and fat on every row: they are used only for a food the food data does not know. `totals` is the finished sum for the meal, and the app writes the foods and those totals into your reply itself: never write them again or add anything up yourself.",
  input_schema: {
    type: "object" as const,
    properties: { foods: FOODS_INPUT },
    required: ["foods"],
  },
};
