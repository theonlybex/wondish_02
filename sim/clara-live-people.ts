// The eight hard profiles of the live sample (shared by sim/clara-live.sim.ts and sim/clara-gate-replay.ts).
import type { RuleKey } from "./profiles";

export const LIVE_PEOPLE: { id: string; rules: RuleKey[]; servings?: number; eating?: Record<string, number>; logs?: boolean }[] = [
  { id: "allergies+CKD3", rules: ["allergy:Peanuts", "allergy:Tree nuts", "allergy:Shellfish", "condition:Chronic kidney disease – stage 3"], logs: true },
  { id: "vegan+celiac", rules: ["diet:Vegan", "condition:Celiac Disease"], eating: { veg: 2, fruit: 1, beans: 2, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 1, sweet: 0 } },
  { id: "pregnancy+fish allergy", rules: ["condition:Pregnancy", "allergy:Fish"], eating: { veg: 0, fruit: 1, beans: 0, grains: 1, fish: 0, meat: 1, dairy: 1, packaged: 2, sweet: 1 } },
  { id: "T2D+hypertension", rules: ["condition:Type 2 Diabetes", "condition:Hypertension"], logs: true },
  { id: "empty profile", rules: [] },
  { id: "guests=4 sesame+soy", rules: ["allergy:Sesame", "allergy:Soy"], servings: 4, logs: true },
  { id: "vegetarian no eggs/dairy", rules: ["diet:Vegetarian", "allergy:Eggs", "allergy:Dairy"] },
  { id: "CKD1-2+HTN+vegan+tree nuts", rules: ["allergy:Tree nuts", "condition:Chronic Kidney Disease stage 1-2", "condition:Hypertension", "diet:Vegan"], servings: 4 },
];
