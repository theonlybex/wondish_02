// Shared diet-match engine — pure module, no Prisma import, no side effects.
//
// Extracts the dietary-ban/matching logic that was copy-pasted across five
// call sites. The canonical behavior this module preserves lives at
// lib/meal-plan.ts:162-179 (5-source ban union + word-boundary allergy
// regex/stemming). Do not change what passes or fails there — this module
// is a lift, not a rewrite, of that logic; `evaluateDishAgainstProfile` is
// the one new capability (all-violations reporting) layered on top.

import { phaseFor, isEnforced } from "@/lib/trials/schedule";
import { termsForCategory } from "@/lib/trials/category-terms";

export type BanSource = "allergy" | "avoid" | "condition" | "preference" | "motivation" | "trial";

export interface ExactBan {
  name: string;
  source: BanSource;
  // Whether a "gluten-free" marker may exempt a grain term for this ban.
  // Set from the list the ban came from: a list that also bans gluten or
  // wheat (Celiac, Gluten-free) is about gluten, so gluten-free pasta is
  // fine; a Keto or Low-carb list bans bread as a carb, so it is not.
  // Undefined = exempt (lenient default for callers that build bans by hand).
  grainExempt?: boolean;
}

// Narrowest structural shape this module reads from the patient diet graph —
// a local type, not a Prisma model import, so the module stays Prisma-free.
export interface PatientDietGraph {
  foodAllergies: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  // bannedIngredients optional: older callers/tests build the graph by hand.
  foodToAvoid: { food: { name: string; bannedIngredients?: { name: string }[] } }[];
  // condition.name optional for hand-built graphs; when present it unlocks
  // CONDITION_GROUPS (Celiac → BIG9-WHEAT components).
  healthConditions: { condition: { name?: string; bannedIngredients: { name: string }[] } }[];
  foodPreferences: { food: { bannedIngredients: { name: string }[] } }[];
  motivations: { motivation: { bannedIngredients: { name: string }[] } }[];
  // Trigger trials (workbook 04). Optional: most callers/tests predate them.
  // Terms come from lib/trials/category-terms by rule.category.
  triggerTrials?: TrialGraphRow[];
}

export interface TrialGraphRow {
  status: "ACTIVE" | "STOPPED" | "COMPLETED";
  startDate: Date | string;
  classification: string | null;
  rule: { category: string; baselineDays: number; trialDays: number; reintroductionDays: number; washoutDays: number };
}

/** Trials whose trigger is banned today: ACTIVE in an enforced phase, or COMPLETED as a likely trigger. */
export function enforcedTrials(trials: readonly TrialGraphRow[] | undefined, today: Date): TrialGraphRow[] {
  return (trials ?? []).filter((t) => {
    if (t.status === "COMPLETED") return t.classification === "LIKELY_TRIGGER";
    if (t.status !== "ACTIVE") return false;
    return isEnforced(phaseFor(t.rule, new Date(t.startDate), today).phase);
  });
}

export interface DerivedBans {
  allergyNames: string[];
  exactBanned: ExactBan[];
  // Wondish 03 Big-9 group codes implied by the patient's FoodAllergy rows.
  // Optional so hand-built callers/tests that predate groups keep compiling.
  allergyGroupCodes?: string[];
  // Same, implied by health conditions (CONDITION_GROUPS).
  conditionGroupCodes?: string[];
  // Same, implied by enforced trigger trials (FODMAP_FRUCTANS → BIG9-WHEAT).
  trialGroupCodes?: string[];
}

// FoodAllergy.name → Wondish 03 "Baseline & Restriction Rules" allergen group
// codes. Codes verified against the sheet's DISTINCT allergen_group_code
// (2026-09-11): BIG9-COW-MILK, BIG9-CRUSTACEAN, BIG9-EGG, BIG9-FISH,
// BIG9-PEANUT, BIG9-SESAME, BIG9-SOY, BIG9-TREE-NUT, BIG9-WHEAT. Keys are
// matched case-insensitively after trimming (the DB once held "Wheat ").
export const ALLERGY_GROUPS: Record<string, string[]> = {
  milk: ["BIG9-COW-MILK"],
  eggs: ["BIG9-EGG"],
  peanuts: ["BIG9-PEANUT"],
  "tree nuts": ["BIG9-TREE-NUT"],
  soy: ["BIG9-SOY"],
  fish: ["BIG9-FISH"],
  shellfish: ["BIG9-CRUSTACEAN"],
  sesame: ["BIG9-SESAME"],
  wheat: ["BIG9-WHEAT"],
};

export function allergyGroupCodesFor(allergyName: string): string[] {
  return ALLERGY_GROUPS[allergyName.trim().toLowerCase()] ?? [];
}

// HealthCondition.name → Big-9 groups the condition must avoid by component.
// Celiac needs this: no recipe ingredient is literally named "wheat", so a
// name-only rule let sliced bread, tortillas and English muffins through
// (condition audit 2026-09-11). Violations carry source "condition".
export const CONDITION_GROUPS: Record<string, string[]> = {
  "celiac disease": ["BIG9-WHEAT"],
};

export function conditionGroupCodesFor(conditionName: string): string[] {
  return CONDITION_GROUPS[conditionName.trim().toLowerCase()] ?? [];
}

// Allergy matchers are RegExp instances carrying the original (lowercased,
// singular-stemmed) term alongside, so evaluateDishAgainstProfile can report
// which term matched without re-deriving it from `.source`. Still
// structurally a RegExp — extra `.term` property doesn't affect regex use.
export type AllergyMatcher = RegExp & { readonly term: string };

export interface DietMatchers {
  allergyMatchers: AllergyMatcher[];
  exactBanned: ExactBan[];
  // Big-9 group codes the patient must not eat. Checked against each
  // ingredient's `allergenGroups` (Ingredient.allergenGroups, from Wondish 01/03)
  // when the caller supplies them — additive to the name matching above.
  bannedGroups: Set<string>;
  // Which profile dimension banned each group ("allergy" wins over
  // "condition" when both name the same group). Optional for older callers.
  groupSources?: Map<string, BanSource>;
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
//   - foodToAvoid      → own food name AND bannedIngredients children (exactBanned, source "avoid")
//   - healthConditions → bannedIngredients children only                (exactBanned, source "condition")
//   - foodPreferences  → bannedIngredients children only                (exactBanned, source "preference")
//   - motivations      → bannedIngredients children only                (exactBanned, source "motivation")
export function derivePatientBans(patient: PatientDietGraph, today: Date = new Date()): DerivedBans {
  const allergyNames = patient.foodAllergies.flatMap((a) => [
    a.food.name,
    ...a.food.bannedIngredients.map((b) => b.name),
  ]);

  // A list that bans gluten or wheat is about gluten: its grain terms may be
  // exempted by a "gluten-free" marker (see ExactBan.grainExempt).
  const aboutGluten = (list: readonly { name: string }[]) => list.some((b) => /^(gluten|wheat)$/i.test(b.name.trim()));
  const exactBanned: ExactBan[] = [
    // foodToAvoid: own name AND its bannedIngredients children ("Red meat" →
    // beef, lamb, veal…). The children were added 2026-09-11; before that a
    // red-meat avoider was offered ground beef.
    ...patient.foodToAvoid.flatMap((f) => {
      const grainExempt = aboutGluten(f.food.bannedIngredients ?? []);
      return [
        { name: f.food.name, source: "avoid" as const, grainExempt },
        ...(f.food.bannedIngredients ?? []).map((b) => ({ name: b.name, source: "avoid" as const, grainExempt })),
      ];
    }),
    ...patient.healthConditions.flatMap((hc) => {
      const grainExempt = aboutGluten(hc.condition.bannedIngredients);
      return hc.condition.bannedIngredients.map((b) => ({ name: b.name, source: "condition" as const, grainExempt }));
    }),
    ...patient.foodPreferences.flatMap((fp) => {
      const grainExempt = aboutGluten(fp.food.bannedIngredients);
      return fp.food.bannedIngredients.map((b) => ({ name: b.name, source: "preference" as const, grainExempt }));
    }),
    ...patient.motivations.flatMap((pm) => {
      const grainExempt = aboutGluten(pm.motivation.bannedIngredients);
      return pm.motivation.bannedIngredients.map((b) => ({ name: b.name, source: "motivation" as const, grainExempt }));
    }),
  ];

  const allergyGroupCodes = Array.from(
    new Set(patient.foodAllergies.flatMap((a) => allergyGroupCodesFor(a.food.name)))
  );
  const conditionGroupCodes = Array.from(
    new Set(patient.healthConditions.flatMap((hc) => (hc.condition.name ? conditionGroupCodesFor(hc.condition.name) : [])))
  );

  // Trigger trials: the eliminated category's terms are banned during the
  // enforced phases (and for a completed "likely trigger" until cleared).
  const trialGroupCodes: string[] = [];
  for (const t of enforcedTrials(patient.triggerTrials, today)) {
    const { terms, groups } = termsForCategory(t.rule.category);
    for (const term of terms) exactBanned.push({ name: term, source: "trial" });
    for (const g of groups ?? []) if (!trialGroupCodes.includes(g)) trialGroupCodes.push(g);
  }

  return { allergyNames, exactBanned, allergyGroupCodes, conditionGroupCodes, trialGroupCodes };
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

// Unicode-aware word boundary. JS \b is ASCII-\w-based: it is unsatisfiable
// at a term edge that is punctuation ("nuts (tree)") or an accented letter
// ("œufs"), silently disabling that ban everywhere. Lookarounds on Unicode
// letters/digits behave identically to \b for plain-ASCII terms.
export const boundaryPattern = (body: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");

// Constructed (not literal) so the `u` flag clears the ES5 tsc target the
// build type-checks against; runtime is Node 18+ where both are fine.
const EDGE_PUNCT_RE = new RegExp("^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$", "gu");
const HAS_LETTER_OR_DIGIT_RE = new RegExp("[\\p{L}\\p{N}]", "u");

// Matching-side variants of a stored ban name: the verbatim name, each
// slash-separated part ("Wheat / Gluten" → wheat, gluten), and each part with
// punctuation stripped from its edges ("(shellfish)" → shellfish).
export function expandBanName(raw: string): string[] {
  const whole = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const out = new Set<string>();
  if (whole) out.add(whole);
  for (const piece of whole.split("/")) {
    const p = piece.trim();
    if (p) out.add(p);
    const stripped = p.replace(EDGE_PUNCT_RE, "").trim();
    if (stripped) out.add(stripped);
  }
  return Array.from(out).filter((v) => v.length >= 2);
}

// Write-side guard for admin banned-ingredient names: trims, collapses inner
// whitespace, and rejects names with no letter/digit or under 2 chars (a
// 1-char name would be silently dropped by the matcher's min-length filter).
export function normalizeBannedIngredientName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length < 2) return null;
  if (!HAS_LETTER_OR_DIGIT_RE.test(collapsed)) return null;
  return collapsed;
}

// Singular form of a stored allergy/food name. The plain `(?<!s)s$` strip
// alone mis-stems -ies/-oes plurals ("strawberries" → "strawberrie"), whose
// bogus stem then never matches the singular form recipe ingredients use.
export function singularize(w: string): string {
  if (/[a-z]ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/[a-z]oes$/.test(w)) return w.replace(/oes$/, "o");
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.replace(/es$/, "");
  return w.replace(/(?<!s)s$/, ""); // plain plural; keep "-ss" words
}

// Union of the singular stem (+s/+es) and the verbatim stored name, so
// "strawberries" matches both "strawberry" and "strawberries".
function stemUnionBody(lowered: string): string {
  const stem = singularize(lowered);
  return stem === lowered || `${stem}s` === lowered || `${stem}es` === lowered
    ? `${escapeRe(stem)}(?:s|es)?`
    : `${escapeRe(stem)}(?:s|es)?|${escapeRe(lowered)}`;
}

// Phrase matcher for an exact-ban name: stem-union body + Unicode boundaries.
// Shared by evaluateDishAgainstProfile (discrete ingredient names) and
// lib/fridge.ts's applyAllergenFilter (free-text recipe fields) so both
// surfaces block the identical term set.
//
// Dietary bans name a food, not the products pressed or fermented from it:
// Hypertension's "olives" (brine sodium) must not match "extra virgin olive
// oil" (435 library recipes → the Hypertension pool collapsed to 3 dinners,
// 2026-09-11), "avocado" must not match "avocado oil", "rice" must not match
// "rice vinegar". A negative lookahead skips a match directly followed by a
// derived-product word, unless the ban itself names that product ("olive
// oil"). Allergy matchers deliberately keep the broad match (peanut oil).
// Likewise "coffee" (a Caffeine avoid rule) must not match "Decaf coffee".
const DERIVED_PRODUCT_RE = /\b(oil|vinegar|spray|extract)\b/;
const DECAF_RE = /\bdecaf/;

// A substitute is not the food it imitates. A Vegan profile banned "Mung bean
// plant-based egg" (41 recipes), "Almond milk" (35), "meatless chicken" (17)
// and "Gluten-free rice buns" carried a "gluten" ban (QA 2026-09-11).
//   - A substitute marker ("vegan", "plant-based", "meatless", …) up to one
//     word before the term exempts ANY dietary ban ("plant based ground beef").
//   - A plant base ("almond", "oat", "coconut", …) directly before — or one
//     "milk"/"cream" away from — a dairy/egg term exempts it ("almond milk
//     yogurt", "cashew cream cheese"). Meat and fish terms are NOT exempted
//     this way: "coconut shrimp" and "apple chicken sausage" are dishes.
//   - A gluten-free / wheat-free / grain-free marker up to three words before
//     a grain term exempts it ("Gluten-free chickpeas rotini pasta").
//   - "<term>-free" / "<term> free" never matches the term.
// Allergy matchers (boundaryPattern) deliberately keep the broad match.
const SUBSTITUTE_MARKERS = "vegan|vegetarian|plant-based|plant based|meatless|meat-free|meat free|dairy-free|dairy free|non-dairy|nondairy|egg-free|egg free|mock|faux";
const PLANT_BASES = "almond|oat|soy|soya|coconut|cashew|rice|hemp|pea|nut|peanut|cocoa|shea|apple|macadamia|hazelnut|walnut|pistachio|sunflower|flax|sesame";
const DAIRY_EGG_TERM_RE = /^(?:milk|cream|butter|cheese|yogurt|yoghurt|eggs?|mayonnaise|mayo|creamer|ice cream|sour cream|cream cheese|whipped cream|heavy cream|buttermilk|custard|whole milk|kefir)$/;
const GRAIN_TERM_RE = /^(?:pasta|noodles?|bread|flour|all-purpose flour|crackers?|cracker crumbs|buns?|muffins?|english muffins?|rotini|orzo|penne|spaghetti|macaroni|fettuccine|linguine|lasagna|tortillas?|flour tortillas?|wraps?|cereal|granola|oats|breadcrumbs|bread crumbs|panko|couscous|pizza|pizza dough|dough|bagels?|pita|croutons|pretzels?|pastry|cookies?|cake|biscuits?|pancakes?|waffles?)$/;
const MARKER_LOOKBEHIND = `(?<!\\b(?:${SUBSTITUTE_MARKERS})\\s(?:[\\p{L}-]+\\s)?)`;
const PLANT_BASE_LOOKBEHIND = `(?<!\\b(?:${PLANT_BASES})\\s(?:(?:milk|cream)\\s)?)`;
const GRAIN_MARKER_LOOKBEHIND = `(?<!\\b(?:gluten-free|gluten free|wheat-free|wheat free|grain-free|grain free),?\\s(?:[\\p{L}&-]+,?\\s){0,3})`;
const FREE_LOOKAHEAD = `(?!(?:-|\\s)free\\b)`;

export const exactBanPattern = (name: string, opts: { grainExempt?: boolean } = {}) => {
  const lowered = name.trim().toLowerCase();
  const body = stemUnionBody(lowered);
  const grainExempt = (opts.grainExempt ?? true) && GRAIN_TERM_RE.test(lowered);
  const substitutable = (DAIRY_EGG_TERM_RE.test(lowered) ? PLANT_BASE_LOOKBEHIND : "") + (grainExempt ? GRAIN_MARKER_LOOKBEHIND : "");
  const derived = DERIVED_PRODUCT_RE.test(lowered) || DECAF_RE.test(lowered);
  const prefix = derived ? "" : "(?<!\\bdecaf\\s)(?<!\\bdecaffeinated\\s)";
  const suffix = derived ? "" : "(?!\\s+(?:cider\\s+)?(?:oil|vinegar|spray|extract)\\b)";
  return new RegExp(
    `${MARKER_LOOKBEHIND}${substitutable}${prefix}(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])${FREE_LOOKAHEAD}${suffix}`,
    "iu"
  );
};

export function buildDietMatchers({ allergyNames, exactBanned, allergyGroupCodes = [], conditionGroupCodes = [], trialGroupCodes = [] }: DerivedBans): DietMatchers {
  const allergyMatchers = Array.from(new Set(allergyNames.flatMap(expandBanName)))
    .map((lowered) => ({ lowered, stem: singularize(lowered) }))
    .filter(({ stem }) => stem.length >= 2)
    .map(({ lowered, stem }) =>
      Object.assign(boundaryPattern(stemUnionBody(lowered)), { term: stem }) as AllergyMatcher
    );

  // Exact-ban names lowercased for matching; dedup by (source, name) so a
  // banned ingredient repeated within one source doesn't produce duplicate
  // violation entries. Distinct sources for the same name are kept separate
  // — a name banned via two dimensions must surface both source-tagged
  // violations (see evaluateDishAgainstProfile's multi-source behavior).
  // Same name from two lists of one source (Keto + Gluten-free both ban
  // "bread"): the stricter list wins, so grainExempt is AND-ed.
  const deduped = new Map<string, ExactBan>();
  for (const { name, source, grainExempt } of exactBanned) {
    const lowered = name.trim().toLowerCase();
    const key = `${source}:${lowered}`;
    const prev = deduped.get(key);
    if (!prev) {
      deduped.set(key, { name: lowered, source, ...(grainExempt !== undefined ? { grainExempt } : {}) });
    } else if (grainExempt === false) {
      prev.grainExempt = false;
    }
  }
  const dedupedExactBanned = Array.from(deduped.values());

  const groupSources = new Map<string, BanSource>();
  for (const g of trialGroupCodes) groupSources.set(g, "trial");
  for (const g of conditionGroupCodes) groupSources.set(g, "condition");
  for (const g of allergyGroupCodes) groupSources.set(g, "allergy");
  return { allergyMatchers, exactBanned: dedupedExactBanned, bannedGroups: new Set(groupSources.keys()), groupSources };
}

// ── evaluateDishAgainstProfile ──────────────────────────────────────────────
//
// New capability: runs every ingredient against every matcher and returns
// ALL violations (not first-hit).
//
// `ingredientGroups[i]` are the Big-9 group codes of `ingredientNames[i]`
// (Ingredient.allergenGroups, from Wondish 01/03). Omit it and the check is
// name-only, exactly as before — Clara-generated dishes carry no groups.
export function evaluateDishAgainstProfile(
  ingredientNames: string[],
  matchers: DietMatchers,
  ingredientGroups?: readonly (readonly string[])[]
): { passed: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const bannedGroups = matchers.bannedGroups ?? new Set<string>();

  // Word-boundary phrase matching (was whole-string equality): free-text
  // ingredient names rarely equal the stored ban verbatim — a "sugar"
  // condition-ban must flag "brown sugar". `term` stays the stored ban name
  // (wire contract: violation.term is what the user's profile banned).
  const exactMatchers = matchers.exactBanned.map((b) => ({
    ...b,
    re: exactBanPattern(b.name, { grainExempt: b.grainExempt }),
  }));

  ingredientNames.forEach((ingredient, i) => {
    for (const matcher of matchers.allergyMatchers) {
      if (matcher.test(ingredient)) {
        violations.push({ ingredient, term: matcher.term, source: "allergy" });
      }
    }

    for (const banned of exactMatchers) {
      if (banned.re.test(ingredient)) {
        violations.push({ ingredient, term: banned.name, source: banned.source });
      }
    }

    if (bannedGroups.size > 0) {
      for (const group of ingredientGroups?.[i] ?? []) {
        if (bannedGroups.has(group)) {
          violations.push({ ingredient, term: group, source: matchers.groupSources?.get(group) ?? "allergy" });
        }
      }
    }
  });

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
  foodToAvoid:      { include: { food: { include: { bannedIngredients: true } } } },
  healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
  foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
  motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
  // Only trials that can ban today: ACTIVE (phase decides) or COMPLETED (likely trigger).
  triggerTrials:    { where: { status: { in: ["ACTIVE", "COMPLETED"] as ("ACTIVE" | "COMPLETED")[] } }, include: { rule: true } },
} as const;

// Convenience for Prisma rows: `ingredients[i].ingredient.allergenGroups` →
// the `ingredientGroups` argument of evaluateDishAgainstProfile. Rows selected
// without `allergenGroups` yield `[]` per ingredient (name-only check).
export function ingredientGroupsOf(
  ingredients: readonly { ingredient: { allergenGroups?: readonly string[] | null } }[]
): string[][] {
  return ingredients.map((ri) => [...(ri.ingredient.allergenGroups ?? [])]);
}
