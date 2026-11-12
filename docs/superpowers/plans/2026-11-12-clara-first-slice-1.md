# Clara-first app, slice 1 ("the loop") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The existing iOS app opens as Clara with three tabs (Clara, Numbers, Log), suggests a dish from what the person has eaten, cooks it with them, and logs it from a notification.

**Architecture:** Reshape what exists. The backend gains one pure "levels" module, two read routes, one new Clara skill and a cook endpoint; chat replies gain typed parts sent only to clients that ask for them. The iOS app keeps its chat, stats and meal-log code and gains views on top of them. Removed features are commented out, never deleted.

**Tech Stack:** Next.js 14 App Router, Prisma/Neon, Anthropic SDK, `node --test` via `npm test`; SwiftUI iOS 17, XCTest, XcodeGen is NOT available (register new Swift files by hand in `project.pbxproj`, see `cycle.md` rule 6).

**Spec:** `docs/superpowers/specs/2026-11-11-clara-first-app-design.md` (slice 1 of §11). Mockups: https://claude.ai/artifact/Gt62BQR7usQRdKBLNUFWCK

**Repos:** backend `/Users/becks/Desktop/Orange Factory/wondish_02`; iOS `/Users/becks/Desktop/Orange Factory/Clara`.

## Global Constraints

- **Nothing is deleted.** Code for a removed feature is commented out or disconnected, with a one-line note: `// OFF 2026-11 (Clara-first, spec §8.6): <why>. Restore: <how>.`
- **Additive only.** Migrations add columns; no drops or alters. Existing API responses stay byte-identical for existing clients.
- **Everything is free.** No allowance, upgrade prompt or paywall is shown. Server keeps hidden safety caps only.
- **Safety.** Every dish Clara suggests passes `lib/diet-match.ts` server-side through the existing generator gates.
- **Wording.** Intake, never the body: "you've had little iron this week". Words are exactly `little`, `on track`, `within limit`, `a lot`.
- **Slice 1 levels are exactly six:** calories, protein, carbs, fat, fibre, sodium. Fibre and sodium are the only ones with words; calories, protein, carbs and fat use the caloric engine's targets.
- **Thresholds:** get-enough level under 70% of target is `little`; stay-under level over 100% is `a lot`. Sodium limit 2,300 mg. Fibre target 28 g.
- **Enough logs:** at least 3 of the last 7 days with 2 or more logged meals. Days with no logs are left out of averages.
- **App name:** the display name becomes `Clara`. No "by Wondish" in the chat header.
- **iOS branch:** create `feat/clara-first-slice-1` from `feat/clara-chat-upgrade`. Do not stage, revert or commit the four files already modified there (`project.pbxproj` hunks that are not yours, `OnboardingView.swift`, `Config/Debug.xcconfig`, `project.yml` hunks that are not yours) or `Clara/Clara.entitlements`.
- **Backend branch:** `feat/clara-first-slice-1` from `main`.
- **Gates after every backend task:** `npm test` green, `npx tsc --noEmit` clean of new errors. After every iOS task: build and unit tests green on an iPhone simulator.
- **UI work:** invoke `ui-ux-pro-max:ui-ux-pro-max` before editing any view (house rule). Colours and type come from `DesignSystem/Theme.swift`; touch targets 44pt or more.

## Review Focus

1. **A person with no logs at all** asks "What should I eat?": Clara says nothing is logged yet and still suggests a dish. Pinned in Task 2 and Task 5.
2. **A day with one snack logged** must not drag the 7-day average down as if it were a full day; it does not count toward "enough logs". Pinned in Task 2.
3. **"I ate it" tapped twice, or the notification action replayed offline:** one log entry, not two. Pinned in Task 6 and Task 12.
4. **An old app build** (no `parts` flag) talks to the new server: it gets plain text with the dish and reasons written out, never a blank reply. Pinned in Task 4.
5. **The dish generator returns nothing usable** (all candidates filtered by the rules): Clara says she couldn't make one that fits and offers to try again; no empty card. Pinned in Task 5.

---

## Backend (`wondish_02`)

### Task 1: Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_clara_first_slice1/migration.sql` (authored offline; applied at the release gate, never mid-task)

**Produces:** on `MealLog`: `sodium Float?`, `estimated Boolean @default(false)`. On `ClaraConversation`: `dishName String?`, `cookedAt DateTime?`, `recipe Json?`.

- [ ] **Step 1:** Add the five columns to the schema and write the matching `ALTER TABLE ... ADD COLUMN` SQL.
- [ ] **Step 2:** `npx prisma validate && npx prisma generate`. Expected: both succeed.
- [ ] **Step 3:** `npm test && npx tsc --noEmit`. Expected: green.
- [ ] **Step 4:** Commit `feat(db): columns for the Clara-first loop`.

### Task 2: Levels module (pure)

**Files:**
- Create: `lib/levels.ts`, `lib/levels.test.ts` (add `lib/levels.test.ts` is already covered by the `lib/*.test.ts` glob in `npm test`)

**Produces:**

```ts
export type LevelKey = "calories" | "protein" | "carbs" | "fat" | "fibre" | "sodium";
export type LevelWord = "little" | "on track" | "within limit" | "a lot";
export interface LevelRow { key: LevelKey; name: string; direction: "enough" | "under" | "match";
  amount: number | null; target: number | null; unit: "kcal" | "g" | "mg"; word: LevelWord | null; }
export interface LevelDayInput { localDate: string; meals: number;
  calories: number; protein: number; carbs: number; fat: number; fibre: number; sodium: number | null; }
export interface LevelSummary { fromDate: string; toDate: string; daysCounted: number;
  enoughLogs: boolean; levels: LevelRow[]; little: LevelKey[]; aLot: LevelKey[]; }
export const FIBRE_TARGET_G = 28;
export const SODIUM_LIMIT_MG = 2300;
export function summarizeLevels(days: LevelDayInput[],
  targets: { calories: number; protein: number; carbs: number; fat: number } | null,
  range: { fromDate: string; toDate: string }): LevelSummary;
```

- [ ] **Step 1: Write the failing tests**

```ts
test("averages only days that have a logged meal", ...)        // 7 days, 2 with logs → daysCounted 2
test("a day needs 2+ meals to count toward enoughLogs", ...)   // 3 days of 1 meal → enoughLogs false
test("3 days of 2 meals is enough", ...)                        // enoughLogs true
test("fibre under 70% of 28 g is 'little'", ...)                // 19 g → little; 20 g → on track
test("sodium over 2300 mg is 'a lot', at 2300 'within limit'", ...)
test("sodium null on every day gives amount null and word null", ...)
test("no days at all: every amount null, little and aLot empty, enoughLogs false", ...)
test("null targets: calories/protein/carbs/fat rows keep amount, target null", ...)
```

- [ ] **Step 2:** `npm test -- --test-name-pattern="levels"`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `summarizeLevels`. `little` and `aLot` list only fibre and sodium in slice 1.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(levels): 7-day level summary with words`.

### Task 3: Numbers and Log routes

**Files:**
- Create: `app/api/numbers/route.ts`, `app/api/log/route.ts`, `lib/log-view.ts`, `lib/log-view.test.ts`
- Modify: `lib/meal-log.ts` (carry `sodium` and `estimated` through `serializeMealLog` and the create path as optional fields)

**Consumes:** `summarizeLevels` (Task 2); `getDayTarget` from `lib/meal-log.ts`; journal weigh-ins.

**Produces:**
- `GET /api/numbers?days=7` → `{ summary: LevelSummary, weight: { value: number; unit: "lbs" | "kg"; change: number | null } | null }`. `days` is 1 to 31, default 7; anything else is 400.
- `GET /api/log?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ days: { date: string; entries: { id: string; mealType: string; name: string; source: string; estimated: boolean }[] }[] }`, newest day first, range capped at 31 days, default the last 14.
- `groupLogByDate(rows): LogDay[]` in `lib/log-view.ts` (pure).
- Both routes follow the existing route shape: Clerk `auth()` → JSON 401, `rateLimit`, patient lookup.

- [ ] **Step 1: Failing tests for `groupLogByDate`**: newest date first; entries in `loggedAt` order; soft-deleted rows excluded; a date with no rows is absent.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `groupLogByDate`, then the two routes. `weight` is null unless the patient has a goal weight; `change` is the latest weigh-in minus the one nearest 7 days earlier.
- [ ] **Step 4:** `npm test`. Expected: PASS. Then `curl -i localhost:3000/api/numbers` signed out. Expected: `401` with a JSON body.
- [ ] **Step 5:** Commit `feat(api): numbers and log read routes`.

### Task 4: Typed chat parts

**Files:**
- Modify: `lib/clara/ndjson.ts`, `lib/clara/types.ts`, `lib/clara/chat-service.ts`, `lib/clara/loop.ts`
- Create: `lib/clara/parts.ts`, `lib/clara/parts.test.ts`

**Produces:**

```ts
export type ClaraPart =
  | { kind: "levels"; little: { key: LevelKey; name: string }[]; aLot: { key: LevelKey; name: string }[] }
  | { kind: "dish"; dishId: string; name: string; minutes: number; calories: number;
      reasons: { level: string; direction: "up" | "down"; text: string }[] }
  | { kind: "steps"; dishId: string; steps: { n: number; text: string; timerMinutes: number | null }[] };
// ndjson.ts gains:  | { type: "part"; part: ClaraPart }
export function partAsText(part: ClaraPart): string;   // the fallback an old client reads
```

- A tool result may carry `parts: ClaraPart[]`. The loop emits each as a `part` event when the request body had `parts: true`; otherwise it appends `partAsText(part)` to the reply text. `parseClaraChatBody` accepts the optional boolean `parts`.
- Parts are stored with the assistant message so a reopened chat shows them again.

- [ ] **Step 1: Failing tests**: `partAsText` of a dish names the dish, the minutes and every reason; of levels reads "little: fibre; a lot: sodium"; of steps is a numbered list. Loop test: with `parts: false` no `part` event is emitted and the text contains the fallback; with `parts: true` the `part` event precedes `done`. Body parser: `parts` omitted → false; `parts: "yes"` → 400.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS, and every existing chat test still passes unchanged.
- [ ] **Step 5:** Commit `feat(clara): typed reply parts with a text fallback`.

### Task 5: Dish skill

**Files:**
- Create: `lib/clara/skills/dish.ts`, `lib/clara/skills/dish.test.ts`, `lib/dish-reasons.ts`, `lib/dish-reasons.test.ts`
- Modify: `lib/clara/registry.ts` (register the skill; add routing lines for "what should I eat" and "plan today's dishes")

**Consumes:** `summarizeLevels`; the existing generator pieces in `lib/fridge.ts` (`SUGGEST_RECIPES_SCHEMA`, `parseFridgeRecipes`, `applyAllergenFilter`) and the pricing in `lib/staple-density.ts`; `ClaraPart`.

**Produces:**

```ts
export function dishReasons(perServing: { fibre: number; sodium: number | null },
  summary: LevelSummary): { level: string; direction: "up" | "down"; text: string }[];
// tools
dish_suggest({ mealType: "breakfast"|"lunch"|"dinner"|"snack", maxMinutes?: number, servings?: number })
dish_plan_today({ occasion?: "normal"|"eating_out"|"guests"|"little_time" })
export interface DishDeps { loadSummary(patientId, today): Promise<LevelSummary>;
  generate(ctx, ask): Promise<FridgeRecipe[]>; loggedMealTypes(patientId, today): Promise<string[]>; }
```

- `dish_suggest` returns one dish as parts `[levels, dish]` and keeps the full recipe in the tool result for `cook` (Task 6).
- `dish_plan_today` returns one dish part per meal not yet logged today. `eating_out`: dinner is left out and the result says to send the menu. `guests`: dinner uses `servings: 6`. `little_time`: `maxMinutes: 20` for every meal.
- The prompt fragment tells Clara to ask "Anything happening today?" once, through `ask_choices`, with options exactly: `A normal day`, `Eating out`, `Guests or a party at home`, `Very little time`. It is optional: if the person already said, she skips it.
- Reason rules: fibre is `little` and the dish gives 25% or more of 28 g → `up`. Sodium is `a lot` and the dish has 350 mg or less per serving → `down`. At most three reasons; none is invented when a rule does not fire.

- [ ] **Step 1: Failing tests**: `dishReasons` for each rule and for "nothing fires → []". Skill: no logs → result text says nothing is logged yet and still returns a dish; generator returns `[]` → `{ ok: false }` with a "couldn't make one that fits" note and no parts; `dish_plan_today` skips a meal type already logged; `little_time` passes `maxMinutes: 20`; `guests` passes `servings: 6` for dinner only.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with injected `DishDeps`; the real `generate` calls the model once with the person's food map and runs the existing filters.
- [ ] **Step 4:** `npm test`, then `npm run clara:routing-eval`. Expected: PASS; "what should I eat tonight" routes to `dish_suggest`.
- [ ] **Step 5:** Commit `feat(clara): suggest a dish from the levels; plan today's dishes`.

### Task 6: Cooking session

**Files:**
- Create: `app/api/clara/conversations/[id]/cook/route.ts`, `lib/clara/cook.ts`, `lib/clara/cook.test.ts`
- Modify: `lib/clara/conversations.ts` (summary and detail gain `dishName`, `cookedAt`, `stepCount`; opt-in via `?cook=1` so the default response is unchanged)

**Produces:**
- `POST /api/clara/conversations/:id/cook` body `{ action: "start", dish: { dishId, name, recipe } }` → sets `title` and `dishName` to the dish name (60-char cap as `TITLE_MAX_CHARS`), stores `recipe`. Body `{ action: "done" }` → sets `cookedAt`. Body `{ action: "ate", portion: 1 | 0.5 }` → creates one `MealLog` (source `CLARA`, `servings` = portion, macros and sodium from the stored recipe, `clientRequestId` = `cook-<conversationId>`). Each returns `{ ok: true }`; a chat that is not the caller's is 404.
- `parseCookBody(raw): ParseResult<CookAction>`.

- [ ] **Step 1: Failing tests**: parser rejects unknown actions, a portion other than 1 or 0.5, and `start` without a recipe; `ate` before `start` is 409; `ate` twice creates one row (same `clientRequestId`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`; signed-out `curl -i -X POST .../cook`. Expected: PASS; `401` JSON.
- [ ] **Step 5:** Commit `feat(clara): cooking session, dish-named chats, log on "I ate it"`.

---

## iOS (`Clara`)

### Task 7: Branch, name, tab bar, free for all

**Files:**
- Modify: `Clara/App/RootTabView.swift`, `project.yml` (only the `CFBundleDisplayName` line → `Clara`) and the matching build setting in `project.pbxproj`, `Clara/Features/Account/AccountView.swift`, `Clara/Features/Account/SignedInView.swift`, `Clara/Features/Chat/ChatView.swift`
- Create: `Clara/Features/Numbers/NumbersView.swift`, `Clara/Features/Log/LogView.swift` (placeholders filled in Tasks 10 and 11)
- Test: `ClaraTests/RootTabTests.swift`

**Produces:** `RootTabView.Tab` cases `chat`, `numbers`, `log` (raw values the same), still launchable with `-tab <name>`. Account opens as a sheet from a person button at the top right of the Clara tab; saved chats stay at the top left.

- [ ] **Step 1: Failing test**: `RootTabView.Tab.allCases.map(\.rawValue) == ["chat", "numbers", "log"]`.
- [ ] **Step 2:** Run the test target. Expected: FAIL.
- [ ] **Step 3:** Comment out the Restaurants, Meal Plan, Cook and Account tab items with the OFF note; add the two new tabs (SF Symbols `chart.bar` and `calendar`). Comment out the `SubscriptionCard` row and every `PaywallStubView` presentation the same way. Their files stay in the project.
- [ ] **Step 4:** Build and test. Expected: PASS. Screenshot each tab with `-tab`.
- [ ] **Step 5:** Commit `feat(shell): Clara, Numbers, Log; app name Clara; paywall off`.

### Task 8: Ability cards

**Files:**
- Create: `Clara/Features/Chat/Components/AbilityCards.swift`, `ClaraTests/AbilityCardsTests.swift`
- Modify: `Clara/Features/Chat/ChatView.swift`, `Clara/Features/Chat/ChatViewModel.swift`, `Clara/Features/Chat/Components/StarterChips.swift` (commented out of the view, kept)

**Produces:** `struct Ability { let title: String; let subtitle: String; let symbol: String; let prompt: String }` and `Ability.sliceOne`, in this order with these titles: `What should I eat?`, `Plan today's dishes`, `Can I eat this?`, `Cook with me`, `I just ate…`, `How am I doing?`. `ChatViewModel.showAbilityCards: Bool` is true only for a new chat with an empty input and an unfocused field.

- [ ] **Step 1: Failing tests**: six abilities in that order; `showAbilityCards` false once `input` is non-empty; false when `isInputFocused` is true; true again when the field is empty and unfocused.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Two-column grid as on screen 2. Tapping a card calls `useSuggestion(prompt)`. Heading "What are we eating?".
- [ ] **Step 4:** Build, test, screenshot the empty chat focused and unfocused.
- [ ] **Step 5:** Commit `feat(chat): ability cards in the empty chat`.

### Task 9: Parts in the chat

**Files:**
- Modify: `Clara/Features/Chat/ClaraChatEvent.swift`, `Clara/Features/Chat/ChatMessage.swift`, `Clara/Features/Chat/ChatViewModel.swift`, `Clara/Features/Chat/Components/MessageBubble.swift`, the request encoding in `Core/Networking/WondishAPIClient.swift` (send `"parts": true`)
- Create: `Clara/Features/Chat/ChatPart.swift`, `Clara/Features/Chat/Components/LevelChipsView.swift`, `Clara/Features/Chat/Components/DishCardView.swift`, `ClaraTests/ChatPartDecodingTests.swift`

**Consumes:** the `part` event of Task 4.

**Produces:** `enum ChatPart: Decodable, Equatable { case levels(...), dish(DishPart), steps(StepsPart) }`; `ClaraChatEvent.part(ChatPart)`; `ChatMessage.parts: [ChatPart]`. The dish card has "Cook this with me" and "Something else" (the second sends that text).

- [ ] **Step 1: Failing tests**: each part kind decodes from the Task 4 JSON; an unknown `kind` is skipped without failing the stream; the request body contains `"parts":true`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, with fixtures `chatDishAdvice` wired to a launch argument for screenshots.
- [ ] **Step 4:** Build, test, screenshot against screen 3.
- [ ] **Step 5:** Commit `feat(chat): level chips and dish card`.

### Task 10: Numbers tab

**Files:**
- Create: `Clara/Features/Numbers/NumbersDTOs.swift`, `NumbersService.swift`, `NumbersViewModel.swift`; fill `NumbersView.swift`; `ClaraTests/NumbersViewModelTests.swift`
- Reuse: bar and card styling from `Features/Stats/StatsView.swift` (that file is left in place, no longer shown)

**Consumes:** `GET /api/numbers?days=7`.

**Produces:** the simple form of screen 8: title "Your numbers", "Last 7 days", the calories and weight card (weight half hidden when `weight` is null), one row per level with word, amount and bar with a target line. No Edit, drag or "What this supports" in slice 1. When `enoughLogs` is false, a line reads "Not enough logged yet. These are from the days you did log."

- [ ] **Step 1: Failing tests**: rows with a word of `little` or `a lot` sort first; a null amount shows "not logged" and no bar; states loaded, empty and error.
- [ ] **Step 2 to 4:** Run, implement with fixtures `numbersLoaded`, `numbersEmpty`, `numbersError`, screenshot each.
- [ ] **Step 5:** Commit `feat(numbers): levels for the last 7 days`.

### Task 11: Log tab

**Files:**
- Create: `Clara/Features/Log/LogDTOs.swift`, `LogService.swift`, `LogViewModel.swift`; fill `LogView.swift`; `ClaraTests/LogViewModelTests.swift`

**Consumes:** `GET /api/log`; `MealLogService.deleteLog(id:)` for swipe-to-delete.

**Produces:** screen 10. Section titles: "Today · Wed 11 Nov", "Yesterday · Tue 10 Nov", then "Mon 9 Nov". Source labels: `CLARA` → "Cooked with Clara", `PICTURE` → "From a photo", `MANUAL` → "From your note", `RESTAURANT` → "From a menu check", anything else → "Logged". An estimated entry shows "estimate".

- [ ] **Step 1: Failing tests**: section titles for today, yesterday and older dates (injected calendar and now); the source-label mapping; deleting removes the row and an emptied day.
- [ ] **Step 2 to 4:** Run, implement with fixtures, screenshot.
- [ ] **Step 5:** Commit `feat(log): dishes eaten, by day`.

### Task 12: Cooking mode and the notification

**Files:**
- Create: `Clara/Features/Cook/CookModeView.swift`, `CookModeViewModel.swift`, `CookService.swift`, `Clara/Core/Notifications/NotificationScheduler.swift`, `NotificationSettings.swift`, `Clara/Features/Account/NotificationSettingsView.swift`, `ClaraTests/CookModeViewModelTests.swift`, `ClaraTests/NotificationSchedulerTests.swift`
- Modify: `Clara/App/ClaraApp.swift` (register the category and handle actions), `Clara/Features/Account/AccountView.swift` (a "Notifications" row), `Clara/Features/Chat/ConversationListView.swift` and its DTO (request `?cook=1`; show "Cooked <day> · N steps" and a share button on those rows)

**Consumes:** the cook endpoint of Task 6; the `steps` part of Task 9.

**Produces:**
- Cooking mode as on screen 4: title is the dish name, "Cooking · step N of M", done steps above, the current step with "Start N min timer" when it has one and "Next step", later steps below, the chat input, and "Done cooking". Starting it calls `cook start`; "Done cooking" calls `cook done` and schedules the notification.
- `NotificationSettings` (stored in `UserDefaults`): `allowed: Bool` (default false) and `howWasTheDish: Bool` (default true). Meal check-in switches are added in slice 3, not now.
- `NotificationScheduler.scheduleAfterCooking(dishName:conversationId:now:)` schedules "How was the <dish>?" 30 minutes later with actions exactly `I ate it`, `I ate some of it`, `I didn't eat it`, only when both switches are on. The first two call `cook ate` with portion 1 or 0.5; the third does nothing.
- `NotificationSettingsView`: a main "Allow notifications" switch that triggers the system prompt the first time, and a "How was the dish?" switch disabled while the main one is off.
- Share on a cooked chat sends the dish name, ingredients and steps as text through the share sheet.

- [ ] **Step 1: Failing tests**: step navigation (next, cannot pass the last step); `scheduleAfterCooking` produces a trigger 1,800 seconds out and nothing when either switch is off; the action handler maps each action to the right portion; handling the same action twice sends one request (guarded by the notification id).
- [ ] **Step 2 to 4:** Run, implement, then on a simulator: cook a dish, tap "Done cooking", fire the pending notification, hold it, tap "I ate it", and confirm the dish appears in Log and Numbers.
- [ ] **Step 5:** Commit `feat(cook): cook together, done cooking, "How was it?"`.

### Task 13: Close-out

- [ ] **Step 1:** Backend `npm test`, `npx tsc --noEmit`, `npm run build`, `npx next lint`. iOS clean build and full test run.
- [ ] **Step 2:** Walk the loop on a simulator against a preview deploy: empty chat → "What should I eat?" → dish card → cook → Done cooking → notification → Log and Numbers updated.
- [ ] **Step 3:** Confirm nothing was deleted: `git diff --diff-filter=D --name-only main...HEAD` prints nothing in either repo.
- [ ] **Step 4:** Confirm an old client still works: `curl` the chat route without `parts` and read a text reply that names the dish.
- [ ] **Step 5:** Record the release gates in the cycle ledger: apply the Task 1 migration with `prisma migrate deploy` before the new routes are used; user does one live sign-in on a simulator.
