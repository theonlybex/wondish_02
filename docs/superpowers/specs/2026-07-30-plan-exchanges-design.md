# Plan Exchanges — Restaurant & Fridge Dishes into Today's Meal Plan (Design)

**Status: user-approved 2026-07-30.** Next step: implementation plan under
`docs/superpowers/plans/`.

## Goal

A user with a generated meal plan for today can pull real-world food into it:

- **Going out:** on any restaurant dish, tap **Add to today's plan**.
- **Fridge Mode:** under any generated fridge recipe, tap the same button.

The dish lands on today's plan as a **pending** item. Later, in the Meal Plan
screen, the user is prompted to **choose which planned dish it replaces**
("Choose a dish to exchange for this restaurant dish"). On confirm, the plan
adjusts — calories left and macros for the day reflect the exchange — and the
web app shows the same adjusted plan, because iOS writes everything to the
server and both surfaces read the same source.

## Decisions (user-approved)

1. **Two-step flow.** Add is instant and choice-free; slot selection happens
   later in the Meal Plan screen. The user always picks the displaced dish —
   no auto-selection.
2. **One button.** "Add to today's plan" replaces the existing instant-log
   "Add to today" path on Restaurants and the fridge log path's placement on
   recipe cards. Eating/completion happens through the plan, as with any
   planned dish.
3. **Web is display-parity only this cycle.** Web renders the composed plan
   (exchanged dishes in their slots, pending strip as passive display); the
   exchange interaction ships on iOS. Server is the single source of truth.
4. **Two separate tables** — two features, two tables, flowing into one plan:
   `RestaurantPlanExchange` and `FridgePlanExchange`.
5. **Overlay architecture** (approach A): the generated plan's `Menu` rows are
   never mutated. Exchanges are day-scoped overlay rows composed onto the
   plan at read time.

## Why overlay (A) over the alternatives

- **B — rewrite Menu rows:** restaurant/fridge dishes aren't catalog
  `Recipe` rows; shadow recipes would pollute the catalog, fight `isPublic`
  serving checks, and be wiped by plan regeneration. Rejected.
- **C — model via MealLog:** a log means *eaten*; a fridge dish added at
  10:00 isn't cooked yet. Journal/stats would count food never eaten.
  Rejected.
- **A** is additive-migration only (release rule), survives regeneration
  (`planVersion` on every row), and preserves original-plan history.

## Data model (additive migration only)

Shared columns on both tables:

```
id            String   cuid PK
patientId     String   FK Patient, cascade delete
localDate     String   "YYYY-MM-DD", client-supplied local calendar date
                       (same convention as MealLog.localDate)
planVersion   Int      patient.activePlanVersion at creation time
status        PENDING | RESOLVED | CANCELLED
displacedMenuId String? FK Menu, null until resolved; a Menu row may be
                       displaced by at most ONE active (non-cancelled)
                       exchange across BOTH tables — enforced in the resolve
                       transaction, not by a cross-table DB constraint
servings      Float    default 1
createdAt / resolvedAt timestamps
```

`RestaurantPlanExchange` adds: `restaurantDishId` (FK, SetNull) plus a
**server-priced** per-serving macro snapshot (calories/protein/carbs/fat/
fiber, unrounded floats — MealLog convention). Clients never send macros for
restaurant dishes (standing rule 3).

`FridgePlanExchange` adds: a full snapshot of the generated recipe —
name, per-serving macros, ingredients list, instructions text — client-
supplied, because fridge recipes exist nowhere server-side (precedent:
FRIDGE-source MealLog rows already work this way). `fridgeRecipeId` kept as
opaque provenance.

## Behavioral rules

- **Pending items count toward nothing.** No day totals, no journal, no
  grocery effect until resolved. They lapse silently when their `localDate`
  passes (remain queryable; UI shows only today's).
- **Resolve** sets `status = RESOLVED`, `displacedMenuId`, `resolvedAt` in a
  transaction that: verifies patient ownership; verifies the Menu row belongs
  to the patient, to `localDate`'s plan day, and to the *current*
  `activePlanVersion`; rejects if the menu row is already displaced by any
  active exchange; rejects if the planned dish is already completed (eaten).
- **Cancel** allowed from PENDING (and from RESOLVED as an un-exchange, which
  restores the displaced dish) — cancel from RESOLVED is rejected if the
  exchanged-in dish has already been marked eaten.
- **No meal-type restriction** on which slot the user exchanges — their pick
  wins.
- **Diet bans:** on restaurant add, the server evaluates the dish against the
  patient profile via `lib/diet-match.ts` and stores/returns the verdict as
  information; the user's choice still wins (parity with existing Restaurants
  behavior). Fridge recipes are generated within constraints already.
- **Premium gating:** same server-side gate as existing meal-plan surfaces
  (`lib/freemium.ts` taxonomy; 402 semantics preserved).
- **Plan regeneration:** bumps `activePlanVersion`; prior-version exchanges no
  longer compose (history intact). Pending rows from a prior version are
  treated as lapsed.

## Composition layer — the dietary-system guarantee

New pure function in `lib/` (name illustrative):

```
getEffectivePlanForDay(patientId, localDate)
  = base Menu rows for the day (current planVersion)
    − rows displaced by RESOLVED exchanges
    + exchanged-in dishes rendered into the displaced slots
```

Every consumer of "today's plan" reads through it, which is what makes the
whole dietary system adjust:

| Consumer | Effect after exchange |
|---|---|
| `/api/meal-plan` day/week reads | Composed plan; calories-left / macros-closed recomputed with the swap |
| Journal / completion | Exchanged-in dish is completable like any planned dish; eating writes the same intake rows (restaurant → RESTAURANT-source, fridge → FRIDGE-source MealLog with `journalMealId`-style provenance to the exchange row) |
| `/api/grocery-list` | Ingredients of displaced Menu rows drop out; restaurant dishes add nothing; fridge dishes add nothing (user owns the ingredients) |
| Journey / prediction / overview | Read intake (eaten) data → consistent automatically |
| Provider meal-plans surface | Unchanged this cycle (shows base plan); noted as follow-up |

## API

New endpoints (all auth-scoped to the requesting patient):

- `POST /api/meal-plan/exchanges/restaurant` `{ restaurantDishId, localDate,
  servings? }` → creates PENDING; server prices macros; returns row + diet
  verdict. (No meal-type field — the slot is chosen at resolve time.)
- `POST /api/meal-plan/exchanges/fridge` `{ localDate, servings?, recipe:
  {name, perServing, ingredients, instructions}, fridgeRecipeId? }` →
  creates PENDING.
- `PATCH /api/meal-plan/exchanges/[id]` `{ action: "resolve", menuId }` or
  `{ action: "cancel" }`.
- Reads: existing day-plan endpoint gains **opt-in** `?exchanges=1` returning
  `{ pending: [...], resolved: [...] }` alongside the composed slots.
  Default responses stay byte-identical (pinned wire-contract rule). iOS DTO
  dates remain `String`.

## iOS (Clara repo, `~/Desktop/BeTech/Clara`)

- **Restaurants:** dish card button becomes "Add to today's plan"; the
  instant-log `AddToTodaySheet` path is retired. Confirm sheet keeps servings
  + shows verdict; posts the exchange; transient success state.
- **Fridge:** same button under each generated recipe card/detail.
- **Meal Plan tab (PlanHubView):** pending strip ("2 dishes waiting — choose
  what to exchange"); tapping a pending dish opens a picker listing today's
  not-yet-eaten planned meals; confirm calls resolve; plan re-renders
  composed. Un-exchange available from the exchanged-in dish's context.
- House rules: fixtures + launch args for every new state (pending, resolved,
  empty, error), controller screenshot verification, view-model tests,
  `ui-ux-pro-max` + iOS design skills before view code, hand-registration of
  new files in project.pbxproj.

## Web (wondish_02)

- Meal-plan page renders the composed day: exchanged-in dishes appear in
  their slots with an origin badge ("From Ristorante Roma" / "From your
  fridge"); pending dishes render as a passive strip ("Added from the app —
  choose the exchange there"). No exchange interaction this cycle.

## Testing

- **TDD core:** composition function (macro math, displacement, version
  filtering) — pure, table-driven.
- **Transaction tests:** resolve/cancel — double displacement across both
  tables, wrong patient, stale planVersion, completed-dish rejection,
  un-exchange of an eaten dish rejected.
- **Wire-contract snapshots:** default (no param) day-plan responses
  byte-identical before/after.
- **Server pricing:** restaurant exchange macros come from DB rows, client
  payloads ignored.
- **iOS:** view-model tests for pending/resolve flows; fixture screenshots
  for every state; Dynamic Type XXL pass in the audit drill.

## Out of scope this cycle

- Web exchange interaction (display parity only).
- Provider surface composition.
- Exchanging into future days (today only, per the product flow).
- Any Clara-assistant integration (parked separately).
