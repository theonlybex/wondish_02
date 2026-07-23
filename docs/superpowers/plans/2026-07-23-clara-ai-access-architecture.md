# Clara AI Access — Company-Key Architecture (users never touch API keys)

**Decision of record (2026-07-23, user-directed):** Wondish serves all AI features through the
company's own Anthropic API key, server-side only. Users authenticate with their Wondish account
(Clerk); they never see, hold, or configure an API key. Cost is controlled by **server-side**
gating — the industry-standard "secure metered pipeline" — not by trusting the client.

## The pipeline (and what Wondish already has)

```
[ iOS app / web UI ] ──(Clerk Bearer)──> [ Wondish backend /api/* ]
                                              │ 1. auth()            ✅ shipped
                                              │ 2. burst rate limit  ✅ shipped (Redis-backed)
                                              │ 3. CREDIT GATE       ← the delta this doc adds
                                              ▼
                                   [ Anthropic API ] ←(ANTHROPIC_API_KEY, server env only) ✅
                                              │
                                              ▼
                                   response streamed / returned to user
```

Mapping the reference architecture to Wondish, feature by feature:

| Reference layer | Wondish reality |
|---|---|
| Client never talks to the AI provider | ✅ Already true — `POST /api/dish-checker` (and the planned `/api/picture`, `/api/fridge`) are the only AI surfaces; the iOS app knows only the Wondish base URL. |
| Company master key | ✅ `ANTHROPIC_API_KEY` in server env only (Vercel env var in prod — **still a user action item to set**). Never in the client binary, never in responses. Rotate in the provider console; nothing client-side changes. |
| Backend "bouncer" (login + credit check) | Auth ✅ shipped. **Credit gate: added by this plan** — per-user server-side daily allowance, premium bypass. |
| Async worker queue | **Deliberately NOT adopted for Clara chat.** Queues exist to buffer long-running jobs (5–15 s image generations). Clara is a *streaming* chat: the response begins in ~1 s and streams token-by-token — a queue would destroy the UX and add infrastructure for nothing. Serverless concurrency + per-user burst limits are the buffer. Revisit only for `/api/picture`·`/api/fridge` if p95 latency or provider 429s demand it (both are already planned stateless + hard-capped). |
| Storage & delivery | N/A for chat (no artifacts). Picture/Fridge results are returned inline; nothing stored (stateless by design). |

## Cost management (the four levers, applied)

1. **Credit-based hybrid.** Free tier = **5 Clara messages/day** (config constant `CHAT_DAILY_FREE`,
   one place to tune); Premium = uncapped chat but still burst-limited. The subscription
   ($14.99/mo recommended, Cycle-Paywall decision) funds the token spend. Server-side
   enforcement means a jailbroken/reinstalled client changes nothing. Exceeding the free
   allowance returns **402 `{"error":"Premium required"}`** — the repo's existing premium-gate
   convention — which the iOS client maps to `.premiumRequired` → paywall sheet.
   *This supersedes Phase 5's D4/D12 (client-only metering with an accepted honor-system leak):
   the leak is closed; the client-side `UsageMeter` is no longer load-bearing for chat.*
2. **Smart model routing.** All Clara surfaces run `claude-sonnet-5` with `max_tokens` caps
   (1024 chat / 1024 picture / 2048 fridge) and thinking disabled — the per-request cost ceiling
   is structural. A cheaper drafting model is a future lever; not needed at current scale.
3. **Caching.** Chat is conversational (rarely cache-hittable); the meaningful cache seam is the
   Restaurants published-menu JSON (already designed) and repeat picture/fridge idempotency via
   client-request IDs if telemetry ever shows repeats. Not built until data says so.
4. **Hard rate limits.** Already shipped for chat: 20 req/60 s per user (burst). This plan adds
   the daily allowance on top. Picture/Fridge plans already specify burst + hard daily backstops
   (25/day, 3/day) as cost ceilings. **Prod requirement (unchanged):** Upstash Redis configured,
   or limits silently degrade to per-instance memory; plus a spend alert in the Anthropic console.

## Unit economics sanity check

A chat turn ≈ ≤4k input chars (server-truncated history budget) + ≤1024 output tokens on
claude-sonnet-5 → roughly $0.02/turn upper bound. Free tier: 5/day ≈ ≤$3/user/month worst case,
bounded and known. Premium heavy use is burst-capped (20/min) and priced in.

## What gets built now (Clara cycle, Engine phase)

Exactly one backend change — everything else above is already shipped or deferred by design:

- `POST /api/dish-checker` gains the credit gate after auth + burst limit:
  `hasActivePremium(userId)` → bypass; else `rateLimit("chat-day", userId, CHAT_DAILY_FREE=5, 86400)`
  → on exceed, **402 `{"error":"Premium required"}`** before any Anthropic call (zero token spend
  for gated requests). Constant exported from a `lib/` module under test; route behavior pinned
  by the existing test conventions.

## Explicit non-goals (recorded so they aren't re-litigated)

- No BYO-key mode, ever, for consumers.
- No worker queue for streaming chat (see table).
- No per-message credit *ledger* table yet — the Redis daily counter IS the ledger at this scale;
  a durable usage table becomes worthwhile only when analytics or variable credit costs demand it.
- Clara's behavior (prompt, streaming format, history contract) is unchanged — this is purely the
  access/metering shell around it.
