# Clara Basket Generation — Phase B (Planner UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Wire the Phase-A engine to the UI: remove the Clara/Homemade switch, add a manual **"New week"** flow with a **readiness gate** (min ingredients + category coverage), a guided **blocked button**, a **review step**, and a persistent **"X / N ingredients" counter** on pantry + onboarding.

**Architecture:** Two pure `lib` modules (categories + readiness) drive both the server gate and the client counter. A new `POST /api/meal-plan/new-week` builds a rolling 7-day, ramp-anchored, basket-constrained plan via the extended runner. `DailyMealPlanView` loses the switch and gains the New-week panel; `PantryClient` gains the counter.

**Tech Stack:** Next.js App Router, TypeScript, Prisma. Tests: `node --test` for `lib`; tsc/lint/curl for routes + components.

## Global Constraints

- `MIN_BASKET = 12`; required categories = protein, carb, vegetable (≥1 each).
- Readiness is computed from one shared module — server gate and client counter must never disagree.
- The New-week build uses `{ basket, windowDays: 7, anchorDate, claraFirst: true }`. Anchor = existing `mealPlanStartDate` if set, else today; the anchor is never moved by a roll.
- Existing suite (1026) stays green. Never `npm run build` while dev runs.
- Frontend matches the existing visual language (burgundy `#812549`, cream cards, `rounded-2xl`); consistency over novelty (ui-ux-pro-max).

---

### Task 1: `lib/ingredient-categories.ts` (+test)

**Files:** Create `lib/ingredient-categories.ts`, `lib/ingredient-categories.test.ts`

**Interfaces:** Produces `type CategoryKey = "protein"|"carb"|"vegetable"|"fruit"|"dairy"|"fat"|"other"`; `classifyIngredient(name: string): CategoryKey`; `CATEGORY_LABEL: Record<CategoryKey,string>`.

- [ ] **Step 1: Failing test** (`lib/ingredient-categories.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIngredient } from "./ingredient-categories";

test("classifies common ingredients by first keyword match", () => {
  assert.equal(classifyIngredient("Chicken breast"), "protein");
  assert.equal(classifyIngredient("brown rice"), "carb");
  assert.equal(classifyIngredient("Broccoli"), "vegetable");
  assert.equal(classifyIngredient("olive oil"), "fat");
});

test("unknown ingredients fall to 'other'", () => {
  assert.equal(classifyIngredient("xanthan gum"), "other");
});
```

- [ ] **Step 2: Run → fail** — `node --import tsx --test lib/ingredient-categories.test.ts`

- [ ] **Step 3: Implement** (`lib/ingredient-categories.ts`)

```ts
// Keyword ingredient classification. Shared by the basket-readiness gate and
// (later) the leveled swipe deck. First matching keyword wins; unknown → other.
export type CategoryKey = "protein" | "carb" | "vegetable" | "fruit" | "dairy" | "fat" | "other";

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  protein: "protein", carb: "grain or carb", vegetable: "vegetable",
  fruit: "fruit", dairy: "dairy", fat: "fat or oil", other: "other",
};

const KEYWORDS: [CategoryKey, string[]][] = [
  ["protein", ["chicken", "beef", "steak", "pork", "bacon", "sausage", "turkey", "lamb", "fish", "salmon", "tuna", "cod", "shrimp", "prawn", "egg", "tofu", "tempeh", "seitan", "bean", "lentil", "chickpea", "ham"]],
  ["carb", ["rice", "pasta", "noodle", "bread", "potato", "oat", "flour", "quinoa", "tortilla", "couscous", "barley", "cereal", "bagel", "bun", "cracker", "wrap"]],
  ["vegetable", ["broccoli", "spinach", "carrot", "tomato", "onion", "garlic", "pepper", "mushroom", "lettuce", "cucumber", "zucchini", "cabbage", "kale", "corn", "pea", "bean sprout", "cauliflower", "celery", "asparagus", "eggplant", "squash"]],
  ["fruit", ["apple", "banana", "berry", "strawberry", "blueberry", "orange", "lemon", "lime", "mango", "grape", "peach", "pear", "pineapple", "melon", "cherry"]],
  ["dairy", ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream"]],
  ["fat", ["oil", "olive", "avocado", "nut", "almond", "peanut", "seed", "tahini"]],
];

export function classifyIngredient(name: string): CategoryKey {
  const n = name.toLowerCase();
  for (const [cat, words] of KEYWORDS) if (words.some((w) => n.includes(w))) return cat;
  return "other";
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `git add lib/ingredient-categories.* && git commit -m "feat: ingredient category classifier"`

---

### Task 2: `lib/basket-readiness.ts` (+test)

**Files:** Create `lib/basket-readiness.ts`, `lib/basket-readiness.test.ts`

**Interfaces:** Produces `MIN_BASKET: number`; `computeBasketReadiness(names: string[]): { count: number; min: number; ready: boolean; missingCategories: CategoryKey[] }`.

- [ ] **Step 1: Failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBasketReadiness, MIN_BASKET } from "./basket-readiness";

const enough = [
  "chicken","beef","salmon","rice","oats","bread","broccoli","spinach","carrot","tomato","onion","apple",
];

test("ready when count >= MIN and protein/carb/veg all present", () => {
  const r = computeBasketReadiness(enough);
  assert.equal(r.min, MIN_BASKET);
  assert.equal(r.ready, true);
  assert.deepEqual(r.missingCategories, []);
});

test("not ready when below the minimum count", () => {
  const r = computeBasketReadiness(["chicken", "rice", "broccoli"]);
  assert.equal(r.ready, false);
});

test("not ready when a required category is missing", () => {
  const only = Array.from({ length: 14 }, (_, i) => `rice ${i}`); // all carbs
  const r = computeBasketReadiness(only);
  assert.equal(r.ready, false);
  assert.ok(r.missingCategories.includes("protein"));
  assert.ok(r.missingCategories.includes("vegetable"));
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```ts
import { classifyIngredient, type CategoryKey } from "./ingredient-categories";

export const MIN_BASKET = 12;
const REQUIRED: CategoryKey[] = ["protein", "carb", "vegetable"];

export function computeBasketReadiness(names: string[]): {
  count: number;
  min: number;
  ready: boolean;
  missingCategories: CategoryKey[];
} {
  const present = new Set(names.map(classifyIngredient));
  const missingCategories = REQUIRED.filter((c) => !present.has(c));
  const count = names.length;
  return { count, min: MIN_BASKET, ready: count >= MIN_BASKET && missingCategories.length === 0, missingCategories };
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `git commit -m "feat: basket readiness (min + category coverage)"`

---

### Task 3: `GET /api/pantry/basket-status`

**Files:** Create `app/api/pantry/basket-status/route.ts`

**Interfaces:** Consumes `computeBasketReadiness`. Produces `{ count, min, ready, missingCategories }` for the current patient's pantry.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { computeBasketReadiness } from "@/lib/basket-readiness";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const items = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredient: { select: { name: true } } },
  });
  const status = computeBasketReadiness(items.map((i) => i.ingredient.name));
  return NextResponse.json(status);
}
```

- [ ] **Step 2: tsc + lint + curl → 401.** **Step 3: Commit** `git commit -m "feat(api): pantry basket-status (readiness)"`

---

### Task 4: Runner opts + `POST /api/meal-plan/new-week`

**Files:** Modify `lib/meal-plan-runner.ts` (opts + anchor-preserving mealPlanStartDate); Create `app/api/meal-plan/new-week/route.ts`

**Interfaces:**
- `regeneratePlan(patientId, startDate, deps, opts)` gains `windowDays?`, `anchorDate?`, `basket?: Set<string>`; passes them to the builder; sets `mealPlanStartDate = opts.anchorDate ?? start`.
- `POST /api/meal-plan/new-week` → builds a rolling week; `{ ok, count }` or `422` if the basket isn't ready.

- [ ] **Step 1: Extend the runner opts type + pass-through**

In `lib/meal-plan-runner.ts`, change the `opts` param type of `regeneratePlan` to:
```ts
  opts: { claraFirst?: boolean; cuisine?: string | null; windowDays?: number; anchorDate?: Date; basket?: Set<string> } = {},
```
The build call already spreads `opts` into `buildMealPlanMenus(patientId, start, nextVersion, opts)` — no change there. In the success `patient.update`, change:
```ts
        mealPlanStartDate: start,
```
to:
```ts
        // Rolling weeks keep the original anchor (day-1 of the ramp); only a
        // fresh plan (no anchor) stamps today.
        mealPlanStartDate: opts.anchorDate ?? start,
```

- [ ] **Step 2: Write the route** (`app/api/meal-plan/new-week/route.ts`)

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { guardAiSpend } from "@/lib/ai-budget";
import { computeBasketReadiness } from "@/lib/basket-readiness";

export const maxDuration = 60;

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, profileCompleted: true, mealPlanStartDate: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  const items = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredient: { select: { name: true } } },
  });
  const names = items.map((i) => i.ingredient.name);
  const status = computeBasketReadiness(names);
  if (!status.ready) {
    return NextResponse.json(
      { error: "Add more ingredients before generating a week.", ...status },
      { status: 422 }
    );
  }

  const guard = await guardAiSpend(userId, "planGen");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const today = clampPlanStartToToday(new Date());
  const anchor = patient.mealPlanStartDate ? new Date(patient.mealPlanStartDate) : today;
  const basket = new Set(names.map((n) => n.trim().toLowerCase()));

  try {
    const count = await regeneratePlan(patient.id, today, undefined, {
      claraFirst: true,
      windowDays: 7,
      anchorDate: anchor,
      basket,
    });
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    if (err instanceof EmptyPlanError) return NextResponse.json({ error: "Couldn't build a week from these ingredients — add a few more and try again." }, { status: 422 });
    throw err;
  }
}
```

- [ ] **Step 3: tsc + `npm test` (runner change must keep suite green) + lint + curl → 401.**
- [ ] **Step 4: Commit** `git commit -m "feat: new-week rolling generation (basket + anchor)"`

---

### Task 5: `DailyMealPlanView` — remove switch, add New-week panel

**Files:** Modify `components/meal-plan/DailyMealPlanView.tsx`

**Interfaces:** Consumes `GET /api/pantry/basket-status`, `POST /api/meal-plan/new-week`.

- [ ] **Step 1:** Remove the Clara/Homemade switch, the cuisine strip, `planMode`/`selectMode`, `handleClaraDay`/`handleHomemade`/`generatePlan`, and the auto-generate effects (the `!startDate` effect and the elapsed-plan branch in the hydrate effect that call `generatePlan`). Keep `handleSetStartDate` only if still used; otherwise remove.

- [ ] **Step 2:** Add state + loader:

```tsx
const [basketStatus, setBasketStatus] = useState<{ count: number; min: number; ready: boolean; missingCategories: string[] } | null>(null);
const [newWeekLoading, setNewWeekLoading] = useState(false);
const [newWeekError, setNewWeekError] = useState("");
const loadBasketStatus = async () => {
  try {
    const res = await fetch("/api/pantry/basket-status");
    if (res.ok) setBasketStatus(await res.json());
  } catch { /* leave null */ }
};
```
Call `loadBasketStatus()` in a mount effect, and whenever the day has no menus.

- [ ] **Step 3:** Add the generate handler:

```tsx
const generateNewWeek = async () => {
  if (newWeekLoading) return;
  setNewWeekLoading(true);
  setNewWeekError("");
  try {
    const res = await fetch("/api/meal-plan/new-week", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setNewWeekError(data?.error ?? "Couldn't generate your week — try again."); return; }
    const dateStr = format(new Date(), "yyyy-MM-dd");
    const mRes = await fetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
    const mData = await mRes.json();
    setMenus(mData.menus ?? []);
    setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
    setMealRatings(mData.mealRatings ?? {});
    if (mData.mealPlanStartDate) setStartDate(new Date(mData.mealPlanStartDate));
    setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
    setExchanges(mData.exchanges ?? null);
  } catch { setNewWeekError("Network error — try again."); }
  finally { setNewWeekLoading(false); }
};
```

- [ ] **Step 4:** Replace the old switch/strip block with the New-week panel, shown when `menus.length === 0` (today has no dishes). Match the existing dashed-panel style:

```tsx
{menus.length === 0 && (
  <div className="rounded-2xl px-4 py-4 mb-4 border border-dashed" style={{ borderColor: "#812549", background: "rgba(129,37,73,0.04)" }}>
    {newWeekLoading ? (
      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "#5F1C35" }}>
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" role="status" aria-label="Generating">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Generating your week…
      </p>
    ) : basketStatus && !basketStatus.ready ? (
      <div>
        <p className="text-sm font-semibold" style={{ color: "#5F1C35" }}>
          {basketStatus.count} / {basketStatus.min} ingredients
        </p>
        <p className="text-xs mt-0.5 mb-3" style={{ color: "#848181" }}>
          Add {Math.max(0, basketStatus.min - basketStatus.count)} more{basketStatus.missingCategories.length ? ` (include a ${basketStatus.missingCategories.join(", ")})` : ""} so Clara can fill all 7 days without repeats.
        </p>
        <a href="/pantry" className="inline-block px-4 py-2 rounded-full text-xs font-semibold text-white" style={{ background: "#812549" }}>
          Add ingredients →
        </a>
      </div>
    ) : (
      <div>
        <p className="text-sm font-semibold" style={{ color: "#5F1C35" }}>New week</p>
        <p className="text-xs mt-0.5 mb-3" style={{ color: "#848181" }}>
          Your selected ingredients are the base of your plan. Make sure you&apos;re happy — <a href="/pantry" className="font-semibold underline" style={{ color: "#812549" }}>edit the list</a> — then generate your whole week.
        </p>
        {newWeekError && <p role="alert" className="text-xs mb-2 text-error">{newWeekError}</p>}
        <button type="button" onClick={() => void generateNewWeek()} className="px-4 py-2 rounded-full text-xs font-semibold text-white" style={{ background: "#812549" }}>
          Generate my whole week
        </button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5:** tsc + lint + curl `/meal-plan` → 307. **Step 6: Commit** `git commit -m "feat(meal-plan): remove switch, add manual New-week flow + readiness gate"`

---

### Task 6: `PantryClient` — required-ingredients counter

**Files:** Modify `components/pantry/PantryClient.tsx`

**Interfaces:** Consumes `MIN_BASKET` + `computeBasketReadiness` (client import of the pure module) to show a persistent bottom bar on the "What I have" tab.

- [ ] **Step 1:** Import at top: `import { computeBasketReadiness, MIN_BASKET } from "@/lib/basket-readiness";`

- [ ] **Step 2:** In the "What I have" view, compute readiness from `selected` (the Map of chosen ingredient names) and render a sticky bottom bar:

```tsx
{(() => {
  const status = computeBasketReadiness(Array.from(selected.values()));
  return (
    <div className="sticky bottom-0 mt-4 -mx-1 px-4 py-3 rounded-2xl border" style={{ borderColor: status.ready ? "#2E7D5B" : "#EAE4CA", background: status.ready ? "rgba(46,125,91,0.06)" : "#fff" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold" style={{ color: status.ready ? "#2E7D5B" : "#5F1C35" }}>
          {status.count} / {status.min} ingredients{status.ready ? " ✓" : ""}
        </span>
        <span className="text-xs" style={{ color: "#848181" }}>
          {status.ready ? "Enough to fill a full week" : `Add ${Math.max(0, status.min - status.count)} more${status.missingCategories.length ? ` (a ${status.missingCategories.join(", ")})` : ""}`}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0EFF5" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (status.count / status.min) * 100)}%`, background: status.ready ? "#2E7D5B" : "#812549" }} />
      </div>
    </div>
  );
})()}
```

> Place it at the bottom of the What-I-have panel so it stays visible while selecting. `selected` maps id→name (confirm the value is the ingredient name; it is, per `toggle`/`persist`). The same bar appears in onboarding because onboarding renders the same What-I-have view.

- [ ] **Step 3:** tsc + lint + curl `/pantry` → 307. **Step 4: Commit** `git commit -m "feat(pantry): required-ingredients counter bar"`

---

## Self-Review

- Remove switch → Task 5. ✓ · Manual New-week + gate + blocked button + Add-ingredients → Tasks 4,5. ✓ · Review/edit step (reassurance + edit link) → Task 5 Step 4. ✓ · Counter on pantry + onboarding → Task 6. ✓ · Readiness shared server+client → Tasks 2,3,5,6 all import `computeBasketReadiness`. ✓ · Anchor preserved across weeks → Task 4 runner change. ✓
- Deferred to Phase C: marginal what-to-buy, pruning.
- Placeholder scan: none. Task 5 Step 1 names exactly what to remove; Task 6 confirms `selected` value = name.
- Types: `{count,min,ready,missingCategories}` shape identical across route (Task 3), new-week 422 body (Task 4), and both components (Tasks 5,6).
