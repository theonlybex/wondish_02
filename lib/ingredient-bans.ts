// Per-ingredient ban check for shopping surfaces — pure, no Prisma import.
//
// lib/diet-match judges DISHES. What-to-buy offers single ingredients, and
// two of its three lenses (By category, By cuisine) never asked the engine at
// all: a vegetarian was offered sirloin, bacon and chicken broth (QA
// 2026-10-07). This wraps the same engine per ingredient and keeps WHICH
// profile rule banned it, so the "Banned ingredients" panel can say why.
//
// Each rule's matchers come from derivePatientBans on a one-row graph, so a
// rule bans exactly what it bans inside the full profile (same grain
// exemptions, same Big-9 group codes) — no second copy of that logic.

import {
  derivePatientBans,
  buildDietMatchers,
  allGroupCodes,
  enforcedTrials,
  evaluateDishAgainstProfile,
  type DietMatchers,
  type PatientDietGraph,
} from "@/lib/diet-match";
import { categoryTitle } from "@/lib/trials/category-terms";

export type BanKind = "allergy" | "avoid" | "condition" | "diet" | "goal" | "trial";

export interface BanRule {
  kind: BanKind;
  label: string; // the profile item: "Vegetarian", "Peanuts", "Celiac disease"
  terms: string[]; // ingredient names this rule bans, as stored
  groups: string[]; // Big-9 group codes banned by component (BIG9-COW-MILK)
}

export interface IngredientBanCheck {
  rules: BanRule[];
  /** Labels of the rules that ban this ingredient; empty when it is allowed. */
  reasonsFor(name: string, allergenGroups?: readonly string[]): string[];
  /** Same, for many ingredients at once — compiles each rule's patterns once, not per item. */
  reasonsForMany(items: readonly { name: string; allergenGroups?: readonly string[] }[]): string[][];
}

const EMPTY: PatientDietGraph = { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] };

function uniq(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function ingredientBanCheck(patient: PatientDietGraph, today: Date = new Date()): IngredientBanCheck {
  const parts: { rule: BanRule; graph: PatientDietGraph }[] = [];
  const add = (kind: BanKind, label: string | undefined, terms: string[], graph: PatientDietGraph) => {
    const bans = derivePatientBans(graph, today);
    const groups = allGroupCodes(bans);
    const rule = { kind, label: label?.trim() || "Your profile", terms: uniq(terms), groups };
    if (rule.terms.length > 0 || rule.groups.length > 0) parts.push({ rule, graph });
  };

  for (const a of patient.foodAllergies) {
    add("allergy", a.food.name, [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)], { ...EMPTY, foodAllergies: [a] });
  }
  for (const f of patient.foodToAvoid) {
    add("avoid", f.food.name, [f.food.name, ...(f.food.bannedIngredients ?? []).map((b) => b.name)], { ...EMPTY, foodToAvoid: [f] });
  }
  for (const hc of patient.healthConditions) {
    add("condition", hc.condition.name, hc.condition.bannedIngredients.map((b) => b.name), { ...EMPTY, healthConditions: [hc] });
  }
  for (const fp of patient.foodPreferences) {
    add("diet", fp.food.name, fp.food.bannedIngredients.map((b) => b.name), { ...EMPTY, foodPreferences: [fp] });
  }
  for (const m of patient.motivations) {
    add("goal", m.motivation.name, m.motivation.bannedIngredients.map((b) => b.name), { ...EMPTY, motivations: [m] });
  }
  for (const t of enforcedTrials(patient.triggerTrials, today)) {
    const graph = { ...EMPTY, triggerTrials: [t] };
    add("trial", `${categoryTitle(t.rule.category)} trial`, derivePatientBans(graph, today).exactBanned.map((b) => b.name), graph);
  }

  const full = buildDietMatchers(derivePatientBans(patient, today));
  const perRule: { label: string; matchers: DietMatchers }[] = parts.map((p) => ({
    label: p.rule.label,
    matchers: buildDietMatchers(derivePatientBans(p.graph, today)),
  }));

  const reasonsForMany = (items: readonly { name: string; allergenGroups?: readonly string[] }[]): string[][] => {
    const names = items.map((i) => i.name);
    const groups = items.map((i) => i.allergenGroups ?? []);
    // Violations carry the ingredient name; index by position via a name → indexes map.
    const flagged = (m: DietMatchers): Set<string> =>
      new Set(evaluateDishAgainstProfile(names, m, groups).violations.map((v) => v.ingredient));
    // The full profile decides; the per-rule passes only name the reasons.
    const banned = flagged(full);
    if (banned.size === 0) return items.map(() => []);
    const byRule = perRule.map((r) => ({ label: r.label, hits: flagged(r.matchers) }));
    return names.map((name) => {
      if (!banned.has(name)) return [];
      const labels = uniq(byRule.filter((r) => r.hits.has(name)).map((r) => r.label));
      return labels.length > 0 ? labels : ["Your profile"];
    });
  };

  return {
    rules: parts.map((p) => p.rule),
    reasonsFor: (name, allergenGroups = []) => reasonsForMany([{ name, allergenGroups }])[0],
    reasonsForMany,
  };
}
