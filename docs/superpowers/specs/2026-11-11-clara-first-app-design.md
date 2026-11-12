# Clara-first app: Clara, Numbers, Log — Design

**Status: DRAFT, awaiting user approval (2026-11-11).**

Two repos. The backend and website live here (`wondish_02`). The iOS app is the
existing Wondish app at `/Users/becks/Desktop/Orange Factory/Clara` (bundle
`io.wondish.clara`, branch `feat/clara-chat-upgrade`, which has uncommitted
onboarding work). No new app.

- Mockups (16 screens, accepted by the user): https://claude.ai/artifact/Gt62BQR7usQRdKBLNUFWCK
- Nutrient list and what each supports: `docs/research/nutrient-levels-2026-11-11.md`
  (written with 18 levels; this spec uses the 21 in §6.1).

Screen numbers below (1, 1b, 2 … 10) are the artboard titles on the canvas.

## Intent

The iOS app becomes a food coach you talk to. Clara knows what you have eaten,
tells you what to eat next and why, cooks it with you, and keeps the record
without the person doing bookkeeping. The app has three tabs: **Clara**,
**Numbers**, **Log**.

Why now: a Reddit call for beta testers got no takers. The pitch read as one
more AI meal planner, and trying the product meant an account, ten onboarding
steps and twelve pantry items before anything came back. This shape gives a
person something in the first minute and keeps the part nobody else has: every
answer is checked against that person's own conditions and rules.

### Decisions already made (do not reopen)

- Clara is the main product. The weekly meal plan, journal, trials, grocery
  list, restaurants directory and fridge stop being screens in the app. Their
  backends stay.
- Three tabs, in this order: Clara, Numbers, Log. Fridge comes later.
- A health condition is the first onboarding question ("none" is allowed).
  The condition decides which levels show first. Its name is not shown on the
  Numbers screen.
- Weight loss is not in the pitch. Weight is one row on Numbers, shown only if
  the person chose a weight goal.
- Wording is about intake, never the body: "you've had little iron this
  week", never "your iron is low".
- Logging happens as a side effect: "Done cooking" then a notification 30
  minutes later; a meal check-in notification; a note or a picture.
- Notifications are separate, small, at the top of the screen, and show only
  the question. Holding one opens the options. The meal note opens from its
  notification at full size with typing already active.
- No "by Wondish" under "Clara" in the chat header for now.
- Numbers has an Edit mode to add or remove levels, and pills count toward a
  level.

## Goals

1. **First run in the app.** A new person answers the condition question, how
   they usually eat, and the basics Clara needs for targets, without leaving
   the app. Today the profile can only be completed on the website and Clara
   refuses to chat until it is.
2. **Clara says what she can do.** The empty chat shows a card per ability.
   The cards disappear when the text box is tapped.
3. **Dish advice from the numbers.** Asked what to eat, Clara names what the
   person has had little or a lot of, suggests one dish, and says which
   ingredient moves which number.
4. **Cook together.** Step-by-step mode with a timer and "Done cooking". The
   chat takes the dish's name so it can be found and shared later.
5. **Menu photo.** A photo of a menu comes back as Yes, No or "Ask the
   kitchen" per dish, against the person's own rules.
6. **Notifications that log.** After cooking, a meal check-in, and "What did
   you have?", as mocked in 6a to 7b.
7. **Numbers.** Levels against a daily target, food and pills together, a
   what-if drag, the "What this supports" panel, Reset and Save as my goal, an
   Edit mode, and weight as one row.
8. **Log.** Dishes eaten, listed by date.

## Non-goals (v1)

- A Fridge tab. Restaurants, Meal Plan, Cook, Journal and Supplements tabs
  leave the tab bar; nothing is built to replace them as screens.
- Changing the website. It keeps working as it does today.
- Android, Apple Health, blood-test import, barcode scanning.
- Clara messaging first in the chat. She reaches out through notifications
  only.
- Renaming the app in the App Store. The header says "Clara"; the store name
  is a separate decision (§10).
- New paywall rules. Existing budgets and guards apply (§8.4).

## Anti-goals (failure even if it "works")

- **A wrong "Yes".** A dish that breaks an allergy or condition rule must
  never show Yes. The rules engine decides, not the model's opinion. Anything
  the menu does not spell out is "Ask the kitchen".
- **Body claims.** No "your iron is low", no predicted mood, no diagnosis.
  The areas panel reports what the food covers.
- **Guesses shown as facts.** A number that comes from a questionnaire, a
  photo or a typed note is marked as an estimate everywhere it appears.
- **Silent writes.** Clara still logs or changes data only after a yes. A tap
  on "I ate it" in a notification is that yes.
- **Notification spam.** A check-in never repeats for the same meal on the
  same day, and none fire for a meal that is already logged.
- **Breaking what is installed.** Every API change is additive (`cycle.md`
  standing rule 2). The website and the current app build keep working.

## 1. What already exists and is reused

Nothing in this table is rewritten.

| Area | What exists | Where |
|---|---|---|
| Clara chat engine | Streaming chat, five tool rounds, confirm-before-write, cost backstops | `app/api/clara/chat`, `lib/clara/*` |
| Saved chats and memory | Conversation list, reopen, memories, 180-day purge | `app/api/clara/conversations`, `memories`; iOS `ConversationListView`, `MemoriesView` |
| Answer boxes | Tappable suggested answers plus "Other" | `lib/clara/ask-choices.ts`; iOS `AnswerChoicesView` |
| Clara's tools | Profile (read), logs (search, day summary, create, delete), nutrition (day, range, targets), plan (get, alternatives, mark done, log eaten, swap) | `lib/clara/skills/*` |
| Rules engine | Bans from allergies, foods to avoid, 41 conditions, diets, trials; enforced server-side | `lib/diet-match.ts`, `lib/food-map.ts` |
| Recipe generation and safety gates | Generated dishes with amounts and steps, truthful names, raw-protein rule, salt and oil clamps, macros computed from amounts | `lib/fridge.ts`, `lib/clara/recipe-generation.ts`, `lib/dish-plausibility.ts`, `lib/staple-density.ts` |
| Meal log | Entries with source (manual, recipe, picture, fridge, restaurant, Clara), idempotent retry, soft delete, delta sync | `MealLog`, `app/api/meal-log`; iOS `MealLogService` |
| Targets | Daily calories and macros from the caloric engine | `lib/caloric-engine.ts`, `lib/meal-log.ts` |
| Today's stats on iOS | Calories and macros against target, last 7 days, today's log | iOS `Features/Stats` |
| Supplements | Name, free-text dosage, time slot, daily intake ticks | `Supplement`, `SupplementIntake`, `app/api/supplements`; iOS `Features/Supplements` |
| Conditions and profile | Profile API, 41 conditions, custom conditions | `app/api/patient/*` |
| Accounts, billing, limits | Clerk, Stripe, coupons, AI budgets, rate limits | unchanged |
| iOS foundations | Networking, session, NDJSON client, design system (crimson, cream, Inter) | iOS `Core`, `DesignSystem` |

## 2. What is new

### Backend (`wondish_02`)

| # | Piece | Notes |
|---|---|---|
| B1 | Level catalogue and per-person tracking | The 21 levels of §6.1, each person's tracked set, per-person direction and target, saved goals |
| B2 | Nutrient data | Per-ingredient values for the levels not held today; dish pricing and the meal log carry every level |
| B3 | Numbers API | Levels over a date range: amount, target, share from pills, word (little / on track / a lot), estimate flag, the areas panel |
| B4 | Log API | Entries grouped by local date for a range. May be an extension of the existing meal-log read |
| B5 | Clara tool: suggest a dish | Reads the levels, generates one dish through the existing generator and gates, returns the dish plus which ingredient moves which level |
| B6 | Cooking session | Structured steps with optional timers; "done cooking" marks the session, sets the chat title to the dish name |
| B7 | Image input for Clara | A photo attached to a chat message: a menu or a meal |
| B8 | Menu check | Photo to dish list, each dish through the rules engine, verdict Yes / No / Ask the kitchen with one reason |
| B9 | Log from a note or a photo | "Chicken wrap and an apple" or a meal photo becomes a log entry marked as an estimate |
| B10 | Structured supplements | What a pill contains (level and amount) so pills can count |
| B11 | Onboarding answers | Usual-eating answers and pills, the starting picture derived from them |
| B12 | Structured chat parts | Level chips, dish card, verdict list and cooking steps as typed parts of a reply, not prose |

### iOS (`Clara`)

| # | Piece | Notes |
|---|---|---|
| A1 | Tab bar | Clara, Numbers, Log. Account moves behind the person icon in the Clara header |
| A2 | Empty chat cards | Replace `StarterChips` |
| A3 | Rich chat parts | Renders B12 |
| A4 | Cooking mode | Screen 4 |
| A5 | Camera and photo attach | In the chat input bar |
| A6 | Notifications | Local notifications, hold-to-open options, the full-size meal note |
| A7 | Numbers tab | Screen 8, both view and Edit modes. Grows out of `Features/Stats` |
| A8 | Log tab | Screen 10 |
| A9 | Onboarding questions | Screens 1 and 1b plus the basics step |
| A10 | Saved chats | Dish-named rows and share. Extends `ConversationListView` |

## 3. Onboarding (screens 1, 1b)

1. **Condition** (screen 1). Ten common conditions as chips, "Show all 41",
   and "None, I just want to eat better". More than one may be chosen. Saved
   through the existing profile and conditions API.
2. **How you usually eat** (screen 1b). Nine food groups, each Rarely / Some
   days / Most days, then "Do you take any of these?" with common pills. The
   "starting picture" strip updates as answers change and is labelled "An
   estimate".
3. **Basics.** Birthday, sex, height, weight, activity. These are what the
   caloric engine needs; without them there is no calorie target and Clara
   will not chat. *My call: this step is not mocked, and it reuses the fields
   and validation of the web wizard.*
4. **Goal.** Lose, keep or gain weight, or "not now". Only "lose" or "gain"
   turn on the weight row. *My call: not mocked.*

Allergies and foods to avoid are safety-critical and are not in the four
steps. *My call: the basics step ends with one "Any allergies?" question that
uses the existing allergy list; the full list stays editable in Account.*

The starting picture is words only: a list of levels the person probably gets
little of and a list they probably get a lot of. It has no amounts. *My call:
turning "fish: some days" into milligrams needs a model nobody has written or
signed off.* The answers and the two lists are stored. Until the person has
enough real logs (§6.4), Numbers shows those two lists in place of bars and
amounts, and Clara uses them for advice. The rules that produce the lists are
the placeholder ones in the mockup until the clinician replaces them.

Nothing is pre-selected for a real person. The mockup's filled answers are
samples.

## 4. Clara

### 4.1 Empty chat (screen 2)

One card per ability. Tapping a card fills the message box with that request.
Tapping the message box hides the cards; they return if the box is empty and
loses focus. A card ships only when the ability behind it works.

| Card | Backed by | In v1 |
|---|---|---|
| What should I eat? | B5 | Yes |
| Check a menu | B7, B8 | Yes |
| Can I eat this? | Existing dish check | Yes |
| Cook with me | B6 | Yes |
| I just ate… | B9 and existing logs tools | Yes |
| How am I doing? | B3 and existing nutrition tools | Yes |
| Plan today's dishes | B5, run once per meal | Yes |
| Find my trigger foods | Needs a trials tool | Later |

"Plan today's dishes" replaces "Plan my week" (user, 2026-11-12). Clara may
first ask one optional question, "Anything happening today?", as answer
boxes: A normal day / Eating out / Guests or a party at home / Very little
time / Other. She then proposes breakfast, lunch and dinner for today, fitted
to the levels and to the answer: an "eating out" meal is left open with a
note to send her the menu, a party gets a dish that scales to several people,
"little time" caps the cooking time. Each dish has "Cook this with me". Meals
already logged today are skipped. *The answer options are my call.*

*My call: "Find my trigger foods" is on the mockup but has no Clara tool
today. It is left off the first release.*

### 4.2 Dish advice (screen 3)

Asked what to eat, Clara:

1. Reads the levels for the last 7 days.
2. Says in one sentence what the person has had little of and a lot of, with
   a chip per level. If nothing stands out she says so and suggests on taste.
3. Suggests one dish with time, calories and up to three reasons. Each reason
   names a level, a direction, and the ingredient responsible.
4. Offers "Cook this with me" and "Something else".

The dish comes from the existing generator and passes every existing gate
(bans, plausibility, safety, computed macros). The reasons are computed from
the dish's own priced ingredients, not written freely by the model, so a
reason can never claim something the dish does not contain.

With no logs and no starting picture, Clara suggests from the condition and
says she has nothing logged yet.

### 4.3 Cooking together (screen 4)

- The chat's title becomes the dish name when cooking starts.
- Steps are shown one at a time with the done ones above and the next ones
  below. A step may carry a timer.
- The person can ask questions mid-recipe in the same chat.
- "Done cooking" ends the session, schedules the after-cooking notification
  for 30 minutes later, and leaves the recipe in the saved chat.
- Share sends the recipe as text through the system share sheet. *My call: a
  shareable link is a later step.*

### 4.4 Menu photo (screen 5)

1. The person attaches a photo of a menu.
2. The dishes are read off the photo with the ingredients each one states or
   plainly implies.
3. Each dish goes through the rules engine with those ingredients.
4. Verdict per dish:
   - **No** when a stated or plainly implied ingredient breaks a rule, or the
     dish would push a limit level the person is already over.
   - **Ask the kitchen** when the dish could contain a banned ingredient and
     the menu does not settle it (a sauce, a marinade, a "house" anything).
     Any dish for a person with an allergy defaults here unless every
     ingredient is stated.
   - **Yes** only when nothing above applies.

   **Decided by the user (2026-11-12):** when the person has allergies, every
   menu check opens with a reminder to tell the kitchen about them, and lists
   them by name ("Tell the kitchen you are allergic to: peanuts, shellfish").
   The rule for the verdicts themselves:
   - The model lists each dish's stated ingredients and separately flags any
     part it cannot see into (sauce, marinade, dressing, broth, batter,
     "house" items). The rules engine runs on the stated ingredients. Any
     flagged part that could hold a banned ingredient makes the dish "Ask".
   - A person with an allergy never gets Yes from a photo. Their best verdict
     is "Ask the kitchen", with what to ask about.
   - A No based on a level ("likely very salty") is allowed from the model's
     estimate and is worded as likely.
5. Each row has one short reason. Tapping a row logs that dish as an estimate
   after a confirmation.

A photo that is not a menu, or cannot be read, gets a plain "I couldn't read
that" and no verdicts.

### 4.5 Saved chats (screen 9)

The existing list, with a dish icon and "Cooked <day> · N steps" for chats
that hold a cooked recipe, and a share button on those rows.

## 5. Notifications (screens 6a to 7b)

All three are small banners with only the question. Holding the banner opens
the options. Tapping it opens the app.

| Notification | When | Held open | Result |
|---|---|---|---|
| "How was the <dish>?" | 30 min after "Done cooking" | I ate it / I ate some of it / I didn't eat it | Logs the dish at one serving, half a serving, or not at all |
| "Did you have lunch?" (and breakfast, dinner) | At the person's meal time, only if that meal has no log | Yes / No | No: nothing happens. Yes: the next question follows |
| "What did you have for lunch?" | Right after Yes | Full-size note with the keyboard up, "Take a picture instead", Save | A note becomes an estimated log entry (B9). The picture option opens the app's camera |

These are local notifications scheduled by the app, so no push server is
needed. The app reschedules them whenever logs change. *My call. It means a
check-in can be stale if the person logged on another device and has not
opened the app since.*

Meal times default to 08:00, 13:00 and 19:00 and are editable in Settings.
*My call.*

**Settings (user, 2026-11-12).** The app's settings have a Notifications
section: one switch that allows notifications at all, and an on/off switch
for each question: "How was the dish?", "Did you have breakfast?", "Did you
have lunch?", "Did you have dinner?". The system permission prompt is shown
the first time the person turns the main switch on.

**Risk to settle on a device first.** The full-size note with typing already
active needs a custom notification view that takes the keyboard. If iOS will
not allow that from a held banner, the fallback is the system's own text
reply for the note plus a "Take a picture" action that opens the app.

## 6. Numbers (screen 8)

### 6.1 The levels

21 levels in three groups. Targets start from the FDA Daily Values and are
adjusted for age and sex where the reference intakes differ.

- **From food:** protein, carbohydrate, fibre, added sugar, saturated fat,
  sodium, omega-3.
- **Minerals:** potassium, calcium, iron, magnesium, zinc, iodine.
- **Vitamins:** A, B6, B12, C, D, E, K, folate.

Phosphorus is a 22nd level that exists only for people with kidney disease.

Calories and weight sit in the card at the top, not in the list. Tapping the
weight shows a field to enter today's weight, which is stored as a weigh-in
so the trend is real. *My call.*

Each level has a direction: get enough, stay under, or match target
(carbohydrate). Direction and target are stored per person because a
condition can change them. Calories, protein and carbohydrate take their
targets from the caloric engine, so Numbers always agrees with the calorie
card; the FDA values in the mockup are samples. Which condition changes which
direction is clinician content. Until it exists, only the changes listed in
the research doc apply, and only for conditions offered at launch (open
question 2).

### 6.2 What a row shows

- Name, a word, and the amount against the target.
- Words: for "get enough" levels, under 70% of target is **little**, otherwise
  **on track**. For "stay under" levels, up to 100% is **within limit**, over
  is **a lot**. For "match target" levels, 70% to 130% is **on track**, below
  is **little**, above is **a lot**. A "get enough" level pushed past its
  safe upper limit by pills shows **more than needed**. *The thresholds come
  from the mockup, and the upper limits are not chosen yet; both need the
  clinician.*
- A bar with a line at the target. The lighter end is the share from pills,
  and those rows carry a pill mark.
- Rows needing attention come first, ordered by what was logged.

The period is the last 7 days, as a daily average.

### 6.3 Edit, drag, save

- **Edit** lists all 21 with one tap to add or remove, plus "Track all" and
  "Clear all". Defaults come from the condition (table in the research doc);
  with no condition the default set is protein, fibre, added sugar, sodium,
  iron and vitamin D.
- **Dragging** a row is a what-if. "What this supports" updates as it moves.
- **Reset** returns to what was logged. **Save as my goal** stores the dragged
  value as that level's goal, and Clara steers suggestions toward it. *My
  call on what Save means.*
- **What this supports** shows Energy, Mood, Muscles, Heart, Blood sugar and
  Digestion as covered, partly or short, from the levels feeding each. It
  reports coverage only. The mapping is in the research doc; the scoring in
  the mockup is a placeholder for the clinician to replace.

### 6.4 Where the numbers come from

1. Logged meals. Dishes Clara generated are priced from their amounts.
   Entries from a note or photo are estimates.
2. Pills. *My calls:* a pill the person has declared counts every day until
   they remove it; there is no daily tick. Pills are declared in onboarding,
   by telling Clara, or under "Pills I take" in Numbers' Edit mode. A pill
   picked by name only ("Vitamin D") gets a typical dose and is marked as an
   estimate; the person can type the amount from the label to make it exact.
3. Before there are enough logs, the starting picture from onboarding.

*My call: "enough" means at least 3 of the last 7 days have two or more
logged meals. Below that, Numbers shows the starting picture with "An
estimate" and Clara says "from your answers" in place of "from what you
logged".*

A day with nothing logged is left out of the average. It is not counted as a
day of eating nothing.

## 7. Log (screen 10)

Days newest first. Under each date, the dishes eaten that day with the meal
and where the entry came from: cooked with Clara, a photo, a note, a menu
check. Tapping an entry opens it to correct or delete (existing meal-log
edit). Estimates are marked.

## 8. Rules that cut across

### 8.1 Safety

Every dish Clara suggests or judges goes through `lib/diet-match.ts`
server-side, as every food surface does today (`cycle.md` standing rule 1).
The model reads menus and writes recipes; it does not decide what is safe.

### 8.2 Honest numbers

Every amount carries where it came from. Estimates are visibly marked in
Numbers, Log and Clara's wording.

### 8.3 Wire contracts

Existing responses stay byte-identical for existing clients. New chat parts
(B12) are sent only to a client that says it can render them; older clients
get the same reply as text.

### 8.4 Cost

**No plans for now; everything is free to use (user, 2026-11-12).** The app
shows no allowances, upgrade prompts or paywall, and the subscription card
and paywall stub are commented out. The server keeps only its hidden safety
caps against a runaway or abusive client (the same idea as Clara's existing
150-a-day cap) and the in-flight locks. Billing code stays in place, unused
by the app.

### 8.5 Privacy

Menu and meal photos are sent for reading and are not stored after the reply.
*My call.* Usual-eating answers and pills are health data and fall under the
same deletion rules as the profile.

### 8.6 Nothing is deleted (user, 2026-11-12)

Features that leave the app are commented out or disconnected, never deleted:
the Restaurants, Meal Plan and Cook tabs, the old starter prompts, the
subscription card and paywall. Each commented-out block carries a one-line
note saying why and how to bring it back. Existing screens are reshaped to
the mock design in preference to being rewritten. No backend route, table or
column is dropped.

### 8.7 Backend tables that change

All changes add; none drop or alter live data (`cycle.md` phase 2 rule 3).

| Table | Change | Slice |
|---|---|---|
| `MealLog` | Add sodium; add an "estimate" flag for entries from a note, photo or menu | 1 |
| `ClaraConversation` | Mark a chat as holding a cooked dish: dish name, when cooking finished, the recipe (ingredients, amounts, steps) | 1 |
| `Patient` (or a new settings table) | Usual-eating answers, the starting-picture lists, weight goal choice | 2 |
| `Supplement` | Which level a pill feeds, the amount and unit, an "estimate" flag for typical doses | 2 and 4 |
| New: tracked levels per person | Which levels the person tracks, each level's direction, target and saved goal | 4 |
| `Ingredient` | Values for the levels not held today (potassium, calcium, iron, magnesium, zinc, iodine, vitamins, omega-3, saturated fat, added sugar) | 4 |
| `MealLog` | Carry the remaining levels | 4 |

Not needed: a notifications table (they are scheduled on the phone and the
switches live in the app) and a weigh-in table (the journal already stores
weigh-ins).

## 9. What is left to the builder

- Table and column names, API routes and payload shapes.
- Whether the Numbers and Log APIs are new routes or extensions.
- How dish reasons are computed from priced ingredients.
- The iOS view structure, and how much of `Features/Stats` survives.
- The notification scheduling details and the device test in §5.

## 10. Open questions for the user

Answered 2026-11-12: the menu check reminds the person to tell the kitchen
about their allergies and lists them (§4.4); everything is free for now
(§8.4); the App Store name becomes Clara; there are no members, so removing
tabs harms nobody.

1. **Launch conditions: decided later.** For now all 41 stay selectable with
   their current rules so the team can see how it works. This must be settled
   before anyone outside the team is invited.
2. *(answered, see above)*
3. **Onboarding steps 3 and 4.** Are basics and a weight goal the right
   remaining steps, with one allergies question at the end of basics?
4. **Lunch flow.** "What did you have?" follows a Yes to "Did you have
   lunch?". Should it replace that question instead?
4b. **Allowances** in §8.4.
5. **Store name.** Does the App Store name change to Clara, or only the
   header inside the app?
6. **Existing members.** People who use Meal Plan, Restaurants or Cook in
   today's app lose those tabs in this release. Is that acceptable, given the
   app has no public users yet?

## 11. Build order

Each slice ends with something a person can use. Slices 1 and 2 are enough to
put the app in a tester's hands.

1. **The loop, on the data we have.** New tab bar. Empty-chat cards. Dish
   advice and cooking mode on the levels the database already holds
   (calories, protein, carbs, fat, fibre, plus sodium carried into the log).
   Saturated fat and added sugar wait for slice 4, because generated dishes
   are not priced for them today. Chat titled by the dish. The after-cooking
   notification. Numbers and Log tabs in their simple form.
2. **First run.** In-app onboarding: condition, usual eating, basics, goal.
   The starting picture. After this a new person never needs the website.
3. **Outside the kitchen.** Photo input. Menu check. Meal check-in
   notifications, the note window, photo logging.
4. **Full numbers.** The remaining 13 levels from USDA data. Pills that
   count. Edit mode over all 21. The what-if drag, areas panel, and saved
   goals.

Before inviting people: clinician sign-off on the launch conditions and
thresholds, real Terms of Service, and TestFlight.
