// Grocery quantity engine — Wondish 06 "Grocery Conversion" steps 2–5, pure.
//
//   2. AGGREGATE   per ingredient, per unit (never mix units before converting)
//   3. CONVERT     unit → base (g / mL / count) via IngredientUnitConversion
//   4. FLAG        LOW-confidence conversions surface as "approximate"
//   5. ROUND       a separate, user-facing purchase amount; the required
//                  amount itself is never rounded
//
// Rounding rules (sheet "Purchase Rounding Rules"):
//   VARIABLE_WEIGHT  g  → oz below ~1 lb, lb at/above; round UP (½ oz / ¼ lb)
//   VARIABLE_VOLUME  mL → fl oz below ~1 L, L at/above; round UP (½ fl oz / ¼ L)
//   WHOLE_COUNT      count → next whole unit          (1.7 onions → 2)
// The sheet's own example "412 g → ≈ 1 lb" shows that an amount close to a
// pound is shown in pounds, so the unit switch happens at ¾ of the big unit.

export type BaseUnit = "g" | "mL" | "count";

export interface NeedRow {
  ingredientId: string;
  quantity: number | null;
  unit: string | null;
}

export interface ConversionRow {
  ingredientId: string;
  unit: string;
  baseQuantity: number;
  baseUnit: string;
  confidence: string;
}

export interface BaseNeed {
  ingredientId: string;
  base: number;
  baseUnit: BaseUnit;
  approx: boolean;
  unconverted: { unit: string; quantity: number }[];
}

const G_PER_OZ = 28.349523125;
const G_PER_LB = 453.59237;
const ML_PER_FLOZ = 29.5735295625;
const ML_PER_L = 1000;

// Units that mean "a whole thing" — blank included (recipe rows with a bare
// number). Anything else must go through a conversion row.
const COUNT_UNITS = new Set([
  "", "count", "piece", "pieces", "each", "whole", "clove", "cloves",
  "slice", "slices", "medium", "large", "small", "unit", "units", "item", "items",
]);

// Units that are already a mass or volume — no per-ingredient conversion row
// needed (Wondish 06 "Universal Unit Conversions"). Keys are normalised units.
const UNIVERSAL: Record<string, { baseQuantity: number; baseUnit: BaseUnit }> = {
  g: { baseQuantity: 1, baseUnit: "g" }, gr: { baseQuantity: 1, baseUnit: "g" },
  gram: { baseQuantity: 1, baseUnit: "g" }, grams: { baseQuantity: 1, baseUnit: "g" },
  kg: { baseQuantity: 1000, baseUnit: "g" },
  oz: { baseQuantity: G_PER_OZ, baseUnit: "g" }, ounce: { baseQuantity: G_PER_OZ, baseUnit: "g" }, ounces: { baseQuantity: G_PER_OZ, baseUnit: "g" },
  lb: { baseQuantity: G_PER_LB, baseUnit: "g" }, lbs: { baseQuantity: G_PER_LB, baseUnit: "g" }, pound: { baseQuantity: G_PER_LB, baseUnit: "g" }, pounds: { baseQuantity: G_PER_LB, baseUnit: "g" },
  ml: { baseQuantity: 1, baseUnit: "mL" }, l: { baseQuantity: ML_PER_L, baseUnit: "mL" }, liter: { baseQuantity: ML_PER_L, baseUnit: "mL" }, litre: { baseQuantity: ML_PER_L, baseUnit: "mL" },
  "fl oz": { baseQuantity: ML_PER_FLOZ, baseUnit: "mL" },
};

export const normUnit = (u: string | null | undefined) => (u ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Step 2: ingredientId → unit → summed quantity. Null/zero quantities are skipped. */
export function aggregateNeeds(rows: readonly NeedRow[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.quantity == null || !(r.quantity > 0)) continue;
    const u = normUnit(r.unit);
    const byUnit = m.get(r.ingredientId) ?? new Map<string, number>();
    byUnit.set(u, (byUnit.get(u) ?? 0) + r.quantity);
    m.set(r.ingredientId, byUnit);
  }
  return m;
}

/**
 * Steps 3–4: convert each ingredient's per-unit totals into one base amount.
 * The first convertible unit decides the base; units that don't convert, or
 * convert to a different base, are reported in `unconverted` rather than
 * mixed in. Ingredients with nothing convertible produce no entry.
 */
export function toBase(
  needs: Map<string, Map<string, number>>,
  conversions: readonly ConversionRow[]
): BaseNeed[] {
  const conv = new Map<string, ConversionRow>();
  for (const c of conversions) conv.set(`${c.ingredientId}|${normUnit(c.unit)}`, c);

  const out: BaseNeed[] = [];
  for (const [ingredientId, byUnit] of needs) {
    let base = 0;
    let baseUnit: BaseUnit | null = null;
    let approx = false;
    const unconverted: { unit: string; quantity: number }[] = [];

    for (const [unit, quantity] of byUnit) {
      if (COUNT_UNITS.has(unit)) {
        if (baseUnit === null || baseUnit === "count") { baseUnit = "count"; base += quantity; }
        else unconverted.push({ unit, quantity });
        continue;
      }
      const c = conv.get(`${ingredientId}|${unit}`);
      const universal = UNIVERSAL[unit];
      const cBase: BaseUnit | null = c
        ? (normUnit(c.baseUnit) === "ml" ? "mL" : normUnit(c.baseUnit) === "g" ? "g" : null)
        : universal?.baseUnit ?? null;
      if (cBase === null || (baseUnit !== null && baseUnit !== cBase)) {
        unconverted.push({ unit, quantity });
        continue;
      }
      baseUnit = cBase;
      base += quantity * (c ? c.baseQuantity : universal.baseQuantity);
      if (c && c.confidence.toUpperCase() === "LOW") approx = true;
    }

    if (baseUnit === null) continue;
    out.push({ ingredientId, base, baseUnit, approx, unconverted });
  }
  return out;
}

const EPS = 1e-9;
const up = (v: number, step: number) => Math.ceil(v / step - EPS) * step;
// Up to two decimals, trailing zeros trimmed: 1 → "1", 1.5 → "1.5", 1.75 → "1.75".
const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** Step 5: the user-facing suggested purchase amount (always rounded UP). */
export function formatPurchase(base: number, baseUnit: BaseUnit): string {
  if (baseUnit === "count") return String(Math.max(1, Math.ceil(base - EPS)));
  if (baseUnit === "g") {
    return base >= 0.75 * G_PER_LB
      ? `${fmt(up(base / G_PER_LB, 0.25))} lb`
      : `${fmt(up(base / G_PER_OZ, 0.5))} oz`;
  }
  return base >= 0.75 * ML_PER_L
    ? `${fmt(up(base / ML_PER_L, 0.25))} L`
    : `${fmt(up(base / ML_PER_FLOZ, 0.5))} fl oz`;
}
