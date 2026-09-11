// Wondish workbook profile_factor_id → our HealthCondition.name(s).
// Source: workbook 05 "Condition Journal Summary" names, matched by hand
// (spec docs/superpowers/specs/2026-09-11-workbooks-tier2-3-design.md).
// Factor 4 ("Prediabetes / Type 2 Diabetes") maps to two of our rows.
// Not covered by any factor: Kidney Disease stage 1-2, Chronic kidney
// disease – stage 3, Thyroid Disorder, PCOS, Recovering after illness/surgery.
export const CONDITION_FACTOR_MAP: Record<number, string[]> = {
  340: ["Acne"],
  3: ["Alzheimer's Disease"],
  345: ["Cancer – after treatment"],
  344: ["Cancer – during treatment"],
  7: ["Celiac Disease"],
  55: ["Chronic Diarrhea"],
  2: ["Chronic Inflammatory Conditions"],
  8: ["Constipation"],
  347: ["Eczema"],
  56: ["Fatty Liver Disease (NAFLD)"],
  10: ["GERD"],
  9: ["Gastritis"],
  57: ["Candidiasis"],
  343: ["Hair Shedding"],
  5: ["Heart Disease"],
  6: ["Hypertension"],
  11: ["High Cholesterol"],
  348: ["IBD – active"],
  349: ["IBD – in remission"],
  350: ["IBS-C"],
  351: ["IBS-D"],
  59: ["Migraine"],
  14: ["Overweight"],
  4: ["Type 2 Diabetes", "Prediabetes"],
  1: ["Respiratory Allergies"],
  341: ["Rosacea"],
  342: ["Seborrheic Dermatitis"],
  54: ["Stroke"],
  61: ["Foggy brain"],
};

export function conditionNamesForFactor(profileFactorId: number): string[] {
  return CONDITION_FACTOR_MAP[profileFactorId] ?? [];
}
