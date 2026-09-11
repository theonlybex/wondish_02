# Symptom journal, trigger trials and condition rules — design

Date: 2026-09-11 · Branch: `feat/workbooks-tier2` (stacked on `main` at `b7740e6`)
Sources: Wondish workbooks 05 (Symptom Journal), 04 (Trigger Trial Process),
03 (Baseline & Restriction Rules — deployable health rules only).
Approved in brainstorming: extend the existing journal and ban pipeline
(approach 1); staged delivery 05 → 04 → 03.

## Goals

1. A user with a health condition records that condition's symptoms in the
   daily journal, rated exactly as workbook 05 specifies.
2. A user with an eligible condition (GERD, Gastritis, Migraine, Acne,
   IBS-C, IBS-D) can run one trigger trial at a time on the 34-day workbook-04
   schedule; during elimination the trigger category is really removed from
   the meal plan, Clara generation and swaps.
3. The deployable workbook-03 condition rules become `bannedIngredients` rows
   for the conditions we can name.

Non-goals (v1): objective/lab items in the UI (imported only), concurrent
trials, clinician-started trials, the 4,477 REVIEW_REQUIRED workbook rules,
portion/carbohydrate budgets, adding conditions that only exist in the
workbook (IBS-M, Hypertriglyceridemia, Pregnancy, Leaky Gut, Autoimmune,
AERD).

## Condition name map (workbook `profile_factor_id` → `HealthCondition.name`)

| id | Workbook name | Ours |
|---|---|---|
| 340 | Acne | Acne |
| 3 | Alzheimer's Disease | Alzheimer's Disease |
| 345 | Cancer – After Treatment | Cancer – after treatment |
| 344 | Cancer – During Treatment | Cancer – during treatment |
| 7 | Celiac Disease | Celiac Disease |
| 55 | Chronic Diarrhea | Chronic Diarrhea |
| 2 | Chronic Inflammatory Conditions | Chronic Inflammatory Conditions |
| 8 | Constipation | Constipation |
| 347 | Eczema / Atopic Dermatitis | Eczema |
| 56 | Fatty Liver Disease (MASLD/NAFLD) | Fatty Liver Disease (NAFLD) |
| 10 | GERD | GERD |
| 9 | Gastritis | Gastritis |
| 57 | Gastrointestinal Candidiasis | Candidiasis |
| 343 | Hair Shedding | Hair Shedding |
| 5 | Heart Disease / Atherosclerosis | Heart Disease |
| 6 | High Blood Pressure | Hypertension |
| 11 | High Cholesterol | High Cholesterol |
| 348 | Inflammatory Bowel Disease – Active | IBD – active |
| 349 | Inflammatory Bowel Disease – Remission | IBD – in remission |
| 350 | IBS – Constipation Predominant | IBS-C |
| 351 | IBS – Diarrhea Predominant | IBS-D |
| 59 | Migraine | Migraine |
| 14 | Overweight | Overweight |
| 4 | Prediabetes / Type 2 Diabetes | Type 2 Diabetes **and** Prediabetes |
| 1 | Respiratory Allergies | Respiratory Allergies |
| 341 | Rosacea | Rosacea |
| 342 | Seborrheic Dermatitis | Seborrheic Dermatitis |
| 54 | Stroke | Stroke |
| 61 | Brain Fog | Foggy brain |

Unmapped ours (no workbook factor): Kidney Disease stage 1-2, Chronic kidney
disease – stage 3, Thyroid Disorder, PCOS, Recovering after illness/surgery.
The map is stored on `HealthCondition.profileFactorId` (two rows share 4).

## Data model (Prisma)

```prisma
model HealthCondition {           // existing, +1 column
  profileFactorId  Int?           // workbook id; not unique (Prediabetes/T2D share 4)
  trackingItems    ConditionTrackingItem[]
  triggerRules     TriggerRule[]
}

model ConditionTrackingItem {     // workbook 05: 274 symptoms + 49 objective items
  id          String  @id @default(cuid())
  code        String  @unique     // "JT-0108"
  conditionId String
  condition   HealthCondition @relation(...)
  category    TrackingCategory   // SYMPTOM | OBJECTIVE
  itemCode    String             // "HEARTBURN"
  label       String             // "Heartburn"
  inputSource String             // USER_REPORTED | LAB | DIAGNOSTIC_TEST | MEASUREMENT
  active      Boolean @default(true)
  symptoms    JournalSymptom[]
  triggerLinks TriggerRuleTrackingItem[]
  @@index([conditionId, category])
}
enum TrackingCategory { SYMPTOM OBJECTIVE }

model JournalSymptom {            // one row per entry per item; no row = not tracked
  id             String @id @default(cuid())
  journalEntryId String
  journalEntry   JournalEntry @relation(..., onDelete: Cascade)
  trackingItemId String
  trackingItem   ConditionTrackingItem @relation(...)
  severity       SymptomSeverity
  @@unique([journalEntryId, trackingItemId])
}
enum SymptomSeverity { NOT_PRESENT MILD MODERATE SEVERE }

model TriggerRule {               // workbook 04: 55 rows
  id                 String @id @default(cuid())
  code               String @unique   // "TR-001"
  conditionId        String
  condition          HealthCondition @relation(...)
  category           String           // "ACIDIC_CITRUS"
  action             String           // workbook default_action_code
  baselineDays       Int              // 7
  trialDays          Int              // 28
  reintroductionDays Int              // 3
  washoutDays        Int              // 3
  doseDependent      Boolean
  examples           String           // workbook example_ingredients_or_exposures
  symptomsToMonitor  String
  safetyNote         String?
  sourceUrl          String?
  active             Boolean @default(true)
  monitored          TriggerRuleTrackingItem[]
  // terms are looked up by `category` in TriggerCategoryTerm (no FK)
  trials             TriggerTrial[]
  @@index([conditionId])
}

model TriggerRuleTrackingItem {   // workbook 04/05 links: 393 rows
  ruleId         String
  trackingItemId String
  @@id([ruleId, trackingItemId])
}

model TriggerCategoryTerm {       // authored (appendix A), admin-editable later
  id       String @id @default(cuid())
  category String                  // "ACIDIC_CITRUS"
  term     String                  // ingredient phrase, matched like a ban
  group    String?                 // optional Big-9 group code (FODMAP_FRUCTANS → BIG9-WHEAT)
  @@unique([category, term])
  @@index([category])
}

model TriggerTrial {
  id             String @id @default(cuid())
  patientId      String
  patient        Patient @relation(..., onDelete: Cascade)
  ruleId         String
  rule           TriggerRule @relation(...)
  startDate      DateTime          // day 1 of elimination (date only, local midnight)
  status         TrialStatus       // ACTIVE | STOPPED | COMPLETED
  classification TrialClassification?   // TOLERATED | DOSE_DEPENDENT | LIKELY_TRIGGER
  baselineScore  Float?            // frozen at evaluation
  eliminationScore Float?
  challengeScore Float?
  lastPhase      String?           // phase seen at the last read; a change flips mealPlanStale
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([patientId, status])
}
enum TrialStatus { ACTIVE STOPPED COMPLETED }
enum TrialClassification { TOLERATED DOSE_DEPENDENT LIKELY_TRIGGER }
```

Invariant: at most one `ACTIVE` trial per patient (enforced in the start
route inside a transaction; a partial unique index on `(patientId) WHERE
status = 'ACTIVE'` is added in the migration SQL).

## Trial schedule (`lib/trials/schedule.ts`, pure)

Given `startDate` and `today` (both local dates), `dayNumber = days(today −
startDate) + 1` and the phase is:

| Phase | Days | Enforced ban |
|---|---|---|
| BASELINE | −6 … 0 (7 days before day 1) | no |
| ELIMINATION | 1 … 28 | yes |
| EVALUATION | 28 (same day, shown as a step) | yes |
| REINTRODUCTION | 29 … 31 | no |
| WASHOUT | 32 … 34 | yes |
| FINAL | 34 onward until classified | yes |

A trial can be started with `startDate = today + 7` (baseline first, the
default) or `startDate = today` (skip baseline; the evaluation then has no
baseline score and says so). `phaseFor(trial, today)` returns `{ phase,
dayInPhase, phaseLength, dayNumber, nextPhaseOn }`.

## Enforcement (diet-match)

- `BanSource` gains `"trial"`.
- `PatientDietGraph` gains optional `triggerTrials: { status, startDate,
  classification, rule: { category, terms: { term, group }[] } }[]`.
  `PATIENT_DIET_INCLUDE` includes it (`where: { status: { in: [ACTIVE,
  COMPLETED] } }`).
- `derivePatientBans(patient, today = new Date())`: for each trial —
  ACTIVE and phase ∈ {ELIMINATION, EVALUATION, WASHOUT, FINAL} → its terms
  become `exactBanned` with source `"trial"` and its groups join the banned
  groups with source `"trial"`; COMPLETED with `LIKELY_TRIGGER` → the same
  ban, kept until the user clears it. "Clear" sets `status = STOPPED` and
  keeps the classification for the history, which releases the ban.
- `buildFoodMapText` adds `Trigger trial: eliminating ACIDIC_CITRUS (day 12
  of 28) — never include: orange, lemon, …` during enforced phases, and
  `Trigger trial: reintroducing ACIDIC_CITRUS — include a normal portion once
  a day` during REINTRODUCTION.
- Every caller of `derivePatientBans` keeps working unchanged (the new field
  is optional); the plan builder, top-up, swap, What-to-buy, cookable and
  taste therefore all honour the trial with no new filtering code.
- Starting, stopping, classifying a trial, and the daily phase change into
  or out of an enforced phase set `patient.mealPlanStale = true`. Phase
  changes are detected lazily: the trials GET and the meal-plan status route
  compare the phase now with `trial.lastPhase` (new column) and flip the
  flag when it differs.

## Scoring (`lib/trials/score.ts`, pure)

- severity → 0/1/2/3; a day's score = mean over the rule's monitored items
  that have a row that day; days with no rows are skipped.
- `phaseScore(days)` = mean of day scores (null when fewer than 3 logged
  days).
- `evaluate({ baseline, elimination })` → `{ improvementPct | null,
  suggestion: "PROCEED" | "STOP_RESTRICTION" | "INSUFFICIENT_DATA" }`;
  PROCEED when improvement ≥ 30 %.
- `classify({ elimination, challenge })` → suggested classification:
  challenge > elimination + 0.5 → LIKELY_TRIGGER; otherwise TOLERATED;
  DOSE_DEPENDENT is never suggested, only chosen by the user (the app cannot
  measure dose). The user confirms; the confirmed value is stored.

## API

- `GET /api/journal?date=` — response gains `symptoms: { trackingItemId,
  severity }[]` and `trackingItems: { id, label, conditionName, inTrial }[]`
  (the items to ask today, trial-linked first).
- `PATCH /api/journal` — body gains optional `symptoms: { trackingItemId,
  severity | null }[]`; null deletes the row; rows are upserted inside the
  existing entry transaction; unknown/inactive item ids → 400.
- `GET /api/journal/symptoms?days=30` — per-day mean severity for the
  Journey trend card.
- `GET /api/trials` — `{ eligible: TriggerRule[] (for the user's
  conditions, minus the active/completed categories), active: TrialView |
  null, history: TrialView[] }` where `TrialView` = trial + phase + scores +
  suggestion + terms.
- `POST /api/trials` `{ ruleId, skipBaseline?: boolean }` → 409 if an
  ACTIVE trial exists, 403 if the rule's condition is not on the profile.
- `PATCH /api/trials/:id` `{ action: "stop" | "classify" | "clear",
  classification?, notes? }`.
- All routes use the existing auth + rate-limit pattern; trial routes are
  free-tier features (no AI spend).

## UI

- **Daily journal (QuickJournalLog and JournalForm):** a `symptoms` step
  after `activity`, present only when `trackingItems.length > 0`. Each item
  is a row with four 44-px chips (Not present / Mild / Moderate / Severe);
  tapping the selected chip clears it. Trial-linked items carry a small
  "trial" tag. More than 8 items → "Show all" disclosure. The journal day
  view lists logged symptoms with severity.
- **Journey page:** "Symptoms" card — 30-day line of mean severity with the
  active trial's phases shaded; empty state when nothing logged. "Trigger
  trials" card — active trial summary or "Start a trial" link.
- **`/trials` page** (dashboard nav item "Trials", shown only when the user
  has an eligible condition or any trial): eligible categories as cards
  (title from the category, workbook examples, safety note, source link,
  "Start" with the baseline choice); the active trial as a 6-step timeline
  with day counters, "what to avoid" chips, the current instruction from the
  workbook's `implementation_rule`, scores and the suggestion at evaluation
  and final; buttons Stop, Confirm classification, and "Generate a new week"
  (calls the existing new-week route when `mealPlanStale`); history list
  with classification badges and a "Clear ban" action on LIKELY_TRIGGER
  rows.
- Copy rule: the app suggests, the user decides; every trial screen shows
  the workbook's safety note and "not medical advice".

## Workbook 03 rules import (`scripts/import-condition-rules.ts`)

- Resolve `profile_factor_id` through the name map; skip unmapped factors
  and report them.
- Import rows with `deployment_gate_code = DEPLOYABLE` and
  `selected_action_code ∈ {DO_NOT_AUTO_INCLUDE, AVOID}` whose
  `ingredient_id` resolves to an `Ingredient.formId` we hold; the ban name
  is our ingredient's name. Rows resolving to a gluten-free product for
  Celiac are skipped (component group covers wheat).
- Report, do not import: NEUTRAL, PORTION_LIMIT, CARBOHYDRATE_BUDGET,
  PRODUCT_LABEL_REVIEW, ALLOW*, and every REVIEW_REQUIRED row.
- Dry-run default, `--apply`, idempotent; after applying, re-run the
  per-condition pool audit and fix false positives before committing the
  data step.

## Seeding

`scripts/import-workbooks.ts` gains `--phase c` (05 tracking items, 04
rules and links, appendix-A terms) using the existing dry-run/apply/rollback
pattern; `--phase d` is the 03 rules import above.

## Testing

- Unit: `lib/trials/schedule.test.ts` (every phase boundary, skip-baseline,
  timezone-safe date math), `lib/trials/score.test.ts` (thresholds, null
  cases), `lib/diet-match.test.ts` (trial source on/off by phase, LIKELY_TRIGGER
  persistence, clear releases), `lib/food-map.test.ts` (trial lines),
  `lib/workbooks/*` readers for 04/05.
- Route tests for `/api/trials` (409 on second trial, 403 on foreign
  condition, phase-change flips `mealPlanStale`).
- E2E (Playwright harness, desktop QA account): log symptoms in the journal;
  start a GERD ACIDIC_CITRUS trial with baseline skipped; regenerate the week;
  assert no citrus ingredient in the plan; move `startDate` back in the DB to
  reach evaluation, reintroduction and final; confirm a classification;
  assert the LIKELY_TRIGGER ban persists and "Clear ban" releases it.

## Appendix A — trigger category terms (authored, v1)

Terms are matched like condition bans (phrase, derived-product exemption).
Groups use the Big-9 component codes.

- ACIDIC_CITRUS: orange, oranges, orange juice, grapefruit, lemon, lemons, lemon juice, lime, limes, lime juice
- ACIDIC_TOMATO: tomato, tomatoes, roma tomatoes, cherry tomatoes, crushed tomatoes, sun-dried tomatoes, tomato sauce, tomato paste, tomato juice, ketchup, marinara sauce
- ALCOHOL: wine, beer, vodka, rum, whiskey, sake, liqueur, cooking wine
- CHOCOLATE, CHOCOLATE_UNCERTAIN: chocolate, dark chocolate, dark chocolate chips, cocoa, cocoa powder
- CAFFEINE, COFFEE_CAFFEINE, CAFFEINE_INSTABILITY: coffee, espresso, black tea, green tea, matcha, energy drink, cola
- HIGH_FAT, HIGH_FAT_GREASY, HIGH_FAT_FRIED: french fries, fried chicken, onion rings, bacon, sausage, ribeye steak, heavy cream, cream sauce, unsalted butter, salted butter, lard
- MINT: peppermint, spearmint, mint, mint tea
- SPICY: chili peppers, jalapeño, habanero, cayenne pepper, hot sauce, sriracha, red pepper flakes, chili powder, wasabi
- CARBONATED: soda, sparkling water, carbonated water, club soda, tonic water
- FODMAP_FRUCTANS: garlic, onion, onions, yellow onions, red onion, shallots, leeks, rye; group BIG9-WHEAT
- FODMAP_GOS: black beans, white beans, kidney beans, lima beans, pinto beans, navy beans, garbanzo beans, chickpeas, lentils, hummus
- FODMAP_LACTOSE: milk, whole milk, ice cream, ricotta, cottage cheese, heavy cream, sour cream, condensed milk
- FODMAP_EXCESS_FRUCTOSE: honey, apple, apples, pear, pears, mango, watermelon, agave, high fructose corn syrup
- FODMAP_POLYOLS: mushrooms, cauliflower, avocado, avocados, peach, plum, cherries, apricot, sorbitol, xylitol, mannitol, maltitol
- CURED_PROCESSED_MEAT: bacon, ham, salami, pepperoni, prosciutto, deli meat, hot dogs, sausage, chorizo
- AGED_CHEESE: parmesan, cheddar, aged cheddar, blue cheese, gorgonzola, gouda, swiss cheese, feta, brie, camembert
- MSG: monosodium glutamate, msg, bouillon, stock cube
- ARTIFICIAL_SWEETENERS: aspartame, sucralose, saccharin, acesulfame, diet soda
- HISTAMINE_TYRAMINE_RICH: sauerkraut, kimchi, soy sauce, fish sauce, miso, smoked fish, anchovies, parmesan, blue cheese, salami, wine
- HIGH_GLYCEMIC_PATTERN: white sugar, brown sugar, candy, soda, sliced bread, jasmine rice, all-purpose flour, maple syrup, honey
- COW_MILK: milk, whole milk, skim milk, 2% milk
- WHEY_PROTEIN: whey protein, whey, protein powder
- HIGH_SUGAR_DAIRY: ice cream, chocolate milk, sweetened yogurt, milkshake, condensed milk
