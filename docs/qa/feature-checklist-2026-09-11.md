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

## Symptom journal, trigger trials, condition rules (added 2026-09-11, `feat/workbooks-tier2`)

Accounts: `qa.desktop.20260911@wondish.io` (Celiac, GERD, High Cholesterol,
Migraine) and `qa.nocond.20260911@wondish.io` (no conditions).

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| Symptoms step in the quick log, only for users with condition items | ✅ | ⏭ | GERD+Celiac+Migraine account: 6 steps, 31 items; no-condition account: 5 steps |
| Symptom severity saved and shown in the journal day view | ✅ | ⏭ | Three items saved, listed with severity chips |
| Journey cards (symptom trend, trials), only for condition users | ✅ | ⏭ | Absent for the no-condition account |
| Trials nav item, only for eligible users | ✅ | ✅ | Absent for the no-condition account; `/trials` redirects to `/journey` |
| Eligible triggers listed per condition | ✅ | ⏭ | 15 for GERD + Migraine |
| Start trial (skip baseline) → elimination day 1, plan flagged stale | ✅ | ⏭ | Second start → 409 |
| Regenerate week from the trials page → no citrus in the plan | ✅ | ⏭ | 22 menus, 0 citrus ingredients |
| Phase walk (start date rewound in DB) → washout, classification radios | ✅ | ⏭ | |
| Classify likely trigger → ban persists (What-to-buy hides citrus) | ✅ | ⏭ | |
| Clear ban → citrus back, category eligible again, plan stale | ✅ | ⏭ | |
| Workbook-03 deployable rules imported | ✅ | — | 31 rows; nine Fatty Liver rows held for client review |
| Six workbook-only conditions added (IBS-M, Hypertriglyceridemia, Pregnancy, Leaky Gut, Autoimmune, AERD) | ✅ | — | 55 items, 10 IBS-M trials, 11 rules; seeds idempotent |
| Five conditions with no workbook factor backfilled from clinical sources | ✅ | — | 76 items, CKD3 bans, PCOS bans + trial; marked `WB-*` for clinician review |

Verification pass 2 (after the six added and five backfilled conditions):

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| New conditions selectable in Settings; saving them adds symptoms, trials and the Trials nav | ✅ | — | PCOS + IBS-M added: 6 journal steps, 53 items, 23 eligible triggers |
| Symptoms step on mobile, trial-linked items first with a "trial" tag | — | ✅ | No horizontal overflow |
| Trials page and Journey cards on mobile | — | ✅ | 3×2 timeline, no overflow |
| PCOS low-glycemic trial → regenerate → plan has no high-glycemic term | ✅ | — | 22 menus, 0 hits |
| Clara chat refuses a trial-banned food and names the trial | ✅ | — | "day 1 of a 28-day trial eliminating high glycemic foods" |
| Clara swap honours the trial | ✅ | — | Asked for jasmine rice + honey glaze, got brown rice & quinoa with herb glaze |
| Phase change (elimination → reintroduction) flags the plan stale | ✅ | — | Lazy sync on the next trials read; meal-plan status agrees |
| Weekly generation limit message on the trials page | 🔧 | — | Reload wiped the 429 message; fixed |
| PCOS standing bans vs its trial | 🔧 | — | Standing bans swallowed the trial's foods; refined grains and juices now belong to the trial only |

Verification pass 3 (the paths pass 2 had not exercised):

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| Stop trial from the UI | ✅ | — | History shows "Stopped", plan flagged stale |
| Start a trial with the 7-day baseline | ✅ | — | Baseline day 1 of 7, "allowed right now", start date = today + 7 |
| Phase flip baseline → elimination flags the plan stale on the next read | ✅ | — | |
| Group-based trial (IBS-M fructans → BIG9-WHEAT + onion/garlic) enforced in generation | ✅ | — | Regenerated week: 0 fructans terms, 0 wheat-group ingredients |
| Evaluation with real symptom data | ✅ | — | Seeded 3 baseline days (2.67) vs 3 elimination days (0.67) → "improved 75% — the protocol suggests testing the trigger" |
| Classify as Tolerated | ✅ | — | Scores frozen on the history row, category eligible again, plan stale |
| Journey symptom trend values | ✅ | — | `/api/journal/symptoms` returns per-day means; chart shows the 30-day window |
| Onboarding health card with all 41 conditions in groups | ✅ | — | Throwaway account walked to step 9, then deleted |
| Trials nav label in ES / RU | ✅ | — | "Pruebas" / "Пробы" |
| Admin: foods-to-avoid banned-ingredient editor (page + API add/delete) | ✅ | — | Temporary SUPER role on the QA account, revoked after; test row removed |
| Full journal form (`components/journal/JournalForm.tsx`) with symptoms section | ⏭ | — | Component is not rendered by any page (dead code); quick log and day view are the live surfaces |
| Objective/lab items hidden from the symptoms step | ✅ | — | API returns SYMPTOM items only |

Fixes from the passes above (verified live):

| Finding | Fix | Verified |
|---|---|---|
| Dead `JournalForm.tsx` / `MealRatingCard.tsx` | Removed | tsc, suite |
| Clara swap ignored the pantry basket | Prompt lists the basket + free staples; candidate must fit the basket (names canonicalised) or the swap returns "Clara couldn't make that from your ingredients…" | Lemon/tahini/feta request → 422 message, lunch unchanged; salmon-quinoa request → swapped, 0 ingredients outside the basket, 10/10 amounts |
| "Decaf coffee" banned by a Caffeine avoid rule | `exactBanPattern` skips matches preceded by "decaf"/"decaffeinated" | unit test |
| Journal day view ignored meals logged through the meal log ("No history yet") | Calendar merges `MealLog` rows as unrated ✓ entries | "+ Add" a meal → day view lists "✓ QA logged snack" |

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
