// How the profile groups health conditions (product list, 2026-10-07).
// Keys are the HealthCondition names stored in the DB; `label` is what the
// profile shows when it differs ("Hypertension" reads as "High Blood
// Pressure"). Selection still saves condition ids — labels are display only.
//
// Conditions the product list did not name are placed where they belong
// (IBS-M and Leaky Gut with digestive, AERD with immune/allergic, Pregnancy
// with nutritional support), and anything added later that is not mapped
// lands in "Other" — a condition must never vanish from the picker.

export type ConditionGroupDef = { title: string; conditions: { name: string; label?: string }[] };

export const CONDITION_GROUPS: ConditionGroupDef[] = [
  {
    title: "Digestive and intestinal",
    conditions: [
      { name: "Gut Candidiasis" },
      { name: "Celiac Disease" },
      { name: "Chronic Diarrhea" },
      { name: "Constipation" },
      { name: "Gastritis" },
      { name: "GERD", label: "Gastroesophageal Reflux Disease (GERD)" },
      { name: "IBS-C", label: "Irritable Bowel Syndrome (IBS-C)" },
      { name: "IBS-D", label: "Irritable Bowel Syndrome (IBS-D)" },
      { name: "IBS-M", label: "Irritable Bowel Syndrome (IBS-M)" },
      { name: "IBD – active", label: "Inflammatory Bowel Disease (Active)" },
      { name: "IBD – in remission", label: "Inflammatory Bowel Disease (In Remission)" },
      { name: "Leaky Gut Syndrome" },
    ],
  },
  {
    title: "Metabolic, endocrine, and liver",
    conditions: [
      { name: "Prediabetes" },
      { name: "Type 2 Diabetes" },
      { name: "Overweight" },
      { name: "Fatty Liver Disease (NAFLD)" },
      { name: "PCOS", label: "Polycystic Ovary Syndrome (PCOS)" },
      { name: "Thyroid Disorder" },
    ],
  },
  {
    title: "Cardiovascular and cerebrovascular",
    conditions: [
      { name: "Heart Disease and Atherosclerosis" },
      { name: "Hypertension", label: "High Blood Pressure" },
      { name: "High Cholesterol" },
      { name: "Hypertriglyceridemia" },
      { name: "Stroke" },
    ],
  },
  {
    title: "Neurological and cognitive",
    conditions: [{ name: "Alzheimer's Disease" }, { name: "Foggy brain", label: "Foggy Brain" }, { name: "Migraine" }],
  },
  {
    title: "Skin and hair",
    conditions: [
      { name: "Acne" },
      { name: "Eczema", label: "Eczema / Atopic Dermatitis" },
      { name: "Hair Shedding" },
      { name: "Rosacea" },
      { name: "Seborrheic Dermatitis" },
    ],
  },
  {
    title: "Immune, inflammatory, and allergic",
    conditions: [
      { name: "Autoimmune Diseases" },
      { name: "Chronic Inflammatory Conditions" },
      { name: "Respiratory Allergies" },
      { name: "Aspirin-Exacerbated Respiratory Disease (AERD)" },
    ],
  },
  {
    title: "Kidney",
    conditions: [
      { name: "Chronic Kidney Disease stage 1-2", label: "Chronic Kidney Disease—Stages 1–2" },
      { name: "Chronic kidney disease – stage 3", label: "Chronic Kidney Disease—Stage 3" },
    ],
  },
  {
    title: "Cancer and survivorship",
    conditions: [
      { name: "Cancer – during treatment", label: "Cancer—During Treatment" },
      { name: "Cancer – after treatment", label: "Cancer—After Treatment" },
    ],
  },
  {
    title: "Recovery and nutritional support",
    conditions: [{ name: "Recovering after illness/surgery", label: "Recovering After Illness or Surgery" }, { name: "Pregnancy" }],
  },
];

export const OTHER_GROUP_TITLE = "Other";

// Dashes and case vary between rows ("–" vs "-"): compare on a folded key.
const fold = (s: string) => s.trim().toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");

export type GroupedConditions<T> = { title: string; options: (T & { label: string })[] }[];

/** Group the picker's options in product order; unknown conditions go to "Other"; empty groups are dropped. */
export function groupConditions<T extends { id: string; name: string }>(options: readonly T[]): GroupedConditions<T> {
  const byName = new Map(options.map((o) => [fold(o.name), o]));
  const used = new Set<string>();
  const groups: GroupedConditions<T> = CONDITION_GROUPS.map((g) => ({
    title: g.title,
    options: g.conditions.flatMap((c) => {
      const o = byName.get(fold(c.name));
      if (!o || used.has(o.id)) return [];
      used.add(o.id);
      return [{ ...o, label: c.label ?? o.name }];
    }),
  }));
  const rest = options.filter((o) => !used.has(o.id)).map((o) => ({ ...o, label: o.name }));
  if (rest.length) groups.push({ title: OTHER_GROUP_TITLE, options: rest });
  return groups.filter((g) => g.options.length > 0);
}

/** Display label for one condition name (the summary line uses it). */
export function conditionLabel(name: string): string {
  for (const g of CONDITION_GROUPS) for (const c of g.conditions) if (fold(c.name) === fold(name)) return c.label ?? name;
  return name;
}
