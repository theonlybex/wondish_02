// Shared food-map extraction — pure module, no Next/Prisma-runtime import
// beyond structural types. Lifted out of app/api/dish-checker/route.ts
// (behavior-preserving) so /api/dish-checker and /api/fridge share one
// source of truth for the patient dietary-constraint display text and the
// Prisma include shape it's built from.
//
// Per the Cycle-5 execution amendment (docs/superpowers/plans/
// 2026-07-20-ios-phase4-fridge.md), `collectBannedTerms` is built on top of
// lib/diet-match.ts's `derivePatientBans` — it does NOT hand-roll a fresh
// ban union. `buildFoodMapText` stays a verbatim lift (the Restaurants-cycle
// review adjudicated its display-text shape as un-refactorable onto the
// diet-match engine).

import { PATIENT_DIET_INCLUDE, derivePatientBans, type PatientDietGraph } from "@/lib/diet-match";

// ── PATIENT_FOOD_MAP_INCLUDE ────────────────────────────────────────────────
// Composes the shared diet-graph include with `mealType: true` rather than
// redeclaring the graph shape.
export const PATIENT_FOOD_MAP_INCLUDE = {
  mealType: true,
  ...PATIENT_DIET_INCLUDE,
} as const;

// Structural shape buildFoodMapText/collectBannedTerms read — matches what
// PATIENT_FOOD_MAP_INCLUDE fetches. A superset of PatientDietGraph (adds the
// display-only `name` fields diet-match's ban-derivation doesn't need), so a
// FoodMapPatient value satisfies PatientDietGraph structurally.
export interface FoodMapPatient {
  mealType?: { name: string } | null;
  foodAllergies: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  foodToAvoid: { food: { name: string; bannedIngredients?: { name: string }[] } }[];
  foodPreferences: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  healthConditions: { condition: { name: string; bannedIngredients: { name: string }[] } }[];
  motivations: { motivation: { name: string; bannedIngredients: { name: string }[] } }[];
}

// Soft, prompt-level guidance per condition — the "how to cook for it" that a
// hard ingredient ban can't express. Plain salt was a hard ban for
// Hypertension / Heart Disease / Kidney Disease until 2026-09-11, which left a
// Hypertension profile 3 library dinners; sodium restriction is guidance.
export const CONDITION_GUIDANCE: Record<string, string> = {
  hypertension: "keep sodium low — season with herbs, citrus and spices, only a pinch of salt, no cured meats or salty sauces",
  "heart disease": "keep sodium and saturated fat low — minimal salt, lean proteins, olive oil over butter",
  "kidney disease stage 1-2": "keep sodium moderate and avoid very high-potassium/phosphorus loads — minimal salt, no processed meats",
  "chronic kidney disease – stage 3": "low sodium, moderate protein portions, limit high-potassium and high-phosphorus foods",
  "high cholesterol": "favour unsaturated fats, fibre and lean proteins; limit saturated fat",
  "type 2 diabetes": "steady carbohydrates with fibre and protein; avoid added sugars and refined starches",
  prediabetes: "steady carbohydrates with fibre and protein; avoid added sugars",
  gerd: "avoid very spicy, fried, acidic or late heavy meals",
  "fatty liver disease (nafld)": "limit added sugars, refined carbs and saturated fat",
};

// ── buildFoodMapText ────────────────────────────────────────────────────────
// Verbatim lift of dish-checker/route.ts's private buildFoodMapText.
export function buildFoodMapText(patient: FoodMapPatient | null | undefined): string {
  if (!patient) return "No specific dietary restrictions on file.";

  const lines: string[] = [];

  if (patient.mealType) {
    lines.push(`Dietary pattern: ${patient.mealType.name}`);
  }

  if (patient.foodAllergies?.length > 0) {
    const names = patient.foodAllergies.map((a) => a.food.name).join(", ");
    const banned = patient.foodAllergies.flatMap((a) => a.food.bannedIngredients.map((b) => b.name));
    lines.push(`Allergies: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from allergies: ${banned.join(", ")}`);
  }

  if (patient.foodToAvoid?.length > 0) {
    lines.push(`Foods to avoid: ${patient.foodToAvoid.map((f) => f.food.name).join(", ")}`);
    const banned = patient.foodToAvoid.flatMap((f) => (f.food.bannedIngredients ?? []).map((b) => b.name));
    if (banned.length > 0) lines.push(`Restricted from foods to avoid: ${banned.join(", ")}`);
  }

  if (patient.foodPreferences?.length > 0) {
    const names = patient.foodPreferences.map((p) => p.food.name).join(", ");
    const banned = patient.foodPreferences.flatMap((p) => p.food.bannedIngredients.map((b) => b.name));
    lines.push(`Food preferences: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from preferences: ${banned.join(", ")}`);
  }

  if (patient.healthConditions?.length > 0) {
    const names = patient.healthConditions.map((c) => c.condition.name).join(", ");
    const banned = patient.healthConditions.flatMap((c) => c.condition.bannedIngredients.map((b) => b.name));
    lines.push(`Health conditions: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from conditions: ${banned.join(", ")}`);
    const guidance = patient.healthConditions
      .map((c) => CONDITION_GUIDANCE[c.condition.name.trim().toLowerCase()])
      .filter((g): g is string => Boolean(g));
    if (guidance.length > 0) lines.push(`Condition guidance: ${guidance.join("; ")}`);
  }

  if (patient.motivations?.length > 0) {
    const names = patient.motivations.map((m) => m.motivation.name).join(", ");
    const banned = patient.motivations.flatMap((m) => m.motivation.bannedIngredients.map((b) => b.name));
    lines.push(`Goals: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from goals: ${banned.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No specific dietary restrictions on file.";
}

// ── collectBannedTerms (F-D7) ───────────────────────────────────────────────
// Built on lib/diet-match.ts's derivePatientBans — NOT a fresh hand-rolled
// union. Flattens allergyNames + exactBanned[].name, lowercases, dedupes.
export function collectBannedTerms(patient: PatientDietGraph): string[] {
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const terms = [...allergyNames, ...exactBanned.map((b) => b.name)]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  return Array.from(new Set(terms));
}
