// Simulated diners: one per rule, every pair of rules, every combination a
// real user holds, hand-built heavy combinations, and everything at once.
import type { Snapshot } from "./fake-db";

export type RuleKind = "allergy" | "avoid" | "condition" | "diet" | "goal" | "trial" | "dislike" | "plan";
export type RuleKey = `${RuleKind}:${string}`;
export type Profile = { id: string; tier: Tier; rules: RuleKey[]; users?: number };
export type Tier = "single" | "pair" | "real" | "curated" | "random" | "everything";

// Ingredients a diner can mark "not for me" on the taste screen — common
// library ingredients, olive oil included (the cooking-oil repair must not
// write in an oil the diner disliked).
export const DISLIKE_SAMPLE = ["Mushrooms", "Extra virgin olive oil", "Garlic", "Large eggs", "Boneless chicken breasts", "Jasmine rice", "Spinach", "Shredded cheddar"];

// A user-made eating plan (custom plans, 2026-10-07): a FoodPreference row the
// diner owns, with its own exclusions and a note — enforced like any diet.
export const SAMPLE_PLAN = { name: "My weekday light plan", guidance: "light dinners, nothing fried", bannedIngredients: [{ name: "white rice" }, { name: "jasmine rice" }, { name: "bacon" }, { name: "potatoes" }] };

export function ruleUniverse(snap: Snapshot) {
  const r = snap.rules;
  const lists: Record<Exclude<RuleKind, "trial" | "dislike" | "plan">, { name: string; bannedIngredients: { name: string }[] }[]> = {
    allergy: r.allergies,
    avoid: r.avoids,
    condition: r.conditions,
    diet: r.preferences,
    goal: r.motivations,
  };
  const all: RuleKey[] = [];
  const empty: RuleKey[] = []; // rules that ban nothing (prompt guidance only)
  for (const [kind, rows] of Object.entries(lists)) {
    for (const row of rows) {
      const key = `${kind}:${row.name}` as RuleKey;
      all.push(key);
      // Allergies always ban their own name; Celiac bans a group.
      if (kind !== "allergy" && kind !== "avoid" && row.bannedIngredients.length === 0 && row.name.toLowerCase() !== "celiac disease") empty.push(key);
    }
  }
  for (const category of Array.from(new Set(r.triggerRules.map((t) => t.category)))) all.push(`trial:${category}`);
  for (const name of DISLIKE_SAMPLE) if (snap.ingredients.some((i) => i.name === name)) all.push(`dislike:${name}`);
  all.push(`plan:${SAMPLE_PLAN.name}`);
  return { all, banning: all.filter((k) => !empty.includes(k)), empty, lists };
}

/** Build the diet graph the services read (PATIENT_DIET_INCLUDE shape) plus the body fields the planner needs. */
export function makePatient(snap: Snapshot, profile: Profile) {
  const { lists } = ruleUniverse(snap);
  const pick = (kind: Exclude<RuleKind, "trial" | "dislike" | "plan">) =>
    profile.rules
      .filter((k) => k.startsWith(`${kind}:`))
      .map((k) => {
        const name = k.slice(kind.length + 1);
        const row = lists[kind].find((x) => x.name === name);
        if (!row) throw new Error(`unknown rule ${k}`);
        return row;
      });
  const trials = profile.rules
    .filter((k) => k.startsWith("trial:"))
    .map((k) => {
      const category = k.slice("trial:".length);
      const rule = snap.rules.triggerRules.find((t) => t.category === category)!;
      // COMPLETED + LIKELY_TRIGGER is enforced on every date (enforcedTrials).
      return { status: "COMPLETED" as const, classification: "LIKELY_TRIGGER", startDate: new Date("2026-01-01"), rule: { ...rule, category } };
    });
  const activity = snap.physicalActivities.find((a) => a.level === 2) ?? snap.physicalActivities[0];
  return {
    id: `sim-${profile.id}`,
    accountId: `acc-${profile.id}`,
    account: { clerkId: `clerk-${profile.id}`, email: null },
    profileCompleted: true,
    tasteCompleted: true,
    // A plausible adult so the caloric engine runs its real path.
    birthday: new Date("1988-05-04"),
    sexAtBirth: "FEMALE",
    gender: null,
    genderId: null,
    weight: 165, // lbs (storage unit)
    weightUnit: "lbs",
    height: 168, // cm
    heightUnit: "cm",
    goalWeight: 150,
    goalWeightUnit: "lbs",
    weeklyGoal: 0.5,
    physicalActivity: activity,
    physicalActivityId: activity?.id ?? null,
    mealType: null,
    mealTypeId: null,
    mealPlanStartDate: new Date("2026-10-05"),
    activePlanVersion: 1,
    recentDishes: null,
    ingredientPreferences: profile.rules.filter((k) => k.startsWith("dislike:")).map((k) => ({ liked: false, ingredient: { name: k.slice("dislike:".length) } })),
    dishPreferences: [] as { recipeId: string }[],
    journalEntries: [] as { meals: { recipeId: string | null }[] }[],
    foodAllergies: pick("allergy").map((food) => ({ food })),
    foodToAvoid: pick("avoid").map((food) => ({ food })),
    healthConditions: pick("condition").map((condition) => ({ condition: { ...condition, ownerPatientId: null } })),
    foodPreferences: [
      ...pick("diet").map((food) => ({ food })),
      ...(profile.rules.includes(`plan:${SAMPLE_PLAN.name}` as RuleKey) ? [{ food: { ...SAMPLE_PLAN, ownerPatientId: `sim-${profile.id}` } }] : []),
    ],
    motivations: pick("goal").map((motivation) => ({ motivation })),
    triggerTrials: trials,
  };
}

const slug = (keys: string[]) => keys.map((k) => k.replace(/[^a-z0-9]+/gi, "_")).join("+").slice(0, 120);

// Hand-built: the combinations most likely to break something — overlapping
// lists, contradictions, a near-empty library.
const CURATED: RuleKey[][] = [
  ["diet:Vegan", "condition:Celiac Disease", "allergy:Tree nuts"],
  ["diet:Vegan", "allergy:Soy", "allergy:Wheat", "allergy:Peanuts"],
  ["diet:Vegetarian", "allergy:Eggs", "allergy:Dairy"],
  ["diet:Pescatarian", "allergy:Fish", "allergy:Shellfish"],
  ["diet:Keto", "allergy:Dairy", "allergy:Eggs", "allergy:Tree nuts"],
  ["diet:Paleo", "diet:Vegan"],
  ["condition:Chronic kidney disease – stage 3", "condition:Hypertension", "condition:Type 2 Diabetes", "condition:Heart Disease and Atherosclerosis"],
  ["condition:Celiac Disease", "trial:FODMAP_FRUCTANS", "trial:FODMAP_LACTOSE", "trial:FODMAP_GOS"],
  ["condition:Pregnancy", "allergy:Fish", "avoid:Raw foods", "avoid:Alcohol", "avoid:Caffeine"],
  ["condition:Thyroid Disorder", "diet:Gluten-free", "allergy:Soy"],
  ["trial:HISTAMINE_TYRAMINE_RICH", "trial:AGED_CHEESE", "trial:CURED_PROCESSED_MEAT", "trial:ALCOHOL"],
];

// Deterministic PRNG so a failing random profile reproduces run to run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2^106 subsets cannot be enumerated. Pairs catch two-list interactions;
// random 3–8-rule combinations (seeded) run through EVERY service, so larger
// mixes get the heavy services too, not just the 29 hand-picked ones.
export const RANDOM_COMBOS = 250;
export const RANDOM_SEED = 20261007;

export function buildProfiles(snap: Snapshot, opts: { pairs: boolean; random?: number }): Profile[] {
  const { all, banning } = ruleUniverse(snap);
  const out: Profile[] = [];
  for (const k of all) out.push({ id: `1:${slug([k])}`, tier: "single", rules: [k] });
  if (opts.pairs) {
    for (let i = 0; i < banning.length; i++)
      for (let j = i + 1; j < banning.length; j++) out.push({ id: `2:${slug([banning[i], banning[j]])}`, tier: "pair", rules: [banning[i], banning[j]] });
  }
  const known = new Set(all);
  snap.realCombos.forEach((c, i) => {
    const rules = c.rules.filter((k) => known.has(k as RuleKey)) as RuleKey[];
    out.push({ id: `real${i}:${slug(rules)}`, tier: "real", rules, users: c.users });
  });
  CURATED.forEach((rules, i) => {
    const bad = rules.filter((k) => !known.has(k));
    if (bad.length) throw new Error(`curated profile names unknown rules: ${bad.join(", ")}`);
    out.push({ id: `cur${i}:${slug(rules)}`, tier: "curated", rules });
  });
  const rnd = mulberry32(RANDOM_SEED);
  for (let i = 0; i < (opts.random ?? 0); i++) {
    const size = 3 + Math.floor(rnd() * 6);
    const picked = new Set<RuleKey>();
    while (picked.size < size) picked.add(banning[Math.floor(rnd() * banning.length)]);
    const rules = Array.from(picked);
    out.push({ id: `rnd${i}:${slug(rules)}`, tier: "random", rules });
  }
  out.push({ id: "everything", tier: "everything", rules: all });
  return out;
}
