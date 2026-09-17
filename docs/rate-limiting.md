# Rate limiting — backends, local Redis, the production rule

`lib/rate-limit.ts` is the one limiter. Every Anthropic-billed route goes through
`guardAiSpend()` in `lib/ai-budget.ts` before the model call (buckets `ai-*`: the
per-user tier quota, then the org-wide `GLOBAL_AI_DAILY_MAX`); burst buckets
(`dish-checker`, `regenerate`, …) use `rateLimit()` directly. Both end up in the
same function, which has two backends:

| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | Backend | Counters live | Holds across… |
|---|---|---|---|
| both set | Upstash (`@upstash/ratelimit` sliding window over `@upstash/redis`, HTTP) | Redis | every process and instance |
| either missing | memory fallback (a `Map` on `globalThis`) | this process | nothing: a dev-server restart, a serverless cold start, a second instance — each starts from zero |

The memory fallback is fine for `next dev` and for `npm test` (which never loads
`.env*`). It is *not* a limiter in serverless production: with N warm instances the
effective cap is `limit × N`, and the ai-* caps are the only bound on the Anthropic
bill. Until 2026-09-17 nothing but a `console.warn` said so, and no Redis was ever
wired up locally, so quota behaviour had only ever been tested against the `Map`.

The failure policy inside `rateLimit()` (backend error → fail open; `ai-*` → degrade
to the per-instance counter) is deliberate and unchanged; see the comment above the
function.

## Local: a real Redis behind an Upstash-compatible shim

`@upstash/redis` speaks HTTP+JSON, not RESP, so a bare `redis-server` is not enough.
`scripts/upstash-local/` is a ~300-line shim: an HTTP server that accepts the Upstash
request shapes (`POST /`, `/pipeline`, `/multi-exec`, base64 result encoding) and
forwards each command over one socket to a real `redis-server`, which it also spawns.
No Docker, no Homebrew, no npm dependency — this machine has none of the three.

```sh
npm run redis:install      # once: builds redis-server 7.2.12 from source into ~/.wondish/redis (clang + make, ~1 min)
npm run redis:local        # starts redis-server on 127.0.0.1:6379 + the shim on http://127.0.0.1:8079; leave it running
```

Then in `.env.local`:

```
UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079
UPSTASH_REDIS_REST_TOKEN=local-dev-token
```

and prove which backend the app sees:

```sh
npm run rate-limit:check                       # MEMORY or UPSTASH, a real round-trip, and a limit-1 bucket checked in Redis
npm run rate-limit:check -- --require-upstash  # exit 1 unless Upstash is live (for a test harness)
```

Exit 1 means the configured backend did not answer. `next dev` reloads `.env.local`
on change; if `/api/health` still says `"backend":"memory"`, restart it.

Things to know:

- **Leave the shim running while those two lines are in `.env.local`.** With the
  vars set and nothing listening, every gated request retries for ~5 s and then
  fails open (ai-* buckets fall back to the memory counter). Comment the lines out
  when you stop the shim.
- **Counters persist.** Redis snapshots to `~/.wondish/redis/data` every minute and on
  shutdown, so a spent weekly allowance is still spent after restarting the shim or
  the dev server — that is the point. Reset everything with
  `~/.wondish/redis/bin/redis-cli FLUSHALL`, or one user's bucket with
  `~/.wondish/redis/bin/redis-cli --scan --pattern 'rl:ai-plangen-free:<clerkUserId>:*' | xargs ~/.wondish/redis/bin/redis-cli DEL`.
  Keys are `rl:<bucket>-<tier>:<userId>:<window>`; the shim logs one line per
  command with the keys touched, so you can watch a quota being spent.
- Overrides: `UPSTASH_LOCAL_PORT`, `UPSTASH_LOCAL_TOKEN`, `UPSTASH_LOCAL_REDIS_PORT`,
  `REDIS_SERVER_BIN` (use an existing binary), `WONDISH_REDIS_HOME`,
  `UPSTASH_LOCAL_QUIET=1`. A `redis-server` already listening on the port is reused.
- `npm test` covers the shim end to end (`scripts/upstash-local/shim.test.ts`: real
  redis-server on a random port, the real `@upstash/redis` + `@upstash/ratelimit`, and
  finally `lib/rate-limit.ts` itself). Without the binary those tests skip, not fail.

### Recipe: the free tier's 1 new week / week

1. `npm run redis:local` in one terminal; env lines above in `.env.local`;
   `npm run rate-limit:check` says `UPSTASH is live`.
2. Sign in as a free account (no coupon, no Stripe row). Generate a week — the shim
   logs `EVALSHA rl:ai-plangen-free:<userId>:<window> …` and `EVALSHA rl:ai-global-day:ALL:…`.
3. Generate again: 429, "You've used your 1 free new week for this week…". The
   counter is `GET rl:ai-plangen-free:<userId>:<window>` → `1`.
4. Restart the dev server (or the shim) and try again: still 429. That is the
   difference from the memory fallback.
5. Clear with the `DEL` above; the next generation succeeds.

## Production: cannot run on the memory fallback unnoticed

Three layers, all in `lib/rate-limit-backend.ts`:

1. **Boot report** — `instrumentation.ts` calls `memoryFallbackViolation()` in the
   Node runtime. In `NODE_ENV=production` without both Upstash vars it logs the
   reason and sends a fatal Sentry event, then **carries on serving**. Dev and tests
   are never judged. `RATE_LIMIT_ALLOW_MEMORY_FALLBACK=1` silences the report for a
   production-mode process that legitimately has no Redis (`next start` on a laptop).
   Nothing else is accepted — not `true`, not `yes`.

   **Why it reports instead of failing (2026-09-17, user-directed).** Throwing here
   rejects Next 14's `prepare()` promise, so every request 500s — which bounds the
   Anthropic bill perfectly, because nothing serves and nothing spends. It was the
   original design and it is strictly safer for cost. It was downgraded because it
   trades an outage for that guarantee: Vercel **Preview** deployments also run
   `NODE_ENV=production`, so a single unset variable takes previews — or production —
   fully down, and the mechanism had never been exercised against a real
   `next build && next start`. An untested kill switch in front of a beta is the
   wrong risk. The runtime outage policy in `rateLimit()` is separate and untouched.

   **To promote it back:** set `RATE_LIMIT_ENFORCE_BACKEND=1` (literal `1`; see
   `shouldFailBoot`). Config, not a code change. Do that once the hard failure has
   been confirmed against a real production build, and only where Upstash is set —
   Preview included, or Preview needs the opt-out.
2. **Health** — `GET /api/health` now returns
   `rateLimit: { backend, reachable, shared }` after a real SET/GET/DEL round-trip
   (3 s cap). `shared: false` means the spend caps are per-instance. In production
   that is `status: "degraded"`, HTTP 503, so an uptime monitor pages on it — the
   opt-out cannot hide it. Upstash configured but unreachable is also 503.
3. **Terminal** — `npm run rate-limit:check` (above) against any env.

Vercel: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` must be set on the
Production environment (they are listed in `docs/billing/stripe-setup.md` step 8 as
well). Preview deployments run with `NODE_ENV=production` too: either give them the
same Upstash database, or set `RATE_LIMIT_ALLOW_MEMORY_FALLBACK=1` on Preview only.

## Files

- `lib/rate-limit.ts` — the limiter (unchanged behaviour); `lib/ai-budget.ts` — the spend caps.
- `lib/rate-limit-backend.ts` (+ `.test.ts`) — backend selection, the production rule, the probe.
- `instrumentation.ts`, `app/api/health/route.ts` — where the rule and the probe are wired.
- `scripts/upstash-local/` — `install-redis.sh`, `server.ts` (CLI), `shim.ts`, `protocol.ts`, tests.
- `scripts/check-rate-limit-backend.ts` — the terminal check.
