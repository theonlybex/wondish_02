# Clara S3 — Meal Plan Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clara reads the meal plan (exchange-aware), proposes and executes swaps, and marks planned dishes done / logs them as intake — writes behind conversational confirm plus a new structural first-turn guard.

**Architecture:** Four engine tasks. E1 extracts route-inline logic into shared lib helpers with parity pinned first (`upsertMealCompletion`, `findAlternatives`, `validateSwapCandidate`). E2 adds the minimal structural confirm guard to the C0 loop (`isWrite` flag + first-turn block) and flags S1's write tools. E3 ships `lib/clara/skills/plan.ts` (5 tools, injected deps) plus registry/gap wiring. E4 updates the routing fixture. No migration anywhere.

**Tech Stack:** Next.js / TypeScript, Prisma, `node --import tsx --test` (suite: `npm test`), no new deps.

**Spec (contract of record):** `docs/superpowers/specs/2026-08-03-clara-s3-plan-skill-design.md`

## Global Constraints

- Branch: `cycle-clara-s3-plan` off `main`.
- **No migration, no client change, no iOS work.** Chat prose is the only surface.
- Files S3 may touch beyond its own skill+tests: `lib/journal.ts`, `lib/meal-plan.ts` (extracted helpers), the three refactored routes, `lib/clara/loop.ts` + `lib/clara/types.ts` (guard — recorded rule-8 amendment), `lib/clara/skills/logs.ts` (isWrite flags ONLY), `lib/clara/registry.ts` (import + entry + tie-breaker rows), `lib/clara/gap.ts` (one map entry), `lib/clara/__fixtures__/routing.ts`.
- Handlers never throw; every outcome is a typed `ToolResult`. New reason `"CONFIRM_REQUIRED"` joins the union.
- No tool input identifies a user/patient. `menuId`/`recipeId` are validated against `ctx.patientId` + `activePlanVersion` in one query.
- Route response shapes stay **byte-identical** after the E1 refactor (parity tests first).
- Writes share hourly cap `clara-plan-write`, 30/h per patient, fail-open (S1 shape). Budget is consumed BEFORE validation (S1 order, consistency).
- Suite green at every commit; `npx tsc --noEmit` stays at **19 pre-existing errors**.
- House test idiom: `node:test` + `assert/strict`, injected-deps fakes, no DB in unit tests. tsconfig predates ES2015 iteration — use `Array.from(map.entries())`, never spread a Map iterator (S2 gotcha).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/journal.ts` + `lib/journal.test.ts` | modify | `upsertMealCompletion` + `CompletionDb` port |
| `lib/meal-plan.ts` + `lib/meal-plan.test.ts` | modify | `findAlternatives`, `validateSwapCandidate` |
| `app/api/journal/log-meal/route.ts` | modify | delegate to `upsertMealCompletion` (toggle mode) |
| `app/api/meal-plan/alternatives/route.ts` | modify | delegate to `findAlternatives` |
| `app/api/meal-plan/[menuId]/swap/route.ts` | modify | delegate to `validateSwapCandidate` |
| `lib/clara/types.ts` | modify | `isWrite` flag, `CONFIRM_REQUIRED` reason |
| `lib/clara/loop.ts` + `loop.test.ts` | modify | first-turn write guard |
| `lib/clara/skills/logs.ts` | modify | `isWrite: true` on logs_create/logs_delete |
| `lib/clara/skills/plan.ts` + `plan.test.ts` | create | the skill: 5 tools, handlers, fragment |
| `lib/clara/registry.ts` + `registry.test.ts` | modify | entry + conditional PLANNED / ATE-PLANNED rows |
| `lib/clara/gap.ts` + `gap.test.ts` | modify | `MEAL_PLAN: "plan"` |
| `lib/clara/__fixtures__/routing.ts` | modify | 2 flips + ~12 new cases |

---

### Task E1: Extract completion / alternatives / swap-validation into lib (parity first)

**Files:**
- Modify: `lib/journal.ts` (append), `lib/meal-plan.ts` (append)
- Modify: `app/api/journal/log-meal/route.ts:48-85`, `app/api/meal-plan/alternatives/route.ts:29-60`, `app/api/meal-plan/[menuId]/swap/route.ts:50-146`
- Test: `lib/journal.test.ts`, `lib/meal-plan.test.ts` (append)

**Interfaces:**
- Consumes (existing): `parseLocalDateStrict` (lib/journal.ts), `derivePatientBans`, `buildDietMatchers`, `evaluateDishAgainstProfile` (lib/diet-match.ts), `resolveMacroProfile`, `getMacroPercentages` (lib/caloric-engine.ts), `macroDeviation` (lib/macros.ts), `prisma` (lib/db.ts).
- Produces (E3 consumes):
  - `upsertMealCompletion(patientId: string, args: {recipeId: string; mealTypeName?: string; date: string; rating: 1 | -1 | null; toggle?: boolean}, db?: CompletionDb): Promise<CompletionResult | null>` — `null` = invalid date.
  - `CompletionResult = { action: "created" | "updated" | "removed" | "unchanged"; journalMealId: string | null; rating: number | null }`
  - `findAlternatives(patient: DietPatientLike, q: {mealTypeId: string; excludeRecipeId?: string; currentCalories?: number}, db?: AlternativesDb): Promise<AlternativeRecipe[]>` (≤3, ban-filtered)
  - `validateSwapCandidate(patient: SwapPatientLike, menu: {mealTypeId: string | null}, recipe: SwapCandidateRecipe, sameDayMenus: SameDayMenuLike[]): {ok: true} | {ok: false; code: SwapRejection; message: string}` — pure.

- [ ] **Step 1: Write the failing tests for `upsertMealCompletion`**

Append to `lib/journal.test.ts` (match its existing import style; add to the top import from `./journal`: `upsertMealCompletion`, `type CompletionDb`):

```ts
const day = (over: Partial<Parameters<CompletionDb["createMeal"]>[0]> = {}) => over; // helper only for typing clarity

function fakeCompletionDb(existingMeals: { id: string; recipeId: string | null; skipped: boolean; rating: number | null }[] | null) {
  const ops: string[] = [];
  const db: CompletionDb = {
    findEntry: async () => (existingMeals === null ? null : { id: "entry-1", meals: existingMeals }),
    createEntry: async () => {
      ops.push("createEntry");
      return { id: "entry-new" };
    },
    createMeal: async (data) => {
      ops.push(`createMeal:${data.recipeId}:${String(data.rating)}`);
      return { id: "meal-new" };
    },
    updateMealRating: async (id, rating) => {
      ops.push(`update:${id}:${String(rating)}`);
    },
    deleteMeal: async (id) => {
      ops.push(`delete:${id}`);
    },
  };
  return { db, ops };
}

test("completion: invalid date returns null, no effects", async () => {
  const { db, ops } = fakeCompletionDb(null);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "not-a-date", rating: 1 }, db);
  assert.equal(res, null);
  assert.equal(ops.length, 0);
});

test("completion: no entry → entry + meal created with the rating", async () => {
  const { db, ops } = fakeCompletionDb(null);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", mealTypeName: "Dinner", date: "2026-08-03", rating: 1 }, db);
  assert.deepEqual(res, { action: "created", journalMealId: "meal-new", rating: 1 });
  assert.deepEqual(ops, ["createEntry", "createMeal:r1:1"]);
});

test("completion: toggle mode + same rating removes the row (route parity)", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1, toggle: true }, db);
  assert.deepEqual(res, { action: "removed", journalMealId: null, rating: null });
  assert.deepEqual(ops, ["delete:m1"]);
});

test("completion: NON-toggle + same rating is unchanged — Clara re-marking done must never undo", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1 }, db);
  assert.deepEqual(res, { action: "unchanged", journalMealId: "m1", rating: 1 });
  assert.deepEqual(ops, []);
});

test("completion: different rating updates (both modes)", async () => {
  for (const toggle of [true, false]) {
    const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: 1 }]);
    const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: -1, toggle }, db);
    assert.deepEqual(res, { action: "updated", journalMealId: "m1", rating: -1 });
    assert.deepEqual(ops, ["update:m1:-1"]);
  }
});

test("completion: null rating creates an unrated row when missing", async () => {
  const { db, ops } = fakeCompletionDb([]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: null }, db);
  assert.deepEqual(res, { action: "created", journalMealId: "meal-new", rating: null });
  assert.deepEqual(ops, ["createMeal:r1:null"]);
});

test("completion: null rating NEVER clears an existing rating", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: false, rating: -1 }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: null }, db);
  assert.deepEqual(res, { action: "unchanged", journalMealId: "m1", rating: -1 });
  assert.deepEqual(ops, []);
});

test("completion: skipped rows are invisible to matching (a skipped dinner can be re-completed)", async () => {
  const { db, ops } = fakeCompletionDb([{ id: "m1", recipeId: "r1", skipped: true, rating: null }]);
  const res = await upsertMealCompletion("p1", { recipeId: "r1", date: "2026-08-03", rating: 1 }, db);
  assert.equal(res?.action, "created");
  assert.deepEqual(ops, ["createMeal:r1:1"]);
});
```

- [ ] **Step 2: Write the failing tests for `validateSwapCandidate` and `findAlternatives`**

Append to `lib/meal-plan.test.ts` (add to its import from `./meal-plan`: `validateSwapCandidate`, `findAlternatives`, `type AlternativesDb`). The patient fixture must satisfy `derivePatientBans`'s input (empty arrays = no bans) and carry conditions/motivations:

```ts
const dietPatient = {
  foodAllergies: [] as { allergy: { name: string } }[],
  foodToAvoid: [] as { food: { name: string } }[],
  foodPreferences: [] as { preference: { name: string } }[],
  healthConditions: [] as { condition: { name: string } }[],
  motivations: [] as { motivation: { name: string } }[],
};
// NOTE: check derivePatientBans's ACTUAL input field names in lib/diet-match.ts
// before running — mirror them exactly (the route passes a PATIENT_DIET_INCLUDE
// patient). Adjust the fixture keys, not the helper.

const swapRecipe = (over: Record<string, unknown> = {}) => ({
  mealTypeId: "mt-lunch",
  calories: 500, protein: 30, carbs: 50, fat: 15,
  family: null as string | null,
  subFamily: null as string | null,
  dishType: null as { name: string } | null,
  ingredients: [] as { ingredient: { name: string } }[],
  ...over,
});

test("swap: meal-type mismatch is rejected first", () => {
  const res = validateSwapCandidate(dietPatient, { mealTypeId: "mt-dinner" }, swapRecipe(), []);
  assert.deepEqual(res, { ok: false, code: "MEAL_TYPE_MISMATCH", message: "Recipe not suitable for this meal slot" });
});

test("swap: banned ingredient is rejected with the route's message", () => {
  const patient = { ...dietPatient, foodAllergies: [{ allergy: { name: "shellfish" } }] };
  const recipe = swapRecipe({ ingredients: [{ ingredient: { name: "shrimp shellfish mix" } }] });
  const res = validateSwapCandidate(patient, { mealTypeId: "mt-lunch" }, recipe, []);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, "BANNED_INGREDIENTS");
  assert.equal((res as { message: string }).message, "Recipe contains ingredients you cannot eat");
});

test("swap: macro deviation over 50pp is rejected; zero-calorie recipes skip the check", () => {
  const skewed = swapRecipe({ calories: 500, protein: 0, carbs: 0, fat: 55.6 }); // ~100% fat vs balanced target
  const res = validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, skewed, []);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, "MACRO_MISALIGNED");
  const zeroCal = swapRecipe({ calories: 0 });
  assert.equal(validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, zeroCal, []).ok, true);
});

test("swap: same family twice a day is rejected — beverage exemption honored", () => {
  const sameDay = [{ mealTypeId: "mt-dinner", recipe: { family: "chicken", subFamily: null, dishType: null } }];
  const conflict = swapRecipe({ family: "chicken" });
  const res = validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, conflict, sameDay);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, "FAMILY_CONFLICT");
  // Beverage not fruity/veggie is exempt.
  const beverage = swapRecipe({ family: "chicken", dishType: { name: "Beverage" } });
  assert.equal(validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, beverage, sameDay).ok, true);
});

test("swap: same sub-family within the same meal type is rejected", () => {
  const sameDay = [{ mealTypeId: "mt-lunch", recipe: { family: null, subFamily: "noodle-soup", dishType: null } }];
  const conflict = swapRecipe({ subFamily: "noodle-soup" });
  const res = validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, conflict, sameDay);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, "SUBFAMILY_CONFLICT");
  // Different meal type → allowed.
  const otherMeal = [{ mealTypeId: "mt-dinner", recipe: { family: null, subFamily: "noodle-soup", dishType: null } }];
  assert.equal(validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, conflict, otherMeal).ok, true);
});

test("swap: clean candidate passes", () => {
  assert.deepEqual(validateSwapCandidate(dietPatient, { mealTypeId: "mt-lunch" }, swapRecipe(), []), { ok: true });
});

test("alternatives: ban-filtered and sliced to 3", async () => {
  const mk = (id: string, ing: string) => ({
    id, name: id, calories: 500, protein: 30, carbs: 50, fat: 15,
    mealType: null, dishType: null,
    ingredients: [{ ingredient: { name: ing } }],
  });
  const db: AlternativesDb = {
    findCandidates: async () => [mk("a", "rice"), mk("b", "shrimp"), mk("c", "beans"), mk("d", "oats"), mk("e", "corn")],
  };
  const patient = { ...dietPatient, foodAllergies: [{ allergy: { name: "shrimp" } }] };
  const out = await findAlternatives(patient, { mealTypeId: "mt-lunch" }, db);
  assert.deepEqual(out.map((r) => r.id), ["a", "c", "d"]); // b banned, sliced to 3
});

test("alternatives: no bans returns first 3 candidates unfiltered", async () => {
  const db: AlternativesDb = {
    findCandidates: async () => [1, 2, 3, 4].map((n) => ({
      id: `r${n}`, name: `r${n}`, calories: null, protein: null, carbs: null, fat: null,
      mealType: null, dishType: null, ingredients: [],
    })),
  };
  const out = await findAlternatives(dietPatient, { mealTypeId: "mt-lunch" }, db);
  assert.equal(out.length, 3);
});
```

- [ ] **Step 3: Run to verify failures**

Run: `npx tsx --test lib/journal.test.ts lib/meal-plan.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 4: Implement the helpers**

Append to `lib/journal.ts`:

```ts
// ─── Meal completion upsert (S3 extraction from app/api/journal/log-meal) ───
// One shared write path for "this planned dish was eaten": the HTTP route uses
// toggle mode (same rating again = undo, its UI contract); Clara uses
// non-toggle mode (re-marking done is idempotent, never an undo) and may pass
// rating null (done, unrated) — which NEVER clears an existing rating.

export interface CompletionDb {
  findEntry(
    patientId: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<{ id: string; meals: { id: string; recipeId: string | null; skipped: boolean; rating: number | null }[] } | null>;
  createEntry(patientId: string, date: Date): Promise<{ id: string }>;
  createMeal(data: {
    journalEntryId: string;
    mealType: string;
    recipeId: string;
    skipped: boolean;
    rating: number | null;
  }): Promise<{ id: string }>;
  updateMealRating(id: string, rating: number | null): Promise<void>;
  deleteMeal(id: string): Promise<void>;
}

export interface CompletionResult {
  action: "created" | "updated" | "removed" | "unchanged";
  journalMealId: string | null;
  rating: number | null;
}

const prismaCompletionDb: CompletionDb = {
  findEntry: async (patientId, dayStart, dayEnd) =>
    prisma.journalEntry.findFirst({
      where: { patientId, date: { gte: dayStart, lte: dayEnd } },
      include: { meals: { select: { id: true, recipeId: true, skipped: true, rating: true } } },
    }),
  createEntry: async (patientId, date) => prisma.journalEntry.create({ data: { patientId, date } }),
  createMeal: async (data) => prisma.journalMeal.create({ data }),
  updateMealRating: async (id, rating) => {
    await prisma.journalMeal.update({ where: { id }, data: { rating } });
  },
  deleteMeal: async (id) => {
    await prisma.journalMeal.delete({ where: { id } });
  },
};

export async function upsertMealCompletion(
  patientId: string,
  args: { recipeId: string; mealTypeName?: string; date: string; rating: 1 | -1 | null; toggle?: boolean },
  db: CompletionDb = prismaCompletionDb
): Promise<CompletionResult | null> {
  const parsed = parseLocalDateStrict(args.date);
  if (!parsed) return null;
  const y = parsed.getFullYear();
  const m = parsed.getMonth() + 1;
  const d = parsed.getDate();
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

  let entry = await db.findEntry(patientId, dayStart, dayEnd);
  if (!entry) {
    const created = await db.createEntry(patientId, dayStart);
    entry = { id: created.id, meals: [] };
  }

  const existing = entry.meals.find((ml) => ml.recipeId === args.recipeId && !ml.skipped);

  if (existing) {
    if (args.rating === null || existing.rating === args.rating) {
      if (args.toggle && args.rating !== null && existing.rating === args.rating) {
        await db.deleteMeal(existing.id); // route contract: same button = undo
        return { action: "removed", journalMealId: null, rating: null };
      }
      return { action: "unchanged", journalMealId: existing.id, rating: existing.rating };
    }
    await db.updateMealRating(existing.id, args.rating);
    return { action: "updated", journalMealId: existing.id, rating: args.rating };
  }

  const meal = await db.createMeal({
    journalEntryId: entry.id,
    mealType: args.mealTypeName ?? "Meal",
    recipeId: args.recipeId,
    skipped: false,
    rating: args.rating,
  });
  return { action: "created", journalMealId: meal.id, rating: args.rating };
}
```

Append to `lib/meal-plan.ts` (import `derivePatientBans`, `buildDietMatchers`, `evaluateDishAgainstProfile` from `@/lib/diet-match`; `resolveMacroProfile`, `getMacroPercentages` from `@/lib/caloric-engine`; `macroDeviation` from `@/lib/macros`; `prisma` is already imported):

```ts
// ─── S3 extractions: alternatives + swap validation (shared route/Clara) ─────

export type DietPatientLike = Parameters<typeof derivePatientBans>[0];

export interface AlternativeRecipe {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  mealType: unknown;
  dishType: unknown;
  ingredients: { ingredient: { name: string } }[];
}

export interface AlternativesDb {
  findCandidates(q: {
    mealTypeId: string;
    excludeRecipeId?: string;
    calorieBand?: { gte: number; lte: number };
  }): Promise<AlternativeRecipe[]>;
}

const prismaAlternativesDb: AlternativesDb = {
  findCandidates: async (q) =>
    prisma.recipe.findMany({
      where: {
        mealTypeId: q.mealTypeId,
        isPublic: true,
        ...(q.excludeRecipeId ? { id: { not: q.excludeRecipeId } } : {}),
        ...(q.calorieBand ? { calories: q.calorieBand } : {}),
      },
      take: 30,
      orderBy: { createdAt: "desc" },
      include: { mealType: true, dishType: true, ingredients: { include: { ingredient: true } } },
    }) as unknown as Promise<AlternativeRecipe[]>,
};

/** Route-parity: ±250 kcal band when currentCalories > 0, ban filter in-memory, ≤3. */
export async function findAlternatives(
  patient: DietPatientLike & { healthConditions?: unknown; motivations?: unknown },
  q: { mealTypeId: string; excludeRecipeId?: string; currentCalories?: number },
  db: AlternativesDb = prismaAlternativesDb
): Promise<AlternativeRecipe[]> {
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const candidates = await db.findCandidates({
    mealTypeId: q.mealTypeId,
    excludeRecipeId: q.excludeRecipeId,
    ...(q.currentCalories && q.currentCalories > 0
      ? { calorieBand: { gte: q.currentCalories - 250, lte: q.currentCalories + 250 } }
      : {}),
  });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;
  return (
    !hasBans
      ? candidates
      : candidates.filter(
          (r) => evaluateDishAgainstProfile(r.ingredients.map((ri) => ri.ingredient.name), matchers).passed
        )
  ).slice(0, 3);
}

export type SwapRejection =
  | "MEAL_TYPE_MISMATCH"
  | "BANNED_INGREDIENTS"
  | "MACRO_MISALIGNED"
  | "FAMILY_CONFLICT"
  | "SUBFAMILY_CONFLICT";

export interface SwapCandidateRecipe {
  mealTypeId?: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  family: string | null;
  subFamily: string | null;
  dishType: { name: string } | null;
  ingredients: { ingredient: { name: string } }[];
}

export interface SameDayMenuLike {
  mealTypeId: string | null;
  recipe: { family: string | null; subFamily: string | null; dishType: { name: string } | null };
}

export type SwapPatientLike = DietPatientLike & {
  healthConditions: { condition: { name: string } }[];
  motivations: { motivation: { name: string } }[];
};

const beverageExempt = (family: string | null, dishTypeName: string | null | undefined): boolean => {
  const fam = (family ?? "").toLowerCase();
  return (dishTypeName ?? "").toLowerCase() === "beverage" && !fam.includes("fruity") && !fam.includes("veggie");
};

/**
 * Pure swap gate — EXACT route order and messages (parity pinned by tests):
 * meal-type → bans → macro deviation (>0.50, skipped when calories<=0) →
 * family (same-day, beverage exemption both sides) → sub-family (same meal).
 */
export function validateSwapCandidate(
  patient: SwapPatientLike,
  menu: { mealTypeId: string | null },
  recipe: SwapCandidateRecipe,
  sameDayMenus: SameDayMenuLike[]
): { ok: true } | { ok: false; code: SwapRejection; message: string } {
  if (menu.mealTypeId && recipe.mealTypeId !== menu.mealTypeId) {
    return { ok: false, code: "MEAL_TYPE_MISMATCH", message: "Recipe not suitable for this meal slot" };
  }

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const { passed } = evaluateDishAgainstProfile(
    recipe.ingredients.map((ri) => ri.ingredient.name),
    matchers
  );
  if (!passed) {
    return { ok: false, code: "BANNED_INGREDIENTS", message: "Recipe contains ingredients you cannot eat" };
  }

  const conditionNames = patient.healthConditions.map((hc) => hc.condition.name);
  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);
  const macroTarget = getMacroPercentages(resolveMacroProfile(conditionNames, motivationNames));
  if (recipe.calories && recipe.calories > 0) {
    const deviation = macroDeviation(
      { calories: recipe.calories, protein: recipe.protein, carbs: recipe.carbs, fat: recipe.fat },
      macroTarget
    );
    if (deviation > 0.5) {
      return { ok: false, code: "MACRO_MISALIGNED", message: "Recipe macros do not align with your nutrition profile" };
    }
  }

  if (recipe.family && !beverageExempt(recipe.family, recipe.dishType?.name)) {
    const familyConflict = sameDayMenus.some((m) => {
      if (m.recipe.family !== recipe.family) return false;
      return !beverageExempt(m.recipe.family, m.recipe.dishType?.name);
    });
    if (familyConflict) {
      return { ok: false, code: "FAMILY_CONFLICT", message: "A dish from the same family is already in today's plan" };
    }
  }

  if (recipe.subFamily) {
    const sameMealConflict = sameDayMenus.some(
      (m) => m.mealTypeId === menu.mealTypeId && m.recipe.subFamily === recipe.subFamily
    );
    if (sameMealConflict) {
      return { ok: false, code: "SUBFAMILY_CONFLICT", message: "A dish from the same sub-family is already in this meal" };
    }
  }

  return { ok: true };
}
```

> NOTE the family-rule nuance (read the original route block at `app/api/meal-plan/[menuId]/swap/route.ts:109-131` before finalizing): the exemption applies to the NEW recipe (skip the check entirely) AND to each same-day row (an exempt beverage row does not conflict). The helper above mirrors that; verify against the route line-by-line.

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `npx tsx --test lib/journal.test.ts lib/meal-plan.test.ts`
Expected: PASS. If `derivePatientBans` field names differ from the fixture, fix the FIXTURE (the helper must accept exactly what routes pass).

- [ ] **Step 6: Refactor the three routes to delegate**

`app/api/journal/log-meal/route.ts` — replace lines 48-85 (entry find/create through meal create) with:

```ts
  const result = await upsertMealCompletion(patient.id, {
    recipeId,
    mealTypeName,
    date,
    rating: rating as 1 | -1,
    toggle: true,
  });
  if (result === null) {
    return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
  }
  // Re-read the entry for the day-state response (same window the helper used).
  const entry = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, date: { gte: entryDate, lte: dateEnd } },
  });
```

…keeping the route's existing validations, `entryDate`/`dateEnd` computation, and the final `updated`/`loggedRecipeIds`/`mealRatings` block exactly as-is (it queries by `journalEntryId: entry.id` — guard for `entry` null → empty arrays). Import `upsertMealCompletion` from `@/lib/journal`.

`app/api/meal-plan/alternatives/route.ts` — replace the candidates query + filter block (lines ~29-60) with:

```ts
  const alternatives = await findAlternatives(
    patient ?? { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] },
    { mealTypeId, excludeRecipeId: excludeRecipeId ?? undefined, currentCalories }
  );
  return NextResponse.json({ alternatives });
```

`app/api/meal-plan/[menuId]/swap/route.ts` — replace the validation blocks (meal-type check through sub-family check, lines ~50-146) with:

```ts
  const sameDayMenus = await prisma.menu.findMany({
    where: {
      patientId: patient.id,
      planVersion: patient.activePlanVersion,
      id: { not: params.menuId },
      date: { gte: dayStart, lte: dayEnd },
    },
    include: { recipe: { select: { family: true, subFamily: true, dishType: { select: { name: true } } } } },
  });

  const verdict = validateSwapCandidate(patient, menu, newRecipe, sameDayMenus);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.message }, { status: 400 });
  }
```

(keep `dayStart`/`dayEnd` computation and the final `prisma.menu.update` + response untouched; the route's 404s for menu/recipe stay before this block).

- [ ] **Step 7: Full suite + type check**

Run: `npm test` → green. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 19.

- [ ] **Step 8: Commit**

```bash
git add lib/journal.ts lib/journal.test.ts lib/meal-plan.ts lib/meal-plan.test.ts app/api/journal/log-meal/route.ts app/api/meal-plan/alternatives/route.ts "app/api/meal-plan/[menuId]/swap/route.ts"
git commit -m "refactor(meal-plan): extract completion/alternatives/swap-validation into lib — route parity pinned (S3 E1)"
```

---

### Task E2: Structural confirm guard (loop + types) + S1 write flags

**Files:**
- Modify: `lib/clara/types.ts` (ToolDef, ToolResult), `lib/clara/loop.ts:115-128`, `lib/clara/skills/logs.ts` (two defs)
- Test: `lib/clara/loop.test.ts`, `lib/clara/skills/logs.test.ts` (append)

**Interfaces:**
- Produces: `ToolDef.isWrite?: boolean`; `ToolResult` reason union gains `"CONFIRM_REQUIRED"`; loop behavior: a tool whose def has `isWrite` is NOT executed when the request's `params.messages` contain no assistant turn — the tool_result is the typed refusal instead. E3's write tools rely on this flag.

- [ ] **Step 1: Write the failing loop tests**

Append to `lib/clara/loop.test.ts` (reuse its existing `stubClient`, `toolUse`, `textBlock`, `drain` helpers):

```ts
const WRITE_TOOLS = [
  { name: "x_write", description: "d", input_schema: { type: "object" as const, properties: {} }, isWrite: true },
  { name: "x_get", description: "d", input_schema: { type: "object" as const, properties: {} } },
];

test("guard: a write tool on the first turn is refused, not executed", async () => {
  let executed = 0;
  const { client, seen } = stubClient([
    { deltas: ["Logging it. "], content: [textBlock("Logging it. "), toolUse("t1", "x_write")] },
    { deltas: ["Actually — shall I log it?"] },
  ]);
  const out = await drain(
    await startClaraLoop({
      client,
      system: "s",
      tools: WRITE_TOOLS,
      messages: [{ role: "user", content: "log that ramen" }], // no assistant turn
      maxToolRounds: 2,
      execute: async () => {
        executed += 1;
        return { ok: true, data: null };
      },
    })
  );
  assert.equal(executed, 0);
  const replay = JSON.stringify(seen[1].messages);
  assert.match(replay, /CONFIRM_REQUIRED/);
  assert.match(out, /shall I log it/i);
});

test("guard: the same write executes once the history has an assistant turn", async () => {
  let executed = 0;
  const { client } = stubClient([
    { deltas: ["Done-ish. "], content: [textBlock("Done-ish. "), toolUse("t1", "x_write")] },
    { deltas: ["Logged."] },
  ]);
  await drain(
    await startClaraLoop({
      client,
      system: "s",
      tools: WRITE_TOOLS,
      messages: [
        { role: "user", content: "log that ramen" },
        { role: "assistant", content: "About 550 kcal — want me to log it?" },
        { role: "user", content: "yes" },
      ],
      maxToolRounds: 2,
      execute: async () => {
        executed += 1;
        return { ok: true, data: null };
      },
    })
  );
  assert.equal(executed, 1);
});

test("guard: read tools are untouched on the first turn", async () => {
  let executed = 0;
  const { client } = stubClient([
    { deltas: ["Checking. "], content: [textBlock("Checking. "), toolUse("t1", "x_get")] },
    { deltas: ["Here."] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: WRITE_TOOLS,
      messages: [{ role: "user", content: "what did I eat?" }],
      maxToolRounds: 2,
      execute: async () => { executed += 1; return { ok: true, data: null }; },
    })
  );
  assert.equal(executed, 1);
});
```

Append to `lib/clara/skills/logs.test.ts`:

```ts
test("S3: both logs write tools carry the structural-guard flag; reads do not", () => {
  const flags = Object.fromEntries(logsSkill.tools.map((t) => [t.def.name, t.def.isWrite === true]));
  assert.deepEqual(flags, {
    logs_search: false,
    logs_day_summary: false,
    logs_create: true,
    logs_delete: true,
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx tsx --test lib/clara/loop.test.ts lib/clara/skills/logs.test.ts`
Expected: FAIL — `isWrite` unknown / guard absent (first guard test executes the tool).

- [ ] **Step 3: Implement**

`lib/clara/types.ts` — two edits:

```ts
  // in ToolDef:
  /** S3 structural confirm guard: the loop refuses to execute a flagged tool
   *  when the request history holds no assistant turn (nothing can have been
   *  proposed+confirmed yet). Every write tool MUST set this. */
  isWrite?: boolean;
```

```ts
  // ToolResult reason union — add "CONFIRM_REQUIRED":
  reason: "NOT_FOUND" | "AMBIGUOUS" | "OUT_OF_RANGE" | "INVALID_INPUT" | "NEEDS_PREMIUM" | "CONFIRM_REQUIRED" | "FAILED";
```

`lib/clara/loop.ts` — inside `startClaraLoop`, before `run()` is defined:

```ts
  // S3 structural confirm guard: a first-turn conversation (no assistant turn
  // in the CLIENT-SENT history) cannot contain a proposed+confirmed write —
  // whatever the model thinks. Zero false positives: any real confirm flow has
  // at least one prior assistant message. Checked against params.messages, NOT
  // the loop's growing copy (which gains assistant turns every round).
  const hasPriorAssistantTurn = params.messages.some((m) => m.role === "assistant");
```

…and in the execute loop (the `for (const call of calls)` block at ~line 115), wrap the execute call:

```ts
        let result: ToolResult;
        const def = params.tools.find((t) => t.name === call.name);
        if (def?.isWrite && !hasPriorAssistantTurn) {
          result = {
            ok: false,
            reason: "CONFIRM_REQUIRED",
            message:
              "This change needs the user's explicit confirmation first. Propose it in plain words and wait for their yes.",
          };
        } else {
          try {
            result = await params.execute(call.name, call.input, call.id);
          } catch (err) {
            params.onError?.(err);
            result = { ok: false, reason: "FAILED", message: "The tool did not respond." };
          }
        }
```

`lib/clara/skills/logs.ts` — add `isWrite: true` to the `logs_create` and `logs_delete` defs (inside the `def` object, after `description`).

- [ ] **Step 4: Run to verify green + full suite**

Run: `npx tsx --test lib/clara/loop.test.ts lib/clara/skills/logs.test.ts` → PASS. `npm test` → green. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 19.

- [ ] **Step 5: Commit**

```bash
git add lib/clara/types.ts lib/clara/loop.ts lib/clara/loop.test.ts lib/clara/skills/logs.ts lib/clara/skills/logs.test.ts
git commit -m "feat(clara): structural confirm guard — isWrite flag, first-turn write block (S3 E2)"
```

---

### Task E3: The plan skill — 5 tools + wiring

**Files:**
- Create: `lib/clara/skills/plan.ts`, `lib/clara/skills/plan.test.ts`
- Modify: `lib/clara/registry.ts` (import + entry + tie-breaker rows), `lib/clara/registry.test.ts`, `lib/clara/gap.ts` (+`MEAL_PLAN: "plan"`), `lib/clara/gap.test.ts`

**Interfaces:**
- Consumes: E1's `upsertMealCompletion`/`findAlternatives`/`validateSwapCandidate` + types; E2's `isWrite`; existing `parseMealLogInput`, `resolveSnapshot`, `buildMealLogCreateData`, `buildMealLogUpsertArgs`, `serializeMealLog`, `MEAL_TYPES` (lib/meal-log.ts); `getExchangesForRange`, `displacedMenuIdSet` (lib/plan-exchanges.ts); `deriveLoggedRecipeIds` (lib/meal-plan.ts); `parseLocalDateStrict` (lib/journal.ts); `rateLimit` (lib/rate-limit.ts); `PATIENT_DIET_INCLUDE` (lib/diet-match.ts).
- Produces: `planSkill: Skill` (name `"plan"`), `makePlanHandlers(deps?)`, `PlanDeps`, `PLAN_WRITE_HOURLY_CAP = 30`.

**Handler contracts (payload shapes the tests pin):**

- `plan_get` → `{ from, to, days: [{ date, meals: [{ menuId, name, mealType, calories, protein, carbs, fat, done, rating, exchange: null | { source: "RESTAURANT"|"FRIDGE", originLabel } }], pendingExchanges: [{ name, originLabel }] }], note? }`. Single-day default (`date?`, `ctx.today`); `weekStart?` → 7 days; completion state (done/rating) single-day only (week: `done: false, rating: null` + a `note` saying completion isn't shown in week view — the web has the same behavior). Resolved-exchange overlay: meal's `name`/macros come from the exchange DTO (`perServing × servings`), `done` = `dto.eaten`, `exchange` populated. Empty plan → `ok:true`, `days` with empty `meals`, note pointing at the Meal Plan surface.
- `plan_alternatives(menuId)` → `{ menuId, alternatives: [{ recipeId, name, calories, protein, carbs, fat }] }` (≤3; empty OK).
- `plan_mark_done(menuId, rating?)` ✍️ → maps `"liked"→1, "disliked"→-1, absent→null`; completion date = the MENU's day; toggle:false. → `{ marked: { menuId, name, date, action, rating } }`.
- `plan_log_eaten(menuId, date?, servings?)` ✍️ → MealLog source RECIPE via the S1 funnel; `date` defaults `ctx.today` (intake day ≠ plan slot); mealType derived from the menu (lowercased, must be in `MEAL_TYPES`, else `INVALID_INPUT` asking for one of them); `clientRequestId: "clara:" + toolUseId` (missing toolUseId → FAILED, S1 rule). → `{ logged: serializeMealLog(row) }`.
- `plan_swap_dish(menuId, recipeId)` ✍️ → budget → menu → recipe (public) → diet patient → same-day menus → `validateSwapCandidate` → swap. Rejections: `INVALID_INPUT` with the verdict message. → `{ swapped: { menuId, from, to } }`.
- All writes: budget check first (`FAILED` "Too many changes…" when spent). All `menuId`/`recipeId` misses → `NOT_FOUND` ("No such planned meal — find it with plan_get first." / "That recipe isn't available.").

```ts
export interface PlanDeps {
  getPlanMeta(patientId: string): Promise<{ activePlanVersion: number } | null>;
  findMenus(patientId: string, planVersion: number, start: Date, end: Date): Promise<PlanMenuRow[]>;
  findMenuById(menuId: string, patientId: string, planVersion: number): Promise<PlanMenuRow | null>;
  completionState(patientId: string, localDate: string): Promise<{ loggedRecipeIds: string[]; mealRatings: Record<string, number> }>;
  getExchanges(patientId: string, planVersion: number, from: string, to: string): Promise<PlanExchangeDTO[]>;
  findDietPatient(patientId: string): Promise<SwapPatientLike | null>;
  findPublicRecipe(recipeId: string): Promise<(SwapCandidateRecipe & { id: string; name: string }) | null>;
  findSameDayMenus(patientId: string, planVersion: number, date: Date, excludeMenuId: string): Promise<SameDayMenuLike[]>;
  alternativesFor(patient: SwapPatientLike, q: { mealTypeId: string; excludeRecipeId?: string; currentCalories?: number }): Promise<AlternativeRecipe[]>;
  upsertCompletion: typeof upsertMealCompletion;
  createMealLog(args: ReturnType<typeof buildMealLogUpsertArgs>): Promise<MealLogRow>;
  swapMenuRecipe(menuId: string, recipeId: string): Promise<void>;
  consumeWriteBudget(patientId: string): Promise<boolean>;
}

export interface PlanMenuRow {
  id: string;
  date: Date;
  mealTypeId: string | null;
  mealTypeName: string | null; // menu.mealType?.name
  recipe: { id: string; name: string; calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
}
```

Prisma-backed defaults mirror the routes: `findMenus`/`findMenuById` filter `{ patientId, planVersion }` and include `recipe` + `mealType`; `completionState` reproduces the meal-plan GET route's journal+intake union (JournalEntry day window → active meals; `mealLog.findMany` on `localDate` + `recipeId != null`; `deriveLoggedRecipeIds`; ratings journal-only); `getExchanges` = `getExchangesForRange`; `findDietPatient` = `prisma.patient.findFirst({ where: { id }, include: PATIENT_DIET_INCLUDE })`; `swapMenuRecipe` = `prisma.menu.update({ where: { id: menuId }, data: { recipeId } })`; `consumeWriteBudget` = `rateLimit("clara-plan-write", patientId, 30, 3600)`. A local `toLocalDateString(d: Date)` (route copy, 3 lines) converts `menu.date` → "YYYY-MM-DD".

**Prompt fragment (verbatim):**

```
About your plan_ tools: the meal plan is what is SCHEDULED, not what was eaten. plan_get shows the planned dishes for a day (or a week with weekStart) — including days where the user exchanged a planned dish for a restaurant or fridge meal; present the exchanged-in dish as the day's actual meal and mention it replaced the original. To swap a dish: plan_get to find the meal, then plan_alternatives for up to three valid options, present them, and only after the user picks and confirms call plan_swap_dish. When the user says they ate a planned dish: propose marking it done (plan_mark_done, rating optional — the app only knows liked or disliked, so map or ask; star ratings do not exist), and ask ONCE whether they also want it counted in their intake numbers — if yes, plan_log_eaten; never assume one implies the other. You cannot regenerate or rebuild the plan — send them to the Meal Plan tab and call gap_report (category MEAL_PLAN, reason OUT_OF_SCOPE). Marking a meal as skipped is not something you can do yet: gap_report (JOURNAL).
```

**Tool defs (names + descriptions the tests pin; isWrite on exactly the three writes):**

- `plan_get`: "The user's planned meals for one day (default today) or a week (weekStart). Includes swaps-in-progress and restaurant/fridge exchanges. Use for 'what's for dinner', 'what's planned'. NOT for what they actually ate — logs_ tools own intake." — props `date`, `weekStart` (both optional strings).
- `plan_alternatives`: "Up to three valid replacement dishes for one planned meal. menuId must come from plan_get in this conversation. Use before proposing any swap. Candidates already respect the user's dietary profile." — props `menuId` (required).
- `plan_mark_done` (isWrite): "Mark a planned dish as completed in the user's journal, AFTER they confirmed. Optional rating 'liked' or 'disliked' (the only scale that exists). Does NOT add it to intake numbers — plan_log_eaten does that, and only if the user wants it." — props `menuId` (required), `rating` enum ["liked","disliked"].
- `plan_log_eaten` (isWrite): "Add a planned dish the user actually ate to their intake log (real recipe macros), AFTER they confirmed. Independent of plan_mark_done. date defaults to today — the day they ate it, not the plan slot." — props `menuId` (required), `date`, `servings`.
- `plan_swap_dish` (isWrite): "Replace one planned meal with a recipe the user picked from plan_alternatives, AFTER they confirmed the specific choice. Validates meal slot, dietary profile, macro fit, and same-day variety — a rejection explains why." — props `menuId`, `recipeId` (both required).

**Registry tie-breaker changes (`buildTieBreakers`):** add `planOn`; PLANNED row:

```ts
const plannedRow = planOn
  ? '- What is PLANNED — "what\'s for dinner", the meal plan, swapping a planned dish for another recipe → plan_ tools (plan_get first; plan_alternatives before proposing a swap). Exchanging a planned dish for a RESTAURANT or FRIDGE meal is not a swap you can do: gap_report (EXCHANGES).'
  : '- What is PLANNED — "what\'s for dinner", the meal plan, swapping dishes → you have no plan tools yet: gap_report (MEAL_PLAN) and say so.';
```

…and an ATE-PLANNED row emitted only when `planOn`:

```ts
const atePlannedRow = !planOn
  ? null
  : logsOn
    ? '- "I ate the planned dish" → plan_mark_done (completion; ask once about also logging intake via plan_log_eaten). Unplanned food they ate → logs_create.'
    : '- "I ate the planned dish" → plan_mark_done. For unplanned food you have no intake tools: gap_report (LOGS).';
```

(join non-null rows; keep existing row order, PLANNED row replaced in place, ATE-PLANNED appended after it).

**`lib/clara/gap.ts`:** `MEAL_PLAN: "plan", // S3` in `CATEGORY_TO_SKILL`.

- [ ] **Step 1: Write the failing tests** — `lib/clara/skills/plan.test.ts` covering, with a `fakeDeps()` in the S1/S2 style (every dep an injectable fake, ops recorded):
  - get: day default + date echo; menus mapped with done/rating from completionState; resolved exchange overlays name/macros/eaten + `exchange.source`; pending exchange listed; weekStart → 7-day window + note + no completion lookups; empty plan note; invalid date → INVALID_INPUT.
  - alternatives: missing/unknown menuId → INVALID_INPUT/NOT_FOUND; happy path maps ≤3 with recipeId/name/macros; empty list ok.
  - mark_done: rating map (liked→1, disliked→-1, absent→null, bogus→INVALID_INPUT); completion date = menu's day (assert the date passed to upsertCompletion); toggle:false asserted; NOT_FOUND on foreign menu; budget-spent → FAILED.
  - log_eaten: funnel produces source RECIPE + recipeId + `clara:<toolUseId>` dedupe key (assert on the upsert args like S1's create test); date default ctx.today; servings passthrough; mealType lowercased from menu, invalid menu meal type without input → INVALID_INPUT; missing toolUseId → FAILED.
  - swap: budget first; NOT_FOUND menu/recipe; verdict failure → INVALID_INPUT with verdict message (fake validateSwap path by giving a banned recipe through real `validateSwapCandidate` — it's pure, use it directly); success calls `swapMenuRecipe` with (menuId, recipeId).
  - schema contract: 5 names in order, `isWrite` true on exactly the three writes, no identity params, required arrays as specced.
  - fragment: matches /ask ONCE/i and /regenerate/i and /liked or disliked/i.
  - loop round-trip (S2 pattern): plan_get through registry → answer streams.
  Registry tests (`registry.test.ts` append): 4 logs×plan combos — each emits a coherent PLANNED row (plan on → `plan_get` named, EXCHANGES gap noted; off → gap_report (MEAL_PLAN)); ATE-PLANNED row only when plan on, logs-off variant steers unplanned to gap_report (LOGS); with everything on, prompt contains no `gap_report (MEAL_PLAN)`.
  Gap test: `resolveGapReason("MEAL_PLAN", "NOT_BUILT", ["plan"]) === "FLAGGED_OFF"`.

- [ ] **Step 2: Run to verify failures** — `npx tsx --test lib/clara/skills/plan.test.ts lib/clara/registry.test.ts lib/clara/gap.test.ts`.

- [ ] **Step 3: Implement `plan.ts` + wiring** per the contracts above (handlers in the S1 factory shape; `invalid()` helper; every write budget-first; exchange overlay via `displacedMenuIdSet` + a `Map(dto.displacedMenuId → dto)` over RESOLVED rows; pending = status PENDING).

- [ ] **Step 4: Run to green** — same command, then `npm test` → green, `npx tsc --noEmit` → 19.

- [ ] **Step 5: Commit**

```bash
git add lib/clara/skills/plan.ts lib/clara/skills/plan.test.ts lib/clara/registry.ts lib/clara/registry.test.ts lib/clara/gap.ts lib/clara/gap.test.ts
git commit -m "feat(clara): plan skill — exchange-aware reads, confirmed swap/done/eaten writes (S3 E3)"
```

---

### Task E4: Routing fixture — 2 flips + S3 cases

**Files:**
- Modify: `lib/clara/__fixtures__/routing.ts`

- [ ] **Step 1: Flip the two S1-era gap cases**

```ts
  { utterance: "what's for dinner tomorrow?", expect: "plan_get", note: "S3: flipped from gap_report" },
```

(replacing `expect: "gap_report", note: "S3 not built"`), and in the adversarial-neighbours block:

```ts
  { utterance: "swap Wednesday's lunch for something else", expect: "plan_get", note: "S3: flipped — find the menu first, alternatives second" },
```

- [ ] **Step 2: Append the S3 block**

```ts
  // ── S3 plan — direct hits ──
  { utterance: "what's for dinner tonight?", expect: "plan_get" },
  { utterance: "what's on my meal plan this week?", expect: "plan_get" },
  { utterance: "what am I supposed to have for breakfast tomorrow?", expect: "plan_get" },
  { utterance: "show me alternatives for tonight's dinner", expect: "plan_get", note: "must locate the menu row before plan_alternatives" },
  {
    utterance: "I ate today's planned dinner",
    expect: "plan_get",
    note: "confirm rule: find the dish, then PROPOSE marking done — the write needs a yes first",
  },

  // ── S3 adversarial neighbours ──
  { utterance: "regenerate my meal plan", expect: "gap_report", note: "OUT_OF_SCOPE refusal edge — link to Meal Plan tab" },
  { utterance: "skip tonight's dinner", expect: "gap_report", note: "JOURNAL (S4) owns skipped" },
  { utterance: "swap Friday's dinner for a restaurant meal", expect: "gap_report", note: "EXCHANGES (S10), not plan_swap_dish" },
  { utterance: "what should I buy for this week's plan?", expect: "gap_report", note: "GROCERY (S7)" },
  { utterance: "rate yesterday's lunch 4 stars", expect: "plan_get", note: "find the meal; the proposal must map stars → liked/disliked" },

  // ── padding: unambiguous S3 hits ──
  { utterance: "what's planned for lunch tomorrow?", expect: "plan_get" },
  { utterance: "is there anything I can have instead of tomorrow's breakfast?", expect: "plan_get" },
```

- [ ] **Step 3: Update the margin comment** — the padding-section comment becomes "5 misses allowed at 54 cases" (42 + 12 new; flips add none).

- [ ] **Step 4: Verify** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 19; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add lib/clara/__fixtures__/routing.ts
git commit -m "feat(clara): S3 routing fixture — plan flips + 12 cases (S3 E4)"
```

---

## Cycle process (controller — not subagent work)

- E1 → E2 → E3 → E4 sequential (E3 imports E1+E2; E4 assumes the tools exist).
- Per-task review after each; final whole-branch review with a **write-path reviewer** (guard, budget ordering, funnel provenance, route parity) + recognition reviewer (tie-breaker combos, fixture).
- Audit: `npm run clara:routing-eval` (54 cases) on the release-gate machine; ≥90%; S1/S2/C0 drops are Critical.
- Close-out: append the S3 block to `.superpowers/sdd/progress.md` (local, gitignored); merge per superpowers:finishing-a-development-branch.
- Release gate carries: prod `CLARA_SKILLS` unset or includes `plan`; live smoke — Clara swap visible in web plan view, `plan_log_eaten` row in journal/stats with source RECIPE, MEAL_PLAN gap rows collapsing.
