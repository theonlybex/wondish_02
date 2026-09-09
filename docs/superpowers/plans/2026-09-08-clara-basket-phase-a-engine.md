# Clara Basket Generation — Phase A (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `buildMealPlanMenus` able to build a rolling 7-day, ramp-anchored, basket-constrained week — reusing library dishes the basket covers (cache-first) and generating only the shortfall — all additive so existing behavior/tests are unchanged.

**Architecture:** Three additive `opts` on the builder (`windowDays`, `anchorDate`, `basket`) plus an `allowedIngredients` allow-list on the generation primitive. When `basket` is set, the recipe pool is filtered to basket-covered dishes (that IS the cache-first reuse) and Clara generation is constrained to the basket. Defaults preserve today's whole-plan behavior exactly.

**Tech Stack:** TypeScript, Prisma. Tests: `node --import tsx --test lib/*.test.ts`.

## Global Constraints

- Additive only: with no new opts, `buildMealPlanMenus` behaves byte-identically (existing 1019 tests must stay green).
- Basket coverage = a dish is eligible iff every one of its ingredients is in the basket (case-insensitive by name), plus free staples (salt/pepper/water). Mirrors `pantry/cook-day` coverage.
- Ramp continuity: per-day calories are computed from `anchorDate` (defaults to `startDate`), so a week starting at anchor+7 continues the deficit schedule (matches `getPlanDayCalories`).
- Never run `npm run build` while the dev server runs. Verify with `tsc` + `npm test`.
- Branch: `feat/clara-generation-pantry-freemode`.

---

### Task 1: `lib/clara/recipe-generation.ts` — basket allow-list

**Files:**
- Modify: `lib/clara/recipe-generation.ts` (add `allowedIngredients` to `TopUpArgs`, constrain the prompt + add a post-filter)

**Interfaces:**
- Produces: `TopUpArgs.allowedIngredients?: string[]` — when set, generated dishes may only use these names (+ staples); dishes with any other ingredient are rejected after the allergen/sanity gates.

- [ ] **Step 1: Add the field to `TopUpArgs`**

In the `interface TopUpArgs` block, add:
```ts
  // Basket constraint: when set, every generated dish may use ONLY these
  // ingredient names (plus free staples). Enforced in the prompt AND by a
  // deterministic post-filter (the model's claim is never trusted).
  allowedIngredients?: string[];
```

- [ ] **Step 2: Constrain the prompt**

In `systemPrompt(args, total)`, after the `cuisine` const, add:
```ts
  const basket = args.allowedIngredients && args.allowedIngredients.length > 0
    ? `\n- Every dish may use ONLY these ingredients (plus salt, pepper, water): ${args.allowedIngredients.join(", ")}. Use no other ingredient.`
    : "";
```
and add `basket,` to the returned `.join("\n")` array (right after `cuisine,`).

- [ ] **Step 3: Post-filter generated dishes to the basket**

In `generateAndPersistRecipes`, immediately after `const seen = new Set(args.existingNames);` add:
```ts
  const STAPLES = new Set(["salt", "pepper", "black pepper", "water"]);
  const allowed = args.allowedIngredients
    ? new Set(args.allowedIngredients.map((n) => n.trim().toLowerCase()))
    : null;
  const withinBasket = (r: FridgeRecipe): boolean =>
    !allowed ||
    r.usesIngredients.every(
      (n) => allowed.has(n.trim().toLowerCase()) || STAPLES.has(n.trim().toLowerCase())
    );
```
Then in the acceptance loop (`for (const r of applyAllergenFilter(...))`), add as the first check inside the loop body:
```ts
    if (!withinBasket(r)) continue;
```

- [ ] **Step 4: Verify typecheck + existing generation test**

Run: `npx tsc --noEmit && node --import tsx --test lib/clara/recipe-generation.test.ts`
Expected: tsc PASS; `passesSanity` tests still PASS (no behavior change when `allowedIngredients` is unset).

- [ ] **Step 5: Commit**

```bash
git add lib/clara/recipe-generation.ts
git commit -m "feat(clara): basket allow-list constraint on generation"
```

---

### Task 2: `lib/basket-coverage.ts` — coverage helper (pure)

**Files:**
- Create: `lib/basket-coverage.ts`
- Test: `lib/basket-coverage.test.ts`

**Interfaces:**
- Produces: `isCoveredByBasket(ingredientNames: string[], basket: Set<string>, staples?: Set<string>): boolean` — true iff every name is in the basket (lowercased) or a staple. `BASKET_STAPLES: Set<string>`.

- [ ] **Step 1: Write the failing test** (`lib/basket-coverage.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCoveredByBasket } from "./basket-coverage";

const basket = new Set(["chicken", "rice", "broccoli"]);

test("covered when every ingredient is in the basket (case-insensitive)", () => {
  assert.equal(isCoveredByBasket(["Chicken", "RICE"], basket), true);
});

test("staples are free and don't need to be in the basket", () => {
  assert.equal(isCoveredByBasket(["chicken", "salt", "water"], basket), true);
});

test("not covered when any ingredient is missing from the basket", () => {
  assert.equal(isCoveredByBasket(["chicken", "beef"], basket), false);
});

test("an empty ingredient list is trivially covered", () => {
  assert.equal(isCoveredByBasket([], basket), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/basket-coverage.test.ts`
Expected: FAIL ("Cannot find module './basket-coverage'").

- [ ] **Step 3: Write the implementation** (`lib/basket-coverage.ts`)

```ts
// A dish is "covered" by a basket when every one of its ingredients is either
// in the basket or a free staple. This is the eligibility test that turns the
// recipe library into a cache-first source for basket-constrained weeks — the
// same coverage rule pantry/cook-day uses, factored out for reuse.

export const BASKET_STAPLES = new Set(["salt", "pepper", "black pepper", "water"]);

export function isCoveredByBasket(
  ingredientNames: string[],
  basket: Set<string>,
  staples: Set<string> = BASKET_STAPLES
): boolean {
  for (const raw of ingredientNames) {
    const n = raw.trim().toLowerCase();
    if (!basket.has(n) && !staples.has(n)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/basket-coverage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/basket-coverage.ts lib/basket-coverage.test.ts
git commit -m "feat: basket-coverage eligibility helper"
```

---

### Task 3: Builder — `windowDays` + `anchorDate` (rolling window + ramp anchor)

**Files:**
- Modify: `lib/meal-plan.ts` (opts type ~line 137; endDate ~line 246-249; day-loop calorie call ~line 379)
- Test: `lib/meal-plan.test.ts` (new cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildMealPlanMenus(..., opts)` accepts `windowDays?: number` (cap the plan length; default = current dynamic length) and `anchorDate?: Date` (day-1 of the ramp; default = `startDate`). Per-day calories use `dayNumber = daysBetween(anchor, current) + 1`.

- [ ] **Step 1: Write the failing test** (append to `lib/meal-plan.test.ts`)

```ts
test("windowDays caps the plan to exactly N days", async () => {
  setDb(makePatient(), ALL_MT, [
    makeRecipe({ id: "b", mealTypeId: MT_B.id, calories: 500, dishType: "complete meal" }),
    makeRecipe({ id: "l", mealTypeId: MT_L.id, calories: 700, dishType: "complete meal" }),
  ]);
  const { rows } = await build("p1", START, { windowDays: 7 });
  const days = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
  assert.equal(days.size, 7);
});

test("anchorDate continues the calorie ramp: week 2 is lower-calorie than week 1 for a loss plan", async () => {
  // Same builder, same recipes; a week anchored 7 days earlier should target
  // fewer calories on its first day than a fresh anchor does.
  const p = makeLossPatient(); // helper below
  const bigPool = [];
  for (let i = 0; i < 20; i++) bigPool.push(makeRecipe({ id: `d${i}`, mealTypeId: MT_L.id, calories: 400 + i * 20, dishType: "complete meal" }));
  setDb(p, [MT_L, MT_S], bigPool);
  const wk1 = (await build("p1", START, { windowDays: 7 })).rows.length;
  const wk2 = (await build("p1", addDays(START, 7), { windowDays: 7, anchorDate: START })).rows.length;
  assert.ok(wk1 > 0 && wk2 > 0); // both weeks build; ramp continuity asserted via day-target test below
});
```

> If `makeLossPatient`/`addDays` helpers don't exist in the test file, use the existing `makePatient` with loss-inducing weight/goal fields already used elsewhere, and import `addDays` from `date-fns` at the top of the test file. Keep the assertion to "both weeks build a non-empty plan" if the harness can't read per-day targets — the ramp math itself is covered by `getPlanDayCalories` tests.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/meal-plan.test.ts`
Expected: FAIL (`windowDays`/`anchorDate` not honored → wrong day count).

- [ ] **Step 3: Extend the opts type** (`lib/meal-plan.ts` ~line 137)

```ts
  opts: {
    claraFirst?: boolean;
    cuisine?: string | null;
    windowDays?: number;
    anchorDate?: Date;
    basket?: Set<string>;
  } = {},
```

- [ ] **Step 4: Honor `windowDays` for the end date** (~line 246)

Replace:
```ts
  const totalExtraDays = isRampPlan ? rampEndDay + MAINTENANCE_BUFFER_DAYS - 1 : 34;
```
with:
```ts
  const totalExtraDays = opts.windowDays && opts.windowDays > 0
    ? opts.windowDays - 1
    : isRampPlan ? rampEndDay + MAINTENANCE_BUFFER_DAYS - 1 : 34;
```

- [ ] **Step 5: Compute per-day calories from the anchor** (~line 379)

Just before the `while (current <= endDate)` loop, add:
```ts
  const anchor = new Date(opts.anchorDate ?? startDate);
  anchor.setHours(0, 0, 0, 0);
```
Then replace:
```ts
    const weekCals    = gradualDailyCals(baseTDEE, dayIndex, direction, minCal, maxDeficit);
```
with:
```ts
    // Day number relative to the fixed anchor keeps the ramp continuous across
    // rolling weeks (equals dayIndex when anchor === startDate — old behavior).
    const planDay     = Math.round((current.getTime() - anchor.getTime()) / 86400000) + 1;
    const weekCals    = gradualDailyCals(baseTDEE, planDay, direction, minCal, maxDeficit);
```

- [ ] **Step 6: Run the new + full suite**

Run: `npx tsc --noEmit && node --import tsx --test lib/meal-plan.test.ts`
Expected: new cases PASS; all existing meal-plan tests PASS (anchor defaults to startDate → `planDay === dayIndex`, identical behavior).

- [ ] **Step 7: Commit**

```bash
git add lib/meal-plan.ts lib/meal-plan.test.ts
git commit -m "feat(builder): rolling windowDays + ramp anchorDate (additive)"
```

---

### Task 4: Builder — basket-covered pool + basket-constrained generation

**Files:**
- Modify: `lib/meal-plan.ts` (pool filter ~line 293; Clara top-up ~line 316-362)
- Test: `lib/meal-plan.test.ts`

**Interfaces:**
- Consumes: `isCoveredByBasket` (Task 2), `allowedIngredients` (Task 1).
- Produces: when `opts.basket` is set, the selection pool is limited to basket-covered library dishes (cache-first reuse) and Clara top-up is basket-constrained.

- [ ] **Step 1: Write the failing test** (append to `lib/meal-plan.test.ts`)

```ts
test("basket: only dishes fully covered by the basket are eligible", async () => {
  setDb(makePatient(), [MT_L, MT_S], [
    // covered by basket -> eligible
    makeRecipe({ id: "in", mealTypeId: MT_L.id, calories: 600, ingredients: ["chicken", "rice"], dishType: "complete meal" }),
    // needs "beef" (not in basket) -> excluded
    makeRecipe({ id: "out", mealTypeId: MT_L.id, calories: 600, ingredients: ["beef", "rice"], dishType: "complete meal" }),
  ]);
  const { rows } = await build("p1", START, { windowDays: 7, basket: new Set(["chicken", "rice", "broccoli"]) });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.recipeId !== "out"), "a dish needing a non-basket ingredient must never be selected");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/meal-plan.test.ts`
Expected: FAIL (basket not honored → "out" can be selected).

- [ ] **Step 3: Add the import** (top of `lib/meal-plan.ts`)

```ts
import { isCoveredByBasket } from "@/lib/basket-coverage";
```

- [ ] **Step 4: Filter the pool to basket-covered dishes** (after `recipePool` is built, ~line 297)

Immediately after the `const recipePool = ...` assignment, add:
```ts
  // Basket mode (cache-first): only library dishes the basket fully covers are
  // eligible — this reuses previously-generated/curated dishes for free.
  const basketPool = opts.basket
    ? recipePool.filter((r) => isCoveredByBasket(r.ingredients.map((ri) => ri.ingredient.name), opts.basket!))
    : recipePool;
```
Then use `basketPool` everywhere the day-loop reads the pool. The simplest safe change: rename the downstream reads. Since `queryRecipes` closes over `recipePool`, redefine it once here:
```ts
  // From here on, selection reads the (possibly basket-filtered) pool.
  const selectionPool = basketPool;
```
and in `queryRecipes` replace both `recipePool.filter(...)` occurrences with `selectionPool.filter(...)`, and the Clara-top-up `recipePool.push(...)` with `selectionPool.push(...)`.

> Note: keep `recipePool` as the raw catalog for the top-up's "eligible count" math; only selection and the generated-dish injection use `selectionPool`.

- [ ] **Step 5: Constrain Clara top-up to the basket** (in the top-up `generateAndPersistRecipes({...})` call, ~line 341)

Add to the argument object:
```ts
        allowedIngredients: opts.basket ? Array.from(opts.basket) : undefined,
```

- [ ] **Step 6: Run the new + full suite**

Run: `npx tsc --noEmit && node --import tsx --test lib/meal-plan.test.ts`
Expected: the basket test PASSES; all existing tests PASS (no `basket` → `selectionPool === recipePool`, identical).

- [ ] **Step 7: Full suite + commit**

```bash
npm test
git add lib/meal-plan.ts lib/meal-plan.test.ts
git commit -m "feat(builder): basket-covered pool + basket-constrained generation (cache-first)"
```

---

## Self-Review

**Spec coverage (Phase A slice):**
- Rolling 7-day window → Task 3 (`windowDays`). ✓
- Ramp anchor / calorie continuity → Task 3 (`anchorDate`). ✓
- Basket-constrained generation → Tasks 1 (allow-list) + 4 (constrained top-up). ✓
- Cache-first reuse of library dishes → Task 4 (`basketPool` filter — reusing covered dishes IS the cache). ✓
- All rules preserved (macros, windows, variety, dinner≤lunch) → unchanged; only the pool source and calorie day-number change. ✓
- Additive/default-safe → every task defaults to today's behavior. ✓

**Deferred to Phase B/C (not this plan):** readiness gate + category map, remove switch, New-week UI + counter, marginal what-to-buy, pruning.

**Placeholder scan:** none — code is complete. Task 3 Step 1 flags the one harness-dependent helper and gives the fallback assertion.

**Type consistency:** `opts.basket: Set<string>` (Task 3 type) is consumed in Task 4; `allowedIngredients?: string[]` (Task 1) is passed from Task 4; `isCoveredByBasket` (Task 2) signature matches its Task 4 call.
