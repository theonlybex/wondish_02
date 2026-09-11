# Web platform feature checklist — QA passes of 2026-09-10/11

Test accounts (dev Clerk instance, shared Neon DB): `qa.mobile.20260910@wondish.io`
(deleted through the UI at the end) and `qa.desktop.20260911@wondish.io` (still
exists, has a generated week). Mobile = iPhone 13 viewport (390×844), Desktop =
1280×900, both driven by Playwright against `localhost:3000`.

Status: ✅ works as intended · 🔧 bug found and fixed in this branch · ⚠️ works
with a caveat (listed) · ⏭ not exercised (reason) · ❌ open finding

## Account & access

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Sign-in via ticket, session persists across pages | ✅ | ✅ | Dev Clerk instance; first navigation after sign-in can loop (see open findings) |
| Email/password sign-in and Google sign-up forms render (signed out) | — | ✅ | Clerk-hosted forms; submitting credentials is out of scope for automation |
| Protected routes redirect signed-out users to `/login` | — | ✅ | `/overview` → `/login` |
| Signed-in visits to `/login`, `/register`, `/` land in the app | ✅ | ✅ | `/dashboard` → `/meal-plan` |
| Delete account (Settings → danger zone, type DELETE) | ✅ | ✅ | Clerk user and DB rows gone, lands on `/` |
| First-day greeting | 🔧 | 🔧 | Said "Welcome back" to a brand-new account; now "Welcome" on the day the account was created |

## Onboarding (10 steps)

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Terms consent gate on the welcome step | ✅ | ✅ | `agreedTerms` stored on the account |
| Motivations, about, body (cm/kg and ft-in/lbs), activity, reveal | ✅ | ✅ | Weight stored in lbs whatever the display unit |
| Allergies + foods to avoid | ✅ | ✅ | |
| Diet card (new) | ✅ | ✅ | Cards with one-line hints, `sm:grid-cols-2` on desktop |
| Health-condition card (new) | ✅ | ✅ | Grouped chips, dot on the 7 conditions with rules |
| Goal weight, save | ✅ | ✅ | Lands on `/taste` |
| Draft survives a reload (sessionStorage) | ✅ | ⏭ | Verified on the earlier mobile pass |

## Taste, pantry, generation

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Taste tinder, 5 levels, allergy-filtered | ✅ | ✅ | Milk allergy left only eggs in Dairy; Peanuts removed from Nuts |
| Taste position survives a reload | 🔧 | 🔧 | Restarted at level 1; now kept per tab |
| Favorites saved → What-to-buy handoff | ✅ | ✅ | |
| Pantry basket onboarding, readiness counter | ✅ | ✅ | 12-ingredient minimum with category coverage |
| Pantry search / category accordions / chips (44 px) | ✅ | ✅ | |
| First week generation from the basket | 🔧 | ✅ | Hypertension + Milk profile got 0 of 28 dishes; four root causes fixed (see commit `0325120`) |
| Generated dishes: steps, prep/cook times, canonical ingredient rows | ✅ | ✅ | Paraphrased names now map to the basket's catalog rows |
| Generated dishes carry per-serving amounts | 🔧 | 🔧 | New: Clara returns `amounts`, persisted to `RecipeIngredient.quantity/unit` (184/184 rows on the last run) |
| Weekly generation limit (free: 1/week) | 🔧 | ⏭ | 429 was silent from the top banner; message + upgrade link now inline; "1 free new weeks" grammar fixed |

## Meal plan

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Day view, day navigation (‹ ›) | ✅ | ✅ | |
| Weekly view (`/meal-plan/weekly`) | ✅ | ✅ | Cuisine tag per dish |
| Cuisine for today chips | ⏭ | ✅ | Panel opens; picking a cuisine not exercised (costs a generation) |
| Dish detail (macros, ingredients, steps, times) | ✅ | ✅ | |
| Swap with Clara (free-text request) | ⏭ | ✅ | Lunch replaced by a lighter no-rice dish in ~10 s; not basket-constrained (see caveats) |
| 👍 Loved it / 👎 Not for me | ⏭ | ✅ | Loved it also logs the meal (1/3 logged) |
| Same-day duplicate dishes | 🔧 | ✅ | Calorie top-up served one snack twice; now leaves the day short instead |
| Calorie/macro summary card | ✅ | ✅ | Targets shown are the plan's sums |

## Clara (AI advisor)

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Chat answers with profile context (allergies, conditions, today's plan) | ✅ | ✅ | Haiku; correct refusals for cheddar (Milk) and peanut butter (Peanuts) |
| Narration + tool call + answer rendering | — | 🔧 | Text blocks were glued ("…tonight.No —"); separator added |
| Daily message limit (free 5/day) | ⏭ | ⏭ | Guard in place (`lib/ai-budget`), not driven to the limit |
| Suggested prompts sidebar | — | ✅ | |

## Ingredients (pantry) & shopping

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| What I have: selected chips, category counts, dish suggestions | ✅ | ✅ | |
| What to buy: By category / By value / By cuisine | ✅ | ✅ | Favorites first, "unlocks N more dishes" |
| Weekly purchase amounts next to items (new) | ✅ | ⚠️ | Amounts appear only for items the week's plan needs that you don't own; a basket-built week therefore shows none |
| Foods-to-avoid respected in suggestions | 🔧 | 🔧 | "Red meat" avoider was offered ground beef; avoid rules now expand to ingredient children (84 seeded, admin-editable) |
| Staples never listed | 🔧 | 🔧 | "tap water · 1 fl oz" appeared; to-buy now uses the shared staple list |
| `/grocery-list` | ✅ | ✅ | Redirects to What-to-buy |

## Journal, overview, journey

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Overview: caloric profile, today's log, streak grid, journal widget | ✅ | 🔧 | Hydration mismatch from the inline `<style>` fixed |
| Mood → weight → … journal steps | ⏭ | ✅ | Steps 1–2 exercised |
| Manual meal log (+ Add / + ADD MEAL modal) | ✅ | ✅ | Flags incomplete nutrition |
| Journal calendar, day detail, "Log an entry" | ✅ | ✅ | Goes to the overview log card |
| Journey analytics (empty states) | — | ✅ | |
| `/prediction` | — | ✅ | Intentionally redirects to the meal plan |

## Billing & settings

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Membership page (free state), See plans | ✅ | ✅ | |
| Pricing page: monthly / 6-month toggle, promo preview (SAVE20) | — | ✅ | "$80.00 today, then $100.00 / 6 months"; checkout not submitted |
| Stripe checkout → success → sync, switch/cancel/resume | ⏭ | ⏭ | Covered end-to-end in test mode on 2026-09-10 (billing v2), not repeated |
| Settings: profile edit, kg/lbs display toggle, save | ✅ | ✅ | Stored values unchanged by the toggle |
| Settings: diet/allergy/condition chips (44 px) | ✅ | ✅ | Adding Type 2 Diabetes saved and reached Clara |
| Orders page (empty state) | — | ✅ | |

## Public site

| Feature | Mobile | Desktop | Notes |
|---|---|---|---|
| Landing page | — | ✅ | Horizontal tray is an intentional carousel |
| Language switcher EN → ES | — | ✅ | Whole site re-renders in Spanish; RU present, not clicked |
| `/dishes`, `/pricing`, `/privacy`, `/restaurants` | — | ✅ | |
| `/terms` | — | ❌ | Placeholder text ("Terms of service will be published…") while onboarding collects consent to it |
| `/api/health` | — | ✅ | 200 JSON |

## Not exercised

- **Admin** (`/admin/*`: users, recipes, parameters, banned ingredients, coupons, promo codes, restaurants, review queue, Clara gaps, prune): needs a SUPER-role account; the QA accounts are ordinary users.
- **Restaurant portal** (`/restaurant/*`, invites, staff, menu verification) and **provider** pages: role-gated.
- **Restaurant claim flow** (`/r/claim` on sign-up): cannot be exercised locally (see BACKLOG §1).
- **iOS-only APIs**: cook-my-day, fridge suggestions, plan exchanges (fridge/restaurant), supplements, coupon redeem. No web UI calls them; `components/CouponRedeem.tsx` is unused.
- **Stripe webhooks** with the CLI, Apple billing, past-due banner.
- **Email flows** (Clerk verification, invites).

## Caveats worth knowing

- Clara swap is not constrained to the basket (a swapped lunch used a lemon dressing that isn't in the pantry). Amounts for such dishes still persist.
- On the Clerk **dev** instance the first navigation right after a sign-in ticket can loop (`/taste → /login → /overview → /taste`). Only seen in the headless harness; a production Clerk instance is the fix.
- `Decaf coffee` is still excluded for a Caffeine avoider (children match "coffee"); conservative on purpose.
