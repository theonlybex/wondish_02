# Clara Chat Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clara gets saved chats, answer boxes, memory and her full skill set, behind one new route used by the website and the existing Wondish iOS app. The app opens on Clara.

**Architecture:** A new `POST /api/clara/chat` route loads history from new Prisma tables instead of trusting the client. It runs the existing `startClaraLoop` with all product skills plus three always-on runtime tools (`memory_*`, `ask_choices`, `gap_report`), and streams NDJSON events. The turn logic lives in a dependency-injected service (`lib/clara/chat-service.ts`) so it's unit-testable with the scripted `ModelClient` stub. Both clients switch to the new route. `POST /api/dish-checker` stays as a compatibility route.

**Tech Stack:** Next.js App Router, Prisma (Neon Postgres), Anthropic SDK (Haiku), Upstash rate limits, `node --import tsx --test`; SwiftUI iOS 17, XcodeGen, ClerkKit, XCTest.

**Spec:** `docs/superpowers/specs/2026-10-28-clara-chat-upgrade-design.md` (approved 2026-10-28). Read it before any task.

## Global Constraints

- Two repos: backend + web in `/Users/becks/Desktop/BeTech/wondish_02` (branch `feat/clara-app-chat`). iOS in `/Users/becks/Desktop/BeTech/Clara` (new branch `feat/clara-chat-upgrade`, created in Task 11).
- **Never run `prisma migrate dev`, `migrate deploy`, `db push` or any script that writes to the database.** Local dev talks to the shared production Neon DB. Migrations are written only. The user applies them on an explicit "run it".
- Never `npm run build` while `next dev` is running.
- `POST /api/dish-checker` keeps its request/response contract (`messages[]` in, `text/plain` out), its `claraChat` allowance and its first-turn guard.
- No route body or tool input carries identity. The patient is always resolved from Clerk auth.
- Write tools (`isWrite`) on the new route run only on the turn directly after a saved assistant message whose `choices` is non-null (spec §3a).
- `ask_choices` options: 2–4 strings. Clients add "Other" themselves.
- Memory: text ≤ 200 chars, cap 50 per member, prompt block ≤ 2,000 chars.
- Conversation history replayed to the model: last 20 saved messages, starting with a user message.
- Conversation retention: 180 days since `updatedAt`.
- Limit-hit copy, exact: `I need a short break. Let's pick this up again tomorrow.` HTTP 429 with `code: "CLARA_RESTING"`. No upgrade or pricing wording anywhere in the new chat.
- No-profile response: HTTP 409 `{ error, code: "PROFILE_INCOMPLETE" }`, returned before any spend.
- Tool rounds on the new route: 5 for every tier.
- Every frontend task invokes the `ui-ux-pro-max:ui-ux-pro-max` skill before writing UI code.
- iOS verification only on the **iPhone 17 Pro** simulator. Relaunch without `-UITestFixture` after screenshot runs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. **Double send:** a member taps an answer box twice, or taps one while a reply is still streaming. Expected: one user message. Boxes and Send are disabled while streaming, and boxes disappear on first tap. Pinned in Task 14 (iOS) and Task 9 (web).
2. **Someone else's conversation id:** `conversationId` belongs to another member. Expected: 404, nothing loaded, nothing written. Pinned in Task 2 and Task 6.
3. **Plain "yes" without boxes:** Clara proposed a change in prose (no `ask_choices`) and the member types "yes". Expected: the write is refused with `CONFIRM_REQUIRED` and Clara re-proposes with boxes. Pinned in Task 6.
4. **Stream dies mid-reply:** network drop or model failure after some text. Expected: the user message is already saved. If any text streamed, the assistant row holds that text plus the loop's fallback line. If none streamed, there's no assistant row and the client offers retry. Pinned in Task 6.
5. **Long-lived member:** more than 20 saved messages, or memories over 2,000 chars. Expected: the model sees only the latest 20 messages (starting with a user turn), and the memory block keeps the **newest** memories that fit. Pinned in Task 2 and Task 3.

---

## Backend (wondish_02)

### Task 1: Prisma models and migration file

**Files:**
- Modify: `prisma/schema.prisma` (add three models; add relation fields on `Patient`)
- Create: `prisma/migrations/20261028120000_clara_conversations_memory/migration.sql`

**Interfaces:**
- Produces (Prisma client): `ClaraConversation { id, patientId, title, surface, createdAt, updatedAt }` with `@@index([patientId, updatedAt])`. `ClaraMessage { id, conversationId, role, content, choices Json?, surface, createdAt }` with `@@index([conversationId, createdAt])`. `ClaraMemory { id, patientId, text, surface, conversationId String?, createdAt }` with `@@index([patientId, createdAt])`. Cascade delete from `Patient` → conversations/memories and from conversation → messages. `ClaraMemory.conversationId` is `onDelete: SetNull`. `role` and `surface` are `String` (values `user|assistant` and `web|ios|unknown`), matching `ClaraCapabilityRequest.surface`.

- [ ] **Step 1:** Add the models and `Patient` back-relations (`claraConversations`, `claraMemories`).
- [ ] **Step 2:** Run `npx prisma validate`. Expected: "The schema at prisma/schema.prisma is valid".
- [ ] **Step 3:** Generate the SQL **without touching any database**: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script --shadow-database-url "$SHADOW_DATABASE_URL"`. If no shadow DB is configured, write the SQL by hand in the style of the latest migration folder instead. Only `CREATE TABLE`, `CREATE INDEX` and `ADD CONSTRAINT ... FOREIGN KEY` are allowed; there must be no `ALTER`/`DROP` on existing tables. Save to the migration file.
- [ ] **Step 4:** Run `npx prisma generate`, then `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5:** Commit `feat(clara): tables for saved conversations and memory (migration not applied)`.

### Task 2: Conversation store

**Files:**
- Create: `lib/clara/conversations.ts`, `lib/clara/conversations.test.ts`

**Interfaces:**
- Consumes: Task 1 models; `ModelMessage` from `lib/clara/types.ts`.
- Produces:
  - `export interface ClaraChoices { question: string; options: string[] }`
  - `export interface StoredMessage { id: string; role: "user" | "assistant"; content: string; choices: ClaraChoices | null; createdAt: Date }`
  - `export interface ConversationDeps` (prisma-backed default `prismaConversationDeps`, fakes in tests)
  - `export function makeConversationStore(deps?: ConversationDeps)` returning:
    - `create(patientId: string, firstMessage: string, surface: string): Promise<{ id: string }>`
    - `owned(conversationId: string, patientId: string): Promise<boolean>`
    - `history(conversationId: string, limit?: number /* 20 */): Promise<{ messages: ModelMessage[]; lastAssistantHadChoices: boolean }>`
    - `appendUser(conversationId: string, content: string, surface: string): Promise<{ id: string }>`
    - `appendAssistant(conversationId: string, content: string, choices: ClaraChoices | null, surface: string): Promise<{ id: string }>` (also bumps `updatedAt`)
    - `list(patientId: string, cursor?: string): Promise<{ items: { id: string; title: string; updatedAt: Date }[]; nextCursor: string | null }>` (30 per page, newest `updatedAt` first)
    - `get(conversationId: string, patientId: string): Promise<{ id: string; title: string; messages: StoredMessage[] } | null>`
    - `remove(conversationId: string, patientId: string): Promise<boolean>`
  - `export function titleFrom(message: string): string` (whitespace collapsed, ≤ 60 chars, trailing `…` when cut)
  - `export function replayText(content: string, choices: ClaraChoices | null): string` (content + `\n` + options as `- option` lines)

- [ ] **Step 1: Write failing tests.**
  - `titleFrom` trims to 60 chars with `…`, collapses newlines.
  - `history` returns at most 20 messages, drops leading assistant messages, and renders an assistant message with choices via `replayText`.
  - `lastAssistantHadChoices` is true only when the newest assistant message has choices.
  - `get`/`remove`/`owned` return `null`/`false` for another patient's conversation (Review Focus 2).
  - `list` pages at 30 with a `nextCursor`.
- [ ] **Step 2:** Run `node --import tsx --test lib/clara/conversations.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement with the deps pattern used by `makeLogsHandlers(deps = prismaDeps)` in `lib/clara/skills/logs.ts`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(clara): conversation store`.

### Task 3: Memory skill and prompt block

**Files:**
- Create: `lib/clara/skills/memory.ts`, `lib/clara/skills/memory.test.ts`

**Interfaces:**
- Consumes: `Skill`, `ClaraContext`, `ToolResult` from `lib/clara/types.ts`.
- Produces:
  - `export interface MemoryRow { id: string; text: string; createdAt: Date }`
  - `export interface MemoryDeps { list(patientId): Promise<MemoryRow[]>; create(patientId, text, surface): Promise<MemoryRow>; remove(patientId, id): Promise<boolean>; clear(patientId): Promise<number> }` with a default `prismaMemoryDeps`
  - `export const MEMORY_MAX_CHARS = 200`, `MEMORY_CAP = 50`, `MEMORY_BLOCK_MAX_CHARS = 2000`
  - `export function makeMemorySkill(deps?: MemoryDeps): Skill` (name `"memory"`, tools `memory_save { text }`, `memory_forget { memoryId }`, **neither `isWrite`**)
  - `export const memorySkill: Skill`
  - `export function buildMemoryBlock(firstName: string, rows: MemoryRow[]): string` ("" when empty, otherwise a heading "What you remember about {firstName}" + `[id] text` lines in oldest-first order, keeping the newest rows that fit in 2,000 chars)
  - `export const memoryStore = { list, remove, clear }` (thin re-export of the deps, for routes)

- [ ] **Step 1: Write failing tests.**
  - Save trims text.
  - Empty or 201-char text → `INVALID_INPUT`.
  - A case-insensitive duplicate → `{ ok: true, data: { duplicate: true } }` with no create call.
  - At 50 rows → `OUT_OF_RANGE`.
  - `memory_forget` on an id that isn't the caller's → `NOT_FOUND`.
  - `buildMemoryBlock` drops the oldest rows first when over 2,000 chars (Review Focus 5).
  - The prompt fragment contains "never" + "allergies" (the profile rule) and the "tell them in the same reply" rule.
- [ ] **Step 2:** Run `node --import tsx --test lib/clara/skills/memory.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Base the prompt fragment's wording on the save rules in spec §4.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(clara): memory skill`.

### Task 4: `ask_choices` and the `writesAllowed` guard in the loop

**Files:**
- Create: `lib/clara/ask-choices.ts`, `lib/clara/ask-choices.test.ts`
- Modify: `lib/clara/loop.ts` (`LoopParams`, the tool-call branch), `lib/clara/loop.test.ts`

**Interfaces:**
- Consumes: `ClaraChoices` (Task 2).
- Produces:
  - `export const ASK_CHOICES_TOOL = "ask_choices"`
  - `export const askChoicesSkill: Skill` (one tool, its handler is never executed by the loop; prompt fragment: use it for short sets of likely answers and **always** for the yes/no confirm of a change)
  - `export function parseChoices(input: Record<string, unknown>): ClaraChoices | null` (question non-empty ≤ 300 chars, 2–4 distinct non-empty options ≤ 60 chars each; "Other" in any case is removed before counting)
  - `LoopParams` gains `writesAllowed?: boolean` (when set, it replaces `hasPriorAssistantTurn` in the `isWrite` check) and `onChoices?: (c: ClaraChoices) => void`. The generator stays `AsyncGenerator<string>`, so `dish-checker` is untouched.

- [ ] **Step 1: Write failing tests** in `loop.test.ts` using `stubClient`:
  - (a) A round with `ask_choices` streams the question text, calls `onChoices` once, and opens no further round.
  - (b) `ask_choices` plus `plan_get` in one round: `plan_get` executes, then the turn ends with choices.
  - (c) Invalid `ask_choices` input gets an `INVALID_INPUT` tool_result and the loop continues.
  - (d) `writesAllowed: false` with prior assistant turns → write tool gets `CONFIRM_REQUIRED`.
  - (e) `writesAllowed: true` on a first turn → write executes.
  - (f) `writesAllowed` undefined → existing behaviour (the current tests still pass).
  - `ask-choices.test.ts` covers `parseChoices` bounds and the "Other" stripping.
- [ ] **Step 2:** Run `node --import tsx --test lib/clara/loop.test.ts lib/clara/ask-choices.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement. The question text follows the existing `\n\n` separator rule (`lastChar`).
- [ ] **Step 4:** Re-run both files and `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(clara): answer boxes and an explicit write guard in the loop`.

### Task 5: Cost backstops (measurement, then guard)

**Files:**
- Modify: `lib/clara/anthropic-client.ts` (optional `onUsage?: (u: { input_tokens: number; output_tokens: number }) => void` as the second argument of `createAnthropicClient`, called from `final.usage`)
- Create: `scripts/clara-cost-measure.ts`
- Modify: `lib/ai-budget.ts`, `lib/ai-budget.test.ts`

**Interfaces:**
- Produces:
  - `AiGuardKind` gains `claraApp`: `AI_LIMITS.claraApp = { bucket: "ai-clara-app", window: "day", free: CLARA_SAFETY_CAP, premium: CLARA_SAFETY_CAP, label: "Clara messages" }`
  - `export const CLARA_SAFETY_CAP: number`
  - `AI_COST_CENTS.claraApp` = the measured value
  - Clara-only pools `ai-clara-free-pool` / `ai-clara-beta-pool` (`CLARA_FREE_AI_DAILY_CENTS`, `CLARA_BETA_AI_DAILY_CENTS`), chosen in `guardGlobalAiSpend` when `kind === "claraApp"`
  - `export const CLARA_RESTING_COPY = "I need a short break. Let's pick this up again tomorrow."`
  - `export async function guardClaraAppSpend(userId: string, tier?: AiTier, limiter?: Limiter): Promise<{ ok: true; tier: AiTier } | { ok: false; status: 429; body: { error: string; code: "CLARA_RESTING" } }>`

- [ ] **Step 1:** Add `onUsage` to the adapter (no behaviour change when omitted). `npm test` passes.
- [ ] **Step 2:** Write `scripts/clara-cost-measure.ts`. It runs about 8 representative prompts through `startClaraLoop` with the real Anthropic client (it loads `.env.local` itself) and **canned tool results** from `lib/clara/__fixtures__`, so nothing touches the DB. It uses the full tool set, a 50-memory block and 20 messages of history. It prints mean and p90 dollars per message, using the current Haiku 4.5 prices from the `claude-api` skill.
- [ ] **Step 3:** Run it: `npx tsx scripts/clara-cost-measure.ts`. Record the numbers.
- [ ] **Step 4: CHECKPOINT. Stop and report to the user:**
  - the measured cost per message;
  - the largest `CLARA_SAFETY_CAP` that keeps `lib/ai-budget.test.ts`'s "$30/month worst case" test green. Today the other premium buckets total about $21.40/month, which leaves roughly $8.60 for Clara: about 20 messages a day at $0.012;
  - the proposed Clara pool sizes.

  The spec's ~150/day cap would put the premium worst case near $65/month, breaking that rule. Ask the user to pick either a cap that holds $30, or to relax the rule for Clara. Don't continue Task 5 until they answer.
- [ ] **Step 5: Write failing tests** in `lib/ai-budget.test.ts`:
  - `guardClaraAppSpend` refuses with `CLARA_RESTING_COPY` and `code: "CLARA_RESTING"` past the cap.
  - It draws from `ai-clara-free-pool`, not `ai-free-pool`.
  - The refusal body contains no "upgrade"/"Plus".
  - The $30 test either stays as is (cap chosen to fit) or is amended exactly as the user decided.
- [ ] **Step 6:** Implement, then run `node --import tsx --test lib/ai-budget.test.ts`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(clara): hidden safety cap and Clara's own pools`.

### Task 6: Chat service and `POST /api/clara/chat`

**Files:**
- Create: `lib/clara/caller.ts`, `lib/clara/ndjson.ts`, `lib/clara/chat-service.ts`, `lib/clara/chat-service.test.ts`, `app/api/clara/chat/route.ts`
- Modify: `lib/clara/registry.ts` (`buildSystemPrompt` gains a 5th param `persona: "advisor" | "assistant" = "advisor"`)

**Interfaces:**
- Consumes: Tasks 2–5; `startClaraLoop`, `resolveActiveSkills(ALL_SKILLS, process.env.CLARA_SKILLS)`, `buildToolDefs`, `findTool`, `buildTodaysPlanText`, `buildFoodMapText`, `resolveToday`, `parseClaraRequestOptions`.
- Produces:
  - `lib/clara/caller.ts`: `export async function resolveClaraCaller(): Promise<{ ok: true; userId: string; account; patient | null } | { ok: false; response: NextResponse }>` (Clerk auth → account with subscriptions → patient with `PATIENT_FOOD_MAP_INCLUDE`; 401/404 as `dish-checker`)
  - `lib/clara/ndjson.ts`: `export type ClaraEvent = { type: "meta"; conversationId: string } | { type: "text"; text: string } | { type: "choices"; question: string; options: string[] } | { type: "done"; messageId: string | null }` and `export function encodeEvent(e: ClaraEvent): Uint8Array` (JSON + `\n`)
  - `lib/clara/chat-service.ts`: `export async function startClaraAppTurn(deps: ChatServiceDeps, input: { patient; account; isPremium: boolean; conversationId?: string; message: string; options: ClaraRequestOptions }): Promise<{ ok: false; status: number; body: object } | { ok: true; conversationId: string; events: AsyncGenerator<ClaraEvent> }>`, where `ChatServiceDeps = { store: ReturnType<typeof makeConversationStore>; memory: MemoryDeps; client: ModelClient; skills: Skill[] }`.
  - Persona `"assistant"`: replaces the advisor line ("you do NOT log meals…") with "you can read and change their meal logs and meal plan with your tools, always proposing a change with answer boxes first". It also replaces rule 13 ("TODAY'S plan only") with "use the plan tools for any other day". Everything else is shared.

- [ ] **Step 1: Write failing tests** in `chat-service.test.ts` with fake store/memory and `stubClient`:
  - patient `null` → `{ ok: false, status: 409, body.code: "PROFILE_INCOMPLETE" }`, model never called.
  - Unknown/foreign `conversationId` → 404, nothing appended (Review Focus 2).
  - The user message is appended **before** `openRound` is called.
  - First event is `meta`, last is `done`.
  - `writesAllowed` is passed as `store.history(...).lastAssistantHadChoices`. A scripted write after a prose-only proposal yields `CONFIRM_REQUIRED` (Review Focus 3).
  - An `ask_choices` round produces a `choices` event and `appendAssistant(..., choices)`.
  - The loop's mid-stream fallback after partial text saves text + fallback; a round-1 connect failure saves no assistant row and returns `{ ok: false, status: 503|500 }` (Review Focus 4).
  - The system prompt contains the memory block and the `"assistant"` persona line.
- [ ] **Step 2:** Run `node --import tsx --test lib/clara/chat-service.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the service, then the thin route. Route order: `resolveClaraCaller` → `rateLimit("clara-chat", userId, 20, 60)` → body validation (`message` string 1–4,000 chars, `conversationId` optional string) → `guardClaraAppSpend` → `startClaraAppTurn` → `Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } })`. `maxDuration = 300`, Anthropic created like `dish-checker` (`timeout: 55_000, maxRetries: 0`). Busy errors map through `claraBusyStatus`.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit `feat(clara): /api/clara/chat with saved history and NDJSON`.

### Task 7: Conversation and memory routes

**Files:**
- Create: `app/api/clara/conversations/route.ts` (GET), `app/api/clara/conversations/[id]/route.ts` (GET, DELETE), `app/api/clara/memories/route.ts` (GET, DELETE = clear all), `app/api/clara/memories/[id]/route.ts` (DELETE)

**Interfaces:**
- Consumes: `resolveClaraCaller`, `makeConversationStore()`, `memoryStore`.
- Produces (JSON shapes clients rely on):
  - `GET /api/clara/conversations?cursor=` → `{ items: [{ id, title, updatedAt }], nextCursor }`
  - `GET /api/clara/conversations/:id` → `{ id, title, messages: [{ id, role, content, choices, createdAt }] }` or 404
  - `DELETE …/:id` → 204 / 404
  - `GET /api/clara/memories` → `{ items: [{ id, text, createdAt }] }`
  - `DELETE /api/clara/memories` → `{ deleted: n }`
  - `DELETE /api/clara/memories/:id` → 204 / 404
  - No patient → `{ items: [] }` for GETs, 404 for DELETEs

- [ ] **Step 1:** Implement the four route files as thin wrappers (no logic beyond auth, param parsing and status mapping; the stores are tested in Tasks 2–3).
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm test`. Expected: clean.
- [ ] **Step 3:** Commit `feat(clara): conversation and memory routes`.

### Task 8: `dish-checker` reads memories

**Files:**
- Modify: `app/api/dish-checker/route.ts` (append `buildMemoryBlock(firstName, await memoryStore.list(patient.id))` to the system prompt when `patient` exists; no tools added)

- [ ] **Step 1:** Implement. If the memory read throws, log it and continue without the block. The old chat must never fail because of memory.
- [ ] **Step 2:** Run `npm test` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Commit `feat(clara): web and old-app chat see Clara's memories`.

### Checkpoint A: user applies the migration

- [ ] Report to the user: migration path, the exact SQL it contains (only new tables), and the command for them to run, `npx prisma migrate deploy`. Run nothing yourself. Wait for their confirmation before Task 9.

### Task 9: Web chat on the new route

**Files:**
- Create: `lib/clara/ndjson-client.ts`, `lib/clara/ndjson-client.test.ts`, `components/clara/ConversationList.tsx`, `components/clara/AnswerChoices.tsx`
- Modify: `components/dish-checker/DishCheckerClient.tsx`, `app/(dashboard)/dish-checker/page.tsx`

**Interfaces:**
- Consumes: Task 6 events, Task 7 routes.
- Produces: `export async function* readClaraEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ClaraEvent>` (handles lines split across chunks; ignores blank lines; skips malformed lines).

- [ ] **Step 1:** Write failing tests for `readClaraEvents`: an event split across 3 chunks, two events in one chunk, a trailing line without `\n`, a malformed line skipped.
- [ ] **Step 2:** Run `node --import tsx --test lib/clara/ndjson-client.test.ts`. Expected: FAIL. Implement, re-run. Expected: PASS. Add the file to the `npm test` glob if it isn't covered (it is: `lib/clara/*.test.ts`).
- [ ] **Step 3:** Invoke `ui-ux-pro-max:ui-ux-pro-max`, then rebuild the chat client.
  - It sends `{ conversationId, message, clientDate, tzOffsetMinutes, surface: "web" }` and reads events.
  - The chat list has "New chat" and delete.
  - `AnswerChoices` sits under the latest assistant message only, with an "Other…" button that focuses the input.
  - Boxes and Send are disabled while streaming, and boxes hide on first tap (Review Focus 1).
  - A 429 `CLARA_RESTING` shows the copy as-is. A 409 `PROFILE_INCOMPLETE` shows a link to finish onboarding.
  - The greeting says Clara is an AI assistant.
  - Remove the quota-upgrade UI from this page.
- [ ] **Step 4: Verify in the browser** (preview tools, local dev, a signed-in test member per the QA harness memory):
  - start a chat;
  - reload and reopen it from the list;
  - an answer box round trip;
  - a swap confirmed through boxes shows on the meal-plan page;
  - double-tap an answer → one message.

  Screenshot proof.
- [ ] **Step 5:** Commit `feat(web): Clara chat with saved chats and answer boxes`.

### Task 10: "What Clara remembers" on `/profile` + privacy draft

**Files:**
- Create: `components/clara/MemoryList.tsx`
- Modify: `app/(dashboard)/profile/page.tsx`
- Create: `docs/superpowers/drafts/2026-10-28-privacy-clara-memory.md` (draft text only; **don't edit `app/(main)/privacy`**)

- [ ] **Step 1:** Invoke `ui-ux-pro-max:ui-ux-pro-max`, then build `MemoryList`: list, per-item delete, "Clear all" behind a confirm, empty state ("Clara hasn't saved anything yet. Tell her things like how many people you cook for.").
- [ ] **Step 2:** Verify in the browser: a memory saved in chat appears, deletes, and Clear all empties the list. Screenshot.
- [ ] **Step 3:** Write the privacy draft: saved chats (180-day retention, deletable), Clara's memory (member-visible, deletable, kept until deleted), no change to who data is shared with.
- [ ] **Step 4:** Commit `feat(web): Clara memory list on profile; privacy draft`.

## iOS (`/Users/becks/Desktop/BeTech/Clara`)

### Task 11: Branch, project regeneration, debug base-URL override

**Files:**
- Modify: `Clara/Core/Config/AppConfig.swift`, `ClaraTests/AppConfigTests.swift`

**Interfaces:**
- Produces: `AppConfig.baseURL` honours a DEBUG-only `-baseURL <url>` launch argument before the Info.plist value: `static func resolveBaseURL(arguments: [String], plistValue: String?) -> URL` (testable), used by `baseURL`.

- [ ] **Step 1: CHECKPOINT.** `git status` shows uncommitted changes to `Clara.xcodeproj/project.pbxproj` and `Config/Debug.xcconfig` that aren't ours. Ask the user whether to keep them as is on the new branch. New Swift files need `xcodegen generate`, which rewrites `project.pbxproj`. Don't continue until they answer.
- [ ] **Step 2:** `git checkout -b feat/clara-chat-upgrade`.
- [ ] **Step 3:** Write failing tests:
  - `-baseURL http://localhost:3000` wins over the plist in DEBUG;
  - the plist value is used without the argument;
  - a malformed argument falls back to the plist.
- [ ] **Step 4:** Run `xcodebuild test -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:ClaraTests/AppConfigTests`. Expected: FAIL. Implement, re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(config): debug -baseURL override`.

### Task 12: NDJSON chat client

**Files:**
- Create: `Clara/Features/Chat/ClaraChatEvent.swift`, `Clara/Core/Networking/NDJSONLineDecoder.swift`, `ClaraTests/NDJSONLineDecoderTests.swift`, `ClaraTests/ClaraChatEventDecodingTests.swift`
- Modify: `Clara/Core/Networking/WondishAPIClient.swift`

**Interfaces:**
- Produces:
  - `enum ClaraChatEvent: Equatable { case meta(conversationId: String), text(String), choices(question: String, options: [String]), done(messageId: String?) }` (`Decodable` by `type`)
  - `struct NDJSONLineDecoder { mutating func feed(_ bytes: Data) -> [Data] ; mutating func finish() -> [Data] }` (reuses `IncrementalUTF8Decoder` semantics for split UTF-8)
  - `protocol ClaraChatStreaming: Sendable { func streamClaraChat(conversationId: String?, message: String) -> AsyncThrowingStream<ClaraChatEvent, Error> }`, with `WondishAPIClient` conforming via `POST /api/clara/chat` (`surface: "ios"`, `clientDate`, `tzOffsetMinutes` as in `ChatWireRequestBody`)
  - `APIError` gains `.claraResting` (429 + `CLARA_RESTING`) and `.profileIncomplete` (409); the existing `.notFound` path stays for 404.

- [ ] **Step 1:** Write failing tests:
  - decoder: a line split across feeds, multi-line feed, trailing line on `finish()`;
  - event decoding for all four types and an unknown type (skipped);
  - error mapping for 429 `CLARA_RESTING` and 409.
- [ ] **Step 2:** Run the two test classes (command as Task 11 with `-only-testing`). Expected: FAIL. Implement, re-run. Expected: PASS.
- [ ] **Step 3:** Commit `feat(chat): NDJSON client for /api/clara/chat`.

### Task 13: Conversations and memories services

**Files:**
- Create: `Clara/Features/Chat/ConversationsService.swift`, `Clara/Features/Account/MemoriesService.swift`, DTOs in `Clara/Core/Networking/DTOs/ClaraDTOs.swift`, `ClaraTests/ClaraDTODecodingTests.swift`

**Interfaces:**
- Produces:
  - `struct ConversationSummary: Decodable, Identifiable { id: String; title: String; updatedAt: Date }`
  - `struct ConversationDetail: Decodable { id: String; title: String; messages: [StoredChatMessage] }`
  - `struct StoredChatMessage: Decodable { id: String; role: String; content: String; choices: ChoicesDTO?; createdAt: Date }`
  - `struct MemoryItem: Decodable, Identifiable { id: String; text: String; createdAt: Date }`
  - `protocol ConversationsServing { func list(cursor: String?) async throws -> (items: [ConversationSummary], nextCursor: String?); func get(_ id: String) async throws -> ConversationDetail; func delete(_ id: String) async throws }`
  - `protocol MemoriesServing { func list() async throws -> [MemoryItem]; func delete(_ id: String) async throws; func clearAll() async throws }`
  - Both are built on `WondishAPIClient.send`, following the `MealLogService` pattern.

- [ ] **Step 1:** Write failing decoding tests against JSON copied from Task 7's shapes (ISO dates with fractional seconds, `choices: null`).
- [ ] **Step 2:** Run. Expected: FAIL. Implement, re-run. Expected: PASS.
- [ ] **Step 3:** Commit `feat(chat): conversation and memory services`.

### Task 14: ChatViewModel upgrade

**Files:**
- Modify: `Clara/Features/Chat/ChatViewModel.swift`, `Clara/Features/Chat/ChatMessage.swift`, `ClaraTests/ChatViewModelTests.swift`

**Interfaces:**
- Consumes: `ClaraChatStreaming`, `ConversationsServing`.
- Produces on `ChatViewModel`:
  - `private(set) var conversationId: String?`
  - `private(set) var pendingChoices: (question: String, options: [String])?` (only for the latest assistant message)
  - `func send(_ text: String)` (also used by a tapped option)
  - `func choose(_ option: String)` (clears `pendingChoices`, then `send`)
  - `func startNewChat()`, `func open(_ id: String) async`
  - `func resumeIfRecent(now: Date) async` (opens the newest conversation when its `updatedAt` is within 12 hours, otherwise leaves a new chat)
  - `paywallPresented` and the 402 path are removed. `.claraResting` sets `lastError` with the spec copy shown as-is.

- [ ] **Step 1: Write failing tests** with scripted `ClaraChatStreaming` and `ConversationsServing` doubles:
  - `meta` sets `conversationId`;
  - `choices` sets `pendingChoices`;
  - `choose` twice while streaming sends **one** message (Review Focus 1);
  - `send` is ignored while streaming;
  - `resumeIfRecent` opens a conversation updated 11h ago and not one updated 13h ago;
  - `open` maps stored messages and restores `pendingChoices` from the last assistant message;
  - `.claraResting` shows the copy as-is.
- [ ] **Step 2:** Run `-only-testing:ClaraTests/ChatViewModelTests`. Expected: FAIL. Implement, re-run. Expected: PASS (update older tests that relied on the 402 paywall path).
- [ ] **Step 3:** Commit `feat(chat): saved chats, answer boxes and resume in the view model`.

### Task 15: Clara-first UI

**Files:**
- Modify: `Clara/App/RootTabView.swift`, `Clara/Features/Chat/ChatView.swift`, `Clara/Features/Account/SignedInView.swift`
- Create: `Clara/Features/Chat/Components/AnswerChoicesView.swift`, `Clara/Features/Chat/ConversationListView.swift`, `Clara/Features/Account/MemoriesView.swift`
- Modify: `project.yml` only if a new resource needs it; run `xcodegen generate` (approved in Task 11)

- [ ] **Step 1:** Invoke `ui-ux-pro-max:ui-ux-pro-max` (and `mobile-ios-design` for HIG details).
- [ ] **Step 2:** Tabs become `chat, restaurants, cook, mealPlan, account`, with default selection `.chat`. The DEBUG `-tab` argument still overrides.
- [ ] **Step 3:** `ChatView` toolbar: chat list (leading, sheet with `ConversationListView`: title + relative date, swipe to delete) and New chat (trailing). `AnswerChoicesView` chips under the latest Clara bubble, in the `StarterChips` style, plus "Other…", which focuses the input bar. Call `resumeIfRecent` on first appear. Greeting says Clara is an AI assistant.
- [ ] **Step 4:** Account tab gets a "What Clara remembers" row → `MemoriesView` (list, swipe to delete, Clear all with confirm, empty state copy from Task 10).
- [ ] **Step 5:** Build and run the full suite: `xcodebuild test -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`. Expected: all pass.
- [ ] **Step 6: Verify on the iPhone 17 Pro simulator** against local dev (launch with `-baseURL http://localhost:3000`):
  - the app opens on Clara;
  - a chat started on the web shows in the list and continues;
  - answer box round trip;
  - a confirmed swap appears in the Meal Plan tab;
  - memory saved → visible in Account → deleted.

  Screenshots. Relaunch without fixture flags afterwards.
- [ ] **Step 7:** Commit `feat(app): Clara first, with saved chats, answer boxes and memories`.

## Backend wrap-up (wondish_02)

### Task 16: Conversation retention cron

**Files:**
- Modify: `lib/clara/retention.ts`, `lib/clara/retention.test.ts`, `vercel.json` (add `{ "path": "/api/cron/clara-conversation-purge", "schedule": "30 4 * * *" }`)
- Create: `app/api/cron/clara-conversation-purge/route.ts`

**Interfaces:**
- Produces: `export const CONVERSATION_RETENTION_DAYS = 180`; the route reuses `isAuthorizedCron` and `gapRetentionCutoff(now, CONVERSATION_RETENTION_DAYS)` and deletes conversations with `updatedAt` before the cutoff (messages cascade; memories are untouched).

- [ ] **Step 1:** Write a failing test: the cutoff for 180 days, and that `CONVERSATION_RETENTION_DAYS === 180`. Run `node --import tsx --test lib/clara/retention.test.ts`. Expected: FAIL. Implement, re-run. Expected: PASS.
- [ ] **Step 2:** Implement the route modeled on `app/api/cron/clara-gap-purge/route.ts`. Run `npx tsc --noEmit`.
- [ ] **Step 3:** Commit `feat(clara): purge conversations idle for 180 days`.

### Task 17: Final checks

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `npm run lint` in wondish_02, and the full iOS test command. All green.
- [ ] **Step 2:** Read-only check of the production `CLARA_SKILLS`: `vercel env ls production | grep CLARA_SKILLS` (name only; if the value is needed, ask the user). Report whether `logs` and `plan` will be active. Change nothing.
- [ ] **Step 3:** Whole-branch review (both repos) with `superpowers:requesting-code-review`.
- [ ] **Step 4:** Report to the user:
  - what shipped;
  - the user's remaining tasks: apply the migration if not done, `CLARA_SKILLS`, the privacy text, App Store privacy labels, pushing both branches.
