# Clara Everywhere — Saved Chats, Answer Boxes, Memory — Design

**Status: DRAFT, awaiting user approval (2026-10-28).**
Two repos: the backend and website live here (`wondish_02`). The iOS app is the
**existing Wondish app** at `~/Desktop/BeTech/Clara` (bundle `io.wondish.clara`, display
name "Wondish"). No new app.

## Intent

Members should be able to ask Clara anything about their Wondish life (plan, meals,
nutrition, diet rules, progress) and have her change things for them, from their phone,
without opening the website. In the Wondish iOS app **Clara is the main focus**: it opens
straight into her chat. The website becomes mainly the dashboard where everything is laid
out, and its Clara chat follows the same rules. The feel the user wants is **Claude chat**:
you are in a conversation, and when Clara needs something from you she offers tappable
suggested answers plus an "Other" option where you type exactly what you mean. Clara also
**remembers** key things a member tells her or keeps asking about, so they don't have to
repeat themselves. **Clara is the same on every platform**: same skills, same memory, same
saved chats, same rules. Anything she changes is written to the same database tables the
website and the app read, so it shows up everywhere at once.

### How we got here (decisions already made, do not reopen)

- The first idea was Clara inside the iPhone **Messages** app, as a blue-bubble chat.
  It was dropped (user decision, 2026-10-28). Apple quotes "not onboarding businesses that
  primarily offer medical or health-related services or products", forbids a "bot-only
  solution" (a live agent is required in business hours), requires a paid messaging
  provider, and doesn't let a business message first. Blue-bubble relays can't show
  answer buttons.
- Next idea, a separate Clara app, was also dropped (user, 2026-10-28: "whats the point of
  being the whole new app if we already have one"). The new rules go into the **existing**
  Wondish app and the website chat instead.
- **No per-member allowance for Clara for now: she's unlimited** (user, 2026-10-28).
- Members always start the conversation. Clara does not message first in v1.

## Goals

1. **Clara first in the iOS app.** The Clara tab moves to the first position and is the
   tab the app opens on. The other tabs (Restaurants, Cook, Meal Plan, Account) stay.
2. **Saved conversations, on web and iOS.** Chats are stored on the server: a list of past
   chats, a "New chat" button, and you can reopen any chat and continue it, including one
   started on the other platform.
3. **Answer boxes.** When Clara asks the member a question, it renders as 2–4 tappable
   suggested answers plus "Other". Tapping one sends that text as the member's reply.
   "Other" puts the cursor in the message box so they type their own.
4. **Memory.** Clara saves short notes about the member on her own and tells them in the
   same reply ("Got it, I'll remember you cook for three"). Notes are loaded into every
   conversation on every platform. Members can see and delete them in a "What Clara
   remembers" list (iOS Account tab and website `/profile`), or say "forget that".
5. **Full Clara on both platforms.** Every product skill already built is available:
   profile (read), nutrition (read), logs (read/add/delete), plan (read/mark done/log
   eaten/swap). This reverses the 2026-09-07 narrowing of the web chat to read-only.
   Changes are confirmed in code before they happen (§3a).
6. **Unlimited.** No visible daily message allowance for Clara. Hidden backstops only (§2a).

## Non-goals (v1)

- Clara messaging first (push notifications), Siri shortcuts, widgets, voice: later.
- Messages / WhatsApp / SMS channels, a separate app, Android.
- New skills (grocery list, pantry, journal, trials, restaurants, orders, **editing the
  diet profile**). Clara keeps using `gap_report` for these, so demand shows at
  `/admin/clara-gaps`.
- Multi-select answer boxes, forms, date pickers. v1 is single-select + Other.
- Searching, renaming or sharing chats.
- Redesigning the other iOS tabs or the rest of the website.

## Anti-goals (failure even if it "works")

- **Clara changing data without a yes.** See §3a. A saved chat must never let a write
  slip through just because the history already holds assistant turns.
- **Memory becoming a second profile.** Allergies, conditions, foods to avoid and
  preferences live on the profile, which drives the meal plan. Clara must not store them
  as memories. The profile is read-only to Clara, so she says she can't change it yet and
  calls `gap_report` (category FILTERS), as today.
- **Silent memory.** Every save is mentioned in the same reply.
- **Runaway cost.** Unlimited for normal use, with backstops (user decision 2026-10-28,
  see §2a). Memory saving adds no extra model calls (it's a tool inside the same loop).
- **Breaking an installed build.** `POST /api/dish-checker` and its `text/plain` contract
  stay working until both clients have moved to the new route. Removing it is a later
  clean-up, not part of this project.

## Current state (facts, with paths)

- Clara's runtime is surface-independent: `lib/clara/loop.ts` (bounded tool loop,
  streaming text, first-turn confirm guard), `lib/clara/registry.ts` (skills, system
  prompt, tie-breaker rows), `lib/clara/types.ts`, skills in `lib/clara/skills/`,
  `gap_report` in `lib/clara/gap.ts`.
- The only chat route is `app/api/dish-checker/route.ts`: Clerk auth → rate limit
  (20/60s) → history validation (`lib/chat-history.ts`, max 20 messages, 4,000 chars) →
  `guardAiSpend(userId, "claraChat")` → prompt → loop → `text/plain` stream. Clients send
  the whole history each turn. **Nothing is stored server-side.**
- `CHAT_SKILLS` = `profile`, `nutrition` (read-only, since 2026-09-07). `ALL_SKILLS` adds
  `logs` and `plan` with write tools. `CLARA_SKILLS` env filters product skills.
- Tool rounds: free 2, premium 5 (`lib/clara/budget.ts`). `claraChat` allowance: free
  5/day, premium 20/day (`lib/ai-budget.ts`). Everything runs on Haiku.
- Web chat UI: `app/(dashboard)/dish-checker/page.tsx` +
  `components/dish-checker/DishCheckerClient.tsx` (client-held history).
- iOS: SwiftUI, iOS 17, XcodeGen, Clerk iOS SDK. Tabs in `Clara/App/RootTabView.swift`
  (default `.restaurants`; order Restaurants, Cook, Meal Plan, Clara, Account). Chat in
  `Clara/Features/Chat/` (`ChatView`, `ChatViewModel`: in-memory transcript, streams via
  `ChatStreaming`). Account in `Clara/Features/Account/`.
- Gap-ledger retention: 180 days via cron (`lib/clara/retention.ts`,
  `app/api/cron/clara-gap-purge`). This is the precedent for health-derived text.

## The design

### 1. Data (additive Prisma migration)

- `ClaraConversation`: `id`, `patientId` (→ Patient, cascade), `title` (first member
  message trimmed to ~60 chars, no model call), `surface` (where it started),
  `createdAt`, `updatedAt` (bumped per message). Index `(patientId, updatedAt)`.
- `ClaraMessage`: `id`, `conversationId` (cascade), `role` (`user`/`assistant`),
  `content` (final visible text), `choices` (JSON, nullable: `{question, options[]}`),
  `surface`, `createdAt`. Tool blocks are **not** stored; history replays as plain
  user/assistant text, like `sanitizeChatHistory` output today.
- `ClaraMemory`: `id`, `patientId` (cascade), `text` (≤ 200 chars), `surface`,
  `conversationId` (nullable, set null on delete), `createdAt`. Cap **50 per member**.
- Retention: conversations untouched for 180 days are purged by a cron (gap-ledger
  pattern). Memories are kept until the member deletes them.
- **Additive only.** Local dev talks to the shared production Neon DB. The builder writes
  the migration but **does not apply it**. The user applies it when they say "run it"
  (repo rule). Default: right after build step 1, so later steps can be tested end to end.

### 2. Backend routes (new)

- `POST /api/clara/chat`, used by **both** web and iOS: body `{ conversationId?, message,
  clientDate?, tzOffsetMinutes?, surface }`. Order: auth → burst rate limit →
  validation → spend check (§2a) → prompt →
  loop. With no `conversationId` it creates a conversation. It loads the last 20 saved
  messages, appends the new one, and runs the loop with **`ALL_SKILLS` filtered by
  `CLARA_SKILLS`** plus memory, `ask_choices` and `gap_report` (those three always on).
  Tool rounds: 5 for everyone. It saves the user message **before** the model runs (a
  dropped stream never loses what the member typed) and the assistant reply when done.
  If the reply fails before any text, no assistant row is written and the client offers
  retry.
  - **Response: NDJSON** (`application/x-ndjson`), one JSON object per line:
    `{"type":"meta","conversationId"}`, then `{"type":"text","text"}` deltas,
    optionally `{"type":"choices","question","options":[...]}`, then
    `{"type":"done","messageId"}`. Mid-stream failure: the loop's fallback prose as a
    `text` event, then `done`. Errors before streaming are JSON bodies with the same codes
    as `dish-checker` (401/404/429/503/500).
  - **No Patient row** (onboarding unfinished): 409 `{ error, code: "PROFILE_INCOMPLETE" }`
    before any spend. Web shows a link to finish onboarding. iOS reuses its existing
    "Finish setting up your profile" affordance.
  - **`CLARA_SKILLS` check before shipping:** the production value must include `logs` and
    `plan` for the full skills to appear. The builder reports the production value (read
    only, e.g. `vercel env ls`) and doesn't change it. Changing env is the user's call.
- `GET /api/clara/conversations` (newest first, cursor, 30 per page: `id`, `title`,
  `updatedAt`), `GET /api/clara/conversations/:id` (messages with `choices`; 404 if not
  the caller's), `DELETE /api/clara/conversations/:id`.
- `GET /api/clara/memories`, `DELETE /api/clara/memories/:id`, `DELETE /api/clara/memories`.
- The patient is always resolved from Clerk auth. No body or tool input carries identity.
- `dish-checker` is left as is (compatibility only).
- **Prompt:** `buildSystemPrompt` is shared with `dish-checker` and says things like "you
  do NOT log meals or change their meal plan" and "you can see TODAY'S plan only". The new
  route gets its own persona text via a parameter. `dish-checker`'s prompt doesn't change.

### 2a. Cost backstops (replaces the `claraChat` allowance on the new route)

Background: `lib/ai-budget.ts` has **no all-tier ceiling**. `guardGlobalAiSpend` draws
from per-tier pools only (Free $20/day `ai-free-pool`, Beta $40/day `ai-beta-pool`), and
paying members and admins pass straight through. Removing the per-member allowance
therefore needs these, all user-approved 2026-10-28:

- **Hidden safety cap, ~150 Clara messages per member per day, every tier.** It's never
  shown as a number or marketed. It exists only to stop scripted or runaway use. It must
  keep the "≤ $30/month worst case per paying member" invariant tested in
  `lib/ai-budget.test.ts`. If the re-measured cost says 150 breaks it, the builder lowers
  the cap to the largest value that holds and reports the number.
- **Clara gets her own Free and Beta pools**, separate from plan builds, rebuilds and fridge,
  so heavy chatting can never block a new member's first plan. Pool sizes: the builder
  proposes them from the re-measured cost and the user approves before shipping.
- **Re-measure the cost per message** (`AI_COST_CENTS`) for the new route: 5 tool rounds,
  full tool set, memory block. Use real token counts from a handful of local runs.
- **Copy when a cap or pool is hit:** "I need a short break. Let's pick this up again
  tomorrow." No upgrade or pricing wording. Same code on web and iOS (`429` with
  `code: "CLARA_RESTING"`).
- The per-user burst limit (20 requests / 60s) stays.
- `dish-checker` keeps its current `claraChat` allowance (compatibility route only).

### 3. Answer boxes (`ask_choices` tool)

- Runtime tool `ask_choices { question: string, options: string[2..4] }`. The client
  always adds "Other". The model never sends it.
- **Terminal:** when called, the loop streams `question` as text, emits `choices`, and
  ends the turn with no further model round. Other tool calls in the same round run first.
  The saved message = text + `choices`. On replay it becomes plain text (question + options
  as a short list), so no orphan `tool_use` is replayed.
- Prompt guidance: use it when a short set of likely answers exists, **always** for the
  confirm step of a change ("Yes, swap it" / "No, keep it"). Don't use it for open
  questions ("What did you eat?").
- Clients show boxes only under the **latest** Clara message and hide them once the member
  replies. A tapped option is sent as an ordinary message with that exact text.

### 3a. Code-enforced confirm for changes

A write tool (`isWrite`) runs only on the turn **directly after a saved assistant message
that ended in `ask_choices`**. Otherwise the loop returns `CONFIRM_REQUIRED` and Clara
proposes the change with answer boxes. The member may tap a box or type "yes"; either
counts, because the model still judges whether the reply means yes. Reopening a
three-week-old chat with "swap tonight's dinner" therefore always gets a fresh proposal.
The route passes this into the loop as a boolean (e.g. `writesAllowed`). `dish-checker`
keeps today's guard.

### 4. Memory (`memory` skill)

- Tools `memory_save { text }` and `memory_forget { memoryId }`. Neither is `isWrite`:
  saves are announced, not confirmed (user decision), and forgetting is always
  member-requested. Ids come from the memory block in the prompt.
- Every turn appends "What you remember about {firstName}" (all memories with ids, oldest
  first, ~2,000 chars max) to the system prompt.
- Save rules (prompt fragment): stable facts and preferences that help later answers
  (household, schedule, cooking habits, goals, things they keep asking about). Never what
  the profile holds. Never one-off events (that's a log). Minimal third-party detail ("cooks
  for two kids", not names and ages). Always tell the member in the same reply.
- Handler: trim, reject empty or > 200 chars (`INVALID_INPUT`), case-insensitive exact
  duplicate → `ok` with `{duplicate: true}`, at the cap → `OUT_OF_RANGE` telling Clara to
  ask which one to forget.

### 5. Website

- **Clara chat page** (`/dish-checker`) moves to `/api/clara/chat`: saved chats (a list
  with "New chat"), streaming NDJSON, answer boxes, no quota/upgrade messaging. The URL
  stays. Visual changes follow the existing dashboard style.
- **"What Clara remembers"** section on `/profile`: list, delete per item, "Clear all".

### 6. iOS (existing Wondish app)

- **Clara first:** `RootTabView` order becomes Clara, Restaurants, Cook, Meal Plan,
  Account, default selection `.chat`. The DEBUG `-tab` launch argument keeps working.
- **Chat:** opens on the most recent conversation if it was active in the last 12 hours,
  otherwise a new chat (my call: "pick up where I left off" for a texting feel without
  piling old chats into one). Toolbar: chats-list button (left), "New chat" (right).
  `ChatStreaming` gains an NDJSON implementation against `/api/clara/chat`. Answer boxes
  render as tappable chips under the latest Clara message (reusing the `StarterChips`
  look), plus "Other…", which focuses the input.
- **Chats list:** title + relative date, tap to open, swipe to delete. Includes chats
  started on the web.
- **Account tab:** a "What Clara remembers" row opening a list (swipe to delete, Clear all).
- The paywall-on-402 path in the chat is removed (unlimited).
- **Reaching local dev:** add a DEBUG-only `-baseURL <url>` launch argument to
  `AppConfig` (same pattern as `-tab`) so simulator runs can target `localhost:3000`
  without touching `Config/Debug.xcconfig` (my call).
- Repo hygiene: the iOS repo has 7 unpushed commits and uncommitted changes to
  `Clara.xcodeproj/project.pbxproj` and `Config/Debug.xcconfig` that aren't ours. The
  builder works on a new branch and doesn't commit or revert those two files without
  asking the user. `project.pbxproj` is regenerated by XcodeGen from `project.yml`.

## Build order (each step ships on its own)

1. **Backend core:** migration, conversation + memory persistence, `/api/clara/chat`
   (NDJSON, full skills, memory skill, unlimited), conversation/memory routes, §3a guard,
   tests (`node --import tsx --test`, following `lib/clara/*.test.ts` and the scripted
   `ModelClient` stub). → user applies migration.
2. **Answer boxes:** `ask_choices` terminal handling + event + tests.
3. **Website:** chat page on the new route (saved chats, boxes) + memory section on
   `/profile`. Verified in the browser against local dev. Also a **drafted** privacy-policy
   addition covering saved chats and Clara's memory, for the user to review (my call;
   the user owns the legal text and the App Store privacy labels before submission).
4. **iOS:** Clara-first tabs, NDJSON streaming, chats list, answer boxes, memory screen.
   Verified on the **iPhone 17 Pro** simulator against local dev.
5. **Retention cron** for stale conversations.

## Constraints and repo rules

- Never `npm run build` while `next dev` runs. Local dev hits the shared prod Neon DB.
  Prod DB scripts only on the user's explicit "run it".
- iOS verification on iPhone 17 Pro only. Relaunch without `-UITestFixture` after
  screenshot runs.
- All frontend work (web chat, `/profile` section, iOS screens) goes through the
  `ui-ux-pro-max` skill before UI code is written.
- App Store: no diagnosis claims. Clara identifies herself as an AI assistant in the
  greeting.

## Left to the builder

Exact table and column names, event-name spelling, prompt wording (within the rules
above), pagination details, title trimming, how the web chat list is laid out (sidebar vs
dropdown) within dashboard conventions, test granularity.
