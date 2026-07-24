// Shared diet-match engine — pure module, no Prisma import, no side effects.
//
// Extracts the dietary-ban/matching logic that was copy-pasted across five
// call sites. The canonical behavior this module preserves lives at
// lib/meal-plan.ts:162-179 (5-source ban union + word-boundary allergy
// regex/stemming). Do not change what passes or fails there — this module
// is a lift, not a rewrite, of that logic; `evaluateDishAgainstProfile` is
// the one new capability (all-violations reporting) layered on top.

export type BanSource = "allergy" | "avoid" | "condition" | "preference" | "motivation";

export interface ExactBan {
  name: string;
  source: BanSource;
}

// Narrowest structural shape this module reads from the patient diet graph —
// a local type, not a Prisma model import, so the module stays Prisma-free.
export interface PatientDietGraph {
  foodAllergies: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  foodToAvoid: { food: { name: string } }[];
  healthConditions: { condition: { bannedIngredients: { name: string }[] } }[];
  foodPreferences: { food: { bannedIngredients: { name: string }[] } }[];
  motivations: { motivation: { bannedIngredients: { name: string }[] } }[];
}

export interface DerivedBans {
  allergyNames: string[];
  exactBanned: ExactBan[];
}

// Allergy matchers are RegExp instances carrying the original (lowercased,
// singular-stemmed) term alongside, so evaluateDishAgainstProfile can report
// which term matched without re-deriving it from `.source`. Still
// structurally a RegExp — extra `.term` property doesn't affect regex use.
export type AllergyMatcher = RegExp & { readonly term: string };

export interface DietMatchers {
  allergyMatchers: AllergyMatcher[];
  exactBanned: ExactBan[];
}

export interface Violation {
  ingredient: string;
  term: string;
  source: BanSource;
}

// ── derivePatientBans ───────────────────────────────────────────────────────
//
// 5-source union, asymmetric by design (mirrors lib/meal-plan.ts:162-166):
//   - allergies        → own food name AND bannedIngredients children (allergyNames)
//   - foodToAvoid      → own food name only                            (exactBanned, source "avoid")
//   - healthConditions → bannedIngredients children only                (exactBanned, source "condition")
//   - foodPreferences  → bannedIngredients children only                (exactBanned, source "preference")
//   - motivations      → bannedIngredients children only                (exactBanned, source "motivation")
export function derivePatientBans(patient: PatientDietGraph): DerivedBans {
  const allergyNames = patient.foodAllergies.flatMap((a) => [
    a.food.name,
    ...a.food.bannedIngredients.map((b) => b.name),
  ]);

  const exactBanned: ExactBan[] = [
    ...patient.foodToAvoid.map((f) => ({ name: f.food.name, source: "avoid" as const })),
    ...patient.healthConditions.flatMap((hc) =>
      hc.condition.bannedIngredients.map((b) => ({ name: b.name, source: "condition" as const }))
    ),
    ...patient.foodPreferences.flatMap((fp) =>
      fp.food.bannedIngredients.map((b) => ({ name: b.name, source: "preference" as const }))
    ),
    ...patient.motivations.flatMap((pm) =>
      pm.motivation.bannedIngredients.map((b) => ({ name: b.name, source: "motivation" as const }))
    ),
  ];

  return { allergyNames, exactBanned };
}

// ── buildDietMatchers ───────────────────────────────────────────────────────
//
// Word-boundary allergy regex + singular-stemming, lifted verbatim in
// behavior from lib/meal-plan.ts:175-179: "peanut" also bans "peanut butter"
// / "roasted peanuts", but "egg" does not ban "eggplant".
// Exported so other modules building their own \b-anchored phrase regexes
// off DietMatchers output (e.g. lib/fridge.ts's applyAllergenFilter, which
// scans free-text recipe fields rather than discrete ingredient names) reuse
// this escape instead of a second copy.
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildDietMatchers({ allergyNames, exactBanned }: DerivedBans): DietMatchers {
  const allergyMatchers = Array.from(new Set(allergyNames))
    .map((name) => name.trim().toLowerCase().replace(/(?<!s)s$/, "")) // singular stem; keep "-ss" words
    .filter((stem) => stem.length >= 2)
    .map((stem) => Object.assign(new RegExp(`\\b${escapeRe(stem)}(?:s|es)?\\b`, "i"), { term: stem }) as AllergyMatcher);

  // Exact-ban names lowercased for matching; dedup by (source, name) so a
  // banned ingredient repeated within one source doesn't produce duplicate
  // violation entries. Distinct sources for the same name are kept separate
  // — a name banned via two dimensions must surface both source-tagged
  // violations (see evaluateDishAgainstProfile's multi-source behavior).
  const seen = new Set<string>();
  const dedupedExactBanned: ExactBan[] = [];
  for (const { name, source } of exactBanned) {
    const lowered = name.trim().toLowerCase();
    const key = `${source}:${lowered}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedExactBanned.push({ name: lowered, source });
  }

  return { allergyMatchers, exactBanned: dedupedExactBanned };
}

// ── evaluateDishAgainstProfile ──────────────────────────────────────────────
//
// New capability: runs every ingredient against every matcher and returns
// ALL violations (not first-hit).
export function evaluateDishAgainstProfile(
  ingredientNames: string[],
  matchers: DietMatchers
): { passed: boolean; violations: Violation[] } {
  const violations: Violation[] = [];

  for (const ingredient of ingredientNames) {
    for (const matcher of matchers.allergyMatchers) {
      if (matcher.test(ingredient)) {
        violations.push({ ingredient, term: matcher.term, source: "allergy" });
      }
    }

    const lowered = ingredient.trim().toLowerCase();
    for (const banned of matchers.exactBanned) {
      if (lowered === banned.name) {
        violations.push({ ingredient, term: banned.name, source: banned.source });
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

// ── PATIENT_DIET_INCLUDE ────────────────────────────────────────────────────
//
// Shared Prisma `include` shape for the patient diet graph (allergies /
// foodToAvoid / healthConditions / foodPreferences / motivations →
// bannedIngredients). Identical across the current call sites:
//   - lib/meal-plan.ts
//   - app/api/meal-plan/alternatives/route.ts
//   - app/api/meal-plan/[menuId]/swap/route.ts
//   - app/api/taste/dishes/route.ts
//   - app/api/dish-checker/route.ts
//
// Exported as a plain `as const` object literal (not a Prisma.PatientInclude
// import) so this module stays Prisma-import-free; it satisfies Prisma's
// include shape structurally at each call site.
export const PATIENT_DIET_INCLUDE = {
  foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
  foodToAvoid:      { include: { food: true } },
  healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
  foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
  motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
} as const;
