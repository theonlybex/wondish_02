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
import type { TrialGraphRow } from "@/lib/diet-match";
import { phaseFor, isEnforced } from "@/lib/trials/schedule";
import { termsForCategory, categoryTitle } from "@/lib/trials/category-terms";

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
  // `guidance` is the DB column (custom conditions, or an admin override);
  // the code map below is the fallback for built-in rows.
  healthConditions: { condition: { name: string; guidance?: string | null; bannedIngredients: { name: string }[] } }[];
  motivations: { motivation: { name: string; bannedIngredients: { name: string }[] } }[];
  triggerTrials?: TrialGraphRow[];
}

// Soft, prompt-level guidance per condition — the "how to cook for it" that a
// hard ingredient ban can't express. Plain salt was a hard ban for
// Hypertension / Heart Disease / Kidney Disease until 2026-09-11, which left a
// Hypertension profile 3 library dinners; sodium restriction is guidance.
export const CONDITION_GUIDANCE: Record<string, string> = {
  hypertension: "keep sodium low — season with herbs, citrus and spices, only a pinch of salt, no cured meats or salty sauces",
  "heart disease": "keep sodium and saturated fat low — minimal salt, lean proteins, olive oil over butter",
  // Stage 1-2 (2026-09-11): potassium/phosphorus foods moved from hard bans to
  // portion guidance — NKF/KDIGO restrict them by lab values, not by stage.
  "kidney disease stage 1-2": "keep sodium low — minimal salt, no processed or cured meats, canned soups or pickles; legumes, nuts, dairy and high-potassium fruit and vegetables in moderate portions rather than never",
  "chronic kidney disease – stage 3": "low sodium, moderate protein portions, limit high-potassium and high-phosphorus foods",
  "high cholesterol": "favour unsaturated fats, fibre and lean proteins; limit saturated fat",
  "type 2 diabetes": "steady carbohydrates with fibre and protein; avoid added sugars and refined starches",
  prediabetes: "steady carbohydrates with fibre and protein; avoid added sugars",
  gerd: "avoid very spicy, fried, acidic or late heavy meals",
  "fatty liver disease (nafld)": "limit added sugars, refined carbs and saturated fat",
  pcos: "lower glycemic load — whole grains, legumes and vegetables over refined carbs and added sugars; steady protein at each meal",
  "thyroid disorder": "cook cruciferous vegetables rather than serving them raw in quantity, keep soy moderate and away from medication time, avoid seaweed/kelp; do not restrict iodised salt without advice",
  "recovering after illness/surgery": "nutrient-dense, protein-forward, small frequent meals, soft textures if appetite is low, plenty of fluids; never cut calories during recovery",
  "hypertriglyceridemia": "limit added sugars, refined carbs and alcohol; favour fish, nuts and olive oil",
  pregnancy: "no raw or undercooked fish, meat, eggs or sprouts, no unpasteurised dairy or soft cheeses, limit high-mercury fish, no alcohol; folate- and iron-rich foods",
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
    // A user-written guidance line is quoted so the model reads it as the
    // diner's instruction, not as ours.
    const guidance = patient.healthConditions
      .map((c) => {
        const own = c.condition.guidance?.trim();
        if (own) return `${c.condition.name} (the diner's own note): "${own}"`;
        return CONDITION_GUIDANCE[c.condition.name.trim().toLowerCase()];
      })
      .filter((g): g is string => Boolean(g));
    if (guidance.length > 0) lines.push(`Condition guidance: ${guidance.join("; ")}`);
  }

  // Trigger trials (workbook 04): the eliminated category during enforced
  // phases; the challenge instruction during reintroduction.
  const today = new Date();
  for (const t of patient.triggerTrials ?? []) {
    const { terms } = termsForCategory(t.rule.category);
    const title = categoryTitle(t.rule.category);
    if (t.status === "COMPLETED" && t.classification === "LIKELY_TRIGGER") {
      lines.push(`Trigger trial result: ${title} is a likely trigger — never include: ${terms.join(", ")}`);
      continue;
    }
    if (t.status !== "ACTIVE") continue;
    const p = phaseFor(t.rule, new Date(t.startDate), today);
    if (isEnforced(p.phase)) {
      const where = p.phase === "ELIMINATION" || p.phase === "EVALUATION" ? `day ${p.dayNumber} of ${t.rule.trialDays}` : p.phase.toLowerCase();
      lines.push(`Trigger trial: eliminating ${title} (${where}) — never include: ${terms.join(", ")}`);
    } else if (p.phase === "REINTRODUCTION") {
      lines.push(`Trigger trial: reintroducing ${title} — include one normal portion a day and note symptoms`);
    }
  }

  if (patient.motivations?.length > 0) {
    const names = patient.motivations.map((m) => m.motivation.name).join(", ");
    // Deduplicated, and described as a LEANING rather than a restriction.
    //
    // This line used to read "Restricted from goals: sugar, …, white rice, …"
    // — once per motivation, undeduplicated — and it goes into Clara's prompt
    // under "respect every line". So when a tester with an empty foodToAvoid
    // list asked about jasmine rice, she answered "yes, your profile does avoid
    // white rice": not a hallucination, the server told her so (QA 2026-09-24).
    //
    // Nothing else in the app treats these as bans — derivePatientBans, which
    // the plan builder and the swap use, reads allergies and foodToAvoid only.
    // So the app invited the user to stock four kinds of rice, certified the
    // basket, built them a week of rice, and then told them it conflicted with
    // their goals. A goal is a direction of travel; only an allergy or an
    // explicit avoid entry forbids a food.
    //
    // Attributed rather than dropped, because the strength varies with the
    // goal: "Sobriety → alcohol" is worth saying out loud, "Eat healthier →
    // white rice" is not a prohibition. Naming the goal lets Clara say the
    // true thing in both cases without asserting a restriction that is not
    // there.
    const leanAway = Array.from(
      new Set(patient.motivations.flatMap((m) => m.motivation.bannedIngredients.map((b) => b.name)))
    );
    lines.push(`Goals: ${names}`);
    if (leanAway.length > 0) {
      lines.push(
        `Foods those GOALS steer away from (attribute these to the goal, never to a dietary restriction — ` +
          `the diner has not banned them and the app will still plan with them): ${leanAway.join(", ")}`
      );
    }
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
