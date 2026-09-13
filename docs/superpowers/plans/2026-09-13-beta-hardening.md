# Beta Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app survive a 50-tester closed beta: no crashes under concurrent AI calls, no double-charged quotas, no duplicated or silently lost plan data, and no client screens that go blank or lie on an error.

**Architecture:** Server side, every Anthropic call goes through one client factory with a real timeout, every plan write runs under the existing per-patient claim lock (quota charged only by the request that will actually build), and unknown errors always come back as JSON. Client side, the existing correct pattern (in-flight guard, `res.json().catch(() => null)`, `res.ok` check, show the server's `error` string, use `apiFetch`) is applied to the components that lack it.

**Tech Stack:** Next.js App Router (route handlers), Prisma + Neon serverless adapter, `@anthropic-ai/sdk`, Upstash rate limiting via `lib/rate-limit.ts`, `node:test` unit tests (`npm test`), React client components.

**Spec:** The audit findings are embedded below under "Spec: audit findings". There is no separate spec file.

## Global Constraints

- Branch: all work on `feat/beta-hardening`, created from `feat/beta-premium-coupons`. Never commit to `main`.
- **Never run `npm run build`** (it clobbers the running dev server's `.next`). Verify with `npm test`, `npx tsc --noEmit`, and `npx next lint --file <path>`.
- Never commit `.env.local` or set `PREMIUM_GATES` anywhere.
- Copy rule: user-facing error strings are full sentences, no jargon, and never expose Prisma/Anthropic error text.
- Every route handler must return JSON on every path. A bare `throw err` at the end of a handler is a defect.
- Commit message format: conventional prefix (`fix:`, `feat:`, `refactor:`), then a body ending with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P7wPbYmKUeMQcYHzU1h77V
```

- Several tasks run in parallel in the same working tree. Stage ONLY the files your task names (`git add <paths>`), never `git add -A`. If `git commit` fails with `index.lock`, wait two seconds and retry.
- Do not touch files outside your task's **Files** list. If you believe you must, stop and report instead.

---

## Spec: audit findings (2026-09-13)

Three independent code reviews were run against this repo for what breaks when about 50 beta users use it at once. Verified findings, each mapped to the task that fixes it:

| # | Finding | Task |
|---|---|---|
| S1 | Clara chat (`app/api/dish-checker/route.ts`) and fridge (`app/api/fridge/route.ts`) export no `maxDuration`; every other AI route sets 60. Long tool-round chats get cut mid-stream with a truncated 200. | T2 |
| S2 | All five `new Anthropic({ apiKey })` sites use SDK defaults: 10-minute timeout, 2 retries. On a 529 burst Vercel kills the function first and the client gets a bare 504 with no JSON. | T2 |
| S3 | `cook-day` and `clara-swap` map Anthropic 429 but not 529 or timeouts, so overload shows as a generic 500/502. | T2 |
| S4 | `GLOBAL_AI_DAILY_MAX = 700` locks every user out once 50 testers do 14 actions each. | T1 |
| S5 | Beta coupon holders are the "premium" tier and should get a proper trial: 25 Clara messages/day, 5 new weeks/week, proportionally more of the rest. | T1 |
| S6 | `lib/rate-limit.ts` fails open on any backend error, for the spend buckets too. One Upstash timeout removes the per-user quota and the global bill cap at once. | T3 |
| S7 | `lib/db.ts` only pins the Prisma client to `globalThis` outside production, and the Neon `Pool` has no `max`. | T3 |
| S8 | `guardAiSpend` runs BEFORE the plan claim lock in new-week, regenerate, meal-plan POST, start-date. A double-click charges two weekly tokens; the loser gets 409 and nothing. | T4 |
| S9 | new-week, meal-plan POST, start-date, exchanges/[id], coupon/redeem end with `throw err`, producing non-JSON 500s. | T4, T10 |
| S10 | `/api/meal-plan/day` skips the claim lock. Two concurrent calls on an empty day insert 8 meals. It also captures `activePlanVersion` before a long AI call, so a concurrent regenerate makes its rows land in a purged version (quota spent, success returned, nothing changed). | T5 |
| S11 | Five routes share the `"regenerate"` rate-limit key with two different thresholds (10 and 15). | T5 |
| S12 | `clara-swap`: two concurrent swaps each persist a public Recipe; the loser's row is orphaned in the shared catalog. `prisma.menu.update` after the AI call is uncaught P2025 if the plan was regenerated meanwhile. | T6 |
| S13 | `cook-day`: concurrent calls persist duplicate public recipes. | T9 |
| S14 | `patient/profile` PUT: four `createMany` calls lack `skipDuplicates`; a double-submit with no existing links hits P2002 uncaught. | T7 |
| S15 | `meal-log` POST and batch: a replayed `clientRequestId` can hit P2002 with no handler. | T8 |
| C1 | `IngredientTinder`: any non-200 on deck load renders "No ingredients" AND fires `/api/taste/seen`, which marks taste complete for a year. Transient error = permanently skipped onboarding step. Favorite saves fail silently; fetch runs inside a setState updater. | T11 |
| C2 | `DailyMealPlanView`: mount refetch (fires for every non-UTC user after ~5pm) wipes the plan on any error body; same after new-week and cuisine-for-today; `navigate` has no catch; rating buttons have no in-flight guard on a toggle endpoint and swallow errors. | T12 |
| C3 | `DishCheckerClient`: a mid-stream error overwrites the partial answer; no abort/watchdog so a stalled connection disables the input forever; error bubbles are re-sent to the model as assistant turns; bare `fetch`. | T13 |
| C4 | `PantryClient`: shopping-list ticks that fail to save stay ticked; the "What to buy" view renders no error banner; fetch runs inside a setState updater. | T14 |
| C5 | QuickJournalLog, ProfileForm, RedeemCodeBox, GroceryListView, PlanPicker, BillingPanel, CaloricProfileCard discard the server's error string or parse JSON unguarded. `components/taste/DishTinder.tsx` is dead code with a permanent-disable bug. No `error.tsx` in `(main)`, `(auth)`, `(restaurant)`. | T15, T16 |

Deferred on purpose (not in this plan; need a product or migration decision): unbounded recipe-catalog scan in `lib/meal-plan.ts:320`; `@@unique` on `Menu`; `JournalEntry` duplicates; pantry `to-buy`/`cookable` catalog scans; `cuisine-ids` 48 sequential queries; journal transaction size; refunding quota on an Anthropic timeout; verifying Upstash env vars in Vercel (ops).

---

## Execution waves

Tasks within a wave touch disjoint files and may run in parallel. A wave starts only after the previous wave's tasks are committed and reviewed.

- **Wave A (server):** T1, T2, T3, T4, T7, T8
- **Wave B (server, depends on A):** T5 (needs T4's runner exports), T6 and T9 (need T2's client factory), T10 (needs T4's `lib/api-error.ts`)
- **Wave C (client):** T11, T12, T13, T14, T15, T16

Setup before Wave A (done once by the orchestrator):

```bash
git checkout feat/beta-premium-coupons
git checkout -b feat/beta-hardening
```

---

### Task 1: Beta trial quota numbers and global ceiling

**Files:**
- Modify: `lib/ai-budget.ts:44-72`
- Test: `lib/ai-budget.test.ts`

**Interfaces:**
- Produces: unchanged exports (`AI_LIMITS`, `GLOBAL_AI_DAILY_MAX`, `limitFor`, `guardAiSpend`, `quotaExceededBody`); only the numbers change. No other task depends on the values.

- [ ] **Step 1: Update the tests to the new numbers**

In `lib/ai-budget.test.ts` replace the first test and the two tests that quote numbers:

```ts
test("tiers: free 1 new week/week + 5 Clara messages/day; premium (beta trial) 5/week + 25/day", () => {
  assert.deepEqual(limitFor("planGen", "free"), { max: 1, windowSec: 7 * 86_400, window: "week" });
  assert.deepEqual(limitFor("planGen", "premium"), { max: 5, windowSec: 7 * 86_400, window: "week" });
  assert.equal(limitFor("claraChat", "free").max, 5);
  assert.equal(limitFor("claraChat", "premium").max, 25);
  assert.equal(limitFor("claraChat", "free").window, "day");
  assert.equal(limitFor("swap", "premium").max, 15);
  assert.equal(limitFor("fridge", "premium").max, 15);
  assert.equal(limitFor("cookDay", "premium").max, 5);
  assert.equal(limitFor("planInit", "premium").max, 10);
  for (const k of Object.keys(AI_LIMITS)) assert.ok(AI_LIMITS[k].premium >= AI_LIMITS[k].free, k);
});
```

In the test `"free user: 6th Clara message today is refused..."` change the assertion line to:

```ts
    assert.match(r.error, /Premium gives you 25 a day/);
```

Replace the test `"free user: second new week in the same week is refused; premium gets three"` with:

```ts
test("free user: second new week in the same week is refused; premium gets five", async () => {
  const { limiter } = fakeLimiter();
  assert.equal((await guardAiSpend("u1", "planGen", "free", limiter)).ok, true);
  const r = await guardAiSpend("u1", "planGen", "free", limiter);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /1 free new week for this week/);
  for (let i = 0; i < 5; i++) assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, true);
  assert.equal((await guardAiSpend("u2", "planGen", "premium", limiter)).ok, false);
});
```

In the test `"premium at its cap gets a plain reset message, no upgrade hint"` change the regex to:

```ts
  assert.match(b.error, /today's limit for Clara messages \(25\)/);
```

Add one new test at the end:

```ts
test("global ceiling is sized for a 50-tester beta", () => {
  // 50 testers x ~40 requests/day worst case = 2000. Below that the 51st
  // request of a busy evening read as an outage ("Clara is at capacity").
  assert.equal(GLOBAL_AI_DAILY_MAX, 2000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/ai-budget.test.ts`
Expected: FAIL on the number assertions (5 vs 3, 25 vs 20, 2000 vs 700).

- [ ] **Step 3: Change the numbers**

In `lib/ai-budget.ts` replace lines 44-61 (the cost comment and `AI_LIMITS`) with:

```ts
// Measured Haiku cost per request (2026-09-12): chat ≈ $0.012, swap /
// fridge ≈ $0.02, cook-day ≈ $0.05, a full new week ≈ $0.08.
// The "premium" column is the BETA TRIAL for coupon holders (2026-09-13):
// generous enough to feel like the real product, capped so one tester's
// worst day is ≈ $2. Free worst case ≈ $0.55/week. When Stripe goes live
// this column splits into a beta tier at these numbers and a near-unlimited
// paid tier.
export const AI_LIMITS: Record<string, AiLimit> = {
  // Conversations with Clara (dish-checker).
  claraChat: { bucket: "ai-chat", window: "day", free: 5, premium: 25, label: "Clara messages" },
  // Fridge recipe generation.
  fridge: { bucket: "ai-fridge", window: "day", free: 3, premium: 15, label: "fridge suggestions" },
  // Pantry "cook my day" full-day generation.
  cookDay: { bucket: "ai-cookday", window: "day", free: 1, premium: 5, label: "cook-my-day plans" },
  // First plan / start-date changes (onboarding) — not the weekly allowance.
  planInit: { bucket: "ai-planinit", window: "day", free: 3, premium: 10, label: "plan setups" },
  // Rolling-week generation (New week, regenerate): the headline free limit.
  planGen: { bucket: "ai-plangen", window: "week", free: 1, premium: 5, label: "new weeks" },
  // Clara single-dish swaps and "cuisine for today".
  swap: { bucket: "ai-swap", window: "day", free: 2, premium: 15, label: "dish swaps" },
} as const;
```

Replace lines 65-72 (the global ceiling comment and constant) with:

```ts
// Org-wide hard ceiling on total Anthropic-billed REQUESTS per rolling day.
// THIS is the number that caps a runaway bill.
//
// Sized for the closed beta (2026-09-13): 50 testers x ~40 requests/day at
// the trial limits = 2000. Worst case at the ceiling on Haiku ≈ $40 for the
// day; realistic usage (~12 requests/tester) is a small fraction of that.
// Raise proportionally as the cohort grows.
export const GLOBAL_AI_DAILY_MAX = 2000;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test lib/ai-budget.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-budget.ts lib/ai-budget.test.ts
git commit -m "feat(quota): beta trial limits (25 Clara msgs/day, 5 weeks/week) and 2000/day global ceiling"
```

---

### Task 2: One Anthropic client factory with a real timeout; duration on chat and fridge; 529 and timeout mapping

**Files:**
- Create: `lib/anthropic.ts`
- Create: `lib/anthropic.test.ts`
- Modify: `app/api/dish-checker/route.ts:8,25` (add `maxDuration`, use factory)
- Modify: `app/api/fridge/route.ts:17-19` (add `maxDuration`, use factory) and `:116-125` (timeout mapping)
- Modify: `app/api/pantry/cook-day/route.ts:3,162,188-195`
- Modify: `app/api/meal-plan/[menuId]/clara-swap/route.ts:3,127,153-158`
- Modify: `lib/clara/recipe-generation.ts:1,193`

**Interfaces:**
- Produces: `createAnthropic(overrides?: { timeout?: number; maxRetries?: number }): Anthropic` and `claraBusyStatus(err: unknown): 429 | 503 | null` from `lib/anthropic.ts`. Tasks 6 and 9 edit files that import these.

- [ ] **Step 1: Write the failing test**

Create `lib/anthropic.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";

process.env.ANTHROPIC_API_KEY ??= "test-key";

import { createAnthropic, claraBusyStatus, ANTHROPIC_TIMEOUT_MS, ANTHROPIC_MAX_RETRIES } from "./anthropic";

test("factory pins a timeout and retry count that fit inside a 60s Vercel function", () => {
  const client = createAnthropic();
  assert.equal(client.timeout, ANTHROPIC_TIMEOUT_MS);
  assert.equal(client.maxRetries, ANTHROPIC_MAX_RETRIES);
  assert.equal(ANTHROPIC_TIMEOUT_MS, 25_000);
  assert.equal(ANTHROPIC_MAX_RETRIES, 1);
});

test("factory accepts per-route overrides (streaming chat needs a longer window)", () => {
  const client = createAnthropic({ timeout: 55_000 });
  assert.equal(client.timeout, 55_000);
  assert.equal(client.maxRetries, ANTHROPIC_MAX_RETRIES);
});

test("claraBusyStatus maps rate limit, overload and timeout to a retryable status", () => {
  const rateLimited = new Anthropic.APIError(429, undefined, "rate", undefined);
  const overloaded = new Anthropic.APIError(529, undefined, "overloaded", undefined);
  const timeout = new Anthropic.APIConnectionTimeoutError({ message: "timed out" });
  assert.equal(claraBusyStatus(rateLimited), 429);
  assert.equal(claraBusyStatus(overloaded), 503);
  assert.equal(claraBusyStatus(timeout), 503);
  assert.equal(claraBusyStatus(new Error("other")), null);
  assert.equal(claraBusyStatus(new Anthropic.APIError(400, undefined, "bad", undefined)), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/anthropic.test.ts`
Expected: FAIL with "Cannot find module './anthropic'".

- [ ] **Step 3: Create the factory**

Create `lib/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

// The ONE place the SDK's network policy is set. The SDK defaults are a
// 10-minute timeout and 2 retries, which outlive every Vercel function here
// (30-60s): on a 529 burst the SDK was still retrying when the platform
// killed the function, and the client got a bare 504 with no JSON body —
// after guardAiSpend had already charged the user's quota.
//
// 25s x (1 + 1 retry) fits under maxDuration = 60 with room for the DB work
// around the call. Streaming chat passes a longer timeout because the
// timeout covers the whole response, not just time-to-first-byte.
export const ANTHROPIC_TIMEOUT_MS = 25_000;
export const ANTHROPIC_MAX_RETRIES = 1;

export function createAnthropic(overrides: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: overrides.timeout ?? ANTHROPIC_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? ANTHROPIC_MAX_RETRIES,
  });
}

/**
 * The HTTP status a route should answer with when Anthropic is the reason
 * the request failed in a retryable way: 429 for our own rate limit, 503 for
 * overload (529) and for a timeout. null means "not a busy signal — treat as
 * a real error".
 */
export function claraBusyStatus(err: unknown): 429 | 503 | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 503;
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return 429;
    if (err.status === 529) return 503;
  }
  return null;
}

export const CLARA_BUSY_MESSAGE = "Clara is busy — try again in a moment.";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/anthropic.test.ts`
Expected: PASS. If the `APIError` constructor signature differs in the installed SDK version, check `node_modules/@anthropic-ai/sdk/error.d.ts` and adjust the test's constructor calls, not the factory.

- [ ] **Step 5: Use the factory in dish-checker and add maxDuration**

In `app/api/dish-checker/route.ts`:
- Keep line 8 `import Anthropic from "@anthropic-ai/sdk";` (the `instanceof` checks still need it).
- Add after the imports: `import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";`
- Replace line 25 `const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` with:

```ts
// Streaming chat: up to 6 tool rounds for premium, each a separate request,
// so the per-request timeout can be generous while maxDuration bounds the
// whole turn.
export const maxDuration = 60;

const anthropic = createAnthropic({ timeout: 55_000 });
```

- Replace the catch block at lines 149-164 with:

```ts
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }
```

- [ ] **Step 6: Use the factory in fridge and add maxDuration**

In `app/api/fridge/route.ts`:
- Add `import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";` after line 17.
- Replace line 19 `const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` with:

```ts
export const maxDuration = 60;

const anthropic = createAnthropic();
```

- Replace the catch block at lines 116-125 with:

```ts
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }
```

If `Anthropic` is no longer referenced anywhere else in the file after this, remove the line-17 import to keep lint clean (the `Anthropic.ToolUseBlock` type guard at ~line 128 probably still needs it; keep it if so).

- [ ] **Step 7: Use the factory in cook-day**

In `app/api/pantry/cook-day/route.ts`:
- Add `import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";` after line 3.
- Line 162: replace `const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` with `const anthropic = createAnthropic();`
- Replace the catch block at lines 188-195 with:

```ts
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json(
      { error: "Clara couldn't cook right now. Nothing was used up — try again." },
      { status: 502 }
    );
  }
```

- [ ] **Step 8: Use the factory in clara-swap**

In `app/api/meal-plan/[menuId]/clara-swap/route.ts`:
- Add `import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";` after line 3.
- Line 127: replace `const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` with `const anthropic = createAnthropic();`
- Replace the catch block at lines 153-158 with:

```ts
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json({ error: "Clara couldn't swap that — try again." }, { status: 502 });
  }
```

- [ ] **Step 9: Use the factory in recipe-generation**

In `lib/clara/recipe-generation.ts`:
- Add `import { createAnthropic } from "@/lib/anthropic";` after line 1.
- Line 193: replace `const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` with `const anthropic = createAnthropic();`

- [ ] **Step 10: Verify no bare constructor remains, typecheck, lint, test**

Run: `grep -rn "new Anthropic(" app lib --include='*.ts' | grep -v "lib/anthropic.ts"`
Expected: no output.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx next lint --file app/api/dish-checker/route.ts --file app/api/fridge/route.ts --file app/api/pantry/cook-day/route.ts --file "app/api/meal-plan/[menuId]/clara-swap/route.ts" --file lib/clara/recipe-generation.ts --file lib/anthropic.ts`
Expected: no errors (unused-import warnings must be fixed).

Run: `npm test`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/anthropic.ts lib/anthropic.test.ts app/api/dish-checker/route.ts app/api/fridge/route.ts app/api/pantry/cook-day/route.ts "app/api/meal-plan/[menuId]/clara-swap/route.ts" lib/clara/recipe-generation.ts
git commit -m "fix(ai): one Anthropic client factory (25s timeout, 1 retry); maxDuration on chat + fridge; 529/timeout answer 503 JSON everywhere"
```

---

### Task 3: Spend buckets fall back instead of failing open; Prisma singleton pinned in production

**Files:**
- Modify: `lib/rate-limit.ts:91-95`
- Test: `lib/rate-limit.test.ts`
- Modify: `lib/db.ts:8,20-22`

**Interfaces:**
- Produces: no signature change. `rateLimit()` behaviour on backend error now depends on the bucket name prefix `ai-`.

- [ ] **Step 1: Write the failing test**

Read `lib/rate-limit.test.ts:90-100` to see how the existing "throwing backend" test injects a failing backend via the `backendOverride` argument. Append this test, following the same style:

```ts
test("spend buckets (ai-*) fall back to the per-instance counter on a backend error instead of opening", async () => {
  const boom = async () => { throw new Error("upstash down"); };
  const id = `spend-${Date.now()}`;
  // limit 2: third call must be rejected even though the backend is throwing.
  assert.equal((await rateLimit("ai-chat", id, 2, 60, boom)).success, true);
  assert.equal((await rateLimit("ai-chat", id, 2, 60, boom)).success, true);
  assert.equal((await rateLimit("ai-chat", id, 2, 60, boom)).success, false);
});

test("non-spend buckets still fail open on a backend error", async () => {
  const boom = async () => { throw new Error("upstash down"); };
  const id = `burst-${Date.now()}`;
  for (let i = 0; i < 5; i++) assert.equal((await rateLimit("dish-checker", id, 2, 60, boom)).success, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/rate-limit.test.ts`
Expected: the first new test FAILS (third call returns `success: true`).

- [ ] **Step 3: Implement the fallback**

In `lib/rate-limit.ts` replace the catch block (lines 91-95) with:

```ts
  } catch (err) {
    // Spend buckets (lib/ai-budget.ts, all named "ai-*") are the Anthropic
    // bill cap. An Upstash blip correlates with load — exactly when 50 users
    // are hammering — so they degrade to the per-instance counter rather
    // than opening completely. Burst buckets keep failing open: availability
    // over enforcement (2026-07-24 audit Task 12).
    if (name.startsWith("ai-")) {
      console.error(`[rate-limit] backend error for spend bucket "${name}" — using per-instance fallback`, err);
      return memoryLimit(JSON.stringify([name, identifier]), limit, windowSec);
    }
    console.error(`[rate-limit] backend error for bucket "${name}" — failing open`, err);
    return { success: true };
  }
```

Note: the `backendOverride` branch is inside the same `try`, so a throwing override reaches this catch. Confirm by reading lines 77-90 before editing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/rate-limit.test.ts`
Expected: all PASS, including the existing "fails open" test (its bucket name does not start with `ai-`; if it does, rename that test's bucket to `"burst-test"`).

- [ ] **Step 5: Pin the Prisma client and cap the pool**

In `lib/db.ts`:
- Line 8: replace `const pool = new Pool({ connectionString: process.env.DATABASE_URL! });` with:

```ts
  // max: the Neon serverless Pool default is 10 WebSocket connections per
  // instance with nothing ever calling pool.end(). Five is plenty for one
  // request at a time on Fluid Compute and keeps a busy evening from
  // holding hundreds of sockets open across warm instances.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 5 });
```

- Lines 20-22: replace with:

```ts
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Pinned in EVERY environment. The old `NODE_ENV !== "production"` guard
// meant a production process that evaluated this module twice (route
// bundle + RSC bundle) got two independent pools.
globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx next lint --file lib/rate-limit.ts --file lib/db.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts lib/db.ts
git commit -m "fix(infra): ai-* spend buckets fall back to memory on Upstash error; pin Prisma singleton in prod; cap Neon pool at 5"
```

---

### Task 4: Charge AI quota only under the plan claim lock; JSON on every path of the four plan routes

**Files:**
- Modify: `lib/meal-plan-runner.ts`
- Test: `lib/meal-plan-runner.test.ts`
- Create: `lib/api-error.ts`
- Modify: `app/api/meal-plan/new-week/route.ts:43-44,57-93`
- Modify: `app/api/meal-plan/regenerate/route.ts:64-66,70-88`
- Modify: `app/api/meal-plan/route.ts:180-199`
- Modify: `app/api/meal-plan/start-date/route.ts:64-66,68-83`

**Interfaces:**
- Produces from `lib/meal-plan-runner.ts`:
  - `export class PlanPreflightError extends Error { status: number; body: Record<string, unknown> }`
  - `export type PlanPreflight = () => Promise<{ status: number; body: Record<string, unknown> } | null>`
  - `regeneratePlan(..., opts: { ...existing; preflight?: PlanPreflight })`
  - `export async function claimPlanSlot(patientId: string, deps?: RunnerDeps): Promise<void>` (throws `MealPlanBusyError`)
  - `export async function withPlanClaim<T>(patientId: string, fn: (activePlanVersion: number) => Promise<T>, deps?: RunnerDeps): Promise<T>` — Task 5 uses this.
- Produces from `lib/api-error.ts`: `internalError(tag: string, err: unknown, message?: string): NextResponse` — Task 10 uses this.
- `PrismaLike.patient.findUnique` return type widens to `Promise<{ activePlanVersion?: number; mealPlanStatus?: string; mealPlanGenStartedAt?: Date | null } | null>`.

- [ ] **Step 1: Write the failing runner tests**

Append to `lib/meal-plan-runner.test.ts` (the `makeDeps`, `ROWS`, `START` helpers already exist above; extend the import line to include `PlanPreflightError, withPlanClaim`):

```ts
test("preflight runs only after the claim; a rejection restores the previous status and never builds", async () => {
  const { deps, calls } = makeDeps({ activePlanVersion: 2 });
  // Simulate the pre-claim read returning the previous status.
  deps.prisma.patient.findUnique = async (args: any) => {
    calls.push({ op: "patient.findUnique", args });
    return { activePlanVersion: 2, mealPlanStatus: "READY", mealPlanGenStartedAt: new Date("2026-07-19T10:00:00") };
  };
  let preflightCalls = 0;
  const preflight = async () => { preflightCalls++; return { status: 429, body: { error: "quota", code: "quota" } }; };

  await assert.rejects(
    regeneratePlan("p1", START, deps, { preflight }),
    (err: unknown) => err instanceof PlanPreflightError && err.status === 429 && (err.body as any).code === "quota"
  );
  assert.equal(preflightCalls, 1);
  const ops = calls.map((c) => c.op);
  assert.equal(ops[0], "patient.findUnique", "previous status is read before the claim");
  assert.equal(ops[1], "patient.updateMany", "then the claim is taken");
  assert.ok(!ops.includes("buildMealPlanMenus"), "a rejected preflight must not build");
  assert.ok(!ops.includes("menu.createMany"), "a rejected preflight must not write menus");
  const restore = calls.filter((c) => c.op === "patient.update").at(-1)!;
  assert.equal(restore.args.data.mealPlanStatus, "READY", "status restored, not FAILED");
  assert.equal(restore.args.data.mealPlanError, undefined, "no error text written for a quota rejection");
});

test("preflight is skipped entirely when the claim fails (the loser of a double-click is never charged)", async () => {
  const { deps } = makeDeps({ claimCount: 0 });
  let preflightCalls = 0;
  const preflight = async () => { preflightCalls++; return null; };
  await assert.rejects(regeneratePlan("p1", START, deps, { preflight }), MealPlanBusyError);
  assert.equal(preflightCalls, 0);
});

test("preflight that passes lets the build proceed exactly as before", async () => {
  const { deps, calls } = makeDeps({ activePlanVersion: 1 });
  const count = await regeneratePlan("p1", START, deps, { preflight: async () => null });
  assert.equal(count, ROWS.length);
  assert.ok(calls.some((c) => c.op === "menu.createMany"));
});

test("withPlanClaim: runs fn with the live activePlanVersion, restores the previous status afterwards", async () => {
  const { deps, calls } = makeDeps({ activePlanVersion: 7 });
  deps.prisma.patient.findUnique = async (args: any) => {
    calls.push({ op: "patient.findUnique", args });
    return { activePlanVersion: 7, mealPlanStatus: "READY", mealPlanGenStartedAt: null };
  };
  const result = await withPlanClaim("p1", async (v) => `built-v${v}`, deps);
  assert.equal(result, "built-v7");
  assert.equal(calls[0].op, "patient.findUnique", "reads previous status first");
  assert.equal(calls[1].op, "patient.updateMany", "then claims");
  const restore = calls.filter((c) => c.op === "patient.update").at(-1)!;
  assert.equal(restore.args.data.mealPlanStatus, "READY");
});

test("withPlanClaim: a busy claim rejects with MealPlanBusyError and never runs fn", async () => {
  const { deps } = makeDeps({ claimCount: 0 });
  let ran = false;
  await assert.rejects(withPlanClaim("p1", async () => { ran = true; }, deps), MealPlanBusyError);
  assert.equal(ran, false);
});

test("withPlanClaim: fn throwing still restores status and rethrows", async () => {
  const { deps, calls } = makeDeps({ activePlanVersion: 3 });
  await assert.rejects(withPlanClaim("p1", async () => { throw new Error("boom"); }, deps), /boom/);
  const restore = calls.filter((c) => c.op === "patient.update").at(-1)!;
  assert.equal(restore.args.data.mealPlanStatus, "READY", "a stub with no previous status restores to READY");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/meal-plan-runner.test.ts`
Expected: FAIL with "PlanPreflightError is not exported" / "withPlanClaim is not a function".

- [ ] **Step 3: Implement in the runner**

In `lib/meal-plan-runner.ts`:

After the `EmptyPlanError` class (line 20) add:

```ts
// Thrown by regeneratePlan / withPlanClaim when the caller's preflight (the
// AI spend guard) rejects AFTER the claim was taken. Carries the exact JSON
// the route should answer with. Status is restored, nothing is built.
export class PlanPreflightError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>
  ) {
    super("PLAN_PREFLIGHT");
    this.name = "PlanPreflightError";
  }
}

export type PlanPreflight = () => Promise<{ status: number; body: Record<string, unknown> } | null>;
```

Widen `PrismaLike.patient.findUnique` (line 44) to:

```ts
    findUnique(args: any): Promise<{ activePlanVersion?: number; mealPlanStatus?: string; mealPlanGenStartedAt?: Date | null } | null>;
```

Replace the claim block inside `regeneratePlan` (lines 77-90) with a call to a shared helper, and add the preflight step. The new top of `regeneratePlan` reads:

```ts
export async function regeneratePlan(
  patientId: string,
  startDate: Date,
  deps: RunnerDeps = defaultDeps,
  opts: { claraFirst?: boolean; cuisine?: string | null; windowDays?: number; anchorDate?: Date; basket?: Set<string>; excludeRecipeIds?: Set<string>; preflight?: PlanPreflight } = {},
): Promise<number> {
  // Only read the previous status when a preflight can need to restore it,
  // so callers without one keep the exact call sequence the tests pin.
  const before = opts.preflight ? await readPlanStatus(patientId, deps) : null;

  // 1. Claim. Succeeds only if not GENERATING, OR the previous run is stuck.
  await claimPlanSlot(patientId, deps);

  // 1b. Preflight UNDER the claim (the AI spend guard). Only the request
  // that will actually build is charged: a double-click's loser fails the
  // claim above and never reaches here, so it costs the user nothing.
  if (opts.preflight) {
    const rejected = await opts.preflight();
    if (rejected) {
      await restorePlanStatus(patientId, before, deps);
      throw new PlanPreflightError(rejected.status, rejected.body);
    }
  }

  try {
```

(the rest of the function body from `const patient = await deps.prisma.patient.findUnique(...)` onward is unchanged).

Add these helpers above `regeneratePlan` (after `defaultDeps`):

```ts
type PreviousStatus = { mealPlanStatus?: string; mealPlanGenStartedAt?: Date | null } | null;

async function readPlanStatus(patientId: string, deps: RunnerDeps): Promise<PreviousStatus> {
  return deps.prisma.patient.findUnique({
    where: { id: patientId },
    select: { activePlanVersion: true, mealPlanStatus: true, mealPlanGenStartedAt: true },
  });
}

/** Put the row back the way it was before the claim (never leaves GENERATING behind). */
async function restorePlanStatus(patientId: string, before: PreviousStatus, deps: RunnerDeps): Promise<void> {
  const status = before?.mealPlanStatus && before.mealPlanStatus !== "GENERATING" ? before.mealPlanStatus : "READY";
  await deps.prisma.patient
    .update({
      where: { id: patientId },
      data: { mealPlanStatus: status, mealPlanGenStartedAt: before?.mealPlanGenStartedAt ?? null },
    })
    .catch(() => {});
}

/**
 * Atomically claim the patient's generation slot (status -> GENERATING).
 * Succeeds only if not GENERATING, OR the previous run is stuck. Throws
 * MealPlanBusyError otherwise. Every writer of Menu rows must hold this.
 */
export async function claimPlanSlot(patientId: string, deps: RunnerDeps = defaultDeps): Promise<void> {
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const claim = await deps.prisma.patient.updateMany({
    where: {
      id: patientId,
      OR: [
        { mealPlanStatus: { not: "GENERATING" } },
        { mealPlanGenStartedAt: { lt: stuckCutoff } },
      ],
    },
    data: { mealPlanStatus: "GENERATING", mealPlanGenStartedAt: new Date(), mealPlanError: null },
  });
  if (claim.count === 0) throw new MealPlanBusyError();
}

/**
 * Run `fn` while holding the plan claim, then restore the previous status.
 * For writers that edit the ACTIVE version in place (cuisine-for-today)
 * rather than doing the blue/green swap: holding the claim means no
 * regenerate can flip activePlanVersion underneath them, and no second
 * copy of themselves can double-insert. `fn` receives the live version.
 */
export async function withPlanClaim<T>(
  patientId: string,
  fn: (activePlanVersion: number) => Promise<T>,
  deps: RunnerDeps = defaultDeps,
): Promise<T> {
  const before = await readPlanStatus(patientId, deps);
  await claimPlanSlot(patientId, deps);
  try {
    const live = await deps.prisma.patient.findUnique({ where: { id: patientId }, select: { activePlanVersion: true } });
    const result = await fn(live?.activePlanVersion ?? 0);
    await restorePlanStatus(patientId, before, deps);
    return result;
  } catch (err) {
    await restorePlanStatus(patientId, before, deps);
    throw err;
  }
}
```

Delete the now-duplicated `const stuckCutoff` / `claim` lines from inside `regeneratePlan` (they moved into `claimPlanSlot`).

- [ ] **Step 4: Run the runner tests**

Run: `node --import tsx --test lib/meal-plan-runner.test.ts`
Expected: all PASS, including the pre-existing "a failed claim must stop the run before any read" test (no preflight passed, so no pre-read happens).

- [ ] **Step 5: Create the JSON error helper**

Create `lib/api-error.ts`:

```ts
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// Last-resort JSON 500 for route handlers. A bare `throw err` at the end of
// a handler produces a Next.js HTML error page: the web client falls back
// to a generic string, the iOS client throws on JSON parse. Always answer
// JSON, always log, always report.
export function internalError(
  tag: string,
  err: unknown,
  message = "Something went wrong — please try again."
): NextResponse {
  console.error(`[${tag}]`, err);
  Sentry.captureException(err, { tags: { route: tag } });
  return NextResponse.json({ error: message }, { status: 500 });
}
```

- [ ] **Step 6: Move the guard into the claim in new-week**

In `app/api/meal-plan/new-week/route.ts`:
- Change the runner import (line 5) to: `import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";`
- Add `import { internalError } from "@/lib/api-error";`
- Delete lines 43-44 (`const guard = await guardAiSpend(userId, "planGen"); if (!guard.ok) ...`).
- In the `regeneratePlan` call (line 58) add the preflight option:

```ts
    const count = await regeneratePlan(patient.id, today, undefined, {
      claraFirst: true,
      windowDays: 7,
      anchorDate: anchor,
      basket,
      excludeRecipeIds,
      // Charged only by the request that holds the claim (S8).
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planGen");
        return guard.ok ? null : { status: guard.status, body: guard.body };
      },
    });
```

- Replace the catch block (lines 82-93) with:

```ts
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "Couldn't build a week from these ingredients — add a few more and try again." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/new-week", err, "Couldn't generate your week — please try again.");
  }
```

- [ ] **Step 7: Same in regenerate**

In `app/api/meal-plan/regenerate/route.ts`:
- Import line 6 becomes: `import { regeneratePlan, MealPlanBusyError, EmptyPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";`
- Delete lines 64-66 (the guard).
- Replace `const count = await regeneratePlan(patient.id, today);` with:

```ts
    const count = await regeneratePlan(patient.id, today, undefined, {
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planGen", isPremium ? "premium" : "free");
        return guard.ok ? null : { status: guard.status, body: guard.body };
      },
    });
```

- Add to the catch, before the `EmptyPlanError` branch:

```ts
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
```

(The existing final `console.error` + 500 JSON stays.)

- [ ] **Step 8: Same in meal-plan POST**

In `app/api/meal-plan/route.ts`:
- Extend the runner import to include `PlanPreflightError`; add `import { internalError } from "@/lib/api-error";`
- Delete lines 180-181 (the `planInit` guard).
- The `regeneratePlan` call becomes:

```ts
    const count = await regeneratePlan(patient.id, start, undefined, {
      claraFirst: wantClara,
      cuisine: wantClara ? normalizeCuisine(cuisine) : null,
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planInit", isPremium ? "premium" : "free");
        return guard.ok ? null : { status: guard.status, body: guard.body };
      },
    });
```

- In the catch add the `PlanPreflightError` branch (same three lines as Step 7) before `EmptyPlanError`, and replace the final `throw err;` with `return internalError("meal-plan/create", err, "Couldn't generate your plan — please try again.");`

- [ ] **Step 9: Same in start-date**

In `app/api/meal-plan/start-date/route.ts`:
- Extend the runner import to include `PlanPreflightError`; add `import { internalError } from "@/lib/api-error";`
- Delete lines 64-66 (the guard).
- `const count = await regeneratePlan(patient.id, start);` becomes:

```ts
    const count = await regeneratePlan(patient.id, start, undefined, {
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planInit", isPremium ? "premium" : "free");
        return guard.ok ? null : { status: guard.status, body: guard.body };
      },
    });
```

- Add the `PlanPreflightError` branch before `EmptyPlanError`; replace the final `throw err;` with `return internalError("meal-plan/start-date", err, "Couldn't change your start date — please try again.");`

- [ ] **Step 10: Verify**

Run: `grep -n "guardAiSpend" app/api/meal-plan/new-week/route.ts app/api/meal-plan/regenerate/route.ts app/api/meal-plan/route.ts app/api/meal-plan/start-date/route.ts`
Expected: exactly one hit per file, and each is inside a `preflight:` arrow function.

Run: `grep -n "throw err" app/api/meal-plan/new-week/route.ts app/api/meal-plan/route.ts app/api/meal-plan/start-date/route.ts`
Expected: no output.

Run: `npx tsc --noEmit` then `npm test` then `npx next lint --file lib/meal-plan-runner.ts --file lib/api-error.ts --file app/api/meal-plan/new-week/route.ts --file app/api/meal-plan/regenerate/route.ts --file app/api/meal-plan/route.ts --file app/api/meal-plan/start-date/route.ts`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add lib/meal-plan-runner.ts lib/meal-plan-runner.test.ts lib/api-error.ts app/api/meal-plan/new-week/route.ts app/api/meal-plan/regenerate/route.ts app/api/meal-plan/route.ts app/api/meal-plan/start-date/route.ts
git commit -m "fix(meal-plan): charge AI quota only under the claim lock (double-click no longer burns two weeks); JSON 500s; withPlanClaim for in-place writers"
```

---

### Task 5: Cuisine-for-today runs under the claim lock with its own rate bucket

**Depends on:** Task 4 (`withPlanClaim`, `PlanPreflightError`).

**Files:**
- Modify: `app/api/meal-plan/day/route.ts`

**Interfaces:**
- Consumes: `withPlanClaim`, `claimPlanSlot` semantics, `PlanPreflightError`, `MealPlanBusyError`, `EmptyPlanError` from `lib/meal-plan-runner.ts`; `internalError` from `lib/api-error.ts`.

- [ ] **Step 1: Rewrite the handler body**

Replace the imports at the top of `app/api/meal-plan/day/route.ts` with:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { guardAiSpend } from "@/lib/ai-budget";
import { normalizeCuisine } from "@/lib/clara/recipe-generation";
import { buildMealPlanMenus } from "@/lib/meal-plan";
import { withPlanClaim, MealPlanBusyError, EmptyPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";
import { internalError } from "@/lib/api-error";
```

Replace line 32 (the rate limit) with its own bucket. The old code shared `"regenerate"` with four other routes at a different threshold, so eleven cuisine taps in a minute locked the user out of New week:

```ts
  const { success } = await rateLimit("cuisine-day", userId, 15, 60);
```

Delete lines 52-54 (the guard before the build; it moves inside the claim).

Replace everything from `try {` (line 70) to the end of the function with:

```ts
  try {
    // Hold the plan claim for the whole build + write (S10): no regenerate
    // can flip activePlanVersion underneath us, and a double-tap's second
    // request gets 409 instead of inserting a second copy of the day.
    const count = await withPlanClaim(patient.id, async (activePlanVersion) => {
      const guard = await guardAiSpend(userId, "swap");
      if (!guard.ok) throw new PlanPreflightError(guard.status, guard.body);

      const { rows } = await buildMealPlanMenus(patient.id, dayStart, activePlanVersion, {
        windowDays: 1,
        anchorDate: anchor,
        basket,
        cuisine: normalizeCuisine(cuisine),
        claraFirst: true,
        // One day needs only ~1 dish per slot — generate a small pool so the
        // model call stays fast (was 28 dishes for a single day).
        claraPerType: 2,
      });
      if (rows.length === 0) throw new EmptyPlanError();

      await prisma.$transaction([
        prisma.menu.deleteMany({
          where: { patientId: patient.id, planVersion: activePlanVersion, date: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.menu.createMany({ data: rows }),
      ]);
      return rows.length;
    });
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "Your plan is being updated — try again in a moment." }, { status: 409 });
    }
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "Couldn't rebuild today in that cuisine — try another, or add a few ingredients." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/day", err, "Couldn't rebuild today — try again.");
  }
```

The `patient` select (line 47) still needs `activePlanVersion`? No: the live version now comes from `withPlanClaim`. Remove `activePlanVersion: true` from that select so nobody reuses the stale value.

- [ ] **Step 2: Verify**

Run: `grep -n "activePlanVersion" app/api/meal-plan/day/route.ts`
Expected: only the `withPlanClaim` callback parameter and its uses inside the callback.

Run: `grep -rn 'rateLimit("regenerate"' app/api`
Expected: four hits (new-week, regenerate, meal-plan route, start-date), all with limit 10. The day route no longer appears.

Run: `npx tsc --noEmit` and `npx next lint --file app/api/meal-plan/day/route.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/meal-plan/day/route.ts
git commit -m "fix(meal-plan/day): build + write under the plan claim (no duplicated days, no writes to a purged version); own rate bucket"
```

---

### Task 6: Clara swap cannot orphan recipes or 500 on a moved slot

**Depends on:** Task 2 (`lib/anthropic.ts` already imported in this file).

**Files:**
- Modify: `app/api/meal-plan/[menuId]/clara-swap/route.ts` (the slot lookup at ~line 71, the guard at ~line 80, and the persist/update block at ~lines 171-181)

- [ ] **Step 1: Add a per-slot in-flight lock before the AI spend guard**

Add `import { rateLimit } from "@/lib/rate-limit";` to the imports.

Immediately before the `guardAiSpend(userId, "swap")` call insert:

```ts
  // One Clara swap per slot at a time (S12). maxDuration is 30s, so a 45s
  // window covers the slowest legitimate run; a double-tap's second request
  // is refused before it can generate a second public recipe for this slot.
  const inflight = await rateLimit("clara-swap-inflight", `${userId}:${params.menuId}`, 1, 45);
  if (!inflight.success) {
    return NextResponse.json({ error: "Clara is already working on this dish — give her a moment." }, { status: 409 });
  }
```

- [ ] **Step 2: Replace the unguarded menu update**

Replace:

```ts
  await prisma.menu.update({ where: { id: params.menuId }, data: { recipeId: createdId } });
```

with:

```ts
  // Guarded write: the slot must still belong to this patient's ACTIVE plan
  // version. If a regenerate ran during the model call, the old row is gone
  // (or stale) and `update` would throw P2025 uncaught. Take the dish out of
  // the public catalog so a lost race doesn't leave junk for every other
  // user's plan builder.
  const claimed = await prisma.menu.updateMany({
    where: { id: params.menuId, patientId: patient.id, planVersion: patient.activePlanVersion },
    data: { recipeId: createdId },
  });
  if (claimed.count === 0) {
    await prisma.recipe.update({ where: { id: createdId }, data: { isPublic: false } }).catch(() => {});
    return NextResponse.json(
      { error: "Your plan changed while Clara was cooking — refresh the page and try again." },
      { status: 409 }
    );
  }
```

- [ ] **Step 3: Verify**

Run: `grep -n "prisma.menu.update(" "app/api/meal-plan/[menuId]/clara-swap/route.ts"`
Expected: no output.

Run: `npx tsc --noEmit` and `npx next lint --file "app/api/meal-plan/[menuId]/clara-swap/route.ts"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/api/meal-plan/[menuId]/clara-swap/route.ts"
git commit -m "fix(clara-swap): per-slot in-flight lock; guarded menu write (409 on a moved slot instead of P2025 500); lost race un-publishes the dish"
```

---

### Task 7: Profile save survives a double-submit

**Files:**
- Modify: `app/api/patient/profile/route.ts:207-240`

- [ ] **Step 1: Add skipDuplicates and a P2002 handler**

Add `import { Prisma } from "@prisma/client";` to the imports if not already present (check with `grep -n "Prisma" app/api/patient/profile/route.ts`).

In the four `createMany` calls for `patientMotivation`, `patientFoodPreference`, `patientFoodToAvoid`, `patientFoodAllergy` add `skipDuplicates: true` after the `data:` argument, matching the form already used by `patientHealthCondition`. Example for the first:

```ts
prisma.patientMotivation.createMany({ data: motivationList.map((id) => ({ patientId: patient.id, motivationId: id })), skipDuplicates: true })
```

Wrap the `await prisma.$transaction([...])` in:

```ts
  try {
    await prisma.$transaction([
      // ...unchanged array...
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Two saves raced (double-submit): the winner's write is correct and
      // complete, so tell the loser to reload rather than 500 (S14).
      return NextResponse.json(
        { error: "Your profile was just saved — refresh the page to see it." },
        { status: 409 }
      );
    }
    throw err;
  }
```

- [ ] **Step 2: Verify**

Run: `grep -c "skipDuplicates: true" app/api/patient/profile/route.ts`
Expected: `5`.

Run: `npx tsc --noEmit` and `npx next lint --file app/api/patient/profile/route.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/patient/profile/route.ts
git commit -m "fix(profile): skipDuplicates on link tables; concurrent save answers 409 JSON instead of P2002 500"
```

---

### Task 8: Meal-log replay cannot 500 on a unique race

**Files:**
- Modify: `app/api/meal-log/route.ts:116-123`
- Modify: `app/api/meal-log/batch/route.ts:122-128`

- [ ] **Step 1: Single log**

In `app/api/meal-log/route.ts` ensure `import { Prisma } from "@prisma/client";` is present. Replace lines 116-123:

```ts
  let created = true;
  let row;
  if (input.clientRequestId) {
    const where = { patientId_clientRequestId: { patientId: patient.id, clientRequestId: input.clientRequestId } };
    const existing = await prisma.mealLog.findUnique({ where });
    created = !existing;
    try {
      row = await prisma.mealLog.upsert(buildMealLogUpsertArgs(data));
    } catch (err) {
      // Two replays of the same clientRequestId raced through the upsert's
      // non-atomic path (pinned `update: {}`). The row exists now: return it
      // as the replay contract promises, instead of P2002 → 500 (S15).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        row = await prisma.mealLog.findUniqueOrThrow({ where });
        created = false;
      } else {
        throw err;
      }
    }
  } else {
    row = await prisma.mealLog.create({ data });
  }
```

- [ ] **Step 2: Batch**

In `app/api/meal-log/batch/route.ts` ensure the `Prisma` import is present. Wrap the transaction:

```ts
  let rows;
  try {
    rows = await prisma.$transaction(
      rowsData.map((data) =>
        data.clientRequestId
          ? prisma.mealLog.upsert(buildMealLogUpsertArgs(data))
          : prisma.mealLog.create({ data })
      )
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Some of these items were already logged — refresh and check your log." },
        { status: 409 }
      );
    }
    throw err;
  }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, `npm test`, `npx next lint --file app/api/meal-log/route.ts --file app/api/meal-log/batch/route.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/meal-log/route.ts app/api/meal-log/batch/route.ts
git commit -m "fix(meal-log): replayed clientRequestId that loses the unique race returns the row (200) / 409, never P2002 500"
```

---

### Task 9: Cook-my-day runs once at a time per user

**Depends on:** Task 2 (this file was edited there; rebase on its commit).

**Files:**
- Modify: `app/api/pantry/cook-day/route.ts` (immediately before the `guardAiSpend(userId, "cookDay")` call, ~line 91)

- [ ] **Step 1: Add the in-flight lock**

Add `import { rateLimit } from "@/lib/rate-limit";` to the imports. Insert before the guard:

```ts
  // One cook-day per user at a time (S13): every accepted dish is persisted
  // as a PUBLIC recipe, so a double-tap used to leave a duplicate day in the
  // shared catalog. maxDuration is 60s; the window covers the slowest run.
  const inflight = await rateLimit("cookday-inflight", userId, 1, 90);
  if (!inflight.success) {
    return NextResponse.json(
      { error: "Clara is already cooking your day — give her a moment." },
      { status: 409 }
    );
  }
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit` and `npx next lint --file app/api/pantry/cook-day/route.ts`
Expected: clean.

```bash
git add app/api/pantry/cook-day/route.ts
git commit -m "fix(cook-day): per-user in-flight lock so a double-tap can't persist a duplicate day of public recipes"
```

---

### Task 10: Exchanges and coupon redeem always answer JSON

**Depends on:** Task 4 (`lib/api-error.ts`).

**Files:**
- Modify: `app/api/meal-plan/exchanges/[id]/route.ts:133,219`
- Modify: `app/api/coupon/redeem/route.ts:139`

- [ ] **Step 1: Replace the rethrows**

In both files add `import { internalError } from "@/lib/api-error";`.

In `app/api/meal-plan/exchanges/[id]/route.ts` replace the `throw err;` at line 133 (inside the `eat` action's catch, after the `ResolveError` branch) with:

```ts
      return internalError("exchanges/eat", err, "Couldn't log that exchange — please try again.");
```

and the `throw err;` at line 219 (after the P2002/P2034 branch) with:

```ts
    return internalError("exchanges/resolve", err, "Couldn't resolve that exchange — please try again.");
```

In `app/api/coupon/redeem/route.ts` replace the `throw err;` at line 139 with:

```ts
    return internalError("coupon/redeem", err, "Couldn't redeem that code right now — please try again.");
```

- [ ] **Step 2: Verify and commit**

Run: `grep -n "throw err" "app/api/meal-plan/exchanges/[id]/route.ts" app/api/coupon/redeem/route.ts`
Expected: no output. (If a `throw err` remains inside a nested helper that is itself caught by an outer handler, leave it and note it in your report.)

Run: `npx tsc --noEmit`, `npm test`, `npx next lint --file "app/api/meal-plan/exchanges/[id]/route.ts" --file app/api/coupon/redeem/route.ts`
Expected: clean.

```bash
git add "app/api/meal-plan/exchanges/[id]/route.ts" app/api/coupon/redeem/route.ts
git commit -m "fix(api): exchanges + coupon redeem answer JSON 500 instead of rethrowing"
```

---

### Task 11: Favorites step never skips itself on a failed load

**Files:**
- Modify: `components/taste/IngredientTinder.tsx`

- [ ] **Step 1: Guard the deck load**

Replace the import block and `loadDeck` (lines 1-32) with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-fetch";

interface Item { id: string; name: string; liked: boolean }
interface Level { key: string; title: string; items: Item[] }

const LOAD_ERROR = "Couldn't load your ingredients — check your connection and try again.";
const SAVE_ERROR = "Couldn't save that pick — check your connection and try again.";

export default function IngredientTinder({ mode }: { mode: "onboarding" | "edit" }) {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelIdx, setLevelIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // True only after a SUCCESSFUL deck load. The "mark taste complete" effect
  // below must never fire on a failed load: it used to treat any error body
  // as an empty deck and permanently skip this onboarding step (C1).
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [done, setDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadDeck = async (): Promise<Level[] | null> => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiFetch("/api/taste/ingredients");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setLoadError(data?.error ?? LOAD_ERROR);
        return null;
      }
      const lv: Level[] = data.levels ?? [];
      setLevels(lv);
      const pre = new Set<string>();
      for (const l of lv) for (const it of l.items) if (it.liked) pre.add(it.id);
      setSelected(pre);
      setDeckLoaded(true);
      return lv;
    } catch {
      setLoadError(LOAD_ERROR);
      return null;
    } finally {
      setLoading(false);
    }
  };
```

- [ ] **Step 2: Gate the "seen" effect on a successful load**

Replace the effect at lines 59-63 with:

```tsx
  // Mark taste complete so the layout gate stops redirecting here — only
  // when the deck really is empty (loaded fine, zero levels), never on error.
  useEffect(() => {
    if (mode === "edit" || done || (deckLoaded && !loading && levels.length === 0)) {
      apiFetch("/api/taste/seen", { method: "POST" }).catch(() => {});
    }
  }, [mode, done, deckLoaded, loading, levels.length]);
```

- [ ] **Step 3: Move the save out of the state updater and roll back on failure**

Replace `toggle` (lines 67-84) with:

```tsx
  const toggle = (id: string) => {
    const nowSelected = !selected.has(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (nowSelected) next.add(id);
      else next.delete(id);
      return next;
    });
    setSaveError("");
    // The request lives OUTSIDE the updater: React may run updaters twice.
    const req = nowSelected
      ? apiFetch("/api/taste/ingredient-swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId: id, liked: true }),
        })
      : apiFetch(`/api/taste/ingredient-swipe?ingredientId=${encodeURIComponent(id)}`, { method: "DELETE" });
    req
      .then((res) => {
        if (!res.ok) throw new Error("save failed");
      })
      .catch(() => {
        // Roll the chip back so the screen never shows a pick the server lost.
        setSelected((prev) => {
          const next = new Set(prev);
          if (nowSelected) next.delete(id);
          else next.add(id);
          return next;
        });
        setSaveError(SAVE_ERROR);
      });
  };
```

In `startOver`, change `await fetch("/api/taste/ingredients/reset", { method: "POST" });` to `await apiFetch(...)` with the same arguments.

- [ ] **Step 4: Render the error states**

Insert this block immediately AFTER the `if (loading) { ... }` return and BEFORE `if (levels.length === 0)`:

```tsx
  if (loadError && levels.length === 0) {
    return (
      <div className="text-center py-16">
        <p role="alert" className="text-navy font-semibold text-lg mb-2">{loadError}</p>
        <button
          onClick={() => void loadDeck()}
          className="mt-4 px-6 py-3 rounded-2xl bg-primary text-white font-semibold text-sm"
        >
          Try again
        </button>
      </div>
    );
  }
```

Insert this immediately after the closing `</div>` of the `{/* Selectable chips */}` block:

```tsx
      {saveError && (
        <p role="alert" className="text-xs mt-3 text-error text-center">{saveError}</p>
      )}
```

- [ ] **Step 5: Verify**

Run: `grep -n "fetch(" components/taste/IngredientTinder.tsx | grep -v apiFetch`
Expected: no output.

Run: `npx tsc --noEmit` and `npx next lint --file components/taste/IngredientTinder.tsx`
Expected: clean.

Manual (if a dev server is running on :3000): open `/taste?edit=1`, confirm chips load, toggle one, reload, confirm it persisted.

- [ ] **Step 6: Commit**

```bash
git add components/taste/IngredientTinder.tsx
git commit -m "fix(taste): failed deck load shows retry and never marks taste complete; favorite saves roll back and report; apiFetch"
```

---

### Task 12: Meal plan view never blanks on an error and rating can't double-toggle

**Files:**
- Modify: `components/meal-plan/DailyMealPlanView.tsx` (MealCard props ~lines 76-82 and the rating buttons ~lines 208-226; mount effect ~lines 283-301; `generateNewWeek` ~lines 326-335; `setCuisineForDay` ~lines 364-370; `navigate` ~lines 389-409; `handleRate` ~lines 411-420; the `<MealCard` usage ~line 849)

- [ ] **Step 1: Mount refetch checks the response**

Replace the `.then((r) => r.json()).then((data) => {` opening of the mount effect (lines 293-294) with:

```tsx
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        // Any error body (401 after idle, 404, 403) used to wipe the
        // server-rendered plan to [] and invite a wasted regeneration (C2).
        if (!r.ok || !data) return;
```

(the body of the callback and the trailing `.catch(() => {})` stay).

- [ ] **Step 2: Follow-up reads after a successful generation keep the plan**

In `generateNewWeek`, replace:

```tsx
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json();
```

with:

```tsx
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json().catch(() => null);
      if (!mRes.ok || !mData) {
        // The week WAS generated; only the re-read failed. Never blank the
        // screen or the user will burn a second weekly token rebuilding.
        setNewWeekError("Your new week is ready — reload the page to see it.");
        return;
      }
```

In `setCuisineForDay`, replace:

```tsx
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json();
```

with:

```tsx
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json().catch(() => null);
      if (!mRes.ok || !mData) {
        setCuisineDayError("Today was updated — reload the page to see it.");
        return;
      }
```

- [ ] **Step 3: Navigation reverts on failure**

Add a state next to `cuisineDayError`: `const [navError, setNavError] = useState("");`

Replace `navigate` with:

```tsx
  const navigate = async (dir: "prev" | "next") => {
    if (dir === "next" && atForwardLimit) return;
    if (dir === "prev" && atBackLimit) return;
    if (loading) return;
    setSelectedId(null);
    setNavError("");
    const prevDate = date;
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        // Keep the dishes that match the header: revert the date instead of
        // showing yesterday's food under today's date (C2).
        setDate(prevDate);
        setNavError(data?.error ?? "Couldn't load that day — try again.");
        return;
      }
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
      if (data.mealPlanStartDate) setStartDate(new Date(data.mealPlanStartDate));
      setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
      setExchanges(data.exchanges ?? null);
    } catch {
      setDate(prevDate);
      setNavError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };
```

Render `navError` directly above the `{/* Cuisine-for-today + full-week entry — only when a day exists. */}` block:

```tsx
      {navError && (
        <p role="alert" className="text-xs mb-3 text-error">{navError}</p>
      )}
```

- [ ] **Step 4: Rating is guarded and reports failure**

Add states: `const [ratingBusy, setRatingBusy] = useState(false);` and `const [rateError, setRateError] = useState("");`

Replace `handleRate` with:

```tsx
  const handleRate = async (recipeId: string, mealTypeName: string, rating: number) => {
    // /api/journal/log-meal is a TOGGLE: two fast taps logged then un-logged
    // the meal with no feedback (C2). One in flight at a time.
    if (ratingBusy) return;
    setRatingBusy(true);
    setRateError("");
    const dateStr = format(date, "yyyy-MM-dd");
    try {
      const res = await apiFetch("/api/journal/log-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, mealTypeName, date: dateStr, rating }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setRateError(data?.error ?? "Couldn't save your rating — try again.");
        return;
      }
      if (data.loggedRecipeIds) setLoggedRecipeIds(data.loggedRecipeIds);
      if (data.mealRatings)     setMealRatings(data.mealRatings);
      setSelectedId(null);
    } catch {
      setRateError("Network error — try again.");
    } finally {
      setRatingBusy(false);
    }
  };
```

In the `MealCard` props interface add:

```tsx
  ratingBusy: boolean;
  rateError: string;
```

and destructure them in the component signature alongside `onRate`. On both rating `<button>`s add `disabled={ratingBusy}` and append ` disabled:opacity-50 disabled:cursor-not-allowed` to their className strings. After the closing `</div>` of the `{/* Rating */}` block add:

```tsx
        {rateError && (
          <p role="alert" className="text-xs mt-2 text-error">{rateError}</p>
        )}
```

At the `<MealCard` usage (~line 849) add `ratingBusy={ratingBusy}` and `rateError={rateError}` next to `onRate={handleRate}`.

- [ ] **Step 5: Verify**

Run: `grep -n "await .*\.json()$\|await .*\.json();" components/meal-plan/DailyMealPlanView.tsx`
Expected: no output (every `.json()` is followed by `.catch(() => null)`).

Run: `npx tsc --noEmit` and `npx next lint --file components/meal-plan/DailyMealPlanView.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/meal-plan/DailyMealPlanView.tsx
git commit -m "fix(meal-plan view): never blank the plan on an error body; navigation reverts on failure; rating is single-flight and reports errors"
```

---

### Task 13: Clara chat survives stream errors and stalls

**Files:**
- Modify: `components/dish-checker/DishCheckerClient.tsx`

- [ ] **Step 1: Message model and history**

Replace the `Message` interface with:

```tsx
interface Message {
  role: "user" | "assistant";
  content: string;
  /** Rendered as Clara, but never sent back to the model as history. */
  error?: boolean;
}
```

Add `import { apiFetch } from "@/lib/client-fetch";` after the React import.

In `send()`, replace `const history = [...messages, userMsg];` with:

```tsx
    // Error bubbles ("Too many requests…") used to be replayed to the model
    // as real assistant turns (C3). Only genuine turns go back.
    const history = [...messages.filter((m) => !m.error), userMsg];
```

Note that `setMessages(history)` on the next line must become `setMessages([...messages, userMsg]);` so error bubbles stay visible on screen.

- [ ] **Step 2: Abort controller with a stall watchdog**

Replace the `fetch("/api/dish-checker", {` call with `apiFetch("/api/dish-checker", {` and add `signal: controller.signal,` to its init object. Declare, at the top of the `try` block in `send()` (before the request):

```tsx
      // A silent mobile drop used to leave reader.read() pending forever,
      // with the textarea and Send disabled until reload (C3). Abort if no
      // byte arrives for STALL_MS; the abort surfaces as a stream error below.
      const STALL_MS = 30_000;
      const controller = new AbortController();
      let stall = setTimeout(() => controller.abort(), STALL_MS);
      const kick = () => {
        clearTimeout(stall);
        stall = setTimeout(() => controller.abort(), STALL_MS);
      };
```

Inside the read loop, after `const chunk = decoder.decode(value, { stream: true });` add `kick();`. Add `clearTimeout(stall);` as the first line of the outer `finally` (the one that calls `setIsStreaming(false)`). Because `controller`/`stall` are declared inside `try`, hoist their declarations above the `try` so `finally` can see them:

```tsx
    const STALL_MS = 30_000;
    const controller = new AbortController();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_MS);
    };
    kick();
    try {
```

and in `finally`: `if (stall) clearTimeout(stall);`.

- [ ] **Step 3: Append on mid-stream error instead of overwriting**

Replace the inner `catch` of the read loop with:

```tsx
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const partial = last.content.trim();
          return [
            ...updated.slice(0, -1),
            partial
              ? { ...last, content: `${last.content}\n\n(Clara got cut off — send your message again for the rest.)`, error: true }
              : { ...last, content: "Sorry — something went wrong. Please try again.", error: true },
          ];
        });
      }
```

In the outer `catch (err)` (the non-ok / no-body path), add `error: true` to the message object it pushes.

- [ ] **Step 4: Verify**

Run: `grep -n "fetch(" components/dish-checker/DishCheckerClient.tsx | grep -v apiFetch`
Expected: no output.

Run: `npx tsc --noEmit` and `npx next lint --file components/dish-checker/DishCheckerClient.tsx`
Expected: clean.

Manual (dev server on :3000, real Anthropic key in `.env.local`): send a message, confirm it streams; send a second, confirm the first answer is in `history` and any prior error bubble is not (check the request body in DevTools Network).

- [ ] **Step 5: Commit**

```bash
git add components/dish-checker/DishCheckerClient.tsx
git commit -m "fix(clara chat): keep the partial answer on a stream error; 30s stall watchdog; error bubbles never replayed to the model; apiFetch"
```

---

### Task 14: Shopping-list ticks roll back and report in every view

**Files:**
- Modify: `components/pantry/PantryClient.tsx` (state at ~line 67-69, `flushSaves` ~lines 175-217, `toggle` ~lines 223-231, the "buy" view return ~line 355, the initial `setSelected` from the server load — find with `grep -n "setSelected(" components/pantry/PantryClient.tsx`)

- [ ] **Step 1: Track the last server-confirmed basket**

Read lines 60-120 and 170-220 of the file first. Next to the `selected` state add:

```tsx
  // The basket as the SERVER last confirmed it. A failed save rolls the
  // chips back to this so a tick never stays on screen when it didn't stick (C4).
  const lastSaved = useRef<Map<string, string>>(new Map());
```

At every place a server response populates `selected` on load (the initial pantry GET; use the grep above to find each `setSelected(` that follows a successful fetch), also set `lastSaved.current = new Map(<that same map>)`.

In `flushSaves`, on the success path (right after `setSyncError("")`), add `lastSaved.current = new Map(next);` where `next` is the map that was just PUT. On the failure path (inside the `catch`, next to `setSyncError(...)`), add:

```tsx
            setSelected(new Map(lastSaved.current));
```

- [ ] **Step 2: Move the save out of the updater**

Replace `toggle` with:

```tsx
  // Queue the save from an effect, never from inside the updater: React may
  // run updaters twice and used to fire duplicate PUTs (C4).
  const pendingToggle = useRef<Map<string, string> | null>(null);
  const toggle = (ing: Ing) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(ing.id)) next.delete(ing.id);
      else next.set(ing.id, ing.name);
      pendingToggle.current = next;
      return next;
    });
  };
  useEffect(() => {
    const next = pendingToggle.current;
    if (!next) return;
    pendingToggle.current = null;
    void persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
```

- [ ] **Step 3: Show the sync error in the "What to buy" view**

In the `if (view === "buy") { ... return ( <div> {tabs} ...` block, insert directly after `{tabs}`:

```tsx
        {syncError && (
          <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-2.5 text-xs mb-4">
            {syncError}
          </div>
        )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx next lint --file components/pantry/PantryClient.tsx`
Expected: clean.

Manual (dev server): in "What I have", tick an ingredient, reload, confirm it stuck. In DevTools set the network to offline, tick another, confirm the chip reverts and the banner appears in BOTH views.

- [ ] **Step 5: Commit**

```bash
git add components/pantry/PantryClient.tsx
git commit -m "fix(pantry): failed basket save rolls the chips back; error banner in the shopping view; save queued from an effect, not the updater"
```

---

### Task 15: Server error strings reach the user (journal, profile, redeem, grocery)

**Files:**
- Modify: `components/dashboard/QuickJournalLog.tsx:102-125`
- Modify: `components/profile/ProfileForm.tsx` (the fetch ~line 190 and `:220`)
- Modify: `components/billing/RedeemCodeBox.tsx:34-41`
- Modify: `components/grocery/GroceryListView.tsx:33-45`

- [ ] **Step 1: QuickJournalLog**

Add `import { apiFetch } from "@/lib/client-fetch";`. Change `fetch("/api/journal", {` to `apiFetch("/api/journal", {`. Replace `if (!res.ok) throw new Error("Failed");` with:

```tsx
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not save.");
      }
```

and the `catch { setError("Could not save."); }` with:

```tsx
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
```

- [ ] **Step 2: ProfileForm**

Read `components/profile/OnboardingWizard.tsx:340-360` first: it already parses this API's 422 field errors and 409 conflict correctly. Mirror that exact parsing in `ProfileForm.tsx`. Replace `if (!res.ok) throw new Error("Failed to save profile");` with the same shape the wizard uses, e.g.:

```tsx
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save profile");
      }
```

(if the wizard extracts a field-error map, reproduce that logic instead of this simplified form). Switch the call to `apiFetch` and add the import.

- [ ] **Step 3: RedeemCodeBox**

Switch to `apiFetch` (add the import). Replace:

```tsx
      const data = await res.json();
      if (!res.ok) {
        setResult({ success: false, message: data.error });
```

with:

```tsx
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setResult({ success: false, message: data?.error ?? t("error") });
```

- [ ] **Step 4: GroceryListView**

Add `const [error, setError] = useState("");` and switch to `apiFetch`. Replace `load` with:

```tsx
  const load = async (f: Date, t: Date) => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/grocery-list?from=${format(f, "yyyy-MM-dd")}&to=${format(t, "yyyy-MM-dd")}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error ?? "Couldn't load your shopping list — try again.");
        return;
      }
      setItems(data.items ?? []);
      setChecked(new Set());
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };
```

Render `{error && <p role="alert" className="text-xs text-error mb-3">{error}</p>}` at the top of the component's returned list area (read the JSX to place it above the item list; do not restyle anything else).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit` and `npx next lint --file components/dashboard/QuickJournalLog.tsx --file components/profile/ProfileForm.tsx --file components/billing/RedeemCodeBox.tsx --file components/grocery/GroceryListView.tsx`
Expected: clean.

```bash
git add components/dashboard/QuickJournalLog.tsx components/profile/ProfileForm.tsx components/billing/RedeemCodeBox.tsx components/grocery/GroceryListView.tsx
git commit -m "fix(client): journal, profile, redeem and grocery show the server's error and parse JSON safely; apiFetch"
```

---

### Task 16: Billing and caloric card parse safely; error boundaries for the other route groups; delete dead DishTinder

**Files:**
- Modify: `components/billing/PlanPicker.tsx:70-76`
- Modify: `components/billing/BillingPanel.tsx:29-52`
- Modify: `components/dashboard/CaloricProfileCard.tsx:41-47`
- Create: `app/(main)/error.tsx`, `app/(auth)/error.tsx`, `app/(restaurant)/error.tsx`
- Delete: `components/taste/DishTinder.tsx`

- [ ] **Step 1: Safe parsing in the three components**

In each, every `const data = await res.json();` becomes `const data = await res.json().catch(() => null);` and every `data.error` / `data.message` becomes `data?.error` / `data?.message`. In `PlanPicker.checkout`, `window.location.href = data.alreadySubscribed ? data.portalUrl : data.url;` becomes:

```tsx
      if (!data?.url && !data?.portalUrl) { setError("Something went wrong. Please try again."); return; }
      window.location.href = data.alreadySubscribed ? data.portalUrl : data.url;
```

In `BillingPanel.openPortal`, `if (res.ok) { window.location.href = data.url; return; }` becomes `if (res.ok && data?.url) { window.location.href = data.url; return; }`.

In `CaloricProfileCard.load`, replace the two-step parse:

```tsx
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error || "Could not load caloric profile");
        return;
      }
      setProfile(data.profile);
      setError("");
```

Switch all three components' `fetch(` calls to `apiFetch(` with the import.

- [ ] **Step 2: Error boundaries**

Create `app/(main)/error.tsx`, `app/(auth)/error.tsx`, and `app/(restaurant)/error.tsx` with identical content (a server-component throw in these groups used to fall through to `global-error.tsx`, which replaces the whole document with no nav):

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <h1 className="text-xl font-bold text-navy">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-[#848181]">
        We hit an unexpected error loading this page. You can retry or head back home.
      </p>
      {error.digest && <p className="mt-2 text-xs text-[#ABA6A6]">Error ID: {error.digest}</p>}
      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-full text-sm font-semibold"
        >
          Try again
        </button>
        <Link href="/" className="px-6 py-2.5 rounded-full text-sm font-semibold text-[#848181] hover:text-navy">
          Back home
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete dead code**

Run: `grep -rn "DishTinder" app components lib --include='*.ts' --include='*.tsx' | grep -v "components/taste/DishTinder.tsx"`
Expected: no output. Then `git rm components/taste/DishTinder.tsx`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit` and `npx next lint --file components/billing/PlanPicker.tsx --file components/billing/BillingPanel.tsx --file components/dashboard/CaloricProfileCard.tsx --file "app/(main)/error.tsx" --file "app/(auth)/error.tsx" --file "app/(restaurant)/error.tsx"`
Expected: clean.

```bash
git add components/billing/PlanPicker.tsx components/billing/BillingPanel.tsx components/dashboard/CaloricProfileCard.tsx "app/(main)/error.tsx" "app/(auth)/error.tsx" "app/(restaurant)/error.tsx"
git commit -m "fix(client): safe JSON parsing in billing + caloric card; error boundaries for main/auth/restaurant groups; remove dead DishTinder"
```

---

## Final verification (orchestrator, after Wave C)

- [ ] `npm test` — all pass.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx next lint` — clean (whole project).
- [ ] `git log --oneline feat/beta-premium-coupons..feat/beta-hardening` — one commit per task, 16 total.
- [ ] With the dev server running and `PREMIUM_GATES=on npm run dev`, as a coupon user: send 3 Clara messages, generate a new week, double-click "New week" and confirm the second click shows "already being generated" while the weekly counter only dropped by one (check `/api/meal-plan/new-week` responses in DevTools).
