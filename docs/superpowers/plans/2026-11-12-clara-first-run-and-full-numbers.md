# Clara first run and full Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new person finishes onboarding inside the app (condition, usual eating and pills, basics and allergies, goal), and the Numbers tab shows all 21 levels with Edit, pills that count, the what-if drag, "What this supports", Reset and "Save as my goal".

**Architecture:** The server owns the level catalogue (names, groups, units, targets, directions, areas, typical pill doses) and sends it with the numbers, so the app holds no nutrient tables. Onboarding writes through the existing profile PATCH plus one new onboarding route. The app adds a `FirstRun` feature shown by the root gate when `me.onboardingComplete` is false, and grows `Features/Numbers` in place.

**Tech Stack:** Next.js 14 App Router, Prisma (Postgres), Clerk `auth()`, `node --import tsx --test`; SwiftUI iOS 17+, XCTest, hand-registered `project.pbxproj`.

**Spec:** `docs/superpowers/specs/2026-11-11-clara-first-app-design.md` (§3, §6, §8). Mockups: scratchpad `clara-canvas/project/Main.dc.html`, `Onboard2.dc.html`, `Numbers.dc.html` (the controller pastes the relevant values into each brief; implementers do not need the files).

**Repos and branches:** server `/Users/becks/Desktop/Orange Factory/wondish_02`, app `/Users/becks/Desktop/Orange Factory/Clara`. Both on a new branch `feat/clara-first-run-and-numbers` cut from `feat/clara-first-slice-1`.

## Global Constraints

- Nothing is deleted. Code that leaves is commented out as `// OFF 2026-11 (Clara-first, spec §8.6): <why>. Restore: <how>.` followed by the original lines commented.
- Never edit, stage, stash, revert or commit these user files in the app repo: `Clara/Features/Onboarding/OnboardingView.swift`, `Config/Debug.xcconfig`, `Clara/Clara.entitlements`. Stage files by name, never `git add -A`.
- No push, merge, migration apply (`prisma migrate deploy/dev`, `db push`) or deploy. Write migration SQL by hand; `npx prisma generate` is allowed.
- Migrations only add. No column or table is dropped or altered.
- `GET /api/numbers` without `full=1` stays byte-identical. Existing meal-log and supplement responses stay byte-identical for existing clients (new fields may be added to supplement objects only under the new `contents`/`estimated` keys).
- Wording is intake, never body state: "you've had little iron", never "your iron is low". Words: `little`, `on track`, `within limit`, `a lot`, `more than needed`.
- Every amount says where it came from. Typical pill doses and the starting picture are labelled "An estimate".
- Nothing is pre-selected for a real person in onboarding.
- No plans, allowances or paywall anywhere.
- Server: hand-written validation (no zod), `auth()` from `@clerk/nextjs/server`, `rateLimit` from `lib/rate-limit.ts` on every new route, pure functions with injected deps for tests. `npx tsc --noEmit` and `npm test` must stay at 2 known baseline failures (billing copy, chat-service date).
- App: Inter via `WFont`, colours via `WColor`, spacing `WSpacing`, 44pt minimum tap targets, VoiceOver labels on every control, Dynamic Type must not truncate. UI tasks invoke the `ui-ux-pro-max:ui-ux-pro-max` skill before writing views. Register new files in `Clara.xcodeproj/project.pbxproj` by hand (PBXBuildFile, PBXFileReference, group child, Sources phase), ids continuing after `C1AC00000000000000000099`.
- App tests: `xcodebuild test -project Clara.xcodeproj -scheme Clara -destination 'id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1' -only-testing:ClaraTests/<Suite>`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Rulings made in the plan (controller's calls)

- **Food micronutrients are not counted yet.** Ingredients and the dish pricing table hold no minerals or vitamins, and filling them needs a USDA data run against the database. This plan builds every screen and all plumbing; the 13 mineral/vitamin/omega-3 rows show pills only, marked "Food not counted yet", with no word. Saturated fat and added sugar count for recipe-sourced logs only.
- Remaining levels on `MealLog` and `Ingredient` are one `nutrients` JSON column each, not 15 columns.
- A pill's contents are a JSON list on `Supplement` (a multivitamin feeds many levels).
- Upper limits for "more than needed" use the NIH adult tolerable upper intake levels as placeholders, flagged for the clinician.
- The live starting picture is computed on the phone with the same rules as the server; the server recomputes and stores at save. Both test files carry the same five vectors.
- Weight row shows when the weight goal is lose or gain (or a goal weight already exists). No goal weight number is asked.
- The ten common-condition chips map to database conditions on the server.

## Review Focus

1. A person who answers nothing on "usual eating" taps Continue: the picture is empty lists, not a crash, and Numbers says so.
2. Numbers with zero logged days and no answers: no bars, a plain empty state, Edit still works.
3. Clear all in Edit: "Nothing is tracked yet." and the areas panel shows no word rather than "short".
4. Dragging a row whose food is not counted (pills only): the drag is disabled, not a fake number.
5. Onboarding interrupted after step 2 and reopened: answers are restored from the server, the person resumes at the first unanswered step.

---

## Shared wire contracts

`LevelKey` (server `lib/level-catalogue.ts`, app `String`): `protein, carbs, fibre, addedSugar, saturatedFat, sodium, omega3, potassium, calcium, iron, magnesium, zinc, iodine, vitaminA, vitaminB6, vitaminB12, vitaminC, vitaminD, vitaminE, vitaminK, folate, phosphorus`. (`calories` and `fat` stay in the old `LevelKey` of `lib/levels.ts`, untouched.)

**`GET /api/onboarding`** →
```json
{ "complete": false,
  "conditions": [{ "id": "…", "name": "…", "common": true, "label": "High blood pressure" }],
  "allergies": [{ "id": "…", "name": "…" }],
  "activities": [{ "id": "…", "name": "…" }],
  "profile": { "conditionIds": [], "noCondition": false, "birthday": null, "sexAtBirth": null,
               "heightCm": null, "weightKg": null, "activityId": null, "allergyIds": [] },
  "usualEating": { "veg": null, "fruit": null, "beans": null, "grains": null, "fish": null,
                   "meat": null, "dairy": null, "packaged": null, "sweet": null },
  "pills": ["Vitamin D"],
  "weightGoal": null,
  "startingPicture": { "little": [{ "key": "fibre", "name": "Fibre" }], "aLot": [] } }
```
`usualEating` values: `0` rarely, `1` some days, `2` most days, `null` unanswered. Pill names: `Vitamin D, Vitamin B12, Multivitamin, Omega-3, Magnesium, Iron, Calcium`. `weightGoal`: `lose | keep | gain | none | null`.

**`PUT /api/onboarding`** body: any of `usualEating`, `pills`, `weightGoal`, `noCondition`. Returns the same shape as GET. Conditions, basics and allergies go through the existing `PATCH /api/patient/profile` (weight in lbs, height in cm; the app converts).

**`GET /api/numbers?full=1&days=7&today=YYYY-MM-DD`** →
```json
{ "summary": { "fromDate": "…", "toDate": "…", "daysCounted": 5, "enoughLogs": true },
  "source": "logged",
  "calories": { "amount": 1840, "target": 1900 },
  "weight": { "value": 78.4, "unit": "kg", "change": -0.6 },
  "levels": [{ "key": "iron", "name": "Iron", "group": "minerals", "direction": "enough",
               "unit": "mg", "target": 18, "upperLimit": 45, "amount": 8.6, "pillAmount": 0,
               "foodCounted": false, "estimate": false, "word": null, "tracked": true, "goal": null }],
  "areas": [{ "key": "energy", "name": "Energy", "uses": ["iron", "vitaminB12", "folate", "magnesium", "vitaminC", "iodine"] }],
  "startingPicture": null }
```
`source`: `logged` (enough logs), `answers` (not enough logs and a stored picture; `startingPicture` is filled), `none`. `group`: `food | minerals | vitamins`. `direction`: `enough | under | match`. `amount` is the daily average of food plus pills; when `foodCounted` is false it equals `pillAmount` (or `null` when that is 0) and `word` is `null`.

**`PUT /api/numbers/tracked`** body `{ "tracked": ["iron", "fibre"] }` → `{ "tracked": [...] }`.
**`PUT /api/numbers/goals`** body `{ "goals": [{ "key": "fibre", "amount": 30 }] }` (`amount: null` clears) → `{ "goals": [{ "key", "amount" }] }`.
**`POST /api/journal`** (exists) `{ date, weight }` in lbs stores a weigh-in.
**Supplements** (exists) gain optional `contents: [{ "key": LevelKey, "amount": number, "unit": "g"|"mg"|"mcg" }]` and `estimated: boolean` on create, update and list.

---

### Task 1: Migration and level catalogue (server)

**Files:**
- Create: `prisma/migrations/20261112180000_clara_first_run_numbers/migration.sql`, `lib/level-catalogue.ts`, `lib/level-catalogue.test.ts`
- Modify: `prisma/schema.prisma`, `package.json` (test glob only if the new test is not already matched)

**Interfaces — Produces:**
- Schema (all additive): `Patient.usualEating Json?`, `Patient.startingPicture Json?`, `Patient.weightGoal String?`, `Patient.noCondition Boolean @default(false)`; `Supplement.contents Json?`, `Supplement.estimated Boolean @default(false)`; `MealLog.nutrients Json?`; `Ingredient.nutrients Json?`; new model `TrackedLevel { id, patientId, levelKey String, tracked Boolean @default(true), goal Float?, direction String?, target Float?, updatedAt; @@unique([patientId, levelKey]) }`.
- `LEVELS: readonly LevelDef[]` where `LevelDef = { key: LevelKey; name: string; group: "food"|"minerals"|"vitamins"; unit: "g"|"mg"|"mcg"; direction: "enough"|"under"|"match"; target: number; upperLimit: number|null; kidneyOnly?: true }`, in the spec §6.1 order with the mockup's targets (protein 50 g, carbs 275 g match, fibre 28 g, added sugar 50 g under, saturated fat 20 g under, sodium 2300 mg under, omega-3 250 mg, potassium 4700 mg, calcium 1300 mg, iron 18 mg, magnesium 420 mg, zinc 11 mg, iodine 150 mcg, vitamin A 900 mcg, B6 1.7 mg, B12 2.4 mcg, C 90 mg, D 20 mcg, E 15 mg, K 120 mcg, folate 400 mcg, phosphorus 1250 mg under kidneyOnly).
- `targetFor(def, person: { sexAtBirth: "MALE"|"FEMALE"|null; age: number|null }): number` — iron 8 mg for men and for women over 50; everything else the catalogue value.
- `wordFor(def, amount, target): LevelWord|null` per spec §6.2 (enough: <70% little else on track, above `upperLimit` more than needed; under: ≤100% within limit else a lot; match: 70–130% on track).
- `AREAS: readonly { key; name; uses: LevelKey[] }[]` — Energy (iron, vitaminB12, folate, magnesium, vitaminC, iodine), Mood (magnesium, vitaminB12, folate, vitaminC), Muscles (protein, magnesium, potassium, calcium, vitaminD), Heart (sodium, saturatedFat, potassium, omega3, fibre), Blood sugar (carbs, fibre, addedSugar), Digestion (fibre).
- `defaultTracked(conditionNames: string[]): LevelKey[]` — research-doc table matched case-insensitively by substring (`blood pressure|hypertension`; `diabet`; `cholesterol|heart`; `kidney` → sodium, potassium, phosphorus, protein; `pcos|polycystic|fatty liver`; `celiac|coeliac`; `pregnan`); union across conditions; none matched → protein, fibre, addedSugar, sodium, iron, vitaminD.
- `TYPICAL_PILLS: Record<PillName, { key: LevelKey; amount: number; unit }[]>` — Vitamin D 25 mcg; Vitamin B12 250 mcg; Omega-3 300 mg; Magnesium 250 mg; Iron 18 mg; Calcium 500 mg; Multivitamin = 100% of target for vitamins A, B6, B12, C, D, E, K, folate, plus zinc 11 mg and iodine 150 mcg.

- [ ] Write `lib/level-catalogue.test.ts`: 22 keys, unique, order; `wordFor` at 69% / 70% / 100% / 101% / 130% / 131% and above the upper limit; `targetFor` iron (female 30 → 18, male → 8, female 60 → 8, unknown → 18); `defaultTracked([])` equals the six defaults; `defaultTracked(["Chronic Kidney Disease stage 1-2"])` includes phosphorus; every `AREAS.uses` and `TYPICAL_PILLS` key exists in `LEVELS`.
- [ ] Run it; expect failure (module missing).
- [ ] Add schema fields, write the migration SQL by hand (`ALTER TABLE … ADD COLUMN`, `CREATE TABLE "TrackedLevel"` with FK to `Patient` on delete cascade and the unique index), run `npx prisma generate`.
- [ ] Implement `lib/level-catalogue.ts`. Upper limits (NIH adult ULs, placeholder): calcium 2500 mg, iron 45 mg, magnesium null, zinc 40 mg, iodine 1100 mcg, vitamin A 3000 mcg, B6 100 mg, C 2000 mg, D 100 mcg, E 1000 mg, folate 1000 mcg; others null. Comment: "Placeholder for clinician review".
- [ ] `npm test` and `npx tsc --noEmit`; commit `feat(numbers): level catalogue and tables for first run and full numbers`.

### Task 2: Starting picture and onboarding route (server)

**Files:**
- Create: `lib/starting-picture.ts`, `lib/starting-picture.test.ts`, `lib/onboarding.ts`, `lib/onboarding.test.ts`, `app/api/onboarding/route.ts`
- Modify: `lib/supplements.ts` (accept `contents`, `estimated`), `app/api/supplements/route.ts`, `app/api/supplements/[id]/route.ts`

**Interfaces — Consumes:** Task 1 catalogue and schema. **Produces:**
- `startingPicture(answers: UsualEating, pills: PillName[]): { little: LevelKey[]; aLot: LevelKey[] }` — the mockup rules exactly, treating `null` as unanswered: a rule fires only when every answer it reads is non-null. Rules (v = answers, has = pill taken, multi = Multivitamin): fibre if veg+fruit+beans+grains ≤ 3; iron if beans+meat ≤ 1 and !Iron; potassium if veg+fruit+beans ≤ 2; calcium if dairy = 0 and !Calcium; omega3 if fish = 0 and !Omega-3; vitaminD if fish < 2 and !Vitamin D and !multi; vitaminB12 if meat = 0 and dairy = 0 and !Vitamin B12 and !multi; vitaminC if veg+fruit ≤ 1 and !multi; magnesium if beans+grains+veg ≤ 1 and !Magnesium. A lot: sodium if packaged = 2; addedSugar if sweet = 2; saturatedFat if meat = 2 and dairy = 2.
- `validateOnboardingBody(body): { ok: true; value } | { ok: false; error; field }`.
- `commonConditions(all: { id; name }[]): { id; name; common: boolean; label: string }[]` — the ten chips (Type 2 diabetes, High blood pressure, High cholesterol, Acid reflux (GERD), IBS, Celiac disease, Kidney disease, PCOS, Fatty liver, Migraine) matched to database names; read `lib/condition-groups.ts` for the real names; a chip with no match is omitted; "Kidney disease" maps to the stage 1-2 row.
- `GET`/`PUT /api/onboarding` per the wire contract, rate limit `onboarding` 60/60s. PUT with `pills` reconciles `Supplement` rows: a named pill not present is created with `contents = TYPICAL_PILLS[name]`, `estimated = true`, `timeSlot "MORNING"`; a typical-dose pill (`estimated = true`, same name) no longer listed is soft-deleted; pills the person edited (`estimated = false`) are never touched. PUT recomputes and stores `startingPicture`.
- Supplement validation: `contents` optional array ≤ 30, each key a `LevelKey`, amount > 0 and ≤ 100000, unit one of g/mg/mcg; `estimated` optional boolean.

- [ ] Tests first: the five shared vectors (all null → both empty; the mockup sample `{veg:1,fruit:1,beans:0,grains:1,fish:0,meat:1,dairy:1,packaged:2,sweet:1}` no pills → little [fibre, iron, potassium, omega3, vitaminD], aLot [sodium]; same with Multivitamin + Iron + Omega-3 → little [fibre, potassium]; all 2 → little [], aLot [sodium, addedSugar, saturatedFat]; all 0 → all nine little, aLot []); partial answers do not fire rules that read a null; validation rejects value 3, unknown pill, unknown goal; `commonConditions` with the names from `condition-groups.ts`.
- [ ] Implement, run tests, `tsc`.
- [ ] Commit `feat(onboarding): usual-eating answers, pills and the starting picture`.

### Task 3: Full numbers API (server)

**Files:**
- Create: `lib/numbers-full.ts`, `lib/numbers-full.test.ts`, `app/api/numbers/tracked/route.ts`, `app/api/numbers/goals/route.ts`
- Modify: `app/api/numbers/route.ts` (branch on `full=1` only), `lib/level-summary.ts` (select `nutrients`), `lib/meal-log.ts` (`resolveSnapshot` for RECIPE source writes `nutrients: { saturatedFat, addedSugar }` per serving when the recipe has them)

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
- `buildFullNumbers(input: { days: FullDay[]; range; macroTargets: {calories, protein, carbs}|null; person; conditionNames: string[]; pills: { contents: PillContent[]; estimated: boolean }[]; trackedRows: { levelKey; tracked; goal }[]; picture: {little; aLot}|null; weight }): FullNumbers` — pure; the wire contract above. `FullDay = { localDate; meals; protein; carbs; fibre; sodium: number|null; saturatedFat: number|null; addedSugar: number|null }` (the last three null unless every meal that day carries the value).
- Rules: protein and carbs targets come from `macroTargets` when present. `foodCounted` is true for protein, carbs, fibre when `daysCounted > 0`; for sodium, saturatedFat, addedSugar when every counted day has a value; false for all others. Pills count every day: `pillAmount` = sum of contents for that key converted to the level's unit. `estimate` is true when any contributing pill is `estimated`. `tracked`: stored rows if the person has any, else `defaultTracked(conditionNames)`. `phosphorus` is returned only when a condition name contains `kidney`. `word` is null when `foodCounted` is false or `enoughLogs` is false.
- `validateTrackedBody`, `validateGoalsBody` (unknown key → 422 `{error, field}`; goal amount > 0 and ≤ 3× target·(upper bound 100000)).
- Routes: `PUT /api/numbers/tracked` replaces the tracked set (upsert all 22 keys with tracked true/false); `PUT /api/numbers/goals` upserts `goal`. Rate limits `numbers-write` 60/60s. `weight` in the full response is filled when `weightGoal` is `lose`/`gain` or `goalWeight` is set.

- [ ] Tests first: zero days → `source "none"`, all amounts null except pills; pills only (Vitamin D 25 mcg estimated) → vitaminD amount 25, pillAmount 25, foodCounted false, word null, estimate true; 5 days ≥2 meals with fibre 15 g → fibre word `little`, foodCounted true; a day missing sodium → sodium foodCounted false; not enough logs with picture → `source "answers"` and `startingPicture` filled with names; stored tracked rows override defaults; kidney condition adds phosphorus; mg↔mcg↔g conversion; without `full=1` the route's output for a fixed input equals the pre-change JSON (snapshot through the existing pure summary function).
- [ ] Implement, run, `tsc`, `npm run lint`.
- [ ] Commit `feat(numbers): full levels, tracked set, goals and pills that count`.

### Task 4: Clara uses the starting picture (server)

**Files:** Modify `lib/clara/skills/dish.ts`, `lib/clara/skills/dish.test.ts`.

**Interfaces — Consumes:** `Patient.startingPicture`. **Produces:** when the level summary has `enoughLogs === false` and a stored picture exists, `dish_suggest`/`dish_plan_today` give the model the picture's `little`/`aLot` names with the phrase `from your answers` (never `from what you logged`), and the `levels` part is omitted (no amounts exist). With no picture, behaviour is unchanged.

- [ ] Test: deps return `enoughLogs: false` + picture → model input contains "from your answers" and the names; no `levels` part emitted. With `enoughLogs: true` → unchanged output (existing tests still pass).
- [ ] Implement behind an injected `loadStartingPicture(patientId)` dep; commit `feat(clara): advise from the starting picture until there are enough logs`.

### Task 5: First-run model layer (app)

**Files:**
- Create: `Clara/Features/FirstRun/FirstRunDTOs.swift`, `FirstRunService.swift`, `StartingPicture.swift`, `FirstRunViewModel.swift`; `ClaraTests/StartingPictureTests.swift`, `ClaraTests/FirstRunViewModelTests.swift`
- Modify: `Clara.xcodeproj/project.pbxproj`

**Interfaces — Produces:**
- `protocol FirstRunProviding: Sendable { func load() async throws -> OnboardingDTO; func save(_ patch: OnboardingPatch) async throws -> OnboardingDTO; func saveProfile(_ patch: ProfilePatch) async throws }` — `GET/PUT /api/onboarding`, `PATCH /api/patient/profile`.
- `enum StartingPicture { static func compute(answers: [FoodGroup: Int], pills: Set<String>) -> (little: [String], aLot: [String]) }` returning display names; same rules and the same five vectors as the server test.
- `@Observable @MainActor final class FirstRunViewModel` with `step: Step (.condition, .eating, .basics, .goal)`, `state (.loading, .ready, .failed)`, selections, `canContinue`, `next()`, `back()`, `picture`, `isSaving`, `saveError`, and `onFinished: () -> Void`. Each `next()` saves that step before advancing; a failed save stays on the step with an inline retry message. On load, the first step with missing answers is shown. Basics validation mirrors the server: age 13–120, height 90–250 cm, weight 50–700 lbs after conversion; units kg/cm or lb/ft-in chosen by a toggle, default from `Locale.current.measurementSystem`.

- [ ] Tests first (`StartingPictureTests`: five vectors; `FirstRunViewModelTests`: nothing pre-selected, Continue disabled on step 1 until a condition or None; None clears conditions and vice versa; step 2 Continue is always enabled; resume lands on the first incomplete step; failed save keeps the step and sets `saveError`; basics validation bounds; finishing calls `onFinished` once).
- [ ] Implement, register files, run the two suites, commit `feat(first-run): onboarding model, service and starting picture`.

### Task 6: First-run screens and root gate (app)

**Files:**
- Create: `Clara/Features/FirstRun/FirstRunView.swift`, `ConditionStepView.swift`, `EatingStepView.swift`, `BasicsStepView.swift`, `GoalStepView.swift`, `FirstRunChrome.swift` (header "C" mark + "Clara", "n of 4", four-segment progress, sticky Continue)
- Modify: `Clara/App/RootGate.swift`, `ClaraTests/RootGateTests.swift`, `Clara/App/LaunchFixtures.swift`, `Clara/Features/Account/SignedInView.swift`, `project.pbxproj`

**Interfaces — Consumes:** Task 5. **Produces:** `RootDestination.firstRun` when signed in and `me.onboardingComplete == false`; after `onFinished`, `SessionStore.refreshMe()` and the tabs show. Fixtures `firstRunCondition`, `firstRunEating`, `firstRunBasics`, `firstRunGoal` (stub provider, each opening on that step). Account's "finish setup" web banner is commented out (OFF note) and replaced by a row "Conditions and eating" that presents `FirstRunView` as a sheet.

Screen content (exact copy):
- Step 1: "Do you live with a health condition?" / "I'll cook around it and watch the numbers that matter for it. You can change this later." Chips for `common` conditions (check mark when on), "Show all 41 conditions" (uses the real count) opening a searchable list sheet, card "None, I just want to eat better". No "by Wondish".
- Step 2: "How do you usually eat?" / "Quick answers give me a starting picture of your numbers. It gets exact as you log." Nine rows (Vegetables, Fruit, Beans and lentils, Whole grains, Fish, Meat and eggs, Milk, yogurt, cheese, Packaged or salty food, Sweet drinks) each with Rarely / Some days / Most days; "Do you take any of these?" chips; card "Your starting picture" + "An estimate", lines "Probably little" and "Probably a lot" with chips or "nothing stands out".
- Step 3: "A few basics" / "These set your calorie and protein targets." Birthday, Sex (Female / Male), Height, Weight, "How active are you?" (server activities), then "Any allergies?" chips from the server list with "None".
- Step 4: "Is weight part of this?" / "Only if you want it to be." Options: Lose weight, Keep my weight, Gain weight, Not now. Button "Start".

- [ ] Invoke `ui-ux-pro-max:ui-ux-pro-max` first.
- [ ] Update `RootGateTests` for the new destination (fail first), implement gate.
- [ ] Build views and fixtures; run the full `ClaraTests` suite.
- [ ] Launch each fixture in the simulator and save screenshots to `<workspace>/screens/first-run-<step>.png`; check at the largest Dynamic Type size that nothing truncates.
- [ ] Commit `feat(first-run): onboarding screens and root gate`.

### Task 7: Full Numbers model layer (app)

**Files:**
- Modify: `Clara/Features/Numbers/NumbersDTOs.swift`, `NumbersService.swift`, `NumbersViewModel.swift`, `ClaraTests/NumbersViewModelTests.swift`, `Clara/App/LaunchFixtures.swift`
- Create: `Clara/Features/Numbers/NumbersWhatIf.swift`, `ClaraTests/NumbersWhatIfTests.swift`; modify `project.pbxproj`

**Interfaces — Produces:**
- `FullNumbersDTO` decoding the wire contract; `NumbersProviding` gains `fullNumbers(days:today:)`, `setTracked(_:)`, `saveGoals(_:)`, `logWeight(kg:date:)` (converts to lbs for `POST /api/journal`). The old `numbers(days:today:)` call is commented out with an OFF note where it is no longer used.
- `enum NumbersWhatIf`: `static func word(direction:percent:overUpper:) -> Word`, `static func coverage(direction:percent:) -> Double` (enough: min(pct,100)/100; under: pct ≤ 100 → 1 else max(0, 1 − (pct − 100)/50); match: as enough up to 100, then as under past 130), `static func area(uses:percents:) -> AreaWord?` (mean coverage over levels that have a percent; ≥ 0.85 covered, ≥ 0.65 partly, else short; nil when none have one).
- `NumbersViewModel.Content` gains: `rows: [Row]` (tracked only, attention first ordered by logged values so a dragged row never jumps), `Row { key, name, word, tone, amountText, loggedPercent, percent (0…150), pillPercent, hasPill, canDrag, note ("Food not counted yet" | nil), goalText }`, `editGroups` (three groups of all levels with `isTracked`), `areas`, `status ("From what you logged" | "From your answers" | "Trying a change" | "Goal saved")`, `isChanged`, `startingPicture`, `mode (.bars | .picture | .empty)`. Actions: `drag(key:percent:)`, `reset()`, `saveGoal() async`, `toggleTracked(key:)`, `trackAll()`, `clearAll()`, `commitEdit() async`, `submitWeight(_:) async`. Failed saves restore the previous state and set `actionError`.
- Fixtures: `numbersFull` (mockup sample incl. vitamin D and omega-3 pills), `numbersFullAnswers` (source answers), `numbersFullEdit` (opens in Edit), keeping the old three.

- [ ] Tests first: what-if maths at the thresholds; rows order stable under drag; `canDrag` false when `foodCounted` is false; Clear all → empty rows and areas nil; `saveGoal` sends only changed rows as amounts (percent × target / 100) and sets "Goal saved"; failure restores; `source "answers"` → `.picture` mode; zero data → `.empty`.
- [ ] Implement, register, run suites, commit `feat(numbers): full levels model, what-if and goals`.

### Task 8: Full Numbers screen (app)

**Files:**
- Modify: `Clara/Features/Numbers/NumbersView.swift`
- Create: `Clara/Features/Numbers/LevelSliderRow.swift`, `SupportsPanel.swift`, `NumbersEditView.swift`, `WeightEntrySheet.swift`, `StartingPictureCard.swift`; modify `project.pbxproj`

**Interfaces — Consumes:** Task 7.

Content (mockup `Numbers.dc.html`):
- Header "Your numbers" / "Last 7 days" and an Edit / Done pill button.
- Card: "Calories a day" `1,840 of 1,900`; "Weight" value and change (neutral colour); tapping weight opens `WeightEntrySheet` ("Today's weight", number field, Save).
- Caption: "The line is your daily target. The lighter part comes from pills. Drag a level to try a change."
- Rows: name, word chip (`levelLittle*` amber, `levelALot*` crimson, `levelOnTrack*` teal), pill mark + amount `8.6 of 18 mg`; 8pt track, fill to percent/150, lighter pill share at the end of the fill, target tick at 2/3, 22pt thumb with a 44pt drag area; VoiceOver adjustable (`accessibilityAdjustableAction`, 5% steps) with value "<amount> of <target>". Rows with `canDrag == false` show no thumb and the note.
- "Add or remove levels" link; "Nothing is tracked yet." when empty.
- Edit mode: "Choose what you want to track. Pills count too: tell Clara what you take and it is added to these levels." / Track all / Clear all / groups "From food", "Minerals", "Vitamins" with a round check or plus per row; then section "Pills I take" listing supplements with their contents and "An estimate" where typical, each removable (uses the existing `SupplementProviding`).
- Footer panel: "What this supports" + status; six tiles (covered teal / partly amber / short crimson, word in text as well as colour); Reset (disabled when unchanged) and "Save as my goal".
- `.picture` mode: `StartingPictureCard` ("Your starting picture", "An estimate", the two lists) with the line "Log a few meals and this turns into your real numbers." in place of bars; panel hidden.

- [ ] Invoke `ui-ux-pro-max:ui-ux-pro-max` first.
- [ ] Build views; old `LevelRowView` and bar are commented out with OFF notes if replaced.
- [ ] Run the full `ClaraTests` suite.
- [ ] Simulator screenshots of `numbersFull` (resting and after a drag), `numbersFullEdit`, `numbersFullAnswers`, `numbersEmpty` to `<workspace>/screens/numbers-*.png`; check largest Dynamic Type and dark mode do not break layout.
- [ ] Commit `feat(numbers): full Numbers screen with edit, what-if and goals`.
