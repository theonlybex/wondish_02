// What a diner with these rules must never be offered — judged three ways.
//
// 1. ENGINE  — lib/diet-match's verdict on the single ingredient. A service
//              that serves something the engine itself bans skipped or
//              weakened the check (the What-to-buy bug, the dropped groups).
// 2. GROUPS  — an INDEPENDENT table, written here from the Wondish 03 workbook
//              and plain dietary meaning, NOT imported from the code under
//              test: which Big-9 component groups each rule forbids. Catches
//              a mapping the engine lacks (a "Dairy" allergy that never mapped
//              to cow's milk; a vegan served a milk-tagged ingredient).
// 3. TEXT    — naive whole-word search of the ingredient name for each banned
//              term. Where the engine allowed it, that is a SUSPECT for a
//              person to judge (an exemption like "gluten-free bread" is
//              right; "goat cheese" passing a vegan would not be).
//
// 1 and 2 are violations. 3 is a review list.
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, type PatientDietGraph } from "@/lib/diet-match";
import type { RuleKey } from "./profiles";

const G = { milk: "BIG9-COW-MILK", egg: "BIG9-EGG", fish: "BIG9-FISH", shellfish: "BIG9-CRUSTACEAN", peanut: "BIG9-PEANUT", treeNut: "BIG9-TREE-NUT", soy: "BIG9-SOY", sesame: "BIG9-SESAME", wheat: "BIG9-WHEAT" };

// Independent expectations. Keys are rule keys as the profile names them.
const EXPECTED_GROUPS: Record<string, string[]> = {
  "allergy:Dairy": [G.milk],
  "allergy:Milk": [G.milk],
  "allergy:Eggs": [G.egg],
  "allergy:Fish": [G.fish],
  "allergy:Shellfish": [G.shellfish],
  "allergy:Peanuts": [G.peanut],
  "allergy:Tree nuts": [G.treeNut],
  "allergy:Soy": [G.soy],
  "allergy:Sesame": [G.sesame],
  "allergy:Wheat": [G.wheat],
  "avoid:Shellfish": [G.shellfish],
  "condition:Celiac Disease": [G.wheat],
  "diet:Vegan": [G.milk, G.egg, G.fish, G.shellfish],
  "diet:Vegetarian": [G.fish, G.shellfish],
  "diet:Dairy-free": [G.milk],
  "diet:Gluten-free": [G.wheat],
  "trial:FODMAP_FRUCTANS": [G.wheat],
  // Not trial:COW_MILK: workbook TR-053 removes cow's milk itself ("strongest
  // signal for skim milk"); yogurt and cheese have their own trials.
};

export type Verdict = {
  engine: string[]; // ban terms the engine matched ([] = allowed)
  groups: { rule: string; group: string }[]; // independent group hits
  suspects: { rule: string; term: string }[]; // text hits the engine allowed
};

export type Oracle = {
  rules: RuleKey[];
  judge(name: string, allergenGroups?: readonly string[]): Verdict;
  judgeMany(items: readonly { name: string; allergenGroups?: readonly string[] }[]): Verdict[];
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeOracle(patient: PatientDietGraph & { [k: string]: any }, rules: RuleKey[]): Oracle {
  const matchers = buildDietMatchers(derivePatientBans(patient));

  // Every banned term per rule, from the same rows the patient carries.
  const termsByRule: { rule: string; term: string; re: RegExp }[] = [];
  const addTerms = (rule: string, names: string[]) => {
    for (const t of names) {
      const term = t.trim().toLowerCase();
      if (term.length < 3) continue;
      termsByRule.push({ rule, term, re: new RegExp(`(?<![\\p{L}])${esc(term)}(?:e?s)?(?![\\p{L}])`, "iu") });
    }
  };
  for (const a of patient.foodAllergies) addTerms(`allergy:${a.food.name}`, [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  for (const f of patient.foodToAvoid) addTerms(`avoid:${f.food.name}`, [f.food.name, ...(f.food.bannedIngredients ?? []).map((b) => b.name)]);
  for (const c of patient.healthConditions) addTerms(`condition:${c.condition.name}`, c.condition.bannedIngredients.map((b) => b.name));
  for (const p of patient.foodPreferences) addTerms(`diet:${p.food.name}`, p.food.bannedIngredients.map((b) => b.name));
  for (const m of patient.motivations) addTerms(`goal:${m.motivation.name}`, m.motivation.bannedIngredients.map((b) => b.name));
  for (const p of patient.ingredientPreferences ?? []) if (p.liked === false) addTerms(`dislike:${p.ingredient.name}`, [p.ingredient.name]);

  const expected = rules.flatMap((rule) => (EXPECTED_GROUPS[rule] ?? []).map((group) => ({ rule, group })));

  const judgeMany: Oracle["judgeMany"] = (items) => {
    const names = items.map((i) => i.name);
    // One batched engine call: violations come back keyed by ingredient name.
    const byName = new Map<string, string[]>();
    for (const v of evaluateDishAgainstProfile(names, matchers, items.map((i) => [...(i.allergenGroups ?? [])])).violations) {
      const list = byName.get(v.ingredient) ?? [];
      list.push(v.term);
      byName.set(v.ingredient, list);
    }
    return items.map((it) => {
      const engine = Array.from(new Set(byName.get(it.name) ?? []));
      const groups = expected.filter((e) => (it.allergenGroups ?? []).includes(e.group));
      const suspects = engine.length > 0 ? [] : termsByRule.filter((t) => t.re.test(it.name)).map(({ rule, term }) => ({ rule, term }));
      return { engine, groups, suspects };
    });
  };
  return { rules, judgeMany, judge: (name, allergenGroups) => judgeMany([{ name, allergenGroups }])[0] };
}
