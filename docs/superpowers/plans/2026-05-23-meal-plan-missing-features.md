# Meal Plan — Missing Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Dr. Cardona's six missing meal plan requirements — dish taxonomy, profile gate, 35-day generation, proper meal assembly, family/sub-family repetition rules, swap validation — plus a timeline-column daily view layout.

**Architecture:** DB migration adds `family`/`subFamily` to Recipe and new dish types; `lib/meal-plan.ts` is rewritten with a per-day family tracker and hierarchical meal assembly (Complete Meal → Main Dish + Sides + Dessert); API routes get a profile gate and swap validation; `DailyMealPlanView.tsx` switches from a flat card grid to a timeline column grouped by meal type.

**Tech Stack:** Next.js 14 App Router, Prisma ORM (PostgreSQL), Tailwind CSS, date-fns, framer-motion.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `family String?` + `subFamily String?` to `Recipe` |
| `app/api/admin/seed/route.ts` | Rename "Main Course"→"Main Dish", add 4 new dish types |
| `types/index.ts` | Add `family`, `subFamily` to `RecipeDTO` |
| `components/admin/RecipeForm.tsx` | Add family + subFamily input fields |
| `lib/meal-plan.ts` | Full rewrite — profile gate, family tracking, meal assembly hierarchy |
| `app/api/meal-plan/route.ts` | Raise cap to 35 days, add 422 profile gate |
| `app/api/meal-plan/alternatives/route.ts` | Add banned filter + calorie range filter |
| `app/api/meal-plan/[menuId]/swap/route.ts` | Add mealTypeId + banned ingredient validation |
| `components/meal-plan/DailyMealPlanView.tsx` | 35-day handlers + timeline column layout |

---

## Task 1: Schema — add family + subFamily to Recipe

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: Add fields to Recipe model**

In `prisma/schema.prisma`, add two lines inside the `Recipe` model after the `tags` field:

```prisma
model Recipe {
  id          String   @id @default(cuid())
  name        String
  description String?
  imageUrl    String?
  emoji       String?
  calories    Float?
  protein     Float?
  carbs       Float?
  fat         Float?
  fiber       Float?
  prepTime    Int?
  cookTime    Int?
  servings    Int?     @default(1)
  isPublic    Boolean  @default(true)
  tags        String[]
  family      String?
  subFamily   String?
  dishTypeId  String?
  dishType    DishType?  @relation(fields: [dishTypeId], references: [id])
  mealTypeId  String?
  mealType    MealType?  @relation(fields: [mealTypeId], references: [id])
  ethnicId    String?
  ethnic      Ethnic?    @relation(fields: [ethnicId], references: [id])
  ingredients      RecipeIngredient[]
  menus            Menu[]
  dishPreferences  PatientDishPreference[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 1.2: Run migration**

```bash
npx prisma migrate dev --name add_recipe_family_subfamily
```

Expected output: `The following migration(s) have been created and applied: .../add_recipe_family_subfamily/migration.sql`

- [ ] **Step 1.3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add family and subFamily fields to Recipe"
```

---

## Task 2: Dish type data — rename + add new types

**Files:**
- Modify: `app/api/admin/seed/route.ts`

- [ ] **Step 2.1: Update seed route dish types**

Replace the `dishType.createMany` block in `app/api/admin/seed/route.ts`:

```typescript
// Rename "Main Course" → "Main Dish" if it exists
await prisma.dishType.updateMany({
  where: { name: "Main Course" },
  data: { name: "Main Dish" },
});

await prisma.dishType.createMany({
  data: [
    { name: "Main Dish" },
    { name: "Complete Meal" },
    { name: "Veggie Side Dish" },
    { name: "Fruity Side Dish" },
    { name: "Starchy Side Dish" },
    { name: "Side Dish" },
    { name: "Salad" },
    { name: "Soup" },
    { name: "Dessert" },
    { name: "Beverage" },
    { name: "Bread" },
    { name: "Appetizer" },
  ],
  skipDuplicates: true,
});
```

- [ ] **Step 2.2: Run seed via admin API**

With the dev server running, call:
```
POST /api/admin/seed
```
(Use the admin panel or curl with a valid admin session cookie.)

Expected: `{ "ok": true, "message": "Seed complete" }`

Verify in DB: `SELECT name FROM "DishType" ORDER BY name;` should include "Main Dish", "Complete Meal", "Veggie Side Dish", "Fruity Side Dish", "Starchy Side Dish".

- [ ] **Step 2.3: Commit**

```bash
git add app/api/admin/seed/route.ts
git commit -m "feat: add spec dish types and rename Main Course to Main Dish"
```

---

## Task 3: Types + admin form

**Files:**
- Modify: `types/index.ts`
- Modify: `components/admin/RecipeForm.tsx`

- [ ] **Step 3.1: Add family + subFamily to RecipeDTO**

In `types/index.ts`, add two fields to `RecipeDTO` after the `tags` field:

```typescript
export interface RecipeDTO {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  emoji?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  prepTime?: number | null;
  cookTime?: number | null;
  servings?: number | null;
  tags: string[];
  family?: string | null;
  subFamily?: string | null;
  mealTypeId?: string | null;
  mealType?: { id: string; name: string } | null;
  dishTypeId?: string | null;
  dishType?: { id: string; name: string } | null;
  ethnicId?: string | null;
  ethnic?: { id: string; name: string } | null;
  ingredients: {
    ingredientId: string;
    ingredient: { id: string; name: string; unit?: string | null };
    quantity?: number | null;
    unit?: string | null;
  }[];
}
```

- [ ] **Step 3.2: Add family + subFamily to RecipeForm state and payload**

In `components/admin/RecipeForm.tsx`, extend the `form` state initialiser:

```typescript
const [form, setForm] = useState({
  name: recipe?.name ?? "",
  description: recipe?.description ?? "",
  emoji: recipe?.emoji ?? "",
  calories: String(recipe?.calories ?? ""),
  protein: String(recipe?.protein ?? ""),
  carbs: String(recipe?.carbs ?? ""),
  fat: String(recipe?.fat ?? ""),
  fiber: String(recipe?.fiber ?? ""),
  prepTime: String(recipe?.prepTime ?? ""),
  cookTime: String(recipe?.cookTime ?? ""),
  servings: String(recipe?.servings ?? "1"),
  mealTypeId: recipe?.mealTypeId ?? "",
  dishTypeId: recipe?.dishTypeId ?? "",
  ethnicId: recipe?.ethnicId ?? "",
  family: recipe?.family ?? "",
  subFamily: recipe?.subFamily ?? "",
});
```

Extend the `payload` in `handleSubmit`:

```typescript
const payload = {
  name: form.name,
  description: form.description || null,
  emoji: form.emoji || null,
  calories: form.calories ? parseFloat(form.calories) : null,
  protein: form.protein ? parseFloat(form.protein) : null,
  carbs: form.carbs ? parseFloat(form.carbs) : null,
  fat: form.fat ? parseFloat(form.fat) : null,
  fiber: form.fiber ? parseFloat(form.fiber) : null,
  prepTime: form.prepTime ? parseInt(form.prepTime) : null,
  cookTime: form.cookTime ? parseInt(form.cookTime) : null,
  servings: form.servings ? parseInt(form.servings) : 1,
  mealTypeId: form.mealTypeId || null,
  dishTypeId: form.dishTypeId || null,
  ethnicId: form.ethnicId || null,
  family: form.family || null,
  subFamily: form.subFamily || null,
  ingredients: ingredients
    .filter((i) => i.ingredientId)
    .map((i) => ({
      ingredientId: i.ingredientId,
      quantity: i.quantity ? parseFloat(i.quantity) : null,
      unit: i.unit || null,
    })),
};
```

- [ ] **Step 3.3: Add family + subFamily input fields to RecipeForm JSX**

In the form JSX, add after the `Ethnic Cuisine` Select (inside the `grid sm:grid-cols-2` div):

```tsx
<Input
  label="Family"
  value={form.family}
  onChange={(e) => setForm((f) => ({ ...f, family: e.target.value }))}
  placeholder="e.g. Chicken, Fish, Grain, Salad"
/>

<Input
  label="Sub-family"
  value={form.subFamily}
  onChange={(e) => setForm((f) => ({ ...f, subFamily: e.target.value }))}
  placeholder="e.g. Grilled Chicken, Brown Rice"
/>
```

- [ ] **Step 3.4: Verify admin form works**

Navigate to `/admin/recipes/new`, confirm Family and Sub-family fields render. Create a test recipe with family="Chicken" and subFamily="Grilled Chicken", verify it saves (check the DB or the recipe list).

- [ ] **Step 3.5: Commit**

```bash
git add types/index.ts components/admin/RecipeForm.tsx
git commit -m "feat: add family and subFamily to RecipeDTO and admin RecipeForm"
```

---

## Task 4: Rewrite meal plan generation (`lib/meal-plan.ts`)

**Files:**
- Modify: `lib/meal-plan.ts`

- [ ] **Step 4.1: Replace lib/meal-plan.ts with the new implementation**

Full replacement of `lib/meal-plan.ts`:

```typescript
import { prisma } from "@/lib/db";
import {
  computeAllMetrics,
  type Sex,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mealCaloriesMap(daily: number): Record<string, number> {
  return {
    breakfast: daily * 0.20,
    lunch:     daily * 0.35,
    dinner:    daily * 0.30,
    snack:     daily * 0.15,
  };
}

const MACRO_RATIOS: Record<string, { protein: number; carbs: number; fat: number }> = {
  "Lose weight":     { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Build muscle":    { protein: 0.30, carbs: 0.40, fat: 0.30 },
  "Improve energy":  { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Eat healthier":   { protein: 0.30, carbs: 0.50, fat: 0.20 },
  "Type 2 Diabetes": { protein: 0.35, carbs: 0.45, fat: 0.20 },
  "Diabetes":        { protein: 0.35, carbs: 0.45, fat: 0.20 },
};
const DEFAULT_MACRO_RATIO = { protein: 0.30, carbs: 0.50, fat: 0.20 };

function calcMacroRatio(
  motivationNames: string[],
  conditionNames: string[] = []
): { protein: number; carbs: number; fat: number } {
  const allNames = [...motivationNames, ...conditionNames];
  const active = allNames.filter((m) => MACRO_RATIOS[m]);
  if (active.length === 0) return DEFAULT_MACRO_RATIO;
  const sum = active.reduce(
    (acc, m) => {
      const r = MACRO_RATIOS[m];
      return { protein: acc.protein + r.protein, carbs: acc.carbs + r.carbs, fat: acc.fat + r.fat };
    },
    { protein: 0, carbs: 0, fat: 0 }
  );
  return {
    protein: sum.protein / active.length,
    carbs:   sum.carbs   / active.length,
    fat:     sum.fat     / active.length,
  };
}

function resolveSex(sexAtBirth: string | null | undefined): Sex | null {
  if (sexAtBirth) {
    const s = sexAtBirth.toLowerCase();
    if (s === "male") return "male";
    if (s === "female") return "female";
  }
  return null;
}

type RecipeCandidate = {
  id: string;
  protein:   number | null;
  calories:  number | null;
  carbs:     number | null;
  fiber:     number | null;
  fat:       number | null;
  family:    string | null;
  subFamily: string | null;
  ingredients: { ingredient: { name: string } }[];
};

function pickByMotivation(
  candidates: RecipeCandidate[],
  motivationNames: string[],
  affinityMap: Record<string, number> = {},
  seenIngredientNames: Set<string> = new Set()
): RecipeCandidate {
  if (candidates.length <= 1) return candidates[0] ?? shuffleArray(candidates)[0];

  const hasAffinity = Object.keys(affinityMap).length > 0;

  const scored = candidates.map((r) => {
    let score = 0;
    for (const m of motivationNames) {
      if (m === "Build muscle") score += (r.protein ?? 0) * 2;
      if (m === "Lose weight") {
        score -= (r.fat ?? 0) * 0.8;
        score -= (r.calories ?? 0) * 0.03;
        score += (r.fiber ?? 0) * 2;
      }
      if (m === "Improve energy") {
        score += (r.fiber ?? 0) * 3;
        score += (r.protein ?? 0) * 0.5;
      }
      if (m === "Eat healthier") {
        score += (r.fiber ?? 0) * 2;
        score -= (r.fat ?? 0) * 0.5;
        score += (r.protein ?? 0) * 0.5;
      }
    }
    if (hasAffinity) {
      for (const ri of r.ingredients) {
        score += (affinityMap[ri.ingredient.name.toLowerCase()] ?? 0) * 14;
      }
    }
    if (seenIngredientNames.size > 0 && r.ingredients.length > 0) {
      const unseen = r.ingredients.filter(
        (ri) => !seenIngredientNames.has(ri.ingredient.name.toLowerCase())
      ).length;
      score += (unseen / r.ingredients.length) * 6;
    }
    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return shuffleArray(scored.slice(0, Math.min(3, scored.length)))[0];
}

// Build Prisma filters for family / sub-family exclusion.
// Recipes with null family/subFamily are never blocked.
function buildFamilyFilter(dailyFamilies: Set<string>) {
  if (dailyFamilies.size === 0) return {};
  return {
    OR: [
      { family: null },
      { family: { notIn: Array.from(dailyFamilies) } },
    ],
  };
}

function buildSubFamilyFilter(mealSubFamilies: Set<string>) {
  if (mealSubFamilies.size === 0) return {};
  return {
    OR: [
      { subFamily: null },
      { subFamily: { notIn: Array.from(mealSubFamilies) } },
    ],
  };
}

// Update tracking sets after a recipe is selected.
// Beverages are exempt from the daily family constraint.
function trackChosen(
  recipe: RecipeCandidate,
  isBeverage: boolean,
  dailyFamilies: Set<string>,
  mealSubFamilies: Set<string>,
  usedIds: Set<string>
) {
  usedIds.add(recipe.id);
  if (recipe.family && !isBeverage) dailyFamilies.add(recipe.family);
  if (recipe.subFamily) mealSubFamilies.add(recipe.subFamily);
}

export async function generateMealPlan(
  patientId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  // ── Load patient ───────────────────────────────────────────────────────────
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      physicalActivity: true,
      foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid:      { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences:  { include: { food:      { include: { bannedIngredients: true } } } },
      motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
      dishPreferences:  {
        include: {
          recipe: {
            include: { ingredients: { include: { ingredient: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Phase 0: profile completeness gate
  if (!patient?.profileCompleted) {
    throw new Error("PROFILE_INCOMPLETE");
  }

  // ── Compile banned ingredient names ────────────────────────────────────────
  const allergyNames     = patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  const foodsToAvoidNames = patient.foodToAvoid.map((f) => f.food.name);
  const conditionBanned  = patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name));
  const preferenceBanned = patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name));
  const motivationBanned = patient.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name));

  const allBannedNames = Array.from(new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));

  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);
  const conditionNames  = patient.healthConditions.map((hc) => hc.condition.name);

  // ── Dish Tinder affinity + novelty ─────────────────────────────────────────
  const allDishPrefs    = patient.dishPreferences;
  const likedDishPrefs  = allDishPrefs.filter((dp) => dp.liked);
  const totalLiked      = likedDishPrefs.length;
  const ingredientCount: Record<string, number> = {};
  for (const dp of likedDishPrefs) {
    for (const ri of dp.recipe.ingredients) {
      const n = ri.ingredient.name.toLowerCase();
      ingredientCount[n] = (ingredientCount[n] ?? 0) + 1;
    }
  }
  const affinityMap: Record<string, number> = {};
  if (totalLiked > 0) {
    for (const [n, c] of Object.entries(ingredientCount)) affinityMap[n] = c / totalLiked;
  }
  const seenIngredientNames = new Set<string>();
  for (const dp of allDishPrefs) {
    for (const ri of dp.recipe.ingredients) seenIngredientNames.add(ri.ingredient.name.toLowerCase());
  }

  // ── Caloric engine ─────────────────────────────────────────────────────────
  let caloriePlan: Record<string, number> | null = null;
  let dailyCals = 0;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth);
    if (sex) {
      const profileInput: CaloricProfileInput = {
        sex,
        birthday:    new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit:  patient.heightUnit === "in" ? "in" : "cm",
        cbwValue:    patient.weight,
        cbwUnit:     (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue:   patient.goalWeight,
        utbwUnit:    (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      const profile = computeAllMetrics(profileInput);
      dailyCals   = Math.round(profile.dailyCalories);
      caloriePlan = mealCaloriesMap(dailyCals);
    }
  }

  let dailyMacros: { proteinG: number; carbsG: number; fatG: number } | null = null;
  if (dailyCals > 0) {
    const ratio = calcMacroRatio(motivationNames, conditionNames);
    dailyMacros = {
      proteinG: (ratio.protein * dailyCals) / 4,
      carbsG:   (ratio.carbs   * dailyCals) / 4,
      fatG:     (ratio.fat     * dailyCals) / 9,
    };
  }

  const mealTypes = await prisma.mealType.findMany();

  // ── Clear existing menus for range ─────────────────────────────────────────
  await prisma.menu.deleteMany({
    where: { patientId, date: { gte: startDate, lte: endDate } },
  });

  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];
  const usedIds = new Set<string>();

  // ── Shared query fragments ─────────────────────────────────────────────────
  const hasContentFilter = {
    ingredients: { some: {} },
    description: { not: null },
  };

  const bannedFilter =
    allBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: allBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const recipeSelect = {
    id: true, protein: true, calories: true, carbs: true, fiber: true, fat: true,
    family: true, subFamily: true,
    ingredients: { select: { ingredient: { select: { name: true } } } },
  };

  const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? mealTypes[mealTypes.length - 1];

  // ── Main generation loop ───────────────────────────────────────────────────
  const current = new Date(startDate);
  while (current <= endDate) {
    let dayCalories  = 0;
    const dailyFamilies = new Set<string>(); // family values used today

    for (const mealType of mealTypes) {
      const mealNameLower = mealType.name.toLowerCase();
      const target        = caloriePlan ? (caloriePlan[mealNameLower] ?? null) : null;
      const mealSubFamilies = new Set<string>(); // sub-families used in this meal slot

      const usedFilter     = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
      const familyFilter   = buildFamilyFilter(dailyFamilies);
      const subFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

      const baseWhere = {
        mealTypeId: mealType.id,
        isPublic: true,
        ...hasContentFilter,
        ...usedFilter,
        ...bannedFilter,
        ...familyFilter,
        ...subFamilyFilter,
      };

      // ── Step A: Complete Meal ──────────────────────────────────────────────
      const completeCandidates = await prisma.recipe.findMany({
        where: {
          ...baseWhere,
          dishType: { name: "Complete Meal" },
          ...(target ? { calories: { gte: target - 250, lte: target + 250 } } : {}),
        },
        select: recipeSelect,
      });

      if (completeCandidates.length > 0) {
        const chosen = pickByMotivation(completeCandidates, motivationNames, affinityMap, seenIngredientNames);
        trackChosen(chosen, false, dailyFamilies, mealSubFamilies, usedIds);
        dayCalories += chosen.calories ?? 0;
        menus.push({ patientId, recipeId: chosen.id, mealTypeId: mealType.id, date: new Date(current) });
        continue; // Complete meal covers all slots for this meal type
      }

      // ── Step B: Main Dish ──────────────────────────────────────────────────
      const mainTarget = target !== null
        ? (mealNameLower === "lunch" || mealNameLower === "dinner" ? target * 0.75 : target)
        : null;

      let mainChosen: RecipeCandidate | undefined;

      // Primary: calorie-targeted
      if (mainTarget !== null) {
        const mainCandidates = await prisma.recipe.findMany({
          where: {
            ...baseWhere,
            dishType: { name: { in: ["Main Dish", "Main Course"] } },
            calories: { gte: mainTarget - 250, lte: mainTarget + 250 },
          },
          select: recipeSelect,
        });
        if (mainCandidates.length > 0) {
          mainChosen = pickByMotivation(mainCandidates, motivationNames, affinityMap, seenIngredientNames);
        }
      }

      // Fallback 1: no calorie restriction
      if (!mainChosen) {
        const fallback1 = await prisma.recipe.findMany({
          where: {
            ...baseWhere,
            dishType: { name: { in: ["Main Dish", "Main Course"] } },
          },
          select: recipeSelect,
        });
        if (fallback1.length > 0) mainChosen = pickByMotivation(fallback1, motivationNames, affinityMap, seenIngredientNames);
      }

      // Fallback 2: any recipe for this meal type
      if (!mainChosen) {
        const fallback2 = await prisma.recipe.findFirst({
          where: { mealTypeId: mealType.id, isPublic: true, ...hasContentFilter },
          select: recipeSelect,
        });
        if (fallback2) mainChosen = fallback2;
      }

      if (!mainChosen) continue;

      trackChosen(mainChosen, false, dailyFamilies, mealSubFamilies, usedIds);
      dayCalories += mainChosen.calories ?? 0;
      menus.push({ patientId, recipeId: mainChosen.id, mealTypeId: mealType.id, date: new Date(current) });

      // ── Step C: Side dishes (lunch and dinner only) ────────────────────────
      const needsSides = dailyMacros !== null && target !== null &&
        (mealNameLower === "lunch" || mealNameLower === "dinner");

      if (needsSides && dailyMacros) {
        const mealShare       = target! / dailyCals;
        const mealProteinTarget = dailyMacros.proteinG * mealShare;
        const mealCarbsTarget   = dailyMacros.carbsG   * mealShare;
        const mealFatTarget     = dailyMacros.fatG      * mealShare;

        const proteinGap = Math.max(0, mealProteinTarget - (mainChosen.protein ?? 0));
        const carbsGap   = Math.max(0, mealCarbsTarget   - (mainChosen.carbs   ?? 0));
        const fatGap     = Math.max(0, mealFatTarget      - (mainChosen.fat     ?? 0));

        const sideCalBudget = target! * 0.25;

        // Helper: pick one side dish of a given dish type name
        const pickSide = async (dishTypeName: string, scoreByGap: (r: RecipeCandidate) => number) => {
          // Rebuild filters with updated tracking sets after main was added
          const sideUsedFilter     = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
          const sideFamilyFilter   = buildFamilyFilter(dailyFamilies);
          const sideSubFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

          const sideCandidates = await prisma.recipe.findMany({
            where: {
              isPublic: true,
              dishType: { name: dishTypeName },
              calories: { gte: sideCalBudget * 0.5, lte: sideCalBudget * 1.5 },
              ...hasContentFilter,
              ...sideUsedFilter,
              ...bannedFilter,
              ...sideFamilyFilter,
              ...sideSubFamilyFilter,
            },
            select: recipeSelect,
          });
          if (sideCandidates.length === 0) return;

          const scored = sideCandidates.map((r) => ({ ...r, _score: scoreByGap(r) }));
          scored.sort((a, b) => b._score - a._score);
          const side = shuffleArray(scored.slice(0, 3))[0];

          trackChosen(side, false, dailyFamilies, mealSubFamilies, usedIds);
          dayCalories += side.calories ?? 0;
          menus.push({ patientId, recipeId: side.id, mealTypeId: mealType.id, date: new Date(current) });
        };

        // Veggie side: score by protein gap
        await pickSide("Veggie Side Dish", (r) =>
          -(Math.abs((r.protein ?? 0) - proteinGap) + Math.abs((r.fat ?? 0) - fatGap))
        );

        // Starchy side: score by carbs gap
        await pickSide("Starchy Side Dish", (r) =>
          -(Math.abs((r.carbs ?? 0) - carbsGap) + Math.abs((r.fat ?? 0) - fatGap))
        );

        // Fruity side: only if still short on calories after the first two sides
        const calRemaining = (target! - dayCalories % (target! + 1));
        if (calRemaining > sideCalBudget * 0.4) {
          await pickSide("Fruity Side Dish", (r) => -(Math.abs((r.calories ?? 0) - calRemaining)));
        }
      }

      // ── Step D: Dessert (lunch = biggest meal) ─────────────────────────────
      if (mealNameLower === "lunch" && target !== null && !dailyFamilies.has("dessert")) {
        const dessertUsedFilter     = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
        const dessertFamilyFilter   = buildFamilyFilter(dailyFamilies);
        const dessertSubFamilyFilter = buildSubFamilyFilter(mealSubFamilies);

        const dessertBudget = target * 0.15; // ~15% of lunch for dessert
        const dessertCandidates = await prisma.recipe.findMany({
          where: {
            isPublic: true,
            dishType: { name: "Dessert" },
            calories: { gte: dessertBudget * 0.5, lte: dessertBudget * 1.5 },
            ...hasContentFilter,
            ...dessertUsedFilter,
            ...bannedFilter,
            ...dessertFamilyFilter,
            ...dessertSubFamilyFilter,
          },
          select: recipeSelect,
        });

        if (dessertCandidates.length > 0) {
          const dessert = pickByMotivation(dessertCandidates, motivationNames, affinityMap, seenIngredientNames);
          trackChosen(dessert, false, dailyFamilies, mealSubFamilies, usedIds);
          dayCalories += dessert.calories ?? 0;
          menus.push({ patientId, recipeId: dessert.id, mealTypeId: mealType.id, date: new Date(current) });
        }
      }
    }

    // ── Calorie top-up ─────────────────────────────────────────────────────
    if (snackMealType && dailyCals > 0 && dayCalories < dailyCals * 0.9) {
      let extraCount = 0;
      const MAX_EXTRA = 4;
      while (dayCalories < dailyCals * 0.9 && extraCount < MAX_EXTRA) {
        const calGap         = dailyCals - dayCalories;
        const extraUsedFilter = usedIds.size > 0 ? { id: { notIn: Array.from(usedIds) } } : {};
        const extraCandidates = await prisma.recipe.findMany({
          where: {
            isPublic: true,
            calories: { gte: Math.round(calGap * 0.25), lte: Math.round(calGap) },
            ...hasContentFilter,
            ...extraUsedFilter,
            ...bannedFilter,
          },
          select: recipeSelect,
        });
        if (extraCandidates.length === 0) break;
        const extra = pickByMotivation(extraCandidates, motivationNames, affinityMap, seenIngredientNames);
        dayCalories += extra.calories ?? 0;
        extraCount++;
        usedIds.add(extra.id);
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current) });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }
  return menus.length;
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add lib/meal-plan.ts
git commit -m "feat: rewrite meal plan generation with family tracking and meal assembly hierarchy"
```

---

## Task 5: API route fixes

**Files:**
- Modify: `app/api/meal-plan/route.ts`
- Modify: `app/api/meal-plan/alternatives/route.ts`
- Modify: `app/api/meal-plan/[menuId]/swap/route.ts`

- [ ] **Step 5.1: Raise cap to 35 days and add profile gate (POST /api/meal-plan)**

In `app/api/meal-plan/route.ts`, update the `POST` handler:

```typescript
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account.subscription;
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Profile completeness gate — must complete health profile + Dish Tinder first
  if (!patient.profileCompleted) {
    return NextResponse.json({ error: "Profile not complete" }, { status: 422 });
  }

  const { startDate, endDate } = await req.json();
  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const daysDiff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0 || daysDiff > 35) {
    return NextResponse.json({ error: "Date range must be between 1 and 35 days" }, { status: 400 });
  }

  const count = await generateMealPlan(patient.id, start, end);
  return NextResponse.json({ ok: true, count });
}
```

- [ ] **Step 5.2: Fix alternatives endpoint**

Replace `app/api/meal-plan/alternatives/route.ts` entirely:

```typescript
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const mealTypeId      = searchParams.get("mealTypeId");
  const excludeRecipeId = searchParams.get("excludeRecipeId");
  const currentCalories = parseFloat(searchParams.get("currentCalories") ?? "0");

  if (!mealTypeId) {
    return NextResponse.json({ error: "mealTypeId required" }, { status: 400 });
  }

  // Load patient to build banned filter (same as generation)
  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid:      { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
      motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
    },
  });

  const allergyNames     = patient?.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]) ?? [];
  const foodsToAvoidNames = patient?.foodToAvoid.map((f) => f.food.name) ?? [];
  const conditionBanned  = patient?.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name)) ?? [];
  const preferenceBanned = patient?.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name)) ?? [];
  const motivationBanned = patient?.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name)) ?? [];

  const allBannedNames = Array.from(new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ]));

  const bannedFilter =
    allBannedNames.length > 0
      ? { NOT: { ingredients: { some: { ingredient: { name: { in: allBannedNames, mode: "insensitive" as const } } } } } }
      : {};

  const calorieFilter = currentCalories > 0
    ? { calories: { gte: currentCalories - 250, lte: currentCalories + 250 } }
    : {};

  const alternatives = await prisma.recipe.findMany({
    where: {
      mealTypeId,
      isPublic: true,
      ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {}),
      ...bannedFilter,
      ...calorieFilter,
    },
    take: 3,
    orderBy: { createdAt: "desc" },
    include: { mealType: true, dishType: true, ingredients: { include: { ingredient: true } } },
  });

  return NextResponse.json({ alternatives });
}
```

- [ ] **Step 5.3: Fix swap endpoint**

Replace `app/api/meal-plan/[menuId]/swap/route.ts` entirely:

```typescript
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { recipeId } = await req.json();

  // Load patient with banned ingredients
  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      foodAllergies:    { include: { food: { include: { bannedIngredients: true } } } },
      foodToAvoid:      { include: { food: true } },
      healthConditions: { include: { condition: { include: { bannedIngredients: true } } } },
      foodPreferences:  { include: { food: { include: { bannedIngredients: true } } } },
      motivations:      { include: { motivation: { include: { bannedIngredients: true } } } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Verify the menu entry belongs to this patient
  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id },
  });
  if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 });

  // Verify the new recipe exists and has the correct meal type
  const newRecipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: { include: { ingredient: true } } },
  });
  if (!newRecipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  if (menu.mealTypeId && newRecipe.mealTypeId !== menu.mealTypeId) {
    return NextResponse.json({ error: "Recipe not suitable for this meal slot" }, { status: 400 });
  }

  // Verify no banned ingredients
  const allergyNames     = patient.foodAllergies.flatMap((a) => [a.food.name, ...a.food.bannedIngredients.map((b) => b.name)]);
  const foodsToAvoidNames = patient.foodToAvoid.map((f) => f.food.name);
  const conditionBanned  = patient.healthConditions.flatMap((hc) => hc.condition.bannedIngredients.map((b) => b.name));
  const preferenceBanned = patient.foodPreferences.flatMap((fp) => fp.food.bannedIngredients.map((b) => b.name));
  const motivationBanned = patient.motivations.flatMap((pm) => pm.motivation.bannedIngredients.map((b) => b.name));
  const allBannedNames   = new Set([
    ...allergyNames, ...foodsToAvoidNames,
    ...conditionBanned, ...preferenceBanned, ...motivationBanned,
  ].map((n) => n.toLowerCase()));

  const recipeIngredientNames = newRecipe.ingredients.map((ri) => ri.ingredient.name.toLowerCase());
  const hasBanned = recipeIngredientNames.some((n) => allBannedNames.has(n));
  if (hasBanned) {
    return NextResponse.json({ error: "Recipe contains ingredients you cannot eat" }, { status: 400 });
  }

  const updated = await prisma.menu.update({
    where: { id: params.menuId },
    data: { recipeId },
    include: { recipe: { include: { mealType: true, dishType: true } }, mealType: true },
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 5.4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.5: Commit**

```bash
git add app/api/meal-plan/route.ts app/api/meal-plan/alternatives/route.ts "app/api/meal-plan/[menuId]/swap/route.ts"
git commit -m "feat: raise plan cap to 35 days, add profile gate, fix alternatives and swap validation"
```

---

## Task 6: Frontend — 35-day generation + nav changes

**Files:**
- Modify: `components/meal-plan/DailyMealPlanView.tsx`
- Modify: `components/meal-plan/SwapMealModal.tsx`

- [ ] **Step 6.1: Update SwapMealModal to pass currentCalories**

In `components/meal-plan/SwapMealModal.tsx`, the `SwapMealModalProps` interface and the fetch call need to pass the current recipe's calories so the alternatives endpoint can apply the calorie filter.

Update the interface:

```typescript
interface SwapMealModalProps {
  open: boolean;
  onClose: () => void;
  menuId: string;
  mealTypeId: string;
  currentRecipeId: string;
  currentCalories?: number | null;
  onSwapped: (menuId: string, newRecipe: RecipeDTO) => void;
}
```

Update the fetch in `useEffect`:

```typescript
useEffect(() => {
  if (!open || !mealTypeId) return;
  setLoading(true);
  const calories = currentCalories ?? 0;
  fetch(
    `/api/meal-plan/alternatives?mealTypeId=${mealTypeId}&excludeRecipeId=${currentRecipeId}&currentCalories=${calories}`
  )
    .then((r) => r.json())
    .then((d) => setAlternatives(d.alternatives ?? []))
    .finally(() => setLoading(false));
}, [open, mealTypeId, currentRecipeId, currentCalories]);
```

- [ ] **Step 6.2: Update DailyMealPlanView — state and handlers**

The following changes go into `components/meal-plan/DailyMealPlanView.tsx`. Replace the state and all handler functions at the top of the `DailyMealPlanView` component:

```typescript
// Add profileIncomplete to state declarations
const [profileIncomplete, setProfileIncomplete] = useState(false);

// Replace handleSetStartDate
const handleSetStartDate = async () => {
  setSettingStart(true);
  setProfileIncomplete(false);
  try {
    const res = await fetch("/api/meal-plan/start-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: format(new Date(), "yyyy-MM-dd") }),
    });
    const data = await res.json();
    const newStartDate = new Date(data.startDate);
    setStartDate(newStartDate);

    // Generate full 35-day plan from start date
    const startStr = format(newStartDate, "yyyy-MM-dd");
    const endStr   = format(addDays(newStartDate, 34), "yyyy-MM-dd");
    const genRes = await fetch("/api/meal-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: startStr, endDate: endStr }),
    });
    if (!genRes.ok) {
      const err = await genRes.json();
      if (err.error === "Profile not complete") { setProfileIncomplete(true); return; }
    }

    const mRes = await fetch(`/api/meal-plan?date=${format(new Date(), "yyyy-MM-dd")}`);
    const mData = await mRes.json();
    setMenus(mData.menus ?? []);
    setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
    setMealRatings(mData.mealRatings ?? {});
  } finally {
    setSettingStart(false);
  }
};

// Replace handleRegenerate
const handleRegenerate = async () => {
  if (!startDate) return;
  setRegenerating(true);
  setSelectedId(null);
  setProfileIncomplete(false);
  try {
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr   = format(addDays(startDate, 34), "yyyy-MM-dd");
    const genRes = await fetch("/api/meal-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: startStr, endDate: endStr }),
    });
    if (!genRes.ok) {
      const err = await genRes.json();
      if (err.error === "Profile not complete") { setProfileIncomplete(true); return; }
    }
    const dateStr = format(date, "yyyy-MM-dd");
    const res = await fetch(`/api/meal-plan?date=${dateStr}`);
    const data = await res.json();
    setMenus(data.menus ?? []);
    setLoggedRecipeIds(data.loggedRecipeIds ?? []);
    setMealRatings(data.mealRatings ?? {});
  } finally {
    setRegenerating(false);
  }
};

// Replace navigate — remove the auto-generation block
const navigate = async (dir: "prev" | "next") => {
  setSelectedId(null);
  const newDate  = dir === "next" ? addDays(date, 1) : subDays(date, 1);
  const dateStr  = format(newDate, "yyyy-MM-dd");
  setDate(newDate);
  setLoading(true);
  try {
    const res  = await fetch(`/api/meal-plan?date=${dateStr}`);
    const data = await res.json();
    setMenus(data.menus ?? []);
    setLoggedRecipeIds(data.loggedRecipeIds ?? []);
    setMealRatings(data.mealRatings ?? {});
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 6.3: Add profile-incomplete banner to JSX**

In the JSX, directly before the `{!startDate && (...)}` block, add:

```tsx
{profileIncomplete && (
  <div className="bg-error/10 border border-error/20 rounded-2xl p-4 mb-4 text-sm text-error">
    Complete your health profile before generating a meal plan.{" "}
    <a href="/profile" className="underline font-semibold">Go to Profile →</a>
  </div>
)}
```

- [ ] **Step 6.4: Verify handlers work**

Start dev server (`npm run dev`). Navigate to the meal plan page. Confirm:
- "Start Meal Plan Today" generates and shows today's meals
- "Regenerate" button rebuilds from plan start (check the date range in Network tab — should be 35 days)
- Navigating forward/back doesn't trigger a POST to `/api/meal-plan`

- [ ] **Step 6.5: Commit**

```bash
git add components/meal-plan/DailyMealPlanView.tsx components/meal-plan/SwapMealModal.tsx
git commit -m "feat: 35-day plan generation, remove auto-generate on navigate, add profile gate banner"
```

---

## Task 7: Timeline layout (`DailyMealPlanView.tsx`)

**Files:**
- Modify: `components/meal-plan/DailyMealPlanView.tsx`

This task replaces the flat card grid and `CaloriesMeter` with the timeline column layout. The `ExpandedRecipe` component and `SwapMealModal` are unchanged.

- [ ] **Step 7.1: Add helper functions at the top of the file (after imports)**

```typescript
// Meal display order and time labels
const MEAL_ORDER = ["Breakfast", "Lunch", "Snack", "Dinner"] as const;
const MEAL_TIMES: Record<string, string> = {
  Breakfast: "8am",
  Lunch:     "12pm",
  Snack:     "3pm",
  Dinner:    "7pm",
};

// Map dishType name to a role badge {label, bg, text}
function roleBadge(dishTypeName?: string | null): { label: string; bg: string; text: string } | null {
  const n = (dishTypeName ?? "").toLowerCase();
  if (n === "complete meal")    return { label: "Complete meal", bg: "bg-[#dcfce7]", text: "text-[#15803d]" };
  if (n === "veggie side dish") return { label: "Veggie side",   bg: "bg-[#d1fae5]", text: "text-[#059669]" };
  if (n === "starchy side dish")return { label: "Starchy side",  bg: "bg-[#fef3c7]", text: "text-[#b45309]" };
  if (n === "fruity side dish") return { label: "Fruity side",   bg: "bg-[#fef9c3]", text: "text-[#a16207]" };
  if (n === "dessert")          return { label: "Dessert",        bg: "bg-[#fce7f3]", text: "text-[#be185d]" };
  if (n === "beverage")         return { label: "Beverage",       bg: "bg-[#eff6ff]", text: "text-[#1d4ed8]" };
  if (n === "main dish" || n === "main course" || n === "side dish" || n === "salad" || n === "soup")
    return { label: "Main", bg: "bg-[#dcfce7]", text: "text-[#15803d]" };
  return null;
}
```

- [ ] **Step 7.2: Replace CaloriesMeter with CaloriePill**

Remove the entire `CaloriesMeter` component. Add this smaller component in its place:

```typescript
function CaloriePill({
  total,
  completed,
}: {
  total: number;
  completed: number;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-[#c8e6cc] rounded-full px-3 py-1.5">
      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      <span className="text-[10px] font-bold text-forest">{Math.round(completed)}</span>
      <span className="text-[10px] text-[#5a7a5d]">/ {Math.round(total)} kcal</span>
    </div>
  );
}
```

- [ ] **Step 7.3: Replace the grid layout with the timeline in the component body**

Remove the `mainDishMenus` / `sideDishMenus` variables and replace the non-expanded layout JSX section.

First remove these derived variables (no longer needed):
```typescript
// DELETE these two:
const mainDishMenus = menus.filter(...)
const sideDishMenus = menus.filter(...)
```

Add the meal groups variable instead:
```typescript
const mealGroups = MEAL_ORDER
  .map((name) => ({
    name,
    time: MEAL_TIMES[name] ?? "",
    isLunch: name === "Lunch",
    dishes: menus.filter((m) => m.mealType?.name === name),
  }))
  .filter((g) => g.dishes.length > 0);
```

Replace the date-nav row with calorie pill:
```tsx
{/* Date nav */}
<div className="flex items-center gap-4 mb-6">
  <button onClick={() => navigate("prev")} className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest">‹</button>
  <p className="font-semibold text-forest text-lg">{format(date, "EEEE, MMMM d")}</p>
  <button onClick={() => navigate("next")} className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest">›</button>
  <div className="ml-auto">
    {menus.length > 0 && (
      <CaloriePill total={totalCalories} completed={completedCalories} />
    )}
  </div>
</div>
```

Replace the grid layout (non-expanded state) with the timeline:

```tsx
{/* ── Timeline layout (non-expanded) ── */}
<motion.div
  key="grid"
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.2 }}
>
  <div
    className="grid gap-0"
    style={{ gridTemplateColumns: "40px 24px 1fr" }}
  >
    {mealGroups.map((group, idx) => {
      const isLast = idx === mealGroups.length - 1;
      return (
        <React.Fragment key={group.name}>
          {/* Time label */}
          <div className="text-right pr-1 pt-[10px]">
            <span className="text-[9px] font-semibold text-[#86a98a]">{group.time}</span>
          </div>

          {/* Spine */}
          <div className="flex flex-col items-center">
            <div
              className="mt-[10px] w-2.5 h-2.5 rounded-full bg-primary border-2 border-white shrink-0 z-10"
              style={{ boxShadow: "0 0 0 1px #4ade80" }}
            />
            {!isLast && <div className="flex-1 w-0.5 bg-gradient-to-b from-primary to-primary-light" />}
          </div>

          {/* Meal card */}
          <div className={`pl-2 ${isLast ? "pb-0" : "pb-2.5"}`}>
            <div
              className={
                group.isLunch
                  ? "bg-white border-[1.5px] border-primary rounded-xl overflow-hidden shadow-[0_2px_14px_rgba(74,222,128,.12)]"
                  : "bg-white border border-[#c8e6cc] rounded-xl overflow-hidden"
              }
            >
              {/* Card header */}
              <div
                className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#e8f5e9] ${
                  group.isLunch ? "bg-[#f0fdf4]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-primary uppercase tracking-[.08em]">
                    {group.name}
                  </span>
                  {group.isLunch && (
                    <span className="text-[8px] font-bold bg-primary text-forest px-1.5 py-0.5 rounded-full">
                      Biggest meal
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-[#5a7a5d]">
                  {Math.round(group.dishes.reduce((s, m) => s + (m.recipe.calories ?? 0), 0))} kcal
                </span>
              </div>

              {/* Dish rows */}
              <div className="px-3.5 py-2.5 flex flex-col">
                {group.dishes.map((menu, dIdx) => {
                  const badge = roleBadge(menu.recipe.dishType?.name);
                  const isCompleted = loggedSet.has(menu.recipe.id);
                  const isMainDish = dIdx === 0;
                  return (
                    <React.Fragment key={menu.id}>
                      {dIdx > 0 && <div className="h-px bg-[#e8f5e9] my-2" />}
                      <div
                        className="flex items-center justify-between gap-2 cursor-pointer group"
                        onClick={() => setSelectedId(menu.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-forest truncate ${isMainDish ? "text-[11px] font-semibold" : "text-[10px] font-medium"}`}>
                            {menu.recipe.name}
                            {isCompleted && <span className="ml-1.5 text-primary text-[9px] font-bold">✓</span>}
                          </p>
                          <p className="text-[9px] text-[#5a7a5d] mt-0.5">
                            {[
                              menu.recipe.calories ? `${menu.recipe.calories} kcal` : null,
                              menu.recipe.protein  ? `${menu.recipe.protein}g protein` : null,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {badge && (
                            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          )}
                          <button
                            className="w-[22px] h-[22px] border border-[#c8e6cc] rounded-md flex items-center justify-center text-[#5a7a5d] text-[9px] hover:bg-[#f0fdf4] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwapModal({ menuId: menu.id, mealTypeId: menu.mealTypeId ?? "", recipeId: menu.recipe.id, calories: menu.recipe.calories ?? 0 });
                            }}
                          >
                            ↔
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </React.Fragment>
      );
    })}
  </div>
</motion.div>
```

- [ ] **Step 7.4: Update swapModal state to include calories**

Change the `swapModal` state type:

```typescript
const [swapModal, setSwapModal] = useState<{
  menuId: string;
  mealTypeId: string;
  recipeId: string;
  calories: number;
} | null>(null);
```

Pass `calories` to `SwapMealModal`:

```tsx
{swapModal && (
  <SwapMealModal
    open={!!swapModal}
    onClose={() => setSwapModal(null)}
    menuId={swapModal.menuId}
    mealTypeId={swapModal.mealTypeId}
    currentRecipeId={swapModal.recipeId}
    currentCalories={swapModal.calories}
    onSwapped={handleSwapped}
  />
)}
```

- [ ] **Step 7.5: Add React import if missing**

The `React.Fragment` syntax requires React to be in scope. At the top of `DailyMealPlanView.tsx`:

```typescript
import React, { useState } from "react";
```

- [ ] **Step 7.6: Remove CaloriesMeter from the expanded layout**

In the expanded state JSX, remove the `<CaloriesMeter ... />` component (it no longer exists). The calorie pill in the date nav replaces it.

Also remove these lines from the expanded state wrapper (they no longer apply):
```tsx
// DELETE: className="flex gap-5 items-start"  (outer flex wrapper)
// DELETE: {/* Calories meter */} <CaloriesMeter ... />
```

The expanded state should render `ExpandedRecipe` + sidebar without a separate calorie column.

- [ ] **Step 7.7: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.8: Visual check in browser**

Start dev server. Navigate to the meal plan. Confirm:
- Timeline shows Breakfast, Lunch, Snack, Dinner in order with time labels (8am, 12pm, 3pm, 7pm) in muted grey
- Green dot-and-line spine connects all meals, stopping at the bottom of Dinner
- Lunch card has green border and "Biggest meal" badge
- Dish rows show role badges (Main, Veggie side, Starchy side, Dessert)
- Each dish row has a `↔` swap button
- Clicking a dish row opens the ExpandedRecipe panel
- Calorie pill shows in top-right of date nav

- [ ] **Step 7.9: Commit**

```bash
git add components/meal-plan/DailyMealPlanView.tsx
git commit -m "feat: replace card grid with timeline column layout in daily meal plan view"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| DB: family + subFamily fields | Task 1 |
| DB: dish type rename + new types | Task 2 |
| Admin RecipeForm: family + subFamily inputs | Task 3 |
| Profile completeness gate | Task 4 (generateMealPlan) + Task 5 (API route) |
| 35-day plan length | Task 5 (cap) + Task 6 (handlers) |
| Complete Meal → Main Dish assembly hierarchy | Task 4 |
| Side dishes (Veggie, Starchy, Fruity) | Task 4 |
| Dessert on lunch | Task 4 |
| Daily family tracking (no repeat per day) | Task 4 |
| Per-meal sub-family tracking | Task 4 |
| Beverage family exemption | Task 4 (trackChosen isBeverage flag) |
| Swap alternatives: banned filter + calorie range | Task 5 |
| Swap confirmation: mealType + banned validation | Task 5 |
| Remove auto-generation on navigate | Task 6 |
| Profile gate banner (422 → UI message) | Task 6 |
| Timeline column layout | Task 7 |
| Role badges (Main, Veggie side, etc.) | Task 7 |
| Muted time labels (v3 style) | Task 7 |
| Calorie pill replaces vertical meter | Task 7 |
| Lunch highlighted as biggest meal | Task 7 |
| Swap button per dish row | Task 7 |

All spec requirements are covered. No gaps found.
