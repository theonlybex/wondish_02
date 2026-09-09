# Clara Basket-Weekly Generation — ingredients as keys

- **Date:** 2026-09-08
- **Status:** Approved (design) — pending spec review
- **Supersedes:** the auto-generate parts of `2026-09-07-favorite-ingredients-design.md` and the memory note `clara-rolling-weeks-design.md`.
- **Branch base:** `feat/clara-generation-pantry-freemode`

## Goal

Make ingredients the centerpiece. The user's **"What I have" list is the basket** — the base of their meal plan. Clara generates one week of dishes **constrained to that basket**, sized to the calorie ramp, gated by the rules engine. Generation is **manual and weekly** (a "New week" button), never automatic. The DB becomes a **cache-first library** of validated dishes that makes generation cheap over time.

## Core principles

1. **Ingredients are keys.** Dishes are generated *from* the basket, never the other way round — so the shopping list stays small, coherent, and reused across the week. Zero upfront friction: works with whatever you have; adding ingredients unlocks more.
2. **One engine, no switch.** The Clara/Homemade switch is removed. The system is always ingredient-adaptive.
3. **Generation only fires on an explicit button press.** This structurally kills runaway generation/cost from mode-toggling or app reopens.
4. **No empty days — gate, don't patch.** A week is only generatable once the basket is provably sufficient. The guarantee comes from the readiness gate, not from filler.
5. **Clara proposes, the rules engine disposes.** Unchanged: allergen filter + macro/calorie sanity + builder selection gate every dish.

## The basket

- **Basket = the patient's `PatientPantryItem` list** ("What I have"). This is the single source of truth for what dishes can exist.
- **Favorites** (from the ingredient swipe) and **What-to-buy** suggestions help the user *build* a good basket, but the basket itself is the pantry list.
- **Readiness gate:** a week can only be generated when the basket meets a minimum: `MIN_BASKET = 12` ingredients (tunable) **and** light category coverage (≥1 protein-ish, ≥1 carb-ish, ≥1 veg-ish), using a shared keyword category map. This ensures 7 days × meal slots can be filled without forced repeats.

## Generation model

### Rolling 7-day window + ramp anchor
- A plan is **7 days**, built from `startDate` (this week). `mealPlanStartDate` is the fixed **anchor** (day-1 of the deficit schedule), set once and never moved by weekly rolls, so `getPlanDayCalories` keeps the calorie ramp continuous across weeks (no migration — `mealPlanStartDate` already carries this).
- When the 7 days run out (today has no menu), the planner shows the **"New week"** button instead of auto-generating.

### Basket-constrained, cache-first generation
For each meal slot across the 7 days, sized to that day's ramp target:
1. **Cache-first:** query the public recipe **library** (curated + previously-generated `"clara"` dishes) for dishes whose ingredients are **fully covered by the basket**, pass the patient's diet filters, and fit the slot's calorie window. Reuse these.
2. **Generate the shortfall only:** call Haiku for the remaining slots, constrained to the basket (like `pantry/cook-day`), sized to targets. Gate (allergen + sanity), persist as public `"clara"` recipes.
3. **Complete from basket cache:** if a day is still thin, fill from basket-covered library dishes (no new ingredients → no empty days, no extra shopping). Given the readiness gate, this rarely triggers.

Because common ingredients recur across users, generated dishes get reused widely — **cost decays as the library grows.**

### The DB / library
- **Unified library:** curated and Clara dishes are one set of public `Recipe` rows. Eligibility = basket coverage + diet + calorie fit. No curated-vs-AI distinction at selection.
- **Hygiene / pruning:** a prune pass drops `"clara"` dishes unused by any plan for N days (or caps per meal-type × cuisine). Curated seed dishes are never pruned. Prevents unbounded DB bloat and keeps the "already exists?" dedupe fast.

## UX

### Removing the switch
Remove the Clara/Homemade segmented switch and the per-day cuisine strip's mode logic from `DailyMealPlanView.tsx`. Replace the auto-generate-on-empty behavior (built 2026-09-07) with the manual New-week flow below.

### The "New week" flow
When the current 7-day window is out of dishes, the planner shows a **New week** panel:

- **Basket sufficient** → live button: **"New week — generate your whole week."** Clicking opens a **review step**: the basket list with edit access + reassurance copy — *"These ingredients are the base of your plan. Make sure you're happy — edit the list before generating."* → **Generate my week** (basket-constrained generation).
- **Basket insufficient** → the button is **not silently disabled**. A panel explains why + offers the fix:
  > **8 / 12 ingredients** — add 4 more so Clara can fill all 7 days without repeats.
  > **[ Add ingredients → ]**  → routes to `/pantry` (Ingredients screen)

### The required-ingredients counter (persistent)
On the ingredient-selection surfaces — **onboarding pantry selection** and the **New-week "add more ingredients"** flow — show a **persistent bottom bar** with the running count toward the minimum:

- Below minimum: `8 / 12 ingredients — add 4 more` with a progress bar; the forward action (Continue / Generate) reflects the gate.
- At/above minimum: a positive state (`12 / 12 — your basket can fill a full week ✓`) and the forward action is enabled.

The same `MIN_BASKET` + category-coverage check drives both the counter and the New-week gate — one shared readiness function.

### What-to-buy = marginal unlock
Evolve the smart-stocking list from an absolute catalog count to a **basket-relative marginal count**: for each suggested ingredient, *"add tomatoes → unlocks 5 more dishes for your basket,"* favorites first. Directly ties the suggestion to the week the user is about to generate.

## Onboarding

Order stays: profile → `/taste` (ingredient favorites) → `/pantry` (build the basket, with the required-count bar) → first week generation. The readiness gate applies before the first generation, guiding the user to a full basket.

## Out of scope (YAGNI, for now)

- Automatic weekly generation (explicitly manual for now).
- The leveled/protein-first swipe UI (deferred; the category keyword map built here is the shared groundwork).
- Per-week cuisine choice (set aside; basket is the constraint).
- Cross-user cache sharing beyond what public recipes already give.

## Phased delivery

- **Phase A — Engine:** rolling 7-day window + ramp anchor; basket-constrained, cache-first generation primitive; Clara-only/library pool; readiness function. (Backend, unit-testable.)
- **Phase B — Planner UX:** remove switch; manual New-week trigger; readiness gate + guided blocked button + review step; required-count bottom bar (pantry + onboarding).
- **Phase C — Polish:** marginal what-to-buy; library pruning job.

## Testing

- Unit (`lib/*.test.ts`): readiness function (count + category coverage); basket-coverage eligibility; cache-first shortfall math; ramp-anchor day-number continuity; ranking of marginal unlock.
- Builder: basket-constrained selection fills 7 days from a sufficient basket; a sufficient basket never yields an empty day; an insufficient basket is gated (never reaches generation).
- Keep the full suite green (currently 1019).

## Rollout

- No migration (anchor reuses `mealPlanStartDate`).
- FREE-MODE unaffected; spend guard + busy-lock remain backstops.
