# Favorite Ingredients — swipe, smart stocking, and ingredient-focused planning

- **Date:** 2026-09-07
- **Status:** Approved (design) — pending spec review
- **Branch base:** `feat/clara-generation-pantry-freemode`

## Goal

Make the system revolve around **liked ingredients** instead of liked dishes. Users swipe ingredients during onboarding; those favorites (a) float to the top of a new "What to buy" smart-stocking list, and (b) feed the meal-plan builder's ingredient-affinity scoring. Liked *dishes* are retired.

## The loop

Onboarding → **swipe ingredients** (favorites captured) → **What to buy** shows favorites on top, then the ingredients that unlock the most dishes → tap to buy → moves to **What I have** → cookable dishes appear → Clara cooks. Right after onboarding the pantry is empty, so swiped favorites sit at the very top of the buy list — the first-run payoff. Favorites are re-editable anytime by re-entering the taste screen.

## Decisions (resolved forks)

1. **What to buy = smart stocking guide**, decoupled from the weekly meal plan. A ranked recommendation of ingredients to buy, filtered to what the user doesn't already have.
2. **Taste = swipe ingredients directly** (not derived from dishes). Per-ingredient preference stored.
3. **Editing = re-enter the taste screen** (no separate list/management UI).
4. **Liked dishes retired**; ingredient favorites replace dish favorites as the builder's affinity signal.

## Out of scope (YAGNI)

- Favorite quantities, per-store logic, category grouping.
- A standalone favorites-management/list screen or bulk-clear.
- Reordering the old plan-derived grocery list (it is replaced here, not reordered).
- Dropping the `PatientDishPreference` table (kept, unused — code is commented, not deleted).

## Data model

**New:** `PatientIngredientPreference` (mirror of `PatientDishPreference`):

```prisma
model PatientIngredientPreference {
  id           String     @id @default(cuid())
  patientId    String
  ingredientId String
  liked        Boolean    // true = favorite, false = not for me
  patient      Patient    @relation(fields: [patientId], references: [id], onDelete: Cascade)
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())

  @@unique([patientId, ingredientId])
}
```

- Add back-relations: `Patient.ingredientPreferences PatientIngredientPreference[]` and `Ingredient.preferences PatientIngredientPreference[]`.
- **Migration:** additive `CREATE TABLE` only. `PatientDishPreference` is untouched (kept for reversibility).

## Retiring liked dishes

Comment out (do not delete), following the `// FREE-MODE`-style convention with a dated marker `// DISHES-RETIRED (2026-09-07)`:

- **Meal-plan builder** (`lib/meal-plan.ts`): the `patient.dishPreferences` read and the affinity map built from liked dishes (~lines 168–185). Replaced — see "Builder affinity" below.
- **Taste dish deck + swipe:** `app/api/taste/dishes/route.ts` and `app/api/taste/swipe/route.ts` (dish version) — superseded by the ingredient routes.
- **`DishTinder` dish mode:** the component is repurposed to ingredients (see below); dish-card rendering commented.
- **Copy referencing "dishes you'd try":** taste screen intro copy, `membership` benefits, any onboarding text.
- Keep `app/api/taste/seen` and `set-cookie` (they set `tasteCompleted` / the `taste_complete` cookie — reused by the ingredient flow).

## Taste screen → ingredient swipe

Repurpose `/taste` (`app/(dashboard)/taste/page.tsx`) and `components/taste/DishTinder.tsx` to swipe **ingredient cards**: ingredient name + a best-effort emoji (small static name→emoji map; text-primary, emoji optional). Verbs stay "✓ Favorite" / "✕ Not for me"; client-only Skip remains.

**Modes (query param):**
- `?onboarding=1` — fresh deck (ingredients not yet rated). Finishing → `/pantry` and sets `tasteCompleted`.
- `?edit=1` — deck **includes already-rated** ingredients, each card showing the current call (👍/👎 badge). Swipe to flip. "Done" → `/pantry?tab=buy`.

Deck source: the **highest dish-count** ingredients (the ones worth an opinion), diet-filtered (drop allergens/avoids and staples like salt/pepper/water), ~20 cards. Because swipe is an upsert on `[patientId, ingredientId]`, flipping in edit mode needs no new write logic.

**New API routes** (`app/api/taste/`):
- `GET ingredients` → `{ ingredients: { id, name, emoji?, dishCount }[] }`. Params: none for onboarding (excludes rated); `?edit=1` includes rated and returns each item's current `liked` (`true|false|null`).
- `POST ingredient-swipe` → body `{ ingredientId: string, liked: boolean }` → `prisma.patientIngredientPreference.upsert({ where: { patientId_ingredientId }, create/update: { liked } })` → `{ ok: true }`.
- `DELETE ingredient-swipe?ingredientId=` → `deleteMany` (un-rate), for completeness.

## Onboarding placement

Ingredient swipe becomes a **required step for everyone** (drop the premium-only condition in `app/(dashboard)/layout.tsx`; we're in FREE-MODE). Order: **profile wizard → `/taste?onboarding=1` → `/pantry?onboarding=1` → `/meal-plan`**. The layout's taste gate now checks ingredient-taste completion (`tasteCompleted` / cookie) for all users, not just premium.

**Entry point for editing:** an "Edit favorite ingredients" action on the Ingredients screen header (`components/pantry/PantryClient.tsx` / `app/(dashboard)/pantry/page.tsx`) → `/taste?edit=1`. Cause (favorites) and effect (What-to-buy order) live in the same place.

## What to buy = smart stocking endpoint

**New `GET /api/pantry/to-buy`** → `{ items: { ingredientId, name, dishCount, favorite: boolean }[] }`.

Candidate set: ingredients that
- appear in ≥1 **eatable** dish (public recipe passing the patient's allergen/avoid filters via `@/lib/diet-match`), and
- are **not already in** the patient's pantry (`PatientPantryItem`), and
- are not banned/staples.

`dishCount` = number of eatable dishes the ingredient appears in (computed in memory from the diet-filtered recipe pool, consistent with `/api/pantry/cookable`).

**Ranking:**
1. `favorite` (liked in `PatientIngredientPreference`) first,
2. then `dishCount` descending (least-unlocking at the bottom).

Capped at ~50 rows (most useful set; least-popular *of the shown set* at the bottom).

**UI (`PantryClient` "buy" tab):** swap the data source from `/api/grocery-list` to `/api/pantry/to-buy`. Each row shows the name + a subtle **"unlocks N dishes"** hint (the count that drives the order; distinct from the removed quantity labels). Tapping a row still calls `PUT /api/pantry` to move it into "What I have," after which it drops off the buy list. The old `/api/grocery-list` route stays in place, just no longer wired to this tab.

## Meal-plan builder affinity (ingredient-based)

Replace the commented dish-affinity block in `lib/meal-plan.ts`:

- Load `patient.ingredientPreferences`.
- `affinityMap[name.toLowerCase()] = 1` for each **liked** ingredient (or a normalized weight; a flat positive weight is enough — `pickByMotivation` already blends affinity with motivation/macro scoring).
- `seenIngredientNames` = names of all rated ingredients (liked or not), preserving the existing "seen" semantics used by the picker.

No change to `pickByMotivation`'s signature or the selection math — only the source of `affinityMap` / `seenIngredientNames` changes.

## Testing

- Unit: `PatientIngredientPreference` upsert/flip; `/api/pantry/to-buy` ranking (favorite-first, dishCount-desc, pantry-exclusion, diet-filtering, cap); deck diet-filtering and edit-mode current-state.
- Builder: affinity now sourced from liked ingredients — update/replace any existing dish-preference affinity test to the ingredient path; assert liked-ingredient dishes score higher, and that removing dish-preferences doesn't break the build.
- Keep the full suite green (currently 1012 tests).

## Rollout

- Additive migration (new table) — safe on the shared prod DB.
- Dish code is commented, not removed — reversible.
- No premium/paywall interaction (FREE-MODE).
