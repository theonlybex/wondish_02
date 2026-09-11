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

Verification pass 4 (different onboarding / profile choices, 2026-09-11):

| Scenario | Desktop | Mobile | Notes |
|---|---|---|---|
| C. "Prefer not to say" + ft/in + lbs + Build muscle + gain goal | ✅ | — | Was a 422 on the calorie card and a flat 2,000-kcal plan; now a neutral (male/female average) profile: 2,873 kcal/day card, 2,753 plan target, 228 g protein |
| A/D. Vegan + Tree nuts + Kidney 1-2 + Hypertension, vegetables-only basket | ✅ | — | Gate wrongly passed ("green beans"/"eggplant" counted as protein) and rapid taps lost items; both fixed. The week generated before the fix (28 menus, 0 violations) had **no protein source** — caused by that basket, not the rules: tofu, plant-based egg and meatless chicken all pass this profile. Gate is enforced in `/api/meal-plan/new-week` too |
| B. Pescatarian + Shellfish allergy + Shellfish avoid | ✅ | — | Profile saves; taste level 1 shows no shrimp; to-buy has canned tuna and no shellfish. Beef is still dealt in the taste deck (see caveats) |
| Diet-list audit against every catalog ingredient (Vegan / Vegetarian / Pescatarian) | ✅ | — | Before: "Sirloin steak" (25 recipes), "Catfish fillets" (20), trout, sardines, clam juice passed all three; Vegan banned "Mung bean plant-based egg" (41), "Almond milk" (35), "meatless chicken" (17). After: 0 leaks, 0 substitute false bans |
| Same audit for all 9 allergies and the other 7 preferences, by name only (the Clara path, which has no Big-9 group tags) | ✅ | — | Before: Wheat allergy let "Sliced bread" (119), "Penne" (33), "Spaghetti" through by name (library dishes were still caught by the `BIG9-WHEAT` tag); Soy let "unsweetened soymilk" through; Paleo passed cheddar/mozzarella/parmesan and hummus; Low-carb passed quinoa (120) and couscous (36). After: 0 leaks on every allergy and preference; a Gluten-free profile now keeps gluten-free pasta |
| E. Restart a category after it was cleared (Citrus) | ✅ | — | Card offered again; started at "Baseline · day 1 of 7" |
| E. Classify Dose-dependent | ✅ | — | Rewound to "Reintroduction · day 2 of 3"; Confirm → history "COMPLETED / DOSE_DEPENDENT", no trial ban left in the pipeline, food map has no trial line, plan flagged stale + "generate a new week" banner on Trials and Meal Plan |
| E. Symptoms step with 53 items (5 conditions) | — | ✅ | 8 shown, "Show all (45 more)" expands to all 53 (212 severity buttons), today's saved severities prefilled, no horizontal page scroll |

Fixes from pass 4 (verified live or by unit test):

| Finding | Fix | Commit |
|---|---|---|
| "Prefer not to say" → 422 caloric card, 2,000-kcal fallback plan | `resolveSexForCalories` + `neutralProfile` averaging male/female | `7a41bf8` |
| Pantry rapid taps lost items (PUT race); vegetables classified as protein; "Add 0 more" copy | Serialised saves, `OVERRIDES` in `lib/ingredient-categories.ts`, clearer readiness copy | `220d3af` |
| Vegan/Vegetarian/Pescatarian ban gaps; plant substitutes and "-free" products banned | `exactBanPattern` substitute-marker / plant-base lookbehinds + "-free" lookahead; `scripts/preference-rules-2026-09-11.ts` (149 rows, applied) | `10333e9` |
| Wheat/Soy allergy and Paleo/Keto/Low-carb/Gluten-free gaps by name; gluten-free pasta banned for a Gluten-free profile | Gluten-free / grain-free marker exempts grain terms in the dietary branch (allergies stay broad); same script, second sweep (142 rows, applied) | `bcd798c` |

Verification pass 5 (extreme inputs, 2026-09-11):

| Input | Before | After |
|---|---|---|
| Weight 1000 lbs (also 20, "abc", 1e9) | Accepted (server limit was 0–1500); caloric card 8,292 kcal/day, body fat 169.8 %, plan target 8,249 kcal | 422 "Weight must be between 50 and 700 lbs." (kg users see 23–318 kg); wizard and settings inputs carry the same min/max and message |
| Height 10 cm / 300 cm / 300 in / 20 ft | Accepted; BMI 8,000 | 422 "Height must be between 90 and 250 cm." (ft/in users: 2'11"–8'2") |
| 700 lbs at 90 cm (each value in range) | Accepted; BMI 392 | 422 "Height and weight don't add up — please check both." (BMI must be 10–100) |
| Goal weight 1000 lbs; goal 60 lbs at 175 cm | 1000 rejected (old 50–1000 band), 60 accepted and silently clamped by the engine | 422 with the safe band for the height: "For your height, a safe goal is between 101 lbs and 405 lbs." (BMI 15–60) |
| Birthday in the future / 1850 | 422 (already) | unchanged (age 13–120) |
| Journal weigh-in 1000 / 20 / −5 / "abc" | 1000 lbs accepted and synced into the profile weight (bypassing the profile bounds) | 400 "weight must be between 50 and 700 lbs" |
| Stored implausible values (older rows, other clients) | Engine ran on them | `/api/patient/caloric-profile` answers 422 "Your saved weight or height looks implausible — please update it in Settings."; body-fat tile shows "—" outside 2–75 % |
| Calorie target display | "7294.0976 kcal" once the ramp hit the deficit floor | Rounded at the three display call sites (engine left unrounded for the glide walk) |
| First name of 5,000 characters | Stored | 422 "Name must be 100 characters or fewer."; inputs have `maxLength` |
| Journal note of 100,000 characters | Stored | 400 "notes must be 2000 characters or fewer"; textarea has `maxLength` |
| Partial `PATCH /api/patient/profile` (`{ weight }` only) | Wiped sex at birth, activity level and every diet / allergy / avoid / condition row (found because the probes above did exactly that to the variant QA account, since restored) | Omitted keys are left unchanged; web forms still send the full body |

Fixes for the pass-4 observations:

| Observation | Fix |
|---|---|
| Pescatarian still dealt steak cards in the taste deck | Resolved by the pass-4 ban terms (the deck already applies preference children); variant account now sees fish and tofu only |
| Vegan + Kidney 1-2 week had no protein | Clara's system prompt now lists the protein sources that survive the profile's bans ("build every main around one of them") whenever the profile bans anything and no basket is set; the kidney legume/nut bans themselves are unchanged (clinician call, see BACKLOG) |
| Symptoms step: no "Show fewer" | Toggle added (44 px, `aria-expanded`); collapsed view keeps the first 8 rows plus any row already logged today |
| Overview heatmap clipped its last column at 390 px | Month labels no longer widen the `1fr` columns (`minmax(0, 1fr)` + absolutely positioned labels); overflow audit 0 elements |
| Gluten-free bread mix passed Keto / Low-carb | The gluten-free marker now exempts grain terms only for lists that also ban gluten or wheat (`ExactBan.grainExempt`); Keto + Gluten-free together take the stricter rule |

## Custom conditions (added 2026-09-11, spec `docs/superpowers/specs/2026-09-11-custom-conditions-design.md`)

Verified on `qa.variant.20260911@wondish.io` (Pescatarian, Shellfish), desktop and 390 px:

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| "My conditions" section on the profile page, add form (name, ingredient tags, note for Clara, symptom tags) | ✅ | ✅ | Tags via Enter / comma / Add; 44 px chips and remove targets; overflow audit 0 |
| Create "Gout" (avoid canned tuna, anchovies, beer; note; 2 symptoms) | ✅ | — | Saved notice; card shows avoids / tracks / note; profile links it; built-in picker does not list it |
| Bans reach the diet pipeline | ✅ | — | `evaluateDishAgainstProfile`: "Canned tuna" and "anchovy paste" banned (source `condition`); taste deck lost "Canned tuna" |
| Clara food map carries the note | ✅ | — | `Condition guidance: Gout (the diner's own note): "small portions of red meat, no beer, plenty of water"` |
| Symptoms in the journal | ✅ | ✅ | Quick log gains the symptoms step (1/6) with "Joint pain · Gout"; logging a severity works |
| Edit: rename, drop "beer", drop a symptom, add "Fatigue" | ✅ | — | Kept symptom keeps its row (logged history intact, same id), dropped one deactivated (row kept), new one created; plan flagged stale |
| Name clash with a built-in ("hypertension") | ✅ | — | 409 with a pointer to the list |
| Settings save with an empty built-in list | ✅ | — | Custom link kept |
| Delete with confirm | ✅ | — | Condition, link, tracking items and their journal symptoms all gone |
| Onboarding health step pointer | ✅ | — | One line: add your own under Settings after setup |

Second pass (trigger trials + onboarding, 2026-09-11):

| Feature | Desktop | Mobile | Notes |
|---|---|---|---|
| "Triggers you could test" chips (28 workbook categories, up to 8) in the add/edit form | ✅ | — | Card shows "2 triggers to test · Alcohol, High fat" |
| Trials page lists the custom condition's triggers | ✅ | — | Two cards under "GOUT" with the category's terms as examples and the custom safety note; Trials nav appears |
| Start a custom trial (skip baseline) | ✅ | — | "Elimination · day 1 of 27", removed-from-plan list = alcohol terms; `evaluateDishAgainstProfile` bans "red wine"/"beer" (source `trial`); food map carries the trial line; plan flagged stale |
| Edit drops a trigger while another is running | ✅ | — | HIGH_FAT card gone, Alcohol trial still active |
| Delete a condition with an active trial | ✅ | — | 200; trial, rules, link, items all gone (trials have no cascade from rules, so the route deletes them first; confirm text says so) |
| Onboarding health step: "Don't see yours?" inline add (name, ingredients, symptoms) | ✅ | — | Throwaway account `qa.custom.20260911` walked through all 10 steps; "Gout · 1 avoided · 1 tracked" listed; after submit `/api/patient/conditions` returns it with the ban and the symptom, profile complete; account deleted afterwards |
| `/terms` content | ⏭ | — | `scripts/seed-terms-2026-09-11.ts` prints a 12-section plain-language draft; **not applied** — `--apply` publishes it to the live site, so it waits for review |

Also in this pass: Kidney Disease stage 1-2 potassium/phosphorus rows (43) moved from hard bans to portion guidance (`scripts/kidney-stage12-rules-2026-09-11.ts`, applied; CKD stage 3 unchanged) — authored, needs clinician review; the settings form now shows the shared inline bounds message instead of the browser's native bubble (`noValidate`).

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
- A Vegan + Kidney 1-2 profile keeps only 5 protein ingredients in the library (tofu 68 recipes, plant-based egg 41, meatless chicken 17, meatless beef strips 5): legumes and nuts are kidney bans. Clara is now told which proteins remain; whether the stage 1-2 legume/nut bans should soften is a clinician call.
- Overlapping symptom labels (Abdominal pain, Bloating, Nausea) appear once per condition, each with its condition name; a five-condition account has 53 items behind "Show all".
- The settings form relies on the browser's native min/max bubble for out-of-range numbers (no inline text); the wizard shows inline text because its Next button validates in code. Both end in the same server 422 if bypassed.
