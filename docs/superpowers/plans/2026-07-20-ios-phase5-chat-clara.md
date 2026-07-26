# Clara iOS Phase 5 — Chat (Clara AI dish-checker)

> **AMENDED 2026-07-22 (supersedes the specific steps it names; see the roadmap's two amendment blocks):**
>
> 1. **Build order:** this phase is built **right after the Restaurants tab** (alongside Phase 6) — its backend is already shipped. Branch from the **current Clara `main` tip**, not "the Phase-2 tip".
> 2. **Tab wiring.** The shipped `RootTabView` (Clara `a466a68`) already has the tab at the right slot with label "Clara"; `selection = .restaurants` and **no `.scan` case exists** — read Task instructions "preserve `selection: Tab = .scan`" as **preserve `selection: Tab = .restaurants`**. `UsageFeature { scan, fridge, chat }` case names are features, not tabs — they stand.
> 3. **ChatView is a mock, not a placeholder.** `Clara/Features/Chat/ChatView.swift` already ships the bubble layout, starter chips that **fill the input without auto-sending** (D2 is implemented), the capsule input bar, and the disabled-send state. The chat task keeps this shipped layout, deletes the demo `ChatMessage` struct + `sampleConversation`, and adds the streaming VM, `TypingIndicator`, `ClaraAvatar`, auto-scroll, retry affordances, and metering the mock lacks.
> 4. **Fix — blocked-redirect semantics (spec bug).** A `RedirectBlockingDelegate` returning `nil` from `willPerformHTTPRedirection` does **not** throw — it delivers the 3xx `HTTPURLResponse` itself. The client treats **any 3xx status** on the stream open exactly like a 401: one bounded force-refresh + re-open. Update the step-4 wording and the 307 `StreamingStubURLProtocol` test expectation accordingly (assert re-open on a delivered 307 response, not on a thrown error).
> 5. **Fix — history budget.** The server's `sanitizeChatHistory` budget (20 messages / 4,000 chars) gets a client-side counterpart: before send, truncate the transcript to the newest turns that fit **both** limits, dropping oldest user+assistant *pairs* first so role alternation (D11) is preserved; unit-test the truncation. Never rely on server-side truncation behavior that Task 5's live probe hasn't confirmed.
> 6. The D8 expiry-shape probe (401 JSON vs 307) stays, but per fix 4 the client handles **both** shapes identically, so the probe informs copy/logging only — it is no longer load-bearing for control flow.
>
> **AMENDED 2026-07-23 (user decision — supersedes D4/D12 and every client-metering step):** Chat freemium is enforced **server-side** per `2026-07-23-clara-ai-access-architecture.md`: `POST /api/dish-checker` gains a credit gate (premium bypass via `hasActivePremium`; free = `CHAT_DAILY_FREE = 5`/day via `rateLimit("chat-day", …, 86400)`) returning **402 `{"error":"Premium required"}`** before any Anthropic call. Consequences for this plan: the client-side `UsageMeter`/`FreemiumLimits.chatPerDay` wiring, the D4 increment-on-first-token rule, and the D12 accepted honor-system leak are **all void** — the iOS client sends freely and maps `.premiumRequired` (402) to the paywall sheet (`PaywallStubView` until Phase 2b lands; premium truth for UI copy = `session.me?.isPremium`). `EntitlementStore` is NOT a dependency anymore; Phase 2b later swaps the stub for the real `PaywallView(.chatLimit)`. The 429 burst limiter keeps its existing retry-bubble treatment (D6) — 402 is the only paywall trigger. REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each such task.**

**Goal:** Replace `ChatPlaceholderView` with the real **Clara** chat tab — a native, incrementally-streaming AI dish-checker conversation backed by the already-**shipped** web route `POST /api/dish-checker` (Anthropic `claude-sonnet-5`, Clerk Bearer, `sanitizeChatHistory` [C2], raw UTF-8 token stream, no new backend). The iOS surface consumes the stream over `URLSession.bytes(for:delegate:)`, renders assistant tokens live, decodes UTF-8 **codepoint-safely** so the ✅/❌ emoji the prompt emits never split at a chunk boundary (the web C4 hazard), renders the canned greeting **client-side only** (never sent as `messages[0]`, respecting the [C2] contract the web client already honors), maps the route's typed JSON errors (400/401/404/429/503/500) and abnormal mid-stream aborts to a retry affordance that preserves partial text, cancels in-flight streams on teardown/re-send, and mints a **fresh Bearer pre-flight** (a consumed stream body cannot replay). Freemium: Chat is free **5 messages/day** via the Phase-2 `UsageMeter`; beyond the cap a non-premium user is sent to `PaywallView(.chatLimit)`; premium bypasses via `EntitlementStore`.

**Architecture:** Phase 5 adds **no backend** — the wire contract is confirmed against the shipped `app/api/dish-checker/route.ts` + `components/dish-checker/DishCheckerClient.tsx` + `lib/chat-history.ts`, and the only server-side verification is a live Bearer-streaming smoke (Task 5). On iOS the streaming path is a new method on the Phase-2-delivered `actor WondishAPIClient` — `func streamChat(messages:) -> AsyncThrowingStream<String, Error>` — so the chat feature reuses `AppConfig.baseURL`, the `TokenProviding` seam, `RedirectBlockingDelegate`, `APIError`/`APIError.from(statusCode:body:)`/`APIError.from(urlError:)`, and the `\.apiClient` `EnvironmentKey` unchanged. Two pure, independently-unit-testable value types carry the load-bearing correctness: `IncrementalUTF8Decoder` (buffers a trailing partial multibyte sequence across `feed(_:)` calls, flushes only complete scalars — the Swift analog of the web's `TextDecoder({stream:true})`) and the greeting/history builder inside `ChatViewModel` (`@Observable @MainActor`; owns `[ChatMessage]`, streaming state, cancellation, retry, the [C2] client-side greeting omission, consecutive-user-turn coalescing, usage metering, paywall-at-cap). Tests inject a **real** `WondishAPIClient` over a new **`StreamingStubURLProtocol`** (a sibling of Phase-2's `StubURLProtocol` that emits an ordered array of `Data` chunks via multiple `urlProtocol(_:didLoad:)` calls, optionally followed by an error) so the split-emoji regression case, the 401 pre-flight retry, mid-stream abort, and premature-EOF are exercised end-to-end against the real client wiring with no live backend. All iOS logic is covered by `ClaraTests` (XCTest).

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 target, XcodeGen, XCTest; reuses the Phase-2-delivered Clerk iOS SDK / networking core / design system. No new SPM dependencies. Web side unchanged (Next.js 14, Anthropic SDK, Clerk v7) — read-only confirmation.

## Global Constraints

- **BLOCKING PREREQUISITE — Phase 2 must be merged first.** The Clara iOS repo is currently on `main` at **Phase 1** (design system + 5-tab HIG shell; Account is still `AccountPlaceholderView`; there is no `Core/Networking/`, no `Store/`, and none of the networking/session/freemium types this plan reuses). **Phase 2 (Tasks 1–8) must be implemented and merged before Phase 5 starts**; branch `phase5-chat-clara` is cut **from that Phase-2 merge, not from current `main`**. Throughout this plan, "shipped" refers ONLY to the web route/lib/client (genuinely in production); every iOS type described as reused is **delivered by Phase 2**, not yet on disk.
- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, separate from the web repo. App/bundle id: `io.wondish.clara`.
- Web repo: `/Users/becks/Desktop/NewView/wondish_02` — **read-only for Phase 5.** No route, lib, schema, or migration change. The only web touch is the live smoke in Task 5 and (optionally) confirming `lib/chat-history.test.ts` still passes — no new `node --test` file is required (Phase 5 adds no endpoint/lib).
- **Reuse Phase 2 wholesale (types it delivers).** `WondishAPIClient`, `APIError` (+ `from(statusCode:body:)` and `from(urlError:)`), `TokenProviding`, `RedirectBlockingDelegate`, `SessionStore` (`phase`, `user`, `me`, `bootstrap()`), `EntitlementStore.isPremium`, `UsageMeter`, `FreemiumLimits.chatPerDay`, `PaywallView(_:)` / `PaywallContext.chatLimit`, `StubURLProtocol` + `StubTokenProvider`, `LaunchFixtures`, `MeDTO`, `AppConfig.baseURL`, `\.apiClient`. New iOS surface is added ONLY where the streaming path genuinely needs it (the `streamChat` method, the two pure value types, the streaming stub, a `UsageFeature`-keyed counter on `UsageMeter` if Phase 2 did not already ship one — see Task 3, and the chat feature files).
- Swift + SwiftUI only; iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), portrait only. English only, no dark mode (design system is light-only). Reuse ported design tokens/components ONLY — **no new colors**, Inter fonts only.
- Brand tokens are fixed: primary `#812549`, primary-light `#B75E78`, primary-dark `#5F1C35`, background `#F9F7ED`, secondary cream `#F5F1DD`, border `#EAE4CA`, text `#1E1A1A`, secondary text `#4F4A4A`, tertiary `#848181`, success `#00B9A6`, warning `#FDC221`, error `#EA5455`. **`WBadge(.info)` is a teal alias of `.success`** — never use it for plan/state discrimination; use `.primary`/`.warning`/`.error`.
- **HIG: no emoji icons.** The web's 🌿 avatar is replaced by an SF Symbol (`leaf.fill` in `WColor.primary`) per the Phase-1 rule. Assistant *content* may contain the model's ✅/❌ emoji (that is text, not chrome) — render it, never strip it. ≥44 pt touch targets, respect safe areas, Dynamic Type, `.scrollDismissesKeyboard(.interactively)`.
- **Never `String(decoding: chunk, as: UTF8.self)` per chunk.** Every received byte-run flows through `IncrementalUTF8Decoder`; a codepoint split across chunk boundaries must surface exactly once, whole. This is the load-bearing C4 correctness requirement, and the **decoder's byte-at-a-time unit tests (Task 1) are the authoritative C4 proof** — the Task-2 stream test is client-wiring regression coverage, since `URLSession.AsyncBytes` may coalesce stubbed buffers before the async sequence observes them and cannot be relied on to reproduce a mid-codepoint boundary.
- **The canned greeting is display-only.** It is an assistant `ChatMessage` rendered in the UI and MUST be excluded from the POST body — mirror the web's `history.filter((m,i) => !(i === 0 && m.role === "assistant"))` (`DishCheckerClient.tsx:53`). The server would strip a leading assistant turn anyway (`sanitizeChatHistory` [C2]), but omitting it client-side matches the web and avoids wasting the 20-msg budget. (Correction 2026-07-25, per Cycle-2 final review: the server's 4000-char limit is **per message** — `sanitizeChatHistory` truncates each message to 4000 chars — not a 4000-char total across the history. Earlier wording implying a total budget was wrong.)
- **The wire history must alternate roles (D11).** `sanitizeChatHistory` strips only a *leading* assistant turn (`chat-history.ts:30-32`) — it does NOT coalesce consecutive same-role turns, and the Anthropic Messages API rejects two consecutive `user` messages. When a failed send leaves an empty/partial assistant placeholder and the user types a new message instead of retrying, the wire builder MUST NOT emit `[…user, user]`.
- **The 401 re-mint on a streaming request is PRE-FLIGHT, not mid-stream.** A body-consuming stream cannot be replayed once iterated, so the retry cancels the first `AsyncBytes` and re-opens the *entire* request exactly once, and only before any token is yielded. Bounded to one re-mint (mirrors Phase-2's rule, reimplemented for the streaming path).
- **In-flight streams are cancellable.** The consuming `Task` and the underlying `URLSession.AsyncBytes` fetch are cancelled before any new send/retry and on view teardown; `AsyncThrowingStream`'s `continuation.onTermination` cancels the fetch (see Task 2 / Task 3).
- iOS test/verify: `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test` (discover the device via `xcrun simctl list devices available | grep iPhone`).

---

## Open product decisions (need sign-off) — each has a RECOMMENDED default so the plan is actionable now

| # | Decision | RECOMMENDED default (plan is written against this) |
|---|---|---|
| D1 | Markdown rendering fidelity | **Plain `Text` while streaming; on stream completion render the final assistant text via `AttributedString(markdown:options:)` with `.inlineOnlyPreservingWhitespace` (preserves `\n`), falling back to plain `Text` on a thrown parse error.** The prompt (rule 10) forbids markdown, so this is defensive only — codepoint-safe decoding + newline preservation (`.fixedSize(horizontal:false, vertical:true)`) are the real needs. Re-parsing markdown per token is wasteful and is not done. |
| D2 | Starter-prompt chips | **Show 3 tappable example chips** (mirror the web: "Is lamb curry ok for me?", "Can I eat sushi tonight?", "What about a Caesar salad?") **only when the conversation is still just the greeting** (no user turn yet). Tapping fills the input (does not auto-send), then they disappear. This is an explicit, reasonable mobile adaptation of the web's persistent side-panel chips; cheap, high-signal onboarding. |
| D3 | Conversation persistence | **In-memory only for Phase 5** — the transcript lives in `ChatViewModel` and resets on app relaunch (a fresh greeting each cold start). No Core Data / disk. History persistence + multi-session is deferred (named in Out of scope). Matches the web (no server-side session id — `messages` is the only field). |
| D4 | What increments the 5/day meter | **One increment per user message that reaches a live reply — `usage.increment(.chat)` fires only after the stream returns HTTP 200 AND yields its first token, NOT at send-start.** A turn that fails pre-flight (`.unauthorized`), goes offline, or is rejected before any token (`400`/`429`/`404`/`503`) does **not** consume a daily credit. A retry of a failed send does NOT double-count. Premium bypasses entirely via `EntitlementStore.isPremium`. (This closes the "does a failed turn cost a message?" question — it does not.) |
| D5 | Greeting `firstName` source | **`session.me?.firstName` ?? `session.user?.firstName` ?? `"there"`.** `me?.firstName` mirrors the server's `account.firstName` (`route.ts:72`), which is the name Clara's system prompt uses — sourcing it first keeps the visible greeting consistent with the persona. Clerk identity (`session.user`) is the fallback for the cold-start window before `/api/me` resolves. Never render `"Hi !"` — the `"there"` default guarantees a clean greeting. |
| D6 | Server 20-req/60s rate-limit UX (backstop, separate from the 5/day meter) | **Surface gracefully as an inline error bubble with Retry** — `429 {"error":"Too many requests…"}` maps to `APIError.rateLimited`; the UI shows the server's human string (or a friendly fallback) and a Retry button. It is NOT a paywall trigger (that is the local 5/day cap only). Anthropic-side `429`/`503` ("Clara is busy…") map the same way. |
| D7 | Mid-stream abort & truncation handling | **Preserve partial text + append a Retry affordance on a thrown error; accept a clean-but-truncated EOF as `.complete`.** An abnormal termination after HTTP 200 that surfaces as a thrown `URLError`/premature-EOF error (`route.ts:122` `controller.error(err)`) marks the bubble `.failed`, keeps whatever streamed, and shows Retry that re-sends the same user turn (mirrors `DishCheckerClient.tsx:84-92`). **Known limitation:** the raw `text/plain` stream carries no completion sentinel, so a transport that delivers a truncated reply as an *error-free* EOF is indistinguishable from a real completion and is marked `.complete` (documented in Out of scope). Task 2/Task 3 include an explicit premature-EOF test asserting this decided behavior rather than assuming `.failed`. |
| D8 | Pre-flight token freshness & expiry surface | **Always `tokens.token(forceRefresh: true)` before opening the stream** (Clerk session JWTs are ~60 s TTL; force-refresh minimizes a mid-stream expiry). A `nil` minted token throws `.unauthorized` without ever sending `Bearer nil`. **A `401` on the opened stream — OR a blocked redirect to the sign-in page (`307 → /login`, which `RedirectBlockingDelegate` rejects, the shape an expired session may take if Clerk middleware guards the route) — forces one more refresh + one full re-open (after cancelling the first `AsyncBytes`); a second such failure → `.unauthorized`.** Task 5 Step 3 confirms which shape (`401` JSON vs `307`) a real expired iOS Bearer actually produces. |
| D9 | Send affordance | **Send button enabled only when the trimmed input is non-empty and no stream is in flight** (`canSend` trims — the web trims at `DishCheckerClient.tsx:38`, and `sanitizeChatHistory` drops whitespace-only content, so an untrimmed whitespace send would burn nothing per D4 but still 400); hardware-keyboard Return submits, Shift+Return inserts a newline (`.onSubmit`/multiline `TextField(axis:.vertical)`); the web's "Enter ↵ to send" hint is reproduced as tertiary caption text. |
| D10 | Fresh-account `404 "Account not found"` (no `account` row yet) | **Provision at launch + map the 404 to a "finish setup" affordance, not a blind Retry.** `/api/dish-checker` uses `findUnique({where:{clerkId}})` (`route.ts:39`) — NOT `getOrCreateAccount` — and 404s when no account row exists; a Retry can never self-heal that. **Call `GET /api/me` once during `session.bootstrap()`/launch** (the only `getOrCreateAccount` path) so the account is provisioned before Chat is usable; additionally map `.notFound` **for this route** to a distinct "Finish setting up your profile / open Account" affordance (open the Account tab) rather than the generic Retry bubble. |
| D11 | Failed-turn wire policy (alternation) | **Keep a non-empty partial assistant reply as a real assistant turn in the wire payload; drop an empty placeholder AND coalesce any resulting consecutive `user` turns** (join with `"\n\n"`) so the body always alternates. This guarantees the Anthropic API never sees `[…user, user]` after a user types past a failed turn without retrying. Covered by an explicit `wireMessages` test. |
| D12 | Freemium enforcement posture (5/day) | **Client-only via `UsageMeter`, accepted as an honor-system leak for Phase 5.** The route has NO server premium/quota gate — the cap lives only in `UserDefaults` and is bypassable by app reinstall and (if keyed on device-local midnight) by changing the device clock; the meter keys on a **device-local** date for Phase 5. The only real fix is a server-side per-user daily count on the route, which is **out of scope** (flagged as a tradeoff). Sign-off = "the leak is acceptable for launch." |

---

### Task 1: iOS — `IncrementalUTF8Decoder` (pure, C4-safe) + tests

**Repo:** `/Users/becks/Desktop/NewView/Clara` (branch `phase5-chat-clara`, cut from the merged Phase-2 tip). Zero dependencies; the foundation the streaming client rests on. Independently reviewable.

**Files:**
- Create: `Clara/Features/Chat/IncrementalUTF8Decoder.swift`
- Create: `ClaraTests/IncrementalUTF8DecoderTests.swift`

**Interfaces:**
- Produces: `struct IncrementalUTF8Decoder` — `mutating func feed(_ bytes: some Sequence<UInt8>) -> String` (appends to an internal `[UInt8]` buffer, finds the last **complete** UTF-8 boundary by walking back over continuation bytes `0x80...0xBF` up to 3 positions, decodes the complete prefix via `String(decoding: prefix, as: UTF8.self)`, **retains the trailing incomplete multibyte sequence** for the next call, returns the decoded prefix — possibly `""` when the whole chunk is a partial head) + `mutating func flush() -> String` (decodes and clears any remainder at stream end; a truly invalid tail decodes to U+FFFD, never throws). Pure, `Sendable`, no I/O. This is the Swift analog of `TextDecoder(..., {stream:true})` and is the authoritative C4 proof.

- [ ] **Step 1: Write failing `IncrementalUTF8DecoderTests`**

```swift
import XCTest
@testable import Clara

final class IncrementalUTF8DecoderTests: XCTestCase {
    // ✅ U+2705 = E2 9C 85 (3 bytes); ❌ U+274C = E2 9D 8C; 🌿 U+1F33F = F0 9F 8C BF (4 bytes)
    func testAsciiPassesThroughWhole() {
        var d = IncrementalUTF8Decoder()
        XCTAssertEqual(d.feed(Array("Looks great".utf8)), "Looks great")
    }
    func testFourByteEmojiSplitAcrossTwoChunksSurfacesOnceWhole() {
        var d = IncrementalUTF8Decoder()
        let e = Array("🌿".utf8)                       // [F0,9F,8C,BF]
        XCTAssertEqual(d.feed([e[0], e[1]]), "")       // partial head buffered, nothing emitted
        XCTAssertEqual(d.feed([e[2], e[3]]), "🌿")     // completes exactly once
    }
    func testThreeByteVerdictEmojiSplitAtEachBoundary() {
        var d = IncrementalUTF8Decoder()
        let e = Array("✅".utf8)                        // [E2,9C,85]
        XCTAssertEqual(d.feed([e[0]]), "")
        XCTAssertEqual(d.feed([e[1]]), "")
        XCTAssertEqual(d.feed([e[2]]), "✅")
    }
    func testTextThenTrailingPartialEmitsTextKeepsPartial() {
        var d = IncrementalUTF8Decoder()
        let bytes = Array("Yes ✅".utf8)                // "Yes " + [E2,9C,85]
        XCTAssertEqual(d.feed(Array(bytes[0..<5])), "Yes ")   // 4 ascii + first emoji byte held
        XCTAssertEqual(d.feed(Array(bytes[5...])), "✅")
    }
    func testFlushEmitsNothingWhenBalanced() {
        var d = IncrementalUTF8Decoder()
        _ = d.feed(Array("done".utf8))
        XCTAssertEqual(d.flush(), "")
    }
    func testFlushOnDanglingPartialDoesNotCrash() {
        var d = IncrementalUTF8Decoder()
        _ = d.feed([0xF0, 0x9F])                        // truncated emoji, stream died
        _ = d.flush()                                   // must not throw/crash (U+FFFD acceptable)
    }
    func testInterleavedMultibyteAndAsciiStreamReconstructsExactly() {
        var d = IncrementalUTF8Decoder()
        let full = "Sushi tonight? ✅ Great — swap soy for tamari ❌ if celiac."
        var out = ""
        for byte in Array(full.utf8) { out += d.feed([byte]) }  // 1 byte at a time (worst case)
        out += d.flush()
        XCTAssertEqual(out, full)
    }
}
```
Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `IncrementalUTF8Decoder.swift`**

Buffer `[UInt8]`. On `feed`: append; scan back from the end to the start of the last UTF-8 sequence (a lead byte is any byte NOT in `0x80...0xBF`); determine that lead byte's expected length from its high bits (`0xxxxxxx`→1, `110xxxxx`→2, `1110xxxx`→3, `11110xxx`→4); if the buffer holds all expected bytes of the final sequence, the whole buffer is complete → decode all, clear, return; otherwise decode everything up to the final lead byte, keep the final (incomplete) sequence, return the decoded prefix. `flush()` decodes+clears the remainder (invalid tail → replacement char). Run `IncrementalUTF8DecoderTests` → Expected: PASS (7).

- [ ] **Step 3: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(chat): codepoint-safe IncrementalUTF8Decoder (C4) + tests"
```
Expected: `TEST SUCCEEDED`.

---

### Task 2: iOS — streaming client (`WondishAPIClient.streamChat`), `ChatWireMessage`, `StreamingStubURLProtocol` + tests

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 1 (and Phase 2's `WondishAPIClient`/`APIError`/`RedirectBlockingDelegate`/`TokenProviding`).

**Files:**
- Create: `Clara/Features/Chat/ChatWireMessage.swift`
- Modify: `Clara/Core/Networking/WondishAPIClient.swift` (add `streamChat`; reuse the existing `session`/`tokens`/`baseURL`/redirect delegate — the actor must **retain a `RedirectBlockingDelegate` instance** to pass to `session.bytes(for:delegate:)`)
- Create: `Clara/Core/Networking/Support/StreamingStubURLProtocol.swift` (**`#if DEBUG`, app target**) — a distinct sibling of `StubURLProtocol`; emits an ordered `[Data]` of chunks via multiple `client?.urlProtocol(_:didLoad:)` calls, optionally then an error, so `bytes(for:)` exercises the real client wiring
- Create: `ClaraTests/StreamChatTests.swift`

**Interfaces:**
- Produces: `struct ChatWireMessage: Encodable, Equatable { let role: String; let content: String }` — the exact `{ "messages": [ { role, content } ] }` element the route accepts. `role ∈ {"user","assistant"}`.
- Produces (on the existing `actor WondishAPIClient`): `func streamChat(messages: [ChatWireMessage]) -> AsyncThrowingStream<String, Error>` — the streaming counterpart of `send`. Behavior:
  1. **Pre-flight mint (D8):** `let jwt = try await tokens.token(forceRefresh: true)`; `nil` → finish the stream throwing `.unauthorized` (never send `Bearer nil`).
  2. Build `POST {baseURL}/api/dish-checker`, `Content-Type: application/json`, `Accept: text/plain`, `Authorization: Bearer <jwt>`, body `{"messages": messages}` (JSON-encoded; the greeting/alternation are already handled by the caller — see Task 3).
  3. `let (bytes, response) = try await session.bytes(for: request, delegate: redirectBlocker)` — the **same `RedirectBlockingDelegate`** the buffered path uses, so a `307 → /login` HTML page can never be consumed as tokens. A blocked redirect surfaces as a thrown error and is treated as an auth-expiry signal (D8).
  4. **Inspect `(response as? HTTPURLResponse)?.statusCode` BEFORE emitting any token.** On `401` (or a blocked-redirect throw from step 3) → **cancel/close the first `bytes` iteration**, force-refresh once (`token(forceRefresh:true)`), rebuild, re-open the whole request exactly once; a second `401`/blocked-redirect (or a `nil` re-mint) → throw `.unauthorized`. On any other non-2xx → drain `bytes` into `Data` (`for try await b in bytes { buf.append(b) }`), `throw APIError.from(statusCode: code, body: buf)` (maps `400`→**`.server(status: 400)`** [surface the server's `{"error":…}` string], `404`→`.notFound`, `429`→`.rateLimited`, `503`/`500`→`.server`).
  5. On 2xx: iterate `for try await byte in bytes`, funnel each byte-run through a per-stream `IncrementalUTF8Decoder`, `continuation.yield(decoded)` for every non-empty part; on normal EOF `yield(decoder.flush())` then `continuation.finish()`.
  6. A thrown `URLError` mid-iteration (the `controller.error(err)` abnormal-abort case, D7) → map via `APIError.from(urlError:)` → `continuation.finish(throwing:)`. The already-yielded partial text is retained by the caller (`ChatViewModel`).
  7. **Cancellation (F1/F5):** wrap the fetch/iteration in an inner `Task` and set `continuation.onTermination = { @Sendable _ in fetchTask.cancel() }` so that when the caller cancels its consuming `Task` (new send, retry, teardown), the underlying `session.bytes` fetch is cancelled and the connection released. The 401 re-open path must cancel the first `AsyncBytes` before opening the second so the first connection is not leaked.
- Produces (test double): `StreamingStubURLProtocol` — `enqueue(status:headers:chunks:[Data], thenError: URLError? = nil)` and `enqueueError(_:)`; delivers the `HTTPURLResponse` then each chunk via a separate `urlProtocol(_:didLoad:)`, then (if given) `urlProtocol(_:didFailWithError:)`. Captures the request **body** in `canInit`/`startLoading` before the stream is drained (`URLProtocol` moves `httpBody` into `httpBodyStream`, so the stub reads and stores it as `httpBodyData` alongside the recorded request) and records requests into a static array. **Note in code comment:** two `didLoad:` calls do not guarantee `AsyncBytes` yields at those boundaries (URLSession may coalesce) — the split-emoji test here is client-wiring regression coverage, not the boundary proof (that is Task 1).

- [ ] **Step 1: Write `StreamingStubURLProtocol` + `ChatWireMessage`, then failing `StreamChatTests`**

`StreamingStubURLProtocol` (app target, `#if DEBUG`): a per-request queue of `(HTTPURLResponse, [Data], URLError?)`; in `startLoading()`, send the response with `.cacheStoragePolicy(.notAllowed)`, then loop the chunks calling `client?.urlProtocol(self, didLoad:)` per chunk, then either `urlProtocol(_:didFailWithError:)` (if `thenError`) or `urlProtocolDidFinishLoading`. Record the request (with captured `httpBodyData`) into a static array. Then:

```swift
import XCTest
@testable import Clara

final class StreamChatTests: XCTestCase {
    func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StreamingStubURLProtocol.self]
        return URLSession(configuration: cfg)
    }
    func collect(_ s: AsyncThrowingStream<String, Error>) async throws -> String {
        var out = ""; for try await part in s { out += part }; return out
    }
    func client(_ tokens: StubTokenProvider) -> WondishAPIClient {
        WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: tokens, session: makeSession())
    }

    func testStreamsConcatenatedTokensInOrder() async throws {
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("Hi ".utf8), Data("there ✅".utf8)])
        let text = try await collect(client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "hi")]))
        XCTAssertEqual(text, "Hi there ✅")
    }
    func testSplitEmojiAcrossChunkBoundariesReconstructsWhole() async throws {   // client-wiring regression
        let e = Array("🌿".utf8)
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data([e[0], e[1]]), Data([e[2], e[3]])])
        let text = try await collect(client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))
        XCTAssertEqual(text, "🌿")
    }
    func testPreflightSendsForceRefreshedBearer() async throws {
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("ok".utf8)])
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1")
        _ = try await collect(client(tokens).streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))
        XCTAssertEqual(tokens.forceRefreshCount, 1)  // pre-flight forced
        XCTAssertEqual(StreamingStubURLProtocol.recorded.first?.value(forHTTPHeaderField: "Authorization"), "Bearer T1")
    }
    func test401ReopensOnceWithFreshTokenThenSucceeds() async throws {
        StreamingStubURLProtocol.enqueue(status: 401, chunks: [Data("{}".utf8)])
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("ok".utf8)])
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1", refreshed2: "T2")
        let text = try await collect(client(tokens).streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))
        XCTAssertEqual(text, "ok")
        XCTAssertEqual(StreamingStubURLProtocol.recorded.count, 2)
        XCTAssertEqual(StreamingStubURLProtocol.recorded[1].value(forHTTPHeaderField: "Authorization"), "Bearer T2")
    }
    func testSecond401ThrowsUnauthorizedNoThirdRequest() async {
        StreamingStubURLProtocol.enqueue(status: 401, chunks: [Data("{}".utf8)])
        StreamingStubURLProtocol.enqueue(status: 401, chunks: [Data("{}".utf8)])
        await XCTAssertThrowsErrorAsync(try await self.collect(self.client(StubTokenProvider(fresh: "T0", refreshed: "T1", refreshed2: "T2"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))) { XCTAssertEqual($0 as? APIError, .unauthorized) }
        XCTAssertEqual(StreamingStubURLProtocol.recorded.count, 2)
    }
    func testBlockedRedirectTriggersReMintThenSucceeds() async throws {   // D8/F4: 307→sign-in treated as expiry
        StreamingStubURLProtocol.enqueue(status: 307, headers: ["Location": "https://x.test/login"], chunks: [Data("<html>login</html>".utf8)])
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("ok".utf8)])
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1", refreshed2: "T2")
        let text = try await collect(client(tokens).streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))
        XCTAssertEqual(text, "ok")
        XCTAssertEqual(StreamingStubURLProtocol.recorded.count, 2)  // redirect body never consumed as tokens
    }
    func test400MapsToServerErrorBeforeAnyToken() async {
        StreamingStubURLProtocol.enqueue(status: 400, chunks: [Data(#"{"error":"Invalid messages"}"#.utf8)])
        await XCTAssertThrowsErrorAsync(try await self.collect(self.client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))) {
                XCTAssertEqual(($0 as? APIError), .server(status: 400)) }
    }
    func test429MapsToRateLimitedBeforeAnyToken() async {
        StreamingStubURLProtocol.enqueue(status: 429, chunks: [Data(#"{"error":"Too many requests. Please wait a moment before asking again."}"#.utf8)])
        await XCTAssertThrowsErrorAsync(try await self.collect(self.client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))) { XCTAssertEqual($0 as? APIError, .rateLimited(retryAfter: nil)) }
    }
    func test404MapsToNotFound() async {   // D10: fresh-account "Account not found"
        StreamingStubURLProtocol.enqueue(status: 404, chunks: [Data(#"{"error":"Account not found"}"#.utf8)])
        await XCTAssertThrowsErrorAsync(try await self.collect(self.client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))) { XCTAssertEqual($0 as? APIError, .notFound) }
    }
    func testNilPreflightTokenThrowsUnauthorizedWithoutSending() async {
        let tokens = StubTokenProvider(fresh: nil, refreshed: nil)
        await XCTAssertThrowsErrorAsync(try await self.collect(self.client(tokens)
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))) { XCTAssertEqual($0 as? APIError, .unauthorized) }
        XCTAssertTrue(StreamingStubURLProtocol.recorded.isEmpty)
    }
    func testMidStreamAbortSurfacesErrorAfterPartial() async {   // D7: thrown-error path
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("partial ".utf8)], thenError: URLError(.networkConnectionLost))
        var got = ""
        do {
            for try await part in self.client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
                .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]) { got += part }
            XCTFail("expected throw")
        } catch { XCTAssertEqual(error as? APIError, .offline) }
        XCTAssertEqual(got, "partial ")   // partial preserved (D7)
    }
    func testPrematureCleanEOFFinishesWithoutError() async throws {   // D7: no-sentinel truncation → normal finish
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("Looks good but ".utf8)])  // stub finishes cleanly mid-thought
        let text = try await collect(client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")]))
        XCTAssertEqual(text, "Looks good but ")   // stream ends normally; ViewModel marks .complete (documented limitation)
    }
    func testGreetingNotSentIsCallerContract() async throws {
        // streamChat sends exactly what it is given; the [C2] greeting-omission + alternation are the ViewModel's job (Task 3).
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("ok".utf8)])
        _ = try await collect(client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "only user turn")]))
        let body = StreamingStubURLProtocol.recorded.first?.httpBodyData ?? Data()
        let decoded = try JSONDecoder().decode([String: [ChatWireMessage]].self, from: body)
        XCTAssertEqual(decoded["messages"], [ChatWireMessage(role: "user", content: "only user turn")])
    }
    func testCancellationStopsFetch() async throws {   // F1: consuming-Task cancel releases the fetch
        StreamingStubURLProtocol.enqueue(status: 200, chunks: [Data("a".utf8), Data("b".utf8), Data("c".utf8)])
        let stream = client(StubTokenProvider(fresh: "T0", refreshed: "T1"))
            .streamChat(messages: [ChatWireMessage(role: "user", content: "x")])
        let task = Task { var n = 0; for try await _ in stream { n += 1; if n == 1 { break } } }  // stop early → onTermination fires
        _ = try await task.value
        // Assert (via a StreamingStubURLProtocol hook) the underlying load was cancelled / did not run to completion.
    }
}
```
(Extend `StubTokenProvider` with an optional `refreshed2` for the double-refresh path; `StreamingStubURLProtocol.enqueue` takes `thenError:`; add a cancellation-observed hook the stub can expose for `testCancellationStopsFetch`.) Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `ChatWireMessage.swift` + `WondishAPIClient.streamChat`**

Add `streamChat` to the actor returning `AsyncThrowingStream<String, Error> { continuation in let fetchTask = Task { … }; continuation.onTermination = { _ in fetchTask.cancel() } }`. Factor a private `openChatStream(messages:forceRefresh:) async throws -> (URLSession.AsyncBytes, HTTPURLResponse)` that mints, builds the request (reuse a `buildURLRequest`-style helper), and opens `session.bytes(for:delegate: redirectBlocker)`; the outer method calls it with `forceRefresh:true`, catches a blocked-redirect throw as well as a `401` status, cancels the first bytes stream, calls it again once, then drives the decoder loop. Map non-2xx via `APIError.from(statusCode:body:)` after draining; add the `400 → .server(status: 400)` branch if Phase 2's mapper lacks it. Ensure `APIError.from(urlError:)` folds `.networkConnectionLost` and premature-EOF into `.offline` (extend it in the Networking core if Phase 2 covered only `.notConnectedToInternet`/`.timedOut`). Run `StreamChatTests` → Expected: PASS.

- [ ] **Step 3: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(chat): WondishAPIClient.streamChat (pre-flight mint, bounded 401/redirect re-open, cancellation, C4 decode) + StreamingStubURLProtocol"
```
Expected: `TEST SUCCEEDED`.

---

### Task 3: iOS — `ChatMessage` model + `ChatViewModel` (greeting/[C2], streaming state, cancellation, retry, usage/paywall) + `UsageMeter` chat-counter + tests

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 2 (and Phase 2's `SessionStore`, `EntitlementStore`, `UsageMeter`/`FreemiumLimits`, `PaywallContext`).

**Files:**
- Create: `Clara/Features/Chat/ChatMessage.swift`
- Create: `Clara/Features/Chat/ChatViewModel.swift`
- Modify: `Clara/Store/UsageMeter.swift` — **only if Phase 2 did not already ship a per-feature counter.** Pin/add `enum UsageFeature: String { case scan, fridge, chat }`, `func count(_ f: UsageFeature) -> Int`, `func increment(_ f: UsageFeature)`, keyed on a **device-local** day (D12), plus an **injectable `UserDefaults` init** (`init(defaults: UserDefaults = .standard)`) so tests use an ephemeral `UserDefaults(suiteName:)`. If Phase 2 already exposes this exact surface, cite its signature here instead and skip the edit. Add/confirm a `UsageMeterTests` case for `increment`/`count`/day-rollover.
- Create: `ClaraTests/ChatViewModelTests.swift`

**Interfaces:**
- Produces: `struct ChatMessage: Identifiable, Equatable { let id: UUID; let role: Role; var content: String; var state: State }` with `enum Role { case user, assistant }` and `enum State: Equatable { case complete, streaming, failed }`. The greeting is `ChatMessage(role: .assistant, content: greetingText, state: .complete)`.
- Produces: `@Observable @MainActor final class ChatViewModel` —
  - `init(api: WondishAPIClient, session: SessionStore, entitlement: EntitlementStore, usage: UsageMeter)`; on init seeds `messages = [greeting]` using `greetingText(firstName:)` (D5).
  - `private(set) var messages: [ChatMessage]`, `private(set) var isStreaming: Bool`, `var input: String`, **`var showPaywall: Bool`** (settable — the `.sheet(isPresented:)` binding in Task 4 must be able to set it false on dismiss; see #13), `private(set) var lastError: APIError?`, `private(set) var lastErrorIsAccountSetup: Bool` (true when the failure is the D10 fresh-account `404`), and a private `streamTask: Task<Void, Never>?`.
  - Pure static helpers (unit-tested without any live client):
    - `static func greetingText(firstName: String?) -> String` → the **verbatim** web template (`DishCheckerClient.tsx:15`): `"Hi \(firstName ?? "there")! I'm Clara, your personal food advisor. Tell me about any dish or food you're thinking of eating — I'll check it against your dietary profile and let you know if it's a good fit, and suggest changes if not."` (note the em-dash `—`).
    - `static func wireMessages(from messages: [ChatMessage]) -> [ChatWireMessage]` — maps to `{role,content}`, **drops a leading assistant message** (the [C2] greeting-omission: `filter { !(index == 0 && role == .assistant) }`), **drops empty/failed-empty assistant placeholders but keeps non-empty partial assistant content as a real assistant turn**, then **coalesces any consecutive `user` turns** (join with `"\n\n"`) so the result strictly alternates (D11).
    - `static func canSend(input: String, isStreaming: Bool) -> Bool` — `!isStreaming && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty` (D9).
  - `func send() async` — guard `canSend`; **usage gate (D4/D12):** if `!entitlement.isPremium && usage.count(.chat) >= FreemiumLimits.chatPerDay` → `showPaywall = true`, return (no message appended, no increment); else append the user `ChatMessage` (trimmed content), append an empty `.streaming` assistant placeholder, set `isStreaming`, clear `input`, cancel any prior `streamTask`, then in a stored `streamTask`: `for try await token in api.streamChat(messages: Self.wireMessages(from: messages)) { on the FIRST non-empty token, if !premium increment usage.increment(.chat) exactly once for this turn; append token to the placeholder }`; on normal EOF mark `.complete` (D7 clean-EOF limitation); on `throws` mark the placeholder `.failed`, keep partial content, store `lastError`, set `lastErrorIsAccountSetup` when it is the D10 `.notFound`. **The meter increments only after HTTP-200 + first token (D4)** — a pre-flight/immediate failure that yields no token costs no credit.
  - `func retryLast() async` — cancels `streamTask`, removes the failed assistant bubble, re-appends a fresh `.streaming` one, re-drives the stream for the last user turn; **does not re-increment the meter** (the first-token guard already fired once for that turn, or not at all).
  - `func useSuggestion(_ text: String)` — sets `input = text` (D2, does not send).
  - `func cancelStream()` — cancels `streamTask` (called from the view's `onDisappear`, F1).
  - `var showStarterChips: Bool { messages.count == 1 }` (only the greeting present).

- [ ] **Step 1: Write failing `ChatViewModelTests`** (inject a real `WondishAPIClient` over `StreamingStubURLProtocol`, a `SessionStore` seeded via a `MeDTO`/user stub, an `EntitlementStore`, and a fresh `UsageMeter` over an ephemeral `UserDefaults(suiteName:)`):

```swift
final class ChatViewModelTests: XCTestCase {
    func testGreetingUsesFirstNameVerbatimAndFallsBackToThere() {
        XCTAssertEqual(ChatViewModel.greetingText(firstName: "Ada"),
            "Hi Ada! I'm Clara, your personal food advisor. Tell me about any dish or food you're thinking of eating — I'll check it against your dietary profile and let you know if it's a good fit, and suggest changes if not.")
        XCTAssertTrue(ChatViewModel.greetingText(firstName: nil).hasPrefix("Hi there! I'm Clara"))
    }
    func testWireMessagesDropsLeadingAssistantGreetingC2() {
        let msgs = [
            ChatMessage(id: UUID(), role: .assistant, content: "Hi Ada! …", state: .complete),
            ChatMessage(id: UUID(), role: .user, content: "sushi ok?", state: .complete),
        ]
        XCTAssertEqual(ChatViewModel.wireMessages(from: msgs),
                       [ChatWireMessage(role: "user", content: "sushi ok?")])   // greeting NOT sent
    }
    func testWireMessagesKeepsInteriorAssistantTurns() {
        let msgs = [greetingMsg, userMsg("a"), assistantMsg("verdict ✅"), userMsg("b")]
        XCTAssertEqual(ChatViewModel.wireMessages(from: msgs).map(\.role), ["user", "assistant", "user"])
    }
    func testWireMessagesCoalescesConsecutiveUsersAfterFailedTurn() {   // D11/F3
        // greeting, user A, EMPTY failed assistant, user B  →  [user "A\n\nB"]  (no [user,user])
        let msgs = [greetingMsg, userMsg("A"),
                    ChatMessage(id: UUID(), role: .assistant, content: "", state: .failed),
                    userMsg("B")]
        let wire = ChatViewModel.wireMessages(from: msgs)
        XCTAssertEqual(wire.map(\.role), ["user"])
        XCTAssertEqual(wire.first?.content, "A\n\nB")
    }
    func testCanSendTrimsWhitespace() {   // D9/F9
        XCTAssertFalse(ChatViewModel.canSend(input: "   \n ", isStreaming: false))
        XCTAssertFalse(ChatViewModel.canSend(input: "ok", isStreaming: true))
        XCTAssertTrue(ChatViewModel.canSend(input: " ok ", isStreaming: false))
    }
    func testSendStreamsAssistantReplyToCompletion() async { /* enqueue 200 chunks; last bubble .complete, concatenated text */ }
    func testSendIncrementsChatMeterOnceAfterFirstTokenForFreeUser() async { /* usage.count(.chat) == 1 after a 200 send */ }
    func testPremiumUserDoesNotIncrementMeter() async { /* entitlement.isPremium=true; count stays 0 */ }
    func testFailedPreflightDoesNotBurnCredit() async {   // D4/F8
        /* enqueue nothing (nil token) OR 429; send(); assert usage.count(.chat) == 0 and bubble .failed */
    }
    func testFreeUserAtCapShowsPaywallAndDoesNotSend() async {
        /* pre-set usage to 5; send(); assert showPaywall == true, messages unchanged (still greeting), no request recorded */
    }
    func testStreamErrorMarksBubbleFailedPreservingPartial() async {
        /* enqueue 200 "partial " thenError; last bubble .failed, content == "partial ", lastError == .offline */
    }
    func testCleanEOFMarksBubbleComplete() async {   // D7 documented limitation
        /* enqueue 200 "Looks good but " (no error); last bubble .complete, content == "Looks good but " */
    }
    func testNotFoundSetsAccountSetupAffordance() async {   // D10
        /* enqueue 404 {"error":"Account not found"}; send(); assert lastErrorIsAccountSetup == true, no meter burn */
    }
    func testRetryDoesNotDoubleCountMeter() async { /* 200 then fail path; retryLast(); count still 1 */ }
    func testStarterChipsVisibleOnlyBeforeFirstUserTurn() async {
        /* fresh VM: showStarterChips == true; after a send: false */
    }
}
```
Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `ChatMessage.swift` + `ChatViewModel.swift`** (and the `UsageMeter` chat-counter edit if needed) per interface. Keep all send/stream mutation on `@MainActor`; append streamed tokens by mutating `messages[lastIndex].content`; store/cancel `streamTask`; increment the meter on the first non-empty token only. Run `ChatViewModelTests` (+ `UsageMeterTests`) → Expected: PASS.

- [ ] **Step 3: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(chat): ChatViewModel (client-side greeting/[C2], alternation-safe wire, cancel, retry, first-token 5/day gate) + ChatMessage + UsageMeter.chat"
```
Expected: `TEST SUCCEEDED`.

---

### Task 4: iOS — Chat UI (`ChatView`, `MessageBubble`, `ChatInputBar`, typing indicator, starter chips, auto-scroll), replace `ChatPlaceholderView`

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 3. **Frontend task — Step 1 invokes `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/Features/Chat/ChatView.swift`
- Create: `Clara/Features/Chat/Components/MessageBubble.swift`, `ChatInputBar.swift`, `TypingIndicator.swift`, `StarterChips.swift`, `ClaraAvatar.swift`
- Modify: `Clara/App/RootTabView.swift` (`.chat` body: `ChatPlaceholderView()` → `ChatView()`; **keep label `"Clara"` / `systemImage: "bubble.left.and.text.bubble.right"`; preserve `selection: Tab = .scan` and all four non-chat tab bodies unchanged**)
- Delete: `Clara/Features/Chat/ChatPlaceholderView.swift` (after `ChatView` lands)
- Modify: `Clara/App/LaunchFixtures.swift` (add a `chat` fixture — see Produces below)
- Modify: `Clara/Features/Paywall/PaywallView.swift` **only if** `PaywallContext.chatLimit` copy is not already present (Phase 2 defined the case; this task wires the headline/subhead if absent)

**Interfaces:**
- Consumes: `WColor`/`WFont`/`WSpacing`/`WRadius`, `WButton`/`WButtonStyle`, `WBadge`, `.wCard()`, `BrandWordmark`, `WondishAPIClient` (`\.apiClient`), `SessionStore`, `EntitlementStore`, `UsageMeter`, `PaywallView(.chatLimit)`, `ChatViewModel`.
- Produces: `struct ChatView` — `NavigationStack { messages ScrollView + ChatInputBar }`, `.navigationTitle("Clara")`, `WColor.background`. Owns `@State private var vm: ChatViewModel` built from `@Environment` (`\.apiClient`, `session`, `entitlement`, `usage`). Presents `PaywallView(.chatLimit)` via `.sheet(isPresented: $vm.showPaywall)` (binding writes back on dismiss — `showPaywall` is a settable `var`, #13). Calls `vm.cancelStream()` in `.onDisappear` (F1). Auto-scroll: `ScrollViewReader` + a bottom-anchor `id`; **animate only on `.onChange(of: vm.messages.count)` (new turn); during streaming scroll WITHOUT animation on `.onChange(of: lastMessageContentLength)`** to avoid overlapping-animation stutter (F6); `.scrollDismissesKeyboard(.interactively)`.
- Produces: `struct MessageBubble(message:)` — **user** = `WColor.textPrimary` (`#1E1A1A`) fill, white text, trailing-aligned, `rounded-br` tight corner; **assistant** = `WColor.surfaceSecondary` (`#F5F1DD` cream — one step off the `#F9F7ED` page background for contrast) fill, `WColor.textPrimary` text, leading-aligned with a leading `ClaraAvatar`. `.font(WFont.inter(15))`, `max width ≈ 78%`, `.fixedSize(horizontal:false, vertical:true)`, `.textSelection(.enabled)`. `state == .complete && role == .assistant` → render via D1 AttributedString path; `.streaming` → plain `Text`; `.failed` → partial text + a `WColor.error` inline affordance: for the D10 account-setup case a **"Finish setting up your profile"** row that opens the Account tab, otherwise **"Couldn't finish — Tap to retry"** calling `vm.retryLast()`.
- Produces: `struct TypingIndicator` — three `WColor.primary` dots with a staggered bounce (SwiftUI `.animation` phase, no emoji), shown inside the assistant placeholder bubble while `content.isEmpty && state == .streaming` (mirrors the web's bouncing dots).
- Produces: `struct StarterChips(onTap:)` — the 3 D2 example prompts as tappable `WColor.primary`-tinted pills (`WColor.primary` at low opacity fill, `#B75E78` text), shown only when `vm.showStarterChips`; tapping calls `vm.useSuggestion(_:)`.
- Produces: `struct ChatInputBar(text:isStreaming:onSend:)` — a `TextField("Ask Clara about any food or dish…", axis: .vertical)` on `WColor.surfaceSecondary`, 1–5 lines, disabled while streaming; a circular Send button (`arrow.up`) in `WColor.primary`, ≥44 pt, disabled unless `ChatViewModel.canSend(input:isStreaming:)` (trimmed, D9); tertiary caption "Return to send · Shift+Return for a new line". Respects the keyboard safe area.
- Produces: `struct ClaraAvatar` — `leaf.fill` in `WColor.primary` on a `WColor.primary`-tint circle (**SF Symbol, never the web 🌿 emoji**).
- Produces (on `LaunchFixtures`): a `chat` case that **seeds `ChatViewModel.messages` directly** (no live stream): for the mid-stream screenshot it injects a pre-populated `.streaming` assistant bubble (partial content, `isStreaming = true`); for the verdict screenshot it builds the VM's client over `StreamingStubURLProtocol` with an enqueued canned transcript; both over a signed-in `SessionStore`. This makes Task 5's screenshots deterministic without pausing a live stream (F/#8).

- [ ] **Step 1: Invoke the frontend design skills, then confirm the layout map**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing any SwiftUI. Layout: `NavigationStack` (title "Clara", inline) → `ScrollViewReader { ScrollView { LazyVStack(spacing: WSpacing.md) { ForEach(vm.messages) { MessageBubble($0) }; if vm.showStarterChips { StarterChips } ; bottomAnchor } } }` → pinned `ChatInputBar` above the keyboard. Background `WColor.background`. Component reuse only (no new colors/components beyond the token-only primitives).

- [ ] **Step 2: Build the leaf components** — `ClaraAvatar`, `TypingIndicator`, `MessageBubble` (all three `state`s, both `.failed` affordances, D1 render path), `StarterChips`, `ChatInputBar` (multiline, trimmed Send affordance, caption). Each on brand tokens, ≥44 pt targets, `#Preview`s for the three bubble states + input bar.

- [ ] **Step 3: Compose `ChatView`; wire auto-scroll, paywall sheet, cancellation, RootTabView swap**

`ChatView` owns `ChatViewModel`; renders the transcript + input bar; `.sheet(isPresented: $vm.showPaywall) { PaywallView(.chatLimit) }`; `.onDisappear { vm.cancelStream() }`; animate-on-append / silent-scroll-on-stream (F6); `.scrollDismissesKeyboard(.interactively)`. In `RootTabView`, replace the `.chat` body `ChatPlaceholderView()` → `ChatView()` (leave `selection = .scan`, `.tint(WColor.primary)`, and the other four tabs untouched); delete `ChatPlaceholderView.swift`. Add the `chat` `LaunchFixtures` case per the Produces above.

- [ ] **Step 4: Regenerate, build, test, screenshot, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Then via `using-xcode-cli`: boot sim, install/launch `io.wondish.clara` with `-UITestFixture chat`, screenshot: (a) fresh greeting + starter chips, (b) seeded mid-stream bubble with typing indicator / partial text, (c) a completed verdict reply (✅/❌ visible), (d) the chat-limit `PaywallView`. Save to the scratchpad.
```bash
git add -A && git commit -m "feat(chat): streaming Clara chat UI (bubbles, typing indicator, starter chips, input bar, cancel-on-teardown), replace placeholder"
```
Expected: `TEST SUCCEEDED` + screenshots showing maroon `#812549`, cream `#F5F1DD`/`#F9F7ED`, Inter, `leaf.fill` avatar (no emoji chrome), ≥44 pt Send target.

---

### Task 5: VERIFY — build + iOS suite + live Bearer-streaming smoke + chat screenshots

**Repo:** both — depends Tasks 1–4. Uses `using-xcode-cli` for every simulator step. Chat states use the `#if DEBUG -UITestFixture chat` harness (Task 4) over `StreamingStubURLProtocol`.

- [ ] **Step 1: Regenerate + build (iOS) + confirm web still green**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
DEV=$(xcrun simctl list devices available | grep -m1 -o 'iPhone [0-9][^(]*' | xargs)
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" build
cd /Users/becks/Desktop/NewView/wondish_02 && npm test    # no new web code; confirm chat-history + suite unchanged-green
```
Expected: `BUILD SUCCEEDED` + web `pass N fail 0` (Phase 5 added no web code).

- [ ] **Step 2: iOS unit tests**

```bash
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" test
```
Expected: `TEST SUCCEEDED` — `IncrementalUTF8DecoderTests`, `StreamChatTests`, `ChatViewModelTests`, `UsageMeterTests`.

- [ ] **Step 3: Live Bearer-streaming smoke (the one dependency no unit test can prove)**

**Precondition (D10):** the account row must exist. First hit `GET /api/me` with the same Bearer (the `getOrCreateAccount` path) to provision the account — and, for a substantive verdict, ensure a patient profile is seeded; otherwise `/api/dish-checker` returns `404 "Account not found"`, not 200. Then:
```bash
curl -N -sS -o /tmp/clara-stream.txt -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Is a Caesar salad ok for me?"}]}' \
  http://localhost:3000/api/dish-checker
```
Assert **`200 text/plain; charset=utf-8`** and that `/tmp/clara-stream.txt` contains streamed prose (not a JSON `{"error":…}` and not an HTML login redirect). **Also probe the expiry shape (D8/F4):** send an **expired/invalid** Bearer and record whether the route returns **`401` JSON** or a **`307` redirect** to sign-in — this decides whether the client's re-mint trigger (401 status vs blocked-redirect) fires on real expiry; if it 307s, confirm Task 2's blocked-redirect re-mint branch covers it. **Failure triage:** `401` on a valid token → the mobile client's `azp`/`authorizedParties` is not accepted for `io.wondish.clara` (a blocking config item, not a code bug — same hard dependency Phase 2 Task 8 Step 3 flags). `404 "Account not found"` → provision via `GET /api/me` first (precondition above).

- [ ] **Step 4: Boot + install + screenshot the chat states**

```bash
xcrun simctl boot "$DEV"; xcrun simctl bootstatus "$DEV" -b
xcrun simctl install "$DEV" <path-to-Clara.app>
xcrun simctl launch "$DEV" io.wondish.clara -UITestFixture chat
xcrun simctl io "$DEV" screenshot <scratchpad>/chat-greeting.png
# the chat fixture seeds a mid-stream bubble + a StreamingStubURLProtocol transcript (Task 4) — no live stream to pause:
xcrun simctl io "$DEV" screenshot <scratchpad>/chat-streaming.png
xcrun simctl io "$DEV" screenshot <scratchpad>/chat-verdict.png
xcrun simctl io "$DEV" screenshot <scratchpad>/chat-paywall.png
```

**Pass criteria:** `BUILD SUCCEEDED` + iOS suite green + web suite still green + live `/api/dish-checker` returns `200 text/plain` with streamed tokens (account provisioned) + the expiry shape recorded + four screenshots showing: greeting + starter chips; mid-stream typing indicator / partial text; completed verdict reply with ✅/❌ rendered intact (C4 proof — no mojibake at chunk edges); chat-limit `PaywallView`. Visually confirm maroon `#812549`, cream `#F5F1DD`/`#F9F7ED`, Inter, light-only, `leaf.fill` avatar, ≥44 pt Send target.

- [ ] **Step 5: Commit the VERIFY report**

```bash
cd /Users/becks/Desktop/NewView/Clara && git commit --allow-empty -m "chore(verify): phase 5 build + tests + live Bearer streaming smoke (+ expiry-shape probe) + chat screenshots green"
```

---

## Out of scope for Phase 5 (deliberately)

- **Any backend change.** No new route, lib, Prisma model, or migration — the chat is fully served by the shipped `POST /api/dish-checker`. Phase 5 confirms Bearer streaming; it does not modify the route, `sanitizeChatHistory`, the system prompt, or the model choice.
- **Server-side freemium enforcement (D12).** The 5/day cap is client-only via `UsageMeter`; the route has no per-user daily count. The accepted leak — bypass by app reinstall or (device-local) clock change — is a named tradeoff; the only real fix is a server-side daily counter, deferred.
- **Truncation detection without a sentinel (D7).** The raw `text/plain` stream carries no completion marker, so a transport delivering a truncated reply as an error-free EOF is marked `.complete`. A sentinel/framed protocol is out of scope.
- **Conversation persistence / multi-session history (D3)** — the transcript is in-memory and resets on relaunch. Disk/Core-Data history, a conversation list, and "clear chat" are deferred.
- **Rich markdown / tables / links in assistant text** — the prompt (rule 10) forbids markdown, so rendering is defensive plain-prose + newline-preserving inline attributes only (D1). No custom markdown renderer.
- **Voice input, image attachments in chat, "log this dish to my day" from a chat verdict** — the chat does not write `MealLog`; wiring a verdict into the Phase-6 logging path is a later cross-feature enhancement.
- **Logging Picture/Fridge results into chat context** — Phases 3/4 features are independent; chat derives patient context server-side from `userId` only.
- **Retry with exponential backoff on the 20/60s server limit** — Phase 5 surfaces `429` as a manual Retry (D6), not an automatic timed retry.

## Verification

- **Build-time confirmations (unpinned API surface this plan leans on — verify at build, don't assume):**
  - `URLSession.bytes(for:delegate:)` accepts a per-request `URLSessionTaskDelegate` and the injected test session delivers `willPerformHTTPRedirection` to it — the entire `testBlockedRedirect…`/redirect-safety path rests on this, and the actor must **retain a `RedirectBlockingDelegate`** to pass in.
  - `AsyncThrowingStream.Continuation.onTermination` fires on consumer cancellation and can cancel the inner fetch `Task` (F1 cancellation).
  - `AttributedString(markdown:options:)` with `.inlineOnlyPreservingWhitespace` compiles and preserves `\n` on the iOS 17 target (D1).
  - `APIError` exposes (or is extended to expose) `.server(status: 400)` and an `from(urlError:)` that folds `.networkConnectionLost` + premature-EOF into `.offline`.
  - `UsageMeter` exposes a `UsageFeature`-keyed `count`/`increment` + injectable `UserDefaults` (Task 3), or Phase 2's equivalent signature is cited.
- **iOS unit tests (XCTest, `@testable import Clara`, auto-picked under `ClaraTests/`; every unit isolates pure logic or drives a real `WondishAPIClient` over `StreamingStubURLProtocol` — no live Clerk/backend):**
  - `IncrementalUTF8DecoderTests` (T1, the authoritative C4 proof): ASCII pass-through, 3-byte and 4-byte emoji split at every boundary surfacing once/whole, text-then-partial, balanced flush, dangling-partial flush no-crash, worst-case 1-byte-at-a-time reconstruction.
  - `StreamChatTests` (T2): ordered token concat, split-emoji regression (client wiring), pre-flight force-refreshed Bearer, `401`→one full re-open with the newest token then success, blocked-redirect→re-mint then success, second `401`→`.unauthorized` with no third request, `400`→`.server(status:400)`, `429`→`.rateLimited`, `404`→`.notFound`, `nil` pre-flight token→`.unauthorized` with **zero** requests sent, mid-stream thrown-abort surfaces `.offline` **after** preserving partial, premature clean-EOF finishes normally (documented D7 limitation), greeting-omission is the caller's contract, cancellation stops the fetch.
  - `ChatViewModelTests` (T3): greeting text **verbatim** + firstName fallback, `wireMessages` drops the leading assistant greeting ([C2]), keeps interior assistant turns, **coalesces consecutive user turns after a failed turn (D11)**, `canSend` trims (D9), send streams to completion, meter increments **once after the first token** for free / never for premium, **a failed/immediate-failure turn burns no credit (D4)**, free-user-at-cap shows paywall and sends nothing, stream error marks `.failed` preserving partial, clean-EOF marks `.complete`, `404` sets the account-setup affordance (D10), retry does not double-count, starter chips visible only before the first user turn.
  - `UsageMeterTests` (T3): `.chat` `increment`/`count`, day rollover, injected-`UserDefaults` isolation.
- **Web unit tests:** none new (Phase 5 adds no endpoint/lib). Confirm the existing `lib/chat-history.test.ts` (the [C2] sanitize coverage) still passes under `npm test`.
- **Build:** `xcodegen generate` → `xcodebuild … build` → `BUILD SUCCEEDED`.
- **Live dependency smoke (Task 5 Step 3):** with the account provisioned via `GET /api/me`, `POST /api/dish-checker` with a real iOS-minted Bearer returns **`200 text/plain; charset=utf-8`** and streams prose — plus the recorded expired-token shape (`401` JSON vs `307`) that pins the re-mint trigger. The one thing no unit test can prove (Bearer streaming acceptance + `azp`/`authorizedParties` for `io.wondish.clara`).
- **Simulator screenshots (via `using-xcode-cli`, `#if DEBUG -UITestFixture chat`, deterministic seeded transcript):** four states — greeting + starter chips, seeded mid-stream typing indicator / partial text, completed verdict reply with ✅/❌ rendered intact (visual C4 proof), chat-limit `PaywallView`. Confirm brand tokens, Inter, light-only, `leaf.fill` avatar (no emoji chrome), ≥44 pt Send target.