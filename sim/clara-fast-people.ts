// The people of the live before/after simulation for fast, always-a-dish
// Clara (sim/clara-fast-live.sim.ts, docs/qa/clara-fast-dishes.md): 40 people,
// weighted to multi-restriction profiles, one dish_suggest each, plus 8 day
// plans. Each plan person has breakfast logged today except the eating-out
// one (dinner is out), so every plan asks for exactly two dishes.
import type { RuleKey } from "./profiles";

export type FastPerson = {
  id: string;
  rules: RuleKey[];
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  servings?: number;
  maxMinutes?: number;
  /** Onboarding answers: the "starting picture" path. */
  eating?: Record<string, number>;
  /** Three days of logged library meals: the levels path. */
  logs?: boolean;
  /** Also runs dish_plan_today with this occasion. */
  plan?: "normal" | "eating_out" | "guests" | "little_time";
  hard: boolean;
};

const LOW_FIBRE_EATING = { veg: 0, fruit: 1, beans: 0, grains: 1, fish: 0, meat: 1, dairy: 1, packaged: 2, sweet: 1 };
const VEGAN_EATING = { veg: 2, fruit: 1, beans: 2, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 1, sweet: 0 };

const ALL_ALLERGIES: RuleKey[] = ["allergy:Dairy", "allergy:Eggs", "allergy:Fish", "allergy:Peanuts", "allergy:Sesame", "allergy:Shellfish", "allergy:Soy", "allergy:Tree nuts", "allergy:Wheat"];

export const FAST_PEOPLE: FastPerson[] = [
  // ── the three that failed in the first live sample, and the rest of it ──
  { id: "allergies+CKD3", rules: ["allergy:Peanuts", "allergy:Tree nuts", "allergy:Shellfish", "condition:Chronic kidney disease – stage 3"], mealType: "dinner", logs: true, hard: true },
  { id: "vegan+celiac", rules: ["diet:Vegan", "condition:Celiac Disease"], mealType: "breakfast", eating: VEGAN_EATING, plan: "normal", hard: true },
  { id: "pregnancy+fish allergy", rules: ["condition:Pregnancy", "allergy:Fish"], mealType: "dinner", eating: LOW_FIBRE_EATING, hard: true },
  { id: "T2D+hypertension", rules: ["condition:Type 2 Diabetes", "condition:Hypertension"], mealType: "dinner", logs: true, hard: true },
  { id: "guests=4 sesame+soy", rules: ["allergy:Sesame", "allergy:Soy"], mealType: "dinner", servings: 4, logs: true, hard: true },
  { id: "vegetarian no eggs/dairy", rules: ["diet:Vegetarian", "allergy:Eggs", "allergy:Dairy"], mealType: "dinner", plan: "little_time", hard: true },
  { id: "CKD1-2+HTN+vegan+tree nuts", rules: ["allergy:Tree nuts", "condition:Chronic Kidney Disease stage 1-2", "condition:Hypertension", "diet:Vegan"], mealType: "dinner", servings: 4, hard: true },
  // ── multi-restriction ──
  { id: "dairy+egg+nut allergies", rules: ["allergy:Dairy", "allergy:Eggs", "allergy:Peanuts", "allergy:Tree nuts"], mealType: "breakfast", hard: true },
  { id: "top-5 allergies (dairy egg nut soy wheat)", rules: ["allergy:Dairy", "allergy:Eggs", "allergy:Peanuts", "allergy:Tree nuts", "allergy:Soy", "allergy:Wheat"], mealType: "dinner", plan: "guests", hard: true },
  { id: "kidney+hypertension+diabetes", rules: ["condition:Chronic kidney disease – stage 3", "condition:Hypertension", "condition:Type 2 Diabetes"], mealType: "dinner", logs: true, plan: "normal", hard: true },
  { id: "pregnancy+fish allergy+vegetarian", rules: ["condition:Pregnancy", "allergy:Fish", "diet:Vegetarian"], mealType: "lunch", hard: true },
  { id: "low-FODMAP style (IBS-D, no spicy)", rules: ["condition:IBS-D", "avoid:Spicy foods"], mealType: "dinner", hard: true },
  { id: "IBS-M+gluten-free+dairy allergy", rules: ["condition:IBS-M", "diet:Gluten-free", "allergy:Dairy"], mealType: "breakfast", hard: true },
  { id: "every rule at once", rules: [...ALL_ALLERGIES, "diet:Vegan", "diet:Keto", "diet:Paleo", "condition:Chronic kidney disease – stage 3", "condition:Hypertension", "condition:Type 2 Diabetes", "condition:Celiac Disease", "condition:IBS-D", "avoid:Red meat", "avoid:Pork", "avoid:Added sugars", "avoid:Fried foods"], mealType: "dinner", plan: "normal", hard: true },
  { id: "vegan+soy+gluten-free", rules: ["diet:Vegan", "allergy:Soy", "diet:Gluten-free"], mealType: "lunch", hard: true },
  { id: "keto+dairy allergy", rules: ["diet:Keto", "allergy:Dairy"], mealType: "dinner", hard: true },
  { id: "paleo+egg+tree nuts", rules: ["diet:Paleo", "allergy:Eggs", "allergy:Tree nuts"], mealType: "breakfast", hard: true },
  { id: "pescatarian+fish+shellfish allergy", rules: ["diet:Pescatarian", "allergy:Fish", "allergy:Shellfish"], mealType: "dinner", hard: true },
  { id: "celiac+dairy+eggs", rules: ["condition:Celiac Disease", "allergy:Dairy", "allergy:Eggs"], mealType: "lunch", plan: "eating_out", hard: true },
  { id: "heart+cholesterol+HTN+low-carb", rules: ["condition:Heart Disease and Atherosclerosis", "condition:High Cholesterol", "condition:Hypertension", "diet:Low-carb"], mealType: "dinner", logs: true, hard: true },
  { id: "GERD+gastritis, no spicy/caffeine (25 min)", rules: ["condition:GERD", "condition:Gastritis", "avoid:Spicy foods", "avoid:Caffeine"], mealType: "dinner", maxMinutes: 25, hard: true },
  { id: "CKD3+vegan", rules: ["condition:Chronic kidney disease – stage 3", "diet:Vegan"], mealType: "dinner", hard: true },
  { id: "vegan+tree nuts+peanuts+sesame", rules: ["diet:Vegan", "allergy:Tree nuts", "allergy:Peanuts", "allergy:Sesame"], mealType: "lunch", hard: true },
  { id: "NAFLD+T2D, no added sugar/fried", rules: ["condition:Fatty Liver Disease (NAFLD)", "condition:Type 2 Diabetes", "avoid:Added sugars", "avoid:Fried foods"], mealType: "dinner", eating: LOW_FIBRE_EATING, hard: true },
  { id: "pregnancy+gluten-free+dairy-free", rules: ["condition:Pregnancy", "diet:Gluten-free", "diet:Dairy-free"], mealType: "lunch", hard: true },
  { id: "mediterranean+shellfish+no red meat+cholesterol", rules: ["diet:Mediterranean", "allergy:Shellfish", "avoid:Red meat", "condition:High Cholesterol"], mealType: "dinner", hard: true },
  { id: "low-carb+HTN+soy allergy", rules: ["diet:Low-carb", "condition:Hypertension", "allergy:Soy"], mealType: "dinner", logs: true, hard: true },
  { id: "vegetarian+wheat+soy allergy", rules: ["diet:Vegetarian", "allergy:Wheat", "allergy:Soy"], mealType: "dinner", hard: true },
  { id: "no pork/alcohol+fish allergy", rules: ["avoid:Pork", "avoid:Alcohol", "allergy:Fish"], mealType: "dinner", servings: 6, hard: true },
  { id: "celiac+IBS-D+vegan", rules: ["condition:Celiac Disease", "condition:IBS-D", "diet:Vegan"], mealType: "dinner", hard: true },
  // ── ordinary and empty ──
  { id: "empty profile", rules: [], mealType: "dinner", plan: "guests", hard: false },
  { id: "empty profile, breakfast", rules: [], mealType: "breakfast", hard: false },
  { id: "lose weight", rules: ["goal:Lose weight + preserve muscle"], mealType: "dinner", hard: false },
  { id: "high-protein", rules: ["diet:High-protein"], mealType: "lunch", hard: false },
  { id: "mediterranean", rules: ["diet:Mediterranean"], mealType: "dinner", eating: LOW_FIBRE_EATING, hard: false },
  { id: "overweight+eat healthier", rules: ["condition:Overweight", "goal:Eat healthier"], mealType: "lunch", hard: false },
  { id: "peanut allergy, snack", rules: ["allergy:Peanuts"], mealType: "snack", hard: false },
  { id: "dairy allergy, breakfast", rules: ["allergy:Dairy"], mealType: "breakfast", hard: false },
  { id: "hypertension", rules: ["condition:Hypertension"], mealType: "dinner", logs: true, plan: "little_time", hard: false },
  { id: "vegetarian, guests=6", rules: ["diet:Vegetarian"], mealType: "dinner", servings: 6, hard: false },
];
