# Clara-first user simulation

Run 2026-11-12 · snapshot 2026-11-12T19:35:12Z (read-only) · branch `sim/clara-first` · `npm run sim:clara-first` (~15 s)

The real route handlers and library code run in-process against an in-memory store
(`sim/fake-db.ts` → `createClaraStore`). Clerk `auth()` is mocked, the clock is mocked
(the process runs in UTC like Vercel; each person has their own time zone and sends
their local date as `today`, as the app does), and the dish model is a fake that
returns raw model output, which then goes through the product's real parser, oil
repair and every server-side gate. No database is written; the only database access
in this work was the read-only `npm run sim:snapshot`.

**Result: no safety violation, no 5xx, no thrown error, no contract mismatch.
8 findings (0 Critical, 2 Important, 6 Minor).**

| | |
|---|---|
| People | 80: 77 on the new app (44 with a website profile first, 33 app-only), 3 on an old app build |
| Rule sets | the 19 combinations real users hold, 11 curated heavy combinations, 24 single rules, 6 random 3–8-rule mixes, 12 app-only mixes (their conditions + allergies), "every rule at once", 5 empty profiles |
| Journeys | 80 (day 0 first run, then 10 simulated days each) |
| Requests | 9,217 (status 200×6,974, 201×1,554, 404×187, 409×36, 422×148 — every 4xx asserted as expected) |
| Assertions | 494,732 |
| Clara dish calls | 318 (77 day plans, 88 for guests; 42 from the starting picture, 199 from logged levels) |
| Candidate dishes from the fake model | 757, of which 301 broke the person's rules (natural violators, a banned ingredient slipped into the list, an allergen named only in a step, "cooking oil") |
| Dishes served | 196 — **0 breaking a rule** (oracle: engine + independent Big-9 group table + allergen text scan); 98 "couldn't make one that fits" |

Old simulation on this code (`SIM_PAIRS=0 npm run sim:rules`): **PASS** — 394 profiles,
0 violations, 0 service errors, 35/35 tests, 603 s (`docs/qa/rule-compliance-sim.md`, regenerated).

## What each person did

Personas are seeded (age 13–85 incl. a 13th birthday on day 0 in Auckland and in Los Angeles,
ages 50/51 around the iron threshold, 85; sex; height in cm or ft/in; weight in kg or lbs; BMI
17–44; activity 1–4; weight goal lose/keep/gain/none; seven time zones from UTC−10 to UTC+13;
start dates 22 or 27 Oct so every journey crosses 1 Nov and the US DST change, and the earlier
ones the EU DST change).

- **Day 0, first run, exactly as `FirstRunViewModel.swift` sends it**: `GET /api/me` → `GET /api/onboarding`
  → step 1 `PATCH /api/patient/profile {healthConditionIds}` + `PUT {noCondition}` → step 2
  `PUT {usualEating (answered keys only), pills}` → step 3 `PATCH` basics + `foodAllergyIds` (app's own kg/lb
  and ft/in conversions) → step 4 `PUT {weightGoal}`. Flows: straight; stopped after step 1, 2 or 3 and
  reopened; every write sent twice; and "edit later" from Account (None ↔ conditions, untick a pill,
  basics re-sent from what the server returned). Answers: all unanswered, all "rarely", all "most days",
  the mockup sample, two partial patterns, random. Pills: none, all seven, Multivitamin only, others, and a
  website-style lowercase `"vitamin d"`.
- **Website people** first save a full web profile (diets, avoids, goals, conditions, allergies, `in` or `cm`
  heights, goal weights), a journal mood/notes day and maybe a pill; then the app sends them straight to the tabs.
- **Day 0 Numbers `full=1`**: must be the starting picture or the honest empty state.
- **Days 1–10**: 0–6 meals a day as library recipes (`POST /api/meal-log` RECIPE, only recipes that pass the
  person's rules, servings 0.5–2, idempotent replays), estimated takeaway entries (MANUAL, `estimated`, sodium
  sometimes, fibre sometimes), and Clara cook sessions (start → done → ate / ate some / didn't eat / ate twice /
  out of order / offline replay / two dishes in one chat); deletions; Numbers `full=1` and default, Log
  (some mornings, so Auckland is a day ahead of the server); Track all / a toggle / Clear all / phosphorus for
  non-kidney people; goals at 1 %, 100 %, 150 % of target, 400 % (refused) and cleared; weigh-ins (kg and lbs,
  twice in a day, on a day with journal notes); pills added with mg/g contents, edited to grams, unticked;
  `dish_suggest` (1 or 4 servings) and `dish_plan_today` (normal / eating out / guests / little time).
- **Old app** (3 people): only `POST/GET /api/meal-log`, `GET /api/numbers` (with and without `today`),
  `GET /api/supplements`, `GET /api/patient/profile`.
- **Ownership**: each person tries the previous person's chat (`cook ate`), pill (`PATCH`) and log (`DELETE`).

## Invariants checked at every step (all hold except the findings below)

- **No 5xx / no throw**; every response matches its wire contract exactly (keys, types, nullability, enums) —
  onboarding, full and old Numbers, Log, tracked, goals, weight, supplements, meal-log DTO, cook.
- **Safety**: nothing served by Clara breaks the person's *current* rules (oracle rebuilt from the person's own
  choices, never from the store); slipped-in banned names never reach the served text; stored allergies,
  conditions, diets, avoids and goals equal what the person chose after every onboarding step, double send,
  interruption and edit (no allergy was ever lost).
- **Honesty**: `word` null unless food is counted and logs are enough; `estimate` true iff an estimated pill
  contributes; amounts never negative/NaN; amounts over 20× target only when a pill explains it (B12 typical
  dose, see Observations); `source` logged / answers / none exactly as specified; the picture equals the plan's
  rules recomputed independently; no body-state wording in tool results or generator prompts; the answers path
  never says "this week" / "from what you logged" and always "from your answers".
- **Arithmetic** (independent ledger of what each person logged): window, daysCounted, enoughLogs (≥3 days with
  ≥2 meals), calories, protein, carbs, fibre, sodium/saturated fat/added sugar counted only when every meal
  carries them, servings applied once, deleted meals excluded, pills once a day with mcg/mg/g conversion, words
  at the exact thresholds, iron 8 mg for men and women over 50, protein/carbs/calories targets equal to the
  caloric engine's, weight in the person's unit with kg↔lbs round trips.
- **State**: Clear all persists through goal saves; a goal save never changes the tracked set; phosphorus only
  for kidney conditions (and refused otherwise); "ate" logs exactly one entry per chat and dish whatever the
  retries, the first answer's portion wins, "didn't eat" logs nothing, "ate" before "start" is 409; Log groups
  by the person's local date, newest first, with the right `estimated`/source; default `GET /api/numbers` is
  byte-identical before and after tracked, goal, pill and onboarding-answer writes; `me.onboardingComplete`
  agrees with onboarding `complete`; another person's chat, pill and log answer 404.
- **Old clients**: the old Numbers and meal-log shapes are unchanged (no `sodium`/`estimated`/`nutrients` leak).

## Findings

| # | Severity | What a person would experience | Reproduction (sim invariant) | Suspected cause | Suggested fix |
|---|---|---|---|---|---|
| 1 | Important | Numbers and Clara count a meal with **no fibre figure as 0 g**. 901 of 3,391 library recipes (27 %) have no fibre, and estimates often have none. The fibre amount is an undercount shown as fact; in the run, 750 Numbers responses said fibre was "little" while part of the week's fibre was unknown, and in 117 the word differs from the one the known meals alone give. Clara then says "you've had little fibre this week". Same for protein/carbs on the 37 recipes without them. | `honesty.fibre-unknown-as-zero` (77 people). Log any library recipe with `fiber: null` plus one with fibre for 3 days × 2 meals → `fibre.foodCounted: true`, amount halved, word "little". | `lib/macros.ts:221` (`recipe.fiber ?? 0`), `lib/level-summary.ts:75` (`r.fiber ?? 0`), `lib/numbers-full.ts:159,182` (fibre always "counted" when any day is) | Treat fibre like sodium: a day's fibre is known only when every meal carries it (`levelDaysFromRows`), and `foodCounted` false otherwise; or show "partly counted" and withhold the word. Decide whether the plan's "fibre counts whenever days are counted" ruling stands. |
| 2 | Important | With **one logged day** (often one meal) and no onboarding answers, Clara is handed `little: ["fibre"]`, shows the levels chip and says "Brown rice is rich in fibre, and you've had little this week." Numbers says nothing (word null, not enough logs) — the two screens disagree, and Clara's claim rests on a single day. | `honesty.clara-levels-need-enough-logs` (26 people; 27 of 28 cases had 1 logged day). New person, answers nothing, logs one meal, asks "What should I eat?". | `lib/levels.ts:61,81` gives fibre/sodium words with no `enoughLogs` gate; `lib/clara/skills/dish.ts:621,627` passes them to the model and the card when there is no picture | When `enoughLogs` is false and no picture exists, hand the model empty `little`/`aLot` plus a "not enough logged yet" note and build no reasons (the plan said "behaviour unchanged" here; slice-1 Review Focus 2 suggests otherwise). |
| 3 | Minor | A pill the person entered **on the website** (e.g. "vitamin d") shows ticked in the app but adds nothing on Numbers — no contents until they re-tick it in the first run, which website people never see (they go straight to the tabs). | `pills.catalogue-pill-counts` (8 website people). Website `POST /api/supplements {name:"vitamin d"}`, then `GET /api/numbers?full=1` → vitaminD `pillAmount 0`. | `lib/onboarding.ts:237` fills contents only on a PUT that ticks the pill; `lib/numbers-full.ts:150` reads no contents | On read (or in a one-off backfill), give catalogue-named pills with `contents: null` the typical contents with `estimated: true`. |
| 4 | Minor | Someone who closes the app on step 4 ("Is weight part of this?") never sees it again: after step 3 `me.onboardingComplete` is true, so the app opens the tabs; `weightGoal` stays null and the weight row stays hidden (until they find "Conditions and eating" in Account). | `onboarding.resume-step4` (5 people). Steps 1–3, then `GET /api/me` → `onboardingComplete: true`. | `lib/me.ts:70` = basics only; app `FirstRunViewModel.swift:132` | Either count `weightGoal` in the first-run completeness the app gates on, or accept it and note it in the spec (Review Focus 5 covers step 2 only). |
| 5 | Minor | Logging a library recipe drops its sodium even when the recipe has it (51 recipes do), so any day with such a log has sodium "not counted". Cooked dishes carry sodium, library logs never do. | `meallog.recipe-sodium` (9 people). `POST /api/meal-log {source:"RECIPE", recipeId:<recipe with sodium>}` → row `sodium: null`. | `app/api/meal-log/route.ts:71` does not select `sodium`; `lib/meal-log.ts:424` (resolveSnapshot RECIPE) never sets it | Select `Recipe.sodium` and store it per serving for RECIPE logs. |
| 6 | Minor | Re-saving untouched basics ("Conditions and eating" → Continue) moves the stored weight by 0.1 lb (e.g. 158.9 → 159.0), because the server sends `weightKg` rounded to 0.1 kg and the app converts it back. Harmless once, but it rewrites BMI and can mark a meal plan stale near the drift threshold. | `units.untouched-weight-stable` (8 people). | `lib/onboarding.ts:324`; app `FirstRunViewModel.swift:228–231` | Send the stored pounds too (or `weightKg` unrounded), and have the app resend the stored pounds when the field is untouched. |
| 7 | Minor | Editing basics from Account resets the weight unit to the phone's locale: a person who reads kg on a US-locale phone is switched to lbs (and vice versa). | `units.edit-keeps-weight-unit` (2 people). | App `FirstRunViewModel.swift:358` sends `usesMetric` from `Locale`; `GET /api/onboarding` does not carry `displayWeightUnit` | Add `displayWeightUnit` to the onboarding profile and start the toggle from it. |
| 8 | Minor | On their 13th birthday, a person east of UTC (Auckland morning) passes the app's age check but the server answers "Birthday must be a valid past date (age 13–120)" until later that day. | `onboarding.age13-accepted` (1 person). PATCH birthday = today − 13 years at 08:00 NZDT. | `app/api/patient/profile/route.ts:78` (365.25-day years from UTC midnight) | Compare calendar dates (`ageOn` in `lib/numbers-full.ts`) against the client's local date. |

## Observations (not defects)

- **Vitamin B12 from a pill reads ~104× target** ("250 of 2.4 mcg"): the typical B12 dose is 250 mcg and B12 has
  no upper limit, so no word is wrong, but the row's percentage is meaningless. Consider capping the bar text.
- **Sodium, saturated fat and added sugar almost never count**: they need every meal of every counted day to carry
  them; only 51 library recipes have saturated fat, and no RECIPE log carries sodium (finding 5). In the run no
  sodium/saturated-fat/added-sugar word ever appeared.
- **Stored tracked rows freeze the defaults**: a person who edited their tracked set and later adds a kidney
  condition gets phosphorus shown but untracked (by design: stored rows override defaults).
- **Old `GET /api/patient/profile`** now also returns `usualEating`, `startingPicture`, `weightGoal`, `noCondition`
  on `patient` (additive; old clients ignore unknown keys).
- **"Couldn't make one that fits"** came back for 98 of 318 fake-model calls — expected, since many were
  deliberately all-violating; see the live sample for the real model.

## Live sample (real dish generator, opt-in)

`SIM_LIVE=1 npm run sim:clara-live` — 8 people chosen for difficulty, one `dish_suggest` each, the product's own
retry policy, in-memory store with database URLs removed. Full table: `docs/qa/clara-live-sample.md`.

- 8 calls to `claude-haiku-4-5` (the product's `CLARA_MODEL`), 19,846 input + 17,392 output tokens
  (≈ $0.11 at $1 / $5 per million).
- 5 dishes served, **0 breaking a rule**; 21 raw candidates returned (none from the pregnancy call), none breaking a rule even before the gates.
- **3 of 8 got "couldn't make one that fits"**: vegetarian without eggs/dairy and CKD 1-2 + hypertension + vegan +
  tree nuts (3 compliant candidates each, all dropped by non-safety gates), and pregnancy + fish allergy (the
  model's output parsed to 0 candidates). Small sample, but worth a look before the phone test: the hardest
  profiles may often see no dish.
- Wording seen: logs path "Quinoa is rich in fibre, and you've had little this week."; answers path
  `from your answers` with little calcium, omega-3, vitamin D, vitamin B12 and the "never describe their body" note;
  empty profile "Nothing is logged yet this week".

## What this simulation cannot show

- **Real Postgres/Prisma behaviour**: the store mimics Prisma semantics (projection, unique/FK errors, lazy
  transactions with rollback, `createMany skipDuplicates`, NULLs distinct) but is not Postgres — isolation levels,
  JSONB key order, `FOR UPDATE` blocking and the unapplied migration itself are untested.
- **Concurrency**: everything runs one request at a time; overlapping PUTs, double taps racing through the
  non-atomic upserts and the row locks are not exercised.
- **The iOS UI**: request shapes are taken from `FirstRunViewModel.swift`, `NumbersService.swift` and
  `CookService.swift`; rendering, Dynamic Type, drag/what-if maths, notifications and offline queues are not run.
- **Real model behaviour** beyond the 8-call live sample; chat routing, the chat loop and `parts` streaming are not run
  (the dish tools are called directly).
- **Clerk, rate limits, Upstash, Sentry**: mocked or cleared (rate limits are reset before every request).
- Trigger trials, dislikes and custom plans/conditions are not settable through these routes and were left out of the
  personas (they are covered by `sim:rules`).

## Files

- `sim/clara-first.sim.ts` — personas, journeys, invariants, report (`npm run sim:clara-first`; run log in
  `sim/.snapshot/clara-first-run.md`, raw failures in `sim/.snapshot/clara-first-failures.json`).
- `sim/clara-dishes.ts` — fake model output: templates, library recipes, slipped-in and "cooking oil" variants.
- `sim/fake-db.ts` — `createClaraStore`, the writable in-memory store (the read-only `createFakePrisma` is unchanged).
- `sim/clara-live.sim.ts`, `sim/clara-live-key.ts` — the opt-in live sample.
- No product code (`app/`, `lib/`, `prisma/`) was changed; no test-only seam was needed (the model client is replaced
  with `mock.module` on `lib/anthropic.ts`).
