# Clara Chat App — Design

**Status: DRAFT, awaiting user approval (2026-10-28).**
Two repos: the backend lives here (`wondish_02`). The new iOS app is a **new repo**,
`~/Desktop/BeTech/ClaraChat`. The existing iOS app (`~/Desktop/BeTech/Clara`, bundle
`io.wondish.clara`, display name "Wondish") is **not modified**.

## Intent

Members should be able to ask Clara anything about their Wondish life (plan, meals,
nutrition, diet rules, progress) and have her change things for them, from a phone,
without opening the website. The website becomes the dashboard where everything is laid
out. The feel the user wants is **Claude chat**: open the app, you are in a conversation,
and when Clara needs something from you she offers tappable suggested answers plus an
"Other" option where you type exactly what you mean. Clara also **remembers** key things a
member tells her or keeps asking about, so they don't have to repeat themselves.

### How we got here (decisions already made, do not reopen)

- The first idea was Clara inside the iPhone **Messages** app, as a blue-bubble chat. That
  was dropped (user decision, 2026-10-28) after recon on Apple Messages for Business:
  Apple quotes "not onboarding businesses that primarily offer medical or health-related
  services or products" (Wondish has health conditions, a symptom journal and trials, so
  that's a real risk). Apple also forbids a "bot-only solution" (a live human agent is
  required in business hours), requires a paid messaging provider, and doesn't let a
  business message first. Blue-bubble relay services can't show answer buttons.
- Instead: **Clara gets her own app**, like the Claude and ChatGPT apps. App Store rules
  apply instead of Messages-for-Business rules: health apps are fine, Clara may be the
  only one answering, and answer boxes, memory and saved chats are fully under our control.
- **The current Wondish iOS app is kept as is** (user: "dont kill the current ios app we
  have for wondish, do a separate version"). The Clara app is a separate app.
- Members always start the conversation. Clara does not message first in v1.

## Goals

1. **A separate Clara iOS app** that opens straight into a chat, Claude-app style. It
   signs in with the member's existing Wondish account (same Clerk instance, same backend).
2. **Saved conversations.** Chats are stored on the server: a list of past chats, a "New
   chat" button, and you can reopen any chat and continue it.
3. **Answer boxes.** When Clara asks the member a question, it renders as 2–4 tappable
   suggested answers plus "Other". Tapping one sends that text as the member's reply.
   "Other" puts the cursor in the message box so they type their own.
4. **Memory.** Clara saves short notes about the member on her own and tells them in the
   same reply ("Got it, I'll remember you cook for three"). Notes are loaded into every
   conversation. Members can see and delete them in a "What Clara remembers" list (in the
   new app and on the website), or say "forget that".
5. **Full Clara.** In the new app Clara has every product skill already built: profile
   (read), nutrition (read), logs (read/add/delete), plan (read/mark done/log eaten/swap).
   The existing confirm-before-change protocol stays as is (every write is proposed
   first and done only after the member says yes).

## Non-goals (v1)

- Changing the existing Wondish iOS app in any way, including its chat.
- Changing how the web Clara chat (`/dish-checker`) behaves, beyond letting her *read*
  memories (see §5).
- Clara messaging first (push notifications), Siri shortcuts, widgets, voice: later.
- Messages / WhatsApp / SMS channels: dropped for now.
- Android app.
- New skills (grocery list, pantry, journal, trials, restaurants, orders, editing the
  diet profile). Clara keeps using `gap_report` for these, so demand shows up at
  `/admin/clara-gaps`.
- Multi-select answer boxes, forms, date pickers. v1 is single-select + Other.
- Searching chats, renaming chats, sharing chats.

## Anti-goals (failure even if it "works")

- **Breaking the shipping clients.** The current iOS app and the web chat send
  `POST /api/dish-checker` with a `messages[]` history and read `text/plain`. That
  contract must not change. The new app gets its own route.
- **Clara changing data without a yes.** The structural confirm guard
  (`lib/clara/loop.ts`, `isWrite`) must keep holding. Saved conversations make "the
  history has an assistant turn" true far more often, so the app route enforces a
  stricter, code-level rule (§3a).
- **Memory becoming a second profile.** Allergies, conditions, foods to avoid and
  preferences live on the profile, which drives the meal plan. Clara must not store
  them as memories. Today the profile is read-only to Clara, so she says she can't
  change it yet and calls `gap_report` (category FILTERS), as she does now.
- **Silent memory.** Every save is mentioned in the same reply. Nothing is remembered
  that the member wasn't told about.
- **Cost blowouts.** All Clara calls stay behind `guardAiSpend` (charge-before-model)
  and the per-user rate limit. Memory saving must not add extra model calls (it is a tool
  inside the same loop, not a second summarizer pass).

## Current state (facts, with paths)

- Clara's runtime is surface-independent: `lib/clara/loop.ts` (bounded tool loop,
  streaming text, confirm guard), `lib/clara/registry.ts` (skills, system prompt,
  tie-breaker rows), `lib/clara/types.ts` (`ClaraContext`, `Skill`, `ToolResult`),
  skills in `lib/clara/skills/`, `gap_report` in `lib/clara/gap.ts`.
- The only chat route is `app/api/dish-checker/route.ts`: Clerk auth → rate limit
  (20/60s) → validate history (`lib/chat-history.ts`, max 20 messages, 4,000 chars) →
  `guardAiSpend(userId, "claraChat")` → build prompt → loop → `text/plain` stream.
  Clients send the whole history each turn. **Nothing is stored server-side.**
- `CHAT_SKILLS` was narrowed to read-only (`profile`, `nutrition`) on 2026-09-07 for
  cost and scope. `ALL_SKILLS` already holds `logs` and `plan` with write tools.
- `claraChat` allowance (`lib/ai-budget.ts`): free 5/day, premium 20/day. Everything
  runs on Haiku.
- Gap-ledger rows have a 180-day retention with a cron purge (`lib/clara/retention.ts`,
  `app/api/cron/clara-gap-purge`): this is the precedent for retaining health-derived text.
- The existing iOS app is SwiftUI, iOS 17, XcodeGen (`project.yml`), Clerk iOS SDK
  (`ClerkKit`, `ClerkKitUI`), Inter font, its own design system (`Clara/DesignSystem`),
  and a networking layer (`Clara/Core/Networking`, `Clara/Core/Session`). Its chat
  (`Clara/Features/Chat`) keeps the transcript in memory only.

## The design

### 1. Data (additive Prisma migration)

- `ClaraConversation`: `id`, `patientId` (→ Patient, cascade delete), `title`
  (from the first member message, trimmed to ~60 chars, no model call), `createdAt`,
  `updatedAt` (bumped on every message). Index `(patientId, updatedAt)`.
- `ClaraMessage`: `id`, `conversationId` (cascade), `role` (`user`/`assistant`),
  `content` (the final visible text), `choices` (JSON, nullable: `{question, options[]}`
  when the assistant turn ended with answer boxes), `createdAt`.
  Tool blocks are **not** stored. Saved history replays as plain user/assistant text,
  the same shape `sanitizeChatHistory` produces today.
- `ClaraMemory`: `id`, `patientId` (cascade), `text` (≤ 200 chars), `surface`,
  `conversationId` (nullable, set null on delete), `createdAt`. Cap **50 per member**.
- Retention: conversations untouched for 180 days are purged by a cron, following the
  gap-ledger pattern. Memories are kept until the member deletes them (they're the
  point).
- **The migration is additive only.** Local dev talks to the shared production Neon
  database. The builder writes the migration but **does not apply it**. The user runs it
  themselves when they say "run it" (repo rule).

### 2. Backend routes (new; `dish-checker` is unchanged)

- `POST /api/clara/chat`: body `{ conversationId?: string, message: string,
  clientDate?, tzOffsetMinutes? }`. Same auth → rate limit → validation → spend guard
  → prompt-building order as `dish-checker` (keep validate-before-charge). With no
  `conversationId` it creates a conversation. It loads the last 20 saved messages
  server-side, appends the new user message, runs the loop with **`ALL_SKILLS` filtered by
  a new `CLARA_APP_SKILLS` env var** (same semantics as `CLARA_SKILLS`: unset ⇒ all,
  empty ⇒ none), plus the memory skill, `ask_choices` and `gap_report`, which are always
  on for this route. `CLARA_SKILLS` keeps governing `dish-checker` only, so switching skills
  on for the app can never change the web or old-app chat. It then saves the user message and
  Clara's final reply. `surface: "app"` is a new `ClaraContext.surface` value.
  - **No Patient row** (account exists, onboarding never finished): the route answers 409
    with `{ error, code: "PROFILE_INCOMPLETE" }` before any spend, and the app shows
    "Finish setting up your profile at wondish.io" with a link.
  - Response: **NDJSON event stream** (`application/x-ndjson`), one JSON object per line:
    `{"type":"meta","conversationId"}` first, then `{"type":"text","text"}` deltas,
    optionally `{"type":"choices","question","options":[...]}`, then
    `{"type":"done","messageId"}`. A mid-stream failure ends with the loop's existing
    fallback prose as a `text` event, then `done`. Errors before streaming stay JSON
    bodies with the same status codes as `dish-checker` (401/404/429/402-style quota body/503/500).
  - The user message is saved **before** the model runs, so a dropped stream doesn't lose
    what the member typed. If the reply fails before any text, the assistant row isn't
    written, and the app shows a retry.
- `GET /api/clara/conversations`: the member's chats, newest first, paginated
  (`cursor`, 30 per page), with `id`, `title`, `updatedAt`.
- `GET /api/clara/conversations/:id`: the messages (with `choices`). 404 if not the
  caller's.
- `DELETE /api/clara/conversations/:id`.
- `GET /api/clara/memories`, `DELETE /api/clara/memories/:id`,
  `DELETE /api/clara/memories` (clear all).
- Every route resolves the patient from Clerk auth. No route or tool input may carry an
  identity (same rule as `ClaraContext`).

### 3. Answer boxes (`ask_choices` tool)

- A runtime tool `ask_choices { question: string, options: string[2..4] }`. "Other" is
  always added by the client, never sent by the model.
- The loop treats it as **terminal**: when the model calls it, the loop streams
  `question` as text (so the transcript reads naturally), emits the `choices` event, and
  ends the turn without another model round. The saved assistant message is the text plus
  `choices`. The next turn's history replays it as plain text (question + the options as
  a short list), so no orphan `tool_use` is ever replayed.
- If `ask_choices` arrives in the same round as other tool calls, the other calls run
  first, then the turn ends with the choices.
- Prompt guidance: use it when a short set of likely answers exists ("Which meal, lunch
  or dinner?", "Swap for which of these?", the confirm step of a change: "Yes, swap it" /
  "No, keep it"). Don't use it for open questions ("What did you eat?").
- In the app, boxes show only under the **latest** Clara message and disappear once the
  member replies. A tapped option is sent as an ordinary user message with that exact text.
- `dish-checker` never registers `ask_choices`, so the old clients are unaffected.

### 3a. Code-enforced confirm for changes (app route)

Saved chats make the existing guard ("no assistant turn yet ⇒ no writes") nearly always
pass, so the app route replaces it with a stricter rule: **a write tool (`isWrite`)
runs only on the turn directly after a saved assistant message that ended in
`ask_choices`** (the "Yes, swap it" / "No, keep it" step). Otherwise the loop returns
`CONFIRM_REQUIRED`, and Clara proposes the change with answer boxes. The member may tap the
box or type "yes"; either counts. A three-week-old chat reopened with "swap tonight's
dinner" therefore always gets a fresh proposal first. This is passed into the loop as a
boolean (e.g. `writesAllowed`), and `dish-checker` keeps today's guard unchanged.

### 4. Memory (`memory` skill)

- Tools: `memory_save { text }` and `memory_forget { memoryId }`. Neither is `isWrite`:
  saving is announced rather than confirmed (user decision), and forgetting only happens
  when the member asks for it. Ids come from the memory list in the prompt.
- Every `/api/clara/chat` turn appends a "What you remember about {firstName}" block
  (all memories, with ids, oldest first, ~2,000 chars max) to the system prompt.
- Save rules in the prompt fragment: stable facts and preferences that help future
  answers (household size, schedule, cooking habits, goals, things they keep asking
  about). Never anything the profile holds (allergies, conditions, foods to avoid, diet
  preferences). Never one-off events (what they ate today: that's a log). Never
  third-party sensitive details beyond what's needed ("cooks for two kids", not names
  and ages). Always tell the member in the same reply.
- Handler rules: trims text, rejects empty or > 200 chars (`INVALID_INPUT`), rejects a
  case-insensitive exact duplicate (`ok` with `{duplicate: true}`), and at the cap returns
  `OUT_OF_RANGE` with a message telling Clara to ask the member which one to forget.
- `dish-checker` (web + current iOS app) gets the memory block **read-only** in its
  prompt, with no memory tools. That way Clara knows the same things everywhere, and the
  old clients' behaviour and contract don't change.

### 5. Website (dashboard)

- A **"What Clara remembers"** section on `/profile`: the list with a delete button
  per item and "Clear all". It uses the memory routes above and follows the existing
  dashboard UI conventions.
- The web chat stays as it is (read-only skills, client-held history), apart from reading
  memories (§4).

### 6. The Clara app (new repo `~/Desktop/BeTech/ClaraChat`)

- SwiftUI, iOS 17, XcodeGen, Clerk iOS SDK: the same stack as the existing app. Bundle id
  `io.wondish.clarachat`, display name **"Clara"** (both placeholders the user can
  change; App Store listing waits on the developer enrollment).
- **Start by copying** from the existing app: `Core/Networking`, `Core/Session`,
  `Core/Config`, `DesignSystem`, fonts, the Clerk sign-in flow (`RootGate`, sign-in
  views). Copy, don't share code: the two apps evolve independently (my call; a shared
  Swift package can come later if the copies drift painfully).
- **Sign-in only.** Accounts are created and onboarded on the website, so the app has no
  sign-up (and therefore no in-app account-deletion requirement under App Store 5.1.1(v)).
  The sign-in screen links to wondish.io for "New to Wondish?".
- **Debug build** points at local `next dev` with the Clerk dev-instance key, Release at
  `https://www.wondish.io` with the live key, both via xcconfig like the existing app.
  **User prerequisite before step 4:** register `io.wondish.clarachat` as a native app in
  the Clerk dashboard (dev and production instances).
- Screens:
  - **Signed out:** Clerk sign-in. Same account as the website.
  - **Chat (home):** opens to a **new chat**, Claude-app style, with a short Clara greeting
    and starter suggestions. Toolbar: chat-list button (left), "New chat" (right).
    Streaming bubbles, typing indicator, input bar. **Answer boxes** render as tappable
    chips under the latest Clara message, plus an "Other…" chip that focuses the input.
  - **Chats list:** past conversations (title, relative date), tap to reopen and continue,
    swipe to delete.
  - **Settings:** "What Clara remembers" (list, swipe to delete, Clear all), "Open
    Wondish dashboard" (opens the website), sign out.
- Quota/upgrade errors reuse the server's existing quota body and are shown as a friendly
  message with a link to the website pricing page. No in-app purchase in v1.
- Restaurants, Cook, Meal Plan etc. are **not** rebuilt in this app. Members see those
  on the website (dashboard) or in the existing Wondish app.

## Build order (each step ships on its own)

1. **Backend core:** migration, conversation + memory persistence, `/api/clara/chat`
   with NDJSON, `ALL_SKILLS` + memory skill, conversation/memory routes, tests
   (`node --import tsx --test`, following `lib/clara/*.test.ts` patterns with the
   scripted `ModelClient` stub).
2. **Answer boxes:** `ask_choices` terminal-tool handling in the loop + event + tests.
3. **Read-only memory in `dish-checker`** + "What Clara remembers" on `/profile`.
4. **Clara app:** new repo scaffold from the copied pieces, sign-in, chat with streaming
   NDJSON, saved chats list, answer boxes, memory screen. Verified on the iPhone 17 Pro
   simulator against local dev.
5. **Retention cron** for stale conversations.

## Constraints and repo rules

- Never `npm run build` while `next dev` runs. Local dev hits the shared prod Neon DB.
  Migrations are written, not applied; prod DB scripts only on the user's explicit "run it".
- iOS verification on **iPhone 17 Pro** only. The existing app's repo has uncommitted
  changes and 7 unpushed commits: read-only, don't touch.
- Frontend work (web `/profile` section, every app screen) goes through the
  `ui-ux-pro-max` skill before UI code is written.
- App Store: no diagnosis claims in copy. Clara identifies herself as an AI assistant in the
  greeting.

## Left to the builder

Exact table and column names, event-name spelling, prompt wording (within the rules above),
pagination details, title trimming, app icon/placeholder art, file layout inside the new
repo, test granularity.

## Open (user's call; defaults in brackets)

- **Testing against real tables:** local dev uses the shared production database and the
  builder doesn't apply migrations. [The user applies the additive migration right after
  step 1, so steps 2–4 can be verified end to end.]
- **Allowance and tool rounds:** Clara becomes the main way to use Wondish, and full skills
  cost more per message. Free members get 2 tool rounds per message
  (`lib/clara/budget.ts`), which can run out mid-swap (`plan_get` → `plan_alternatives`).
  [Keep `claraChat` at free 5 / premium 20 per day across all surfaces; app route uses
  3 rounds free / 5 premium.]
