# Meal Plan — Missing Features Design

**Date:** 2026-05-23  
**Author:** Brainstorming session (Dr. Cardona spec compliance)

---

## Scope

Implement the six gaps identified between the current meal plan generation logic and Dr. Cardona's spec, plus a redesigned daily view layout.

---

## 1. Data Layer

### 1a. Dish type changes (DB migration)
- Rename `Main Course` → `Main Dish`
- Add: `Complete Meal`, `Veggie Side Dish`, `Fruity Side Dish`, `Starchy Side Dish`
- Keep existing: `Side Dish`, `Salad`, `Soup`, `Dessert`, `Beverage`, `Bread`, `Appetizer` (legacy, still selectable in admin)
- Update seed route to reflect new names

### 1b. New Recipe fields (DB migration)
```prisma
family    String?   // e.g. "Chicken", "Fish", "Beef", "Grain", "Salad", "Dairy", "Fruit"
subFamily String?   // e.g. "Grilled Chicken", "Brown Rice", "Garden Salad"
```
Both nullable — existing recipes are unaffected. Admins tag them over time.

### 1c. Admin RecipeForm
Add `family` and `subFamily` text inputs to the recipe edit/create form.

---

## 2. Generation Logic (`lib/meal-plan.ts`)

### 2a. Profile completeness gate
First line of `generateMealPlan()`: if `patient.profileCompleted === false`, throw an error. API surfaces this as 422.

### 2b. Plan length
- Raise API cap from 14 → 35 days
- `handleSetStartDate` (frontend) generates 35 days upfront
- `handleRegenerate` regenerates all 35 days from plan start date

### 2c. Per-day tracking
Each day initialises:
- `dailyFamilies: Set<string>` — `family` values used today (prevents family repeats across the whole day)
- Exception: recipes with `dishType = "Beverage"` are exempt from `dailyFamilies`

### 2d. Per-meal assembly (for each meal slot)
Each meal initialises:
- `mealSubFamilies: Set<string>` — `subFamily` values used in this meal slot (prevents sub-family repeats within one sitting)

**Step A — Complete Meal search:**
Query: `dishType = "Complete Meal"`, mealType matches, calories in target range, not banned, not in `usedIds`, `family` not in `dailyFamilies`, `subFamily` not in `mealSubFamilies`.  
If found → pick via `pickByMotivation`, update tracking sets, skip Step B.

**Step B — Main Dish search (fallback):**
Same constraints, `dishType IN ["Main Dish", "Main Course"]` (backward compat alias). Pick one.

**Step C — Side dishes (lunch & dinner only):**
After main is placed, fill remaining calorie/macro budget with up to one of each:
- `Veggie Side Dish` — scored by protein gap; must pass family + sub-family checks
- `Starchy Side Dish` — scored by carbs gap; same checks
- `Fruity Side Dish` — optional; only if calories still short after first two

**Step D — Dessert (lunch only, 35% meal):**
If day calories still below target after lunch is assembled, add one `Dessert` dish. Family tracking applies (only one dessert per day).

**Beverage exception:**
Recipes with `dishType = "Beverage"` never write to `dailyFamilies`. They remain available in the calorie top-up pool.

**`usedIds`** remains unchanged — no recipe repeats across the entire 35-day plan.

---

## 3. API Changes

| Endpoint | Change |
|---|---|
| `POST /api/meal-plan` | Raise cap to 35 days; return 422 if `profileCompleted = false` |
| `GET /api/meal-plan/alternatives` | Apply full `bannedFilter`; filter by calories ±250 of current recipe |
| `PATCH /api/meal-plan/[menuId]/swap` | Validate: same `mealTypeId`, no banned ingredients; return 400 if either fails |

---

## 4. Frontend Changes

### 4a. Generation
- `handleSetStartDate`: after setting start date, fire `POST /api/meal-plan` for 35 days (today → today + 34)
- `handleRegenerate`: rebuild full 35-day plan from plan start date (not 7 days from current date)

### 4b. Navigation
- Remove the auto-generation block (`fetched.length === 0 && dir === "next"`)
- Empty day outside plan window → show existing empty state + note: *"This day is outside your current plan."*

### 4c. Profile gate UI
- If `POST /api/meal-plan` returns 422 → show banner: *"Complete your health profile to generate a meal plan."* with link to `/profile`

---

## 5. Daily View Layout Redesign (`DailyMealPlanView.tsx`)

### Layout: Timeline Column
Replace the current 2-column card grid with a vertical timeline. See mockup v3.

**Structure:**
```
[date nav]          [calorie pill]
─────────────────────────────────
8am  ●──  [ Breakfast card      ]
     │
12pm ●──  [ Lunch card          ]  ← green border, "Biggest meal" badge
     │       Main dish row
     │       ─────────────
     │       Veggie side row
     │       ─────────────
     │       Dessert row
     │
3pm  ●──  [ Snack card          ]
     │
7pm  ●──  [ Dinner card         ]
            Main dish row
            ─────────────
            Starchy side row
```

**Time spine:** small muted grey text (`9px / 600 weight / #86a98a`) — v3 style (no pills/borders). A continuous `2px` green-gradient line connects all dots top-to-bottom.

**Meal cards:** white bg, `1px solid #c8e6cc` border, `12px` radius.  
**Lunch card:** `1.5px solid #4ade80` border, subtle green glow shadow, `#f0fdf4` header background.

**Dish role badges (pill, right-aligned per row):**
| Role | Background | Text |
|---|---|---|
| Main | `#dcfce7` | `#15803d` |
| Veggie side | `#d1fae5` | `#059669` |
| Starchy side | `#fef3c7` | `#b45309` |
| Fruity side | `#fef9c3` | `#a16207` |
| Dessert | `#fce7f3` | `#be185d` |

**Swap button:** `22×22px`, `1px solid #c8e6cc`, `6px` radius, `↔` icon — one per dish row.

**Calorie pill:** replaces vertical bar meter. Lives top-right of the date nav row. Green dot + `current / target kcal`.

**Completion banner:** unchanged logic, green palette (`#dcfce7` bg, `#86efac` border, dot indicators).

---

## 6. Out of Scope (this iteration)
- Multi-classification dish types (many-to-many `dishType`) — single `dishTypeId` per recipe is kept
- Beverage proactive insertion — beverages remain available in top-up pool only
- Cross-plan recipe repetition prevention (future)
