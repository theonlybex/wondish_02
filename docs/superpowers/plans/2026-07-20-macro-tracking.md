# Calorie & Macro Tracking Implementation Plan (definitive, verified)

> **For agentic workers:** Execute with superpowers:subagent-driven-development. Produced by 17-agent workflow wf_88ead130-54c (readers -> design panel -> judges -> synthesis -> 3-lens adversarial verify incl. codebase-fit against the post-audit-fix tree) on 2026-07-20. User pre-approved: "approved, build it".

All facts verified against the working tree (journey.ts fix already shipped, swap-route duplicate confirmed at lines 70-73, `db:fetch-nutrition` on bare node, middleware redirect confirmed, `new Date(date)` live at journal route lines 22 and 44, `PatientCustomIngredient` has no fiber column, script rounds calories with `Math.round` and macros with r1).

# Wondish Calorie & Macro Tracking — Definitive Design Plan

All repo facts below were re-verified against the working tree at `/Users/becks/Desktop/NewView/wondish_02` (branch `clara-backend-fixes`) and `/Users/becks/Desktop/NewView/Clara` on 2026-07-20.

---

## Summary

**Base: the "robust" design** (winner, Judges 1 & 2), merged with every mustSteal item and with every judge-identified weakness fixed.

Core decisions and how disagreements were resolved:

1. **New `MealLog` model, not an overload of `JournalMeal`.** Verified: `POST /api/journal/log-meal` is a recipeId-keyed *rating toggle* (`app/api/journal/log-meal/route.ts:37-49` finds `meals.find(ml => ml.recipeId === recipeId && !ml.skipped)` and deletes on same-rating re-tap). Append-style intake logging (same recipe twice a day, recipeId-null ad-hoc rows) is structurally incompatible with that toggle — the "reuse" design's claim of backward compatibility was wrong. `JournalMeal` stays plan-completion/rating; `MealLog` is intake. An optional `journalMealId` provenance pointer (stolen from "contract") links the two without overloading either — it is a **plain nullable column, NOT unique** (a completion row may legitimately bridge to multiple intake rows, e.g. leftovers of the same planned dish eaten twice; a `@unique` here would re-impose the exact "one intake per planned dish" limit that made `JournalMeal` unusable and would throw raw P2002 500s on the second log).
2. **Per-serving snapshot + `servings` stored separately** (robust; Judge 3 mustSteal). Totals derived on read via one shared `scaleSnapshot`. Editing servings never corrupts base nutrition and never requires the client to resend macros. The stored per-serving snapshot is kept at **full float precision** (no rounding at store time); rounding (r1) is applied only at the display/response boundary by `scaleSnapshot`/DTO serialization — so logging all 3 servings of a 1000 kcal recipe sums back to 1000, not 999.9.
3. **`localDate` stored as a plain `"YYYY-MM-DD"` string** (robust over contract's `@db.Date`). Prisma hydrates `@db.Date` to a UTC-midnight `Date`, which any later local `getDate()` formatting turns into an off-by-one. A string is structurally immune. Lexical comparison is correct for ISO dates, so range queries work. `localDate` is **required on every write — 400 if missing, never server-defaulted** (a `new Date()` default on a UTC serverless host would reintroduce the exact T3 class of bug).
4. **Idempotency** via `clientRequestId` + `@@unique([patientId, clientRequestId])` upsert (robust; Judge 1's decisive point, Judge 3 mustSteal) — on the single write **and** on every item of the new **batch endpoint** (stolen from "contract": multi-item Picture plate in one `$transaction`). The upsert is pinned as **create-or-return-existing: `update: {}`** — a replayed create can never clobber a later edit. Edits and deletes are additionally **addressable by `clientRequestId`**, so offline-created rows can be corrected before their create ever syncs.
5. **Full extraction of ALL existing macro math** into `lib/macros.ts` (stolen from "reuse", demanded by Judges 1–3): `toGrams` + per-100g summation out of `scripts/fetch-nutrition.mjs` (verified at lines 89-95 / 249-281; the npm script is switched to run via tsx), `macroRatios`/`macroDeviation` out of **both** verified inline copies — `lib/meal-plan.ts:79-82` **and** the byte-identical duplicate at `app/api/meal-plan/[menuId]/swap/route.ts:70-73` — and re-export of `MealMacros` from `lib/caloric-engine.ts:792` rather than a duplicate type. A grep-based guard test keeps future copies from reappearing.
6. **Fix the one still-live date bug on the shared path.** `app/api/journal/route.ts` parses date-only strings with `new Date(date)` (UTC-midnight → previous local day in negative offsets) at **line 22 (GET)** and **line 44 (POST)** — both verified live. The other previously-cited bug pair in `lib/journey.ts` (fmt off-by-one + mealSourceBreakdown double-count, T3) was **already fixed on this branch** (commit 27f1fb6: `fmt` has an anchored `^\d{4}-\d{2}-\d{2}$` string passthrough at lines 48-54; `isSkipped`/`activeMeals` make the buckets mutually exclusive at lines 37-44; existing tests already pin the fixed behavior). This plan does **not** touch `lib/journey.ts`'s existing fmt/breakdown code or its test pins — the anchored guard stays exactly as-is.
7. **Signed `remaining` + `dayTotals` + `dayTarget` in every write/read response** (stolen from "contract") — one round-trip ring updates on web and iOS.
8. **`CUSTOM` source** for `PatientCustomIngredient` (verified model at `prisma/schema.prisma:300-311`; per-`unit` freeform macros, **no fiber column**), premium-gated via a shared `hasActivePremium` extracted from `app/(dashboard)/layout.tsx:11-14` into `lib/auth.ts`. The CUSTOM branch loads the subscription explicitly (the common patient lookup doesn't). Logging itself is free; **meal-log gates only CUSTOM** — any premium gating of Picture/Fridge features is enforced upstream in those future endpoints, never assumed here.
9. **Null/unpriced macros are never silently wrong** (stolen from "reuse"): summed as 0 but flagged `incomplete: true` on the row and day totals; `toGrams` returning null is logged, not swallowed. Stats additionally quarantine all-incomplete days so they cannot drag averages (§ Stats rewiring).
10. **Sync**: soft-delete tombstones (`deletedAt`) + `GET /api/meal-log?updatedSince=` delta read backed by `@@index([patientId, updatedAt])` (robust) so iOS reconciles offline creates/edits/deletes — with an explicit offline-queue coalescing rule for rows edited/deleted before their create ever synced (§ iOS).
11. **Daily target source is pinned**: when the day falls inside the patient's active meal plan, the tracking target is the **same ramped per-day budget the plan itself uses** (`gradualDailyCals` — the number `/api/meal-plan` GET already returns); the steady-state formula is only the fallback. One budget, no "eat 1650 but remaining says 2100" contradiction (§ Daily targets).
12. **iOS Bearer clients need one middleware change**: `middleware.ts` currently answers *any* unauthenticated `/api/*` request with a **307 redirect to `/login` (HTML)** — verified at `middleware.ts:27-30`, and `/api/meal-log*` is not in `isPublicRoute`. The route-level `401 {error:"Unauthorized"}` this plan documents would be dead code for the missing/expired-token path without fixing this. Step 1 adds a JSON-401 branch for `/api` paths (§ API endpoints, § iOS).

One source of truth: a logged meal stores a point-in-time per-serving snapshot; Stats only sums stored snapshots; targets come only from `lib/caloric-engine.ts` + `lib/meal-plan.ts`'s existing ramp; there is exactly one ingredient-summation algorithm, one per-serving boundary, one ratio/deviation function (with both existing inline copies removed), one premium check.

---

## Data model (exact Prisma diff)

Add to `prisma/schema.prisma` (Journal & Tracking section). No changes to `JournalEntry`, `JournalMeal`, or `Recipe` columns.

```prisma
enum MealLogSource {
  MANUAL   // typed/edited by hand (web or iOS)
  RECIPE   // logged from an existing Recipe row (incl. meal-plan dishes)
  PICTURE  // one-tap from a Picture Mode vision result
  FRIDGE   // "I cooked this" on a Fridge Mode generated recipe
  CUSTOM   // from a PatientCustomIngredient (premium)
}

model MealLog {
  id         String        @id @default(cuid())
  patientId  String
  patient    Patient       @relation(fields: [patientId], references: [id], onDelete: Cascade)

  // Client-supplied LOCAL calendar date, "YYYY-MM-DD". Aggregation key.
  // Stored as a string on purpose: no Date hydration, no UTC math, immune to T3.
  // REQUIRED on every write; the server never defaults it.
  localDate  String
  mealType   String        // "breakfast" | "lunch" | "dinner" | "snack"
  source     MealLogSource @default(MANUAL)
  name       String        // display label snapshot, always present

  // PER-SERVING snapshot captured at log time. Never recomputed from Recipe.
  // Stored UNROUNDED (full float precision); r1 rounding happens only at the
  // response/display boundary, so servings × per-serving always re-sums exactly.
  servings   Float         @default(1)
  calories   Float?
  protein    Float?
  carbs      Float?
  fat        Float?
  fiber      Float?
  incomplete Boolean       @default(false) // true when any macro was unpriceable (null→0)

  // Provenance only — NEVER read for macro math.
  recipeId           String?
  recipe             Recipe?  @relation(fields: [recipeId], references: [id], onDelete: SetNull)
  customIngredientId String?
  journalMealId      String?          // best-effort provenance pointer to a plan-completion
                                      // JournalMeal row. Plain nullable column, deliberately
                                      // NOT unique: the same planned dish eaten twice yields
                                      // two intake rows pointing at one completion row.
  pictureResultId    String?          // opaque id echoed by Picture Mode
  fridgeRecipeId     String?          // opaque id of the generated Fridge recipe

  note       String?
  clientRequestId String?             // idempotency key for one-tap / offline replay;
                                      // ALSO an alternate address for PATCH/DELETE (see routes)
  deletedAt  DateTime?                // soft delete → tombstone for cross-device sync
  loggedAt   DateTime      @default(now())  // ordering within a day
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt

  @@unique([patientId, clientRequestId])  // Postgres treats NULLs as distinct → manual logs unaffected
  @@index([patientId, localDate])         // hot day/range aggregation
  @@index([patientId, updatedAt])         // delta sync for iOS
}
```

Back-relations: add `mealLogs MealLog[]` to `Patient` and `mealLogs MealLog[]` to `Recipe`.

**Migration note:** purely additive — one enum, one table, two back-relations. Zero backfill, zero risk to existing rows, no interaction with the still-pending production meal-plan backfill (tasks/todo.md:23). `npm run db:migrate -- --name add_meal_log_tracking`, then `npm run db:generate`.

---

## Shared macro module — `lib/macros.ts` (new)

The single home for all **intake** macro arithmetic. Target math stays in `lib/caloric-engine.ts` (engine = should eat; macros = did eat), re-exported here for a single import surface.

```ts
// lib/macros.ts
import type { MealMacros, MacroPercentages } from "@/lib/caloric-engine";
export type { MealMacros } from "@/lib/caloric-engine";              // re-export, no duplicate type
export { computeDailyMacros, resolveMacroProfile, getMacroPercentages,
         KCAL_PER_KG } from "@/lib/caloric-engine";

export interface MacroSnapshot {          // per-serving OR totals — same shape
  calories: number; protein: number; carbs: number; fat: number; fiber: number;
  incomplete: boolean;                     // any contributing value was null/unpriceable
}
export const ZERO_SNAPSHOT: MacroSnapshot =
  { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: false };

export const r1 = (n: number) => Math.round(n * 10) / 10;
// ROUNDING POLICY: internal snapshots and sums stay UNROUNDED floats end-to-end.
// r1 (and integer Math.round for the script's calories — see below) is applied
// only by callers at a display/persistence boundary, exactly once. Never round
// then rescale.

// ── Extracted from scripts/fetch-nutrition.mjs (lines 89-95, 249-281).
// The script imports these back; Picture/Fridge server code prices ad-hoc
// ingredients with the same single algorithm.
export const UNIT_TO_GRAMS: Record<string, number>;                  // moved table
export function toGrams(qty: number | null, unit: string | null): number | null;
// Unknown unit → null AND onUnknownUnit callback (default console.warn) — never silent.
// Returns RAW (unrounded) sums. The script applies ITS OWN existing rounding at
// the call site (Math.round on calories, r1 on protein/carbs/fat) so its DB
// output is byte-identical pre/post extraction; the script also ignores the
// returned fiber field (its loop never summed fiber — that gap is preserved,
// not silently "fixed", and noted in the extraction task).
export function sumIngredientMacros(
  items: { ingredient: { calories?: number | null; protein?: number | null;
                         carbs?: number | null; fat?: number | null;
                         fiber?: number | null };
           quantity?: number | null; unit?: string | null }[],
  onUnknownUnit?: (unit: string | null) => void
): MacroSnapshot;                                                    // sets incomplete when items dropped

// ── Extracted from BOTH verified inline copies of the deviation math:
// lib/meal-plan.ts:79-82 AND app/api/meal-plan/[menuId]/swap/route.ts:70-73
// (byte-identical (protein*4)/cal + (carbs*4)/cal + (fat*9)/cal blocks).
// Both call sites import these back; each keeps its own threshold/weight
// (swap: deviation > 0.50 → 400; meal-plan scoring: score -= deviation * 40).
export function macroRatios(m: { calories: number; protein?: number | null;
  carbs?: number | null; fat?: number | null }):
  { protein: number; carbs: number; fat: number };
export function macroDeviation(m: Parameters<typeof macroRatios>[0], target: MacroPercentages): number;

// ── The ONE place the whole-dish → per-serving boundary is crossed.
// Recipe.calories is a WHOLE-DISH total (verified: meal-plan.ts and DishCard use
// it undivided); divide by Recipe.servings (null/0 → treated as 1).
// Result is UNROUNDED — stored as-is so N-servings totals re-sum exactly.
export function recipeToPerServing(recipe: { calories?: number | null; protein?: number | null;
  carbs?: number | null; fat?: number | null; fiber?: number | null;
  servings?: number | null }): MacroSnapshot;

// Caller-supplied per-serving numbers (PICTURE / MANUAL / FRIDGE-generated).
export function snapshotFromMacros(perServing: Partial<Omit<MacroSnapshot, "incomplete">>): MacroSnapshot;

// PatientCustomIngredient macros are per its freeform `unit`. This maps the ci
// fields 1:1 into a per-UNIT snapshot — NO multiplier parameter. The MealLog
// `servings` column is the sole multiplier, applied exactly once at read time by
// scaleSnapshot ("servings" for CUSTOM rows means "quantity in the ingredient's
// unit"; the UI labels it with ci.unit). This kills the double-scaling path where
// quantity baked into the snapshot AND servings at read → 4x totals.
// PatientCustomIngredient has NO fiber column (verified schema:300-311): fiber
// defaults to 0 WITHOUT setting incomplete — incomplete is only for values the
// model could have had but were null/unpriceable.
export function snapshotFromCustomIngredient(ci: { calories?: number | null;
  protein?: number | null; carbs?: number | null; fat?: number | null }): MacroSnapshot;

// per-serving snapshot × servings → totals, r1-rounded AT THIS BOUNDARY ONLY.
// Fractional servings exact (input snapshot is unrounded).
export function scaleSnapshot(snap: MacroSnapshot, servings: number): MacroSnapshot;

// Aggregate rows → day/window totals. Excludes deletedAt != null. Empty → ZERO_SNAPSHOT.
export function sumMealLogs(rows: { calories?: number | null; protein?: number | null;
  carbs?: number | null; fat?: number | null; fiber?: number | null;
  servings: number; incomplete?: boolean; deletedAt?: Date | string | null }[]): MacroSnapshot;
```

Script wiring: `scripts/fetch-nutrition.mjs` switches its local `UNIT_TO_GRAMS`/`toGrams`/summation loop to `import { toGrams, sumIngredientMacros } from "../lib/macros.ts"`, **keeps its own rounding at the call site** (`Math.round(cal)`, r1 on the rest — its verified current output shape), and ignores fiber. **`package.json:18` is edited in the same step**: `"db:fetch-nutrition": "node --import tsx scripts/fetch-nutrition.mjs"` (matching the test harness at `package.json:11`; bare `node` cannot import the `.ts` module or its `@/lib/caloric-engine` path alias). Golden-fixture test asserts parity against the script's **post-rounding** output, not raw `sumIngredientMacros` (§ Test plan).

**Single-source guard:** before declaring extraction done, grep `app/` + `lib/` + `scripts/` for `* 9) / cal` and `* 4) / cal` (and `UNIT_TO_GRAMS`) — zero hits outside `lib/macros.ts`. A small test (`lib/macros.test.ts`) does this grep programmatically so a future inline copy fails CI.

No float-equality comparisons anywhere in this module (audit T4); all threshold checks are ratio/`>=` based.

---

## API endpoints (exact contracts)

**Middleware prerequisite (step 1, before any route ships):** `middleware.ts:27-30` currently answers every unauthenticated non-public request — including all `/api/*` — with `NextResponse.redirect(loginUrl)` (307 → HTML login page). For a native client with a missing/expired Bearer token this masquerades as success (URLSession follows redirects by default). Add an explicit branch:

```ts
if (!isPublicRoute(req) && !userId) {
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}
```

This changes behavior for *all* authenticated API routes' failure path (browser clients never hit it — they hold session cookies; XHR callers get a proper 401 instead of an opaque redirect). Success path needs nothing: clerkMiddleware v7's `authenticateRequest` already resolves `Authorization: Bearer <session JWT>` to the same `userId`/`Account.clerkId`. Covered by extending `middleware.test.ts`. **This is new server surface required by iOS** — the "steps 3/4/6 add no new server surface" claim is scoped accordingly (see Build order).

Common to all routes: `auth()` → 401 `{error:"Unauthorized"}` if no `userId` (now reachable defense-in-depth behind the middleware 401); `prisma.patient.findFirst({ where: { account: { clerkId: userId } } })` → 404 `{error:"Profile not found"}` (identical to `app/api/journal/log-meal/route.ts:10-15`). The CUSTOM branch needs subscription data the common lookup doesn't load — it queries `include: { account: { include: { subscription: true } } }` (or reuses a `lib/auth.ts` `getAccountWithSubscription`) and passes `account.subscription` to the shared `hasActivePremium`. Writes: `rateLimit("meal-log", userId, 60, 60)`; reads: `rateLimit("meal-log-read", userId, 120, 60)` (existing `lib/rate-limit.ts` Upstash pattern). Routes are thin; all logic lives in `lib/meal-log.ts` (validation + snapshot resolution) and `lib/macros.ts`.

**Shared validation (`parseMealLogInput` in `lib/meal-log.ts`, pure & unit-tested):**
- `localDate` **required** and matches anchored `^\d{4}-\d{2}-\d{2}$` (audit T1 lesson) → else 400. **Never server-defaulted** — a missing date is a client bug, and defaulting via `new Date()` on a UTC host is the T3 bug reborn.
- `mealType ∈ {"breakfast","lunch","dinner","snack"}` (exact allow-list) → else 400.
- `source ∈ MealLogSource` allow-list → else 400.
- `servings` finite, `> 0`, `≤ 50` → else 400.
- Each per-serving macro finite, `≥ 0`, `≤ 10000` → else 400.
- `name` trimmed, non-empty, `≤ 120` chars → else 400.
- Batch: `1–50` items (audit C5 bounded input) → else 400.
- Range GET: window `≤ 366` days → else 400.

`lib/meal-log.ts` also exports **`formatLocalDate(d: Date): string`** — local getters (`getFullYear`/`getMonth`/`getDate`), zero-padded. Every web write path derives `localDate` from this helper on the **browser's** clock; it is the string-for-string twin of iOS's `DateFormatter "yyyy-MM-dd"` in the device's current calendar.

**Shared response fragment** (returned by every write and the day GET):

```jsonc
"dayTotals": { "calories": 1740, "protein": 108, "carbs": 190, "fat": 55, "fiber": 22, "incomplete": false },
"dayTarget": { "calories": 2100, "protein": 158, "carbs": 236, "fat": 47,
               "profile": "balanced", "basis": "plan-ramp" /* or "steady-state" */ } /* or null */,
"remaining": { "calories": 360, "protein": 50, "carbs": 46, "fat": -8 } /* signed; null when dayTarget null */
```

### `POST /api/meal-log` — universal write (`app/api/meal-log/route.ts`)

One contract for all four consumers; `source` discriminates how the per-serving snapshot is produced; every branch converges on the same stored shape.

```jsonc
// A) RECIPE — server prices: recipeToPerServing(recipe) (client macros ignored: trust boundary)
{ "localDate": "2026-07-19", "mealType": "dinner", "source": "RECIPE",
  "recipeId": "ckrec123", "servings": 1.5,
  "journalMealId": "cjm_9",              // optional provenance pointer to the plan-completion row
  "clientRequestId": "b3f0…-uuid" }

// B) MANUAL / PICTURE / FRIDGE(generated) — caller supplies per-serving macros
{ "localDate": "2026-07-19", "mealType": "lunch", "source": "PICTURE",
  "name": "Grilled chicken salad", "servings": 1,
  "perServing": { "calories": 420, "protein": 38, "carbs": 12, "fat": 24, "fiber": 5 },
  "pictureResultId": "pic_abc",          // FRIDGE sends "fridgeRecipeId" instead
  "clientRequestId": "pic_abc-item-0" }

// C) CUSTOM (premium; 402 {error:"Premium required"} if !hasActivePremium)
// perServing stored = snapshotFromCustomIngredient(ci) — the PER-UNIT macros,
// untouched. `servings` here means "how many of ci.unit" and is the ONLY
// multiplier, applied once at read via scaleSnapshot. Fiber = 0, not incomplete.
{ "localDate": "2026-07-19", "mealType": "snack", "source": "CUSTOM",
  "customIngredientId": "cci_9", "servings": 2, "clientRequestId": "…" }
```

**Premium scope:** this route gates **only** `source: "CUSTOM"`. `PICTURE`/`FRIDGE` rows are accepted from any authenticated user — they are just client-supplied macros, indistinguishable from `MANUAL` at the trust boundary. If Picture/Fridge *features* are ever premium, that gate lives in the future vision/fridge endpoints (where the expensive inference happens), not here; nothing in this contract assumes meal-log protects them.

Server: resolves the per-serving snapshot via the matching `lib/macros.ts` function; `name` defaults to `recipe.name` / custom-ingredient name when omitted for A/C. **Idempotency:** when `clientRequestId` is present →

```ts
prisma.mealLog.upsert({
  where: { patientId_clientRequestId: { patientId, clientRequestId } },
  create: { /* full resolved row */ },
  update: {},          // PINNED: create-or-return-existing. NEVER re-write the
                       // create payload on conflict — a replayed offline create
                       // must not clobber a PATCH edit that landed first.
})
```

(Prisma's empty `update: {}` still bumps `@updatedAt`; that's benign — the row re-surfaces in delta sync with unchanged content.) Absent `clientRequestId` → plain create (201). Replay returns 200 with the row **as it currently exists** (possibly edited — by design).

**`journalMealId` semantics:** best-effort provenance, no uniqueness. The client sends it when it happens to know today's completion row for this recipe (it often won't exist yet on a fresh plan day — then it's simply null). Logging the same planned dish twice creates two rows; both may carry the same `journalMealId` or the second may omit it — either is valid, nothing throws.

Response `201` (or `200` on replay):

```jsonc
{ "log": { "id": "clog_01", "localDate": "2026-07-19", "mealType": "dinner", "source": "RECIPE",
           "name": "Salmon Teriyaki Bowl", "servings": 1.5, "clientRequestId": "b3f0…-uuid",
           "perServing": { "calories": 460, "protein": 34, "carbs": 44, "fat": 14, "fiber": 4, "incomplete": false },
           "totals":     { "calories": 690, "protein": 51, "carbs": 66, "fat": 21, "fiber": 6, "incomplete": false },
           "recipeId": "ckrec123", "journalMealId": "cjm_9",
           "loggedAt": "2026-07-19T18:22:04.000Z", "updatedAt": "2026-07-19T18:22:04.000Z" },
  "dayTotals": { … }, "dayTarget": { … }, "remaining": { … } }
```

(`clientRequestId` is echoed in every `MealLogDTO` so offline clients can map server rows back to queued local rows.)

### `POST /api/meal-log/batch` — multi-item one-tap (Picture plate) (`app/api/meal-log/batch/route.ts`)

```jsonc
{ "localDate": "2026-07-19", "mealType": "lunch",
  "items": [ { "name": "Grilled chicken", "source": "PICTURE", "servings": 1,
               "perServing": { "calories": 320, "protein": 42, "carbs": 2, "fat": 15, "fiber": 0 },
               "pictureResultId": "pic_abc", "clientRequestId": "pic_abc-0" },
             { "name": "Rice", … "clientRequestId": "pic_abc-1" },
             { "name": "Side salad", … "clientRequestId": "pic_abc-2" } ] }
```

All items validated up front; inserted in one `prisma.$transaction` of per-item upserts (each item carries its own `clientRequestId` and the same `update: {}` no-op semantics, so a retried batch is fully replay-safe and never clobbers interleaved edits — merges robust's idempotency into contract's batch, closing contract's E10 gap). Response `{ logs: [...], dayTotals, dayTarget, remaining }`.

### `GET /api/meal-log?date=YYYY-MM-DD` — one day for the log UI

`where: { patientId, localDate: date, deletedAt: null }`, ordered by `loggedAt`. Response:

```jsonc
{ "date": "2026-07-19",
  "logs": [ /* MealLogDTO, per-serving + totals as above */ ],
  "byMealType": { "breakfast": [...], "lunch": [...], "dinner": [...], "snack": [...] },
  "dayTotals": { … }, "dayTarget": { … } /* null on incomplete caloric profile — never a 422 */,
  "remaining": { … } }
```

Empty day → `logs: []`, zeroed `dayTotals`, `dayTarget` still present.

### `GET /api/meal-log?from=YYYY-MM-DD&to=YYYY-MM-DD` — range for Stats

Groups purely by the `localDate` string (lexical `gte/lte` on ISO strings is correct). Response `{ "days": [ { "localDate": "2026-07-18", "totals": {…} }, … ], "target": {…}|null }`. Days with no rows are **absent** (UI renders "no data", never a fake 0).

### `GET /api/meal-log?updatedSince=<ISO-8601>` — delta sync (iOS)

`where: { patientId, updatedAt: { gt: updatedSince } }` **including** `deletedAt != null` tombstones, ordered by `updatedAt`, capped at 500 rows + `nextCursor`. Every row echoes its `clientRequestId`. Devices reconcile creates/edits/deletes; offline-queued taps replay through `clientRequestId`.

### `PATCH /api/meal-log/[idOrClientRequestId]` (`app/api/meal-log/[id]/route.ts`)

**Addressing:** the path segment may be either the server `id` (cuid) **or** a `clientRequestId`. Resolution is ownership-scoped and unambiguous:

```ts
const row = await prisma.mealLog.findFirst({
  where: { patientId, OR: [{ id: param }, { clientRequestId: param }] },
});
```

(`clientRequestId` is unique per patient; a collision between one patient's cuid and their own clientRequestId is not a real case, and the ownership scope means no cross-patient ambiguity.) This is what lets a device correct a row it created offline the instant the create has synced, **without knowing the server id yet** — and it makes the edit path itself replay-safe when combined with client-side coalescing (§ iOS offline queue).

Body: any of `servings`, `mealType`, `name`, `perServing`, `localDate`, `deletedAt: null` (undo). 404 if not owned or tombstoned (except the undo case). `servings` edits rescale server-side from the stored unrounded per-serving snapshot — no client macro resend. Response: same `{ log, dayTotals, dayTarget, remaining }` shape (for the row's `localDate`).

### `DELETE /api/meal-log/[idOrClientRequestId]`

Same dual addressing as PATCH. Soft delete: sets `deletedAt = now()`. Idempotent (already-deleted → 200; **unknown clientRequestId → 404**, which the offline queue treats as "create never synced — drop the queued create instead", § iOS). Response `{ ok: true, dayTotals, dayTarget, remaining }`. Undo = `PATCH { deletedAt: null }` within the Toast window.

### Existing `POST /api/journal/log-meal` — explicitly unchanged

This route stays exactly what it is: the plan-completion **rating toggle** (verified semantics: same-rating re-tap deletes the row). It is *not* an intake logger and must not be generalized — its `find(ml => ml.recipeId === recipeId)` toggle would collapse repeated intake rows. The two paths are documented in the route header comments: **completion/rating → `/api/journal/log-meal`; intake → `/api/meal-log`**. When the web UI logs a plan dish for intake and a completion row already exists, it passes that row's id as `journalMealId` (provenance only); the rating buttons keep calling the old route.

### Changed `GET /api/journey` — extended, additive (see Stats rewiring)

---

## Daily targets derivation (reuse only — zero new formulas)

**Which number is "the" daily target?** Two per-day calorie numbers exist today and they legitimately differ during a ramp:

- **Steady-state**: `tdeeCBW + weeklyDeltaKg × KCAL_PER_KG/7` — the inline math verified at `components/dashboard/CaloricProfileCard.tsx:79-81` (the ring's long-run goal).
- **Plan ramp**: `gradualDailyCals(baseTDEE, dayIndex, direction, minCal, maxDeficit)` (verified: `lib/meal-plan.ts:253,325`) — the per-day budget the user's active meal plan is actually built to and that `/api/meal-plan` GET returns.

**Decision: the tracking target for a given `localDate` is the plan-ramp number whenever an active plan covers that day; steady-state is the fallback.** Rationale: `remaining` answers "how much more can I eat *today*", and today's plan was generated to the ramped budget — computing remaining against the steady-state figure would tell a week-1 user they have 400 kcal "remaining" that their own plan deliberately didn't give them. The `dayTarget.basis` field (`"plan-ramp" | "steady-state"`) makes the source explicit to both UIs; `CaloricProfileCard` continues to show the steady-state goal (labeled as the long-run target), and during a ramp the two numbers *will* differ on screen — that is correct and now legible, not a silent contradiction.

1. **Extract** the CaloricProfileCard inline math into `lib/caloric-engine.ts`:

```ts
export function resolveDailyCalorieTarget(profile: {
  tdeeCBW: number; weeklyTarget?: { weeklyDeltaKg?: number } | null;
}): number {
  const dailyAdjustment = (profile.weeklyTarget?.weeklyDeltaKg ?? 0) * (KCAL_PER_KG / 7); // signed
  return Math.max(0, Math.round(profile.tdeeCBW + dailyAdjustment));
}
```

`CaloricProfileCard` is refactored to call it (behavior identical, inline copy deleted).

2. **Extract the plan-day lookup** into `lib/meal-plan.ts`: `getPlanDayCalories(patientId, localDate): Promise<number | null>` — finds the patient's active menu/plan covering `localDate`, derives `dayIndex` from the plan start, and returns exactly what the existing `/api/meal-plan` GET path computes via `gradualDailyCals` (the route is refactored to call this same helper — one ramp computation, two consumers, no drift). Returns `null` when no plan covers the day.

3. **Macro targets** — wire the already-existing, verified functions (`lib/caloric-engine.ts:826-879`):

```ts
export function resolveDailyTargets(
  profile: Parameters<typeof resolveDailyCalorieTarget>[0],
  healthConditionNames: string[], motivationNames: string[],
  planDayCalories?: number | null            // from getPlanDayCalories; wins when present
): { calories: number; protein: number; carbs: number; fat: number;
    profile: MacroProfile; basis: "plan-ramp" | "steady-state" } | null {
  const calories = planDayCalories ?? resolveDailyCalorieTarget(profile);
  if (calories <= 0) return null;                       // guard (audit T5 class)
  const mp = resolveMacroProfile(healthConditionNames, motivationNames);
  const d  = computeDailyMacros(calories, mp);           // MACRO_PROFILES splits, r1 grams
  return { calories, protein: d.totalProteinG, carbs: d.totalCarbsG, fat: d.totalFatG,
           profile: mp, basis: planDayCalories != null ? "plan-ramp" : "steady-state" };
}
```

The "no macro targets exist anywhere" gap closes purely by calling `computeDailyMacros` — nothing new invented. Incomplete caloric profile (the `/api/patient/caloric-profile` 422 path) → routes return `dayTarget: null`, logging still works.

---

## Web logging UI (existing design system only)

Per the global CLAUDE.md rule, the implementer invokes `ui-ux-pro-max:ui-ux-pro-max` before writing any of this frontend code; this section specifies structure/contracts.

- **`localDate` on every write** comes from the shared `formatLocalDate(new Date())` (`lib/meal-log.ts`, local getters on the **browser's** clock) — never `toISOString().slice(0,10)` (UTC — the T3 bug), never omitted (the server 400s on a missing `localDate`; it is not defaulted server-side).
- **`components/tracking/DailyLogCard.tsx`** — mounted on `/overview` (bento grid, `app/(dashboard)/overview/page.tsx`) and on `/journey`. White card, `#EAE4CA` border, cream `#F9F7ED` context, crimson `#812549` accents. Four `mealType` sections of `MealLogRow`s: name, source `Badge` (`components/ui/Badge`), `servings ×` (labeled with the custom ingredient's `unit` for CUSTOM rows), kcal/P/C/F from `log.totals`, an "incomplete" `Badge` when `totals.incomplete`, edit + delete affordances.
- **Add/edit `Modal`** (`components/ui/Modal` + `components/ui/Input`): name, servings stepper (0.25 steps), per-serving kcal/P/C/F, mealType pill group reusing `QuickJournalLog`'s option-pill styling. Submits `POST /api/meal-log` / `PATCH /api/meal-log/[id]` with a fresh `clientRequestId` (uuid).
- **`components/tracking/AddToLogButton.tsx`** — the universal one-tap component: given a prepared payload, POSTs, fires `components/ui/Toast`, updates the ring from the returned `dayTotals`. Dropped into `components/DishCard.tsx` (source `RECIPE`, servings stepper, `recipeId`, plus `journalMealId` when today's completion row exists) and later into Picture/Fridge result cards — zero bespoke logging code per feature.
- **Delete** → soft delete + Toast with **Undo** (`PATCH { deletedAt: null }`).
- **`CaloricProfileCard`** ring gains an *actual* arc: today's `dayTotals.calories` over the target arc. The card's own goal figure stays the steady-state `resolveDailyCalorieTarget`; the arc's denominator is the response's `dayTarget` (plan-ramp when active), with a small "ramp" label when `basis === "plan-ramp"` differs from the steady-state goal. Over-budget renders from the signed `remaining` (negative → error red), no client math.

No new colors, no new primitives.

---

## Stats rewiring

**`lib/journey.ts`:**
- **No changes to the existing `computeJourneyStats`/`fmt`/`mealSourceBreakdown` code.** The formerly-planned T3 fixes already shipped in commit 27f1fb6 (verified on branch: anchored `^\d{4}-\d{2}-\d{2}$` string passthrough in `fmt` at lines 48-54; mutually exclusive `isSkipped`/`activeMeals` buckets at lines 37-44) and the existing tests already pin the fixed behavior. In particular, the anchored regex guard in `fmt` **stays** — it is not replaced with an unguarded `slice(0,10)`.
- New pure sibling function (does not disturb `computeJourneyStats`'s signature):

```ts
export interface MacroDay { date: string; calories: number; protein: number; carbs: number; fat: number; incomplete: boolean; }
export interface MacroStats {
  dailyMacros: MacroDay[];                             // every logged day, incl. incomplete ones (flagged)
  avgCalories: number; avgProtein: number; avgCarbs: number; avgFat: number;
  daysLogged: number;                                  // days with ≥1 non-tombstoned row
  daysComplete: number;                                // daysLogged minus all-incomplete days — the averages' denominator
  daysIncomplete: number;                              // days where EVERY row was incomplete (quarantined)
  daysOnTarget: number;                                // |calories/target − 1| ≤ 0.10 over COMPLETE days only — ratio, never float-eq
  target: { calories: number; protein: number; carbs: number; fat: number } | null;
}
export function computeMacroStats(
  logs: { localDate: string; servings: number; calories?: number|null; protein?: number|null;
          carbs?: number|null; fat?: number|null; incomplete?: boolean; deletedAt?: Date|null }[],
  target: MacroStats["target"]
): MacroStats
```

Groups by the `localDate` string (no Date math → no off-by-one), scales via `scaleSnapshot`, sums via `sumMealLogs`, and **quarantines all-incomplete days**: a day whose every row is `incomplete` (macros summed as 0 because nothing was priceable) still appears in `dailyMacros` with `incomplete: true`, but is **excluded from `avgCalories`/`avgProtein`/`avgCarbs`/`avgFat` and from `daysOnTarget`** — otherwise a fully-unpriceable day reads as a 0-kcal day and drags the mean while looking "wildly under target". Averages divide by `Math.max(1, daysComplete)`; `daysIncomplete` is surfaced so the UI can say "3 days couldn't be counted". Days with *some* complete rows count normally (their incomplete rows still contribute their known-0 values, flagged on the day).

**`app/api/journey/route.ts`:** add a second query `prisma.mealLog.findMany({ where: { patientId, localDate: { gte: from, lte: to }, deletedAt: null } })` (hits `@@index([patientId, localDate])`, no Recipe join), compute `resolveDailyTargets` (with `getPlanDayCalories` for today's basis where relevant), return **`{ stats, macroStats, entries }`** — additive, existing consumers unbroken.

**Kill the page/route duplication** (readers' warning): extract `lib/journey-data.ts → getJourneyPayload(patientId, from, to)` containing the JournalEntry fetch + MealLog fetch + both computations; `app/api/journey/route.ts` and `app/(dashboard)/journey/page.tsx` both call it.

**Fix the one still-live date bug while on this path:** `app/api/journal/route.ts` — replace `new Date(date)` / `new Date(dateParam)` (UTC-midnight parse of date-only strings → previous day in negative offsets) at **both** verified sites — line 22 (GET's `dateParam`) and line 44 (POST) — with the explicit local parse already used at `app/api/journal/log-meal/route.ts:20-22` (`const [y,m,d] = date.split("-").map(Number); new Date(y, m-1, d)`).

**Components:**
- `StatCard` (`components/journey/StatCard.tsx`) reused as-is: "Avg Calories", "Avg Protein g", "Days On Target" (+ `daysComplete`/`daysIncomplete` subtitle).
- New `components/journey/CalorieTrendLine.tsx` — cloned from `MoodTrendLine`'s recharts LineChart scaffold; kcal Y-domain `[0, ceil(target×1.3)]`, `<ReferenceLine y={target.calories}>` (new component, not prop-twisting the mood one, per readers).
- New `components/journey/MacroSplitDonut.tsx` — cloned from `MealSourceDonut`'s PieChart pattern; three slices protein/carbs/fat in `#812549` / `#B75E78` / `#FDC221`.
- `JourneyDashboard` date-range fetch/setState pattern reused unchanged; macro tiles + two chart cards appended.

---

## Picture Mode integration contract (future feature — the exact call)

The vision endpoint (when built) **must return structured JSON, not a text stream** (the dish-checker `text/plain` ACCEPTED/REJECTED prose is explicitly not the pattern here):

```jsonc
{ "pictureResultId": "pic_abc", "verdict": "fits",         // fits | caution | doesntFit (maps to Clara's Verdict enum)
  "items": [ { "name": "Grilled chicken", "servings": 1,
               "perServing": { "calories": 320, "protein": 42, "carbs": 2, "fat": 15, "fiber": 0 },
               "confidence": 0.78 }, … ] }
```

"Add to today's log" tap makes exactly this call:

```
POST /api/meal-log/batch
{ "localDate": "<device-local YYYY-MM-DD>", "mealType": "<user pick>",
  "items": items.map((it, i) => ({ ...it, source: "PICTURE",
    "pictureResultId": "pic_abc", "clientRequestId": "pic_abc-" + i })) }
```

Atomic (`$transaction`), replay-safe (per-item `clientRequestId` derived from the verdict card id — re-tapping never double-logs and never clobbers post-log edits, thanks to `update: {}`), one round-trip ring update from the returned `dayTotals`/`remaining`. Single-item photos may use plain `POST /api/meal-log` (source B) identically. If Picture Mode itself becomes premium, the gate lives in the vision endpoint (before inference), not in meal-log.

## Fridge Mode integration contract (future)

A generated recipe carries ingredient lines + servings. Its macros are priced by the **shared** `sumIngredientMacros`/`toGrams` (server-side, same single algorithm as `fetch-nutrition.mjs`). "I cooked this, N servings eaten":

```
POST /api/meal-log
{ "localDate": "…", "mealType": "dinner", "source": "FRIDGE",
  "name": "Veggie Stir-Fry", "servings": 2,
  "perServing": { "calories": 410, "protein": 18, "carbs": 52, "fat": 14, "fiber": 8 },
  "fridgeRecipeId": "frg_77", "clientRequestId": "frg_77-cook-1" }
```

If the generated recipe is later persisted as a `Recipe` row, pass `recipeId` too — provenance only; the snapshot never changes when the recipe is edited. A Fridge-logged meal and a Picture-logged meal are indistinguishable to Stats except by `source`. Same premium note as Picture Mode: any gating happens in the Fridge endpoints, not here.

---

## iOS integration path (Clara — networking built from zero)

Verified: Clara has no URLSession, no Clerk, no Keychain, no dependency manager. Tracking deliberately needs only plain JSON (never the dish-checker text stream), so the stack is minimal:

1. **Phase 2:** add Clerk iOS SDK via SPM (first dependency — introduce the package in `project.yml`/XcodeGen). **Token model, precisely:** Clerk session JWTs are short-lived (~60 s). The Keychain (`ClaraKeychain`) stores the Clerk **client/session credentials** the SDK needs to restore its session — **never the bearer JWT itself**. A cached JWT would be expired for essentially every offline replay and most foreground requests.
2. **`WondishAPIClient`** (new, `Clara/Networking/`): thin URLSession wrapper that calls the Clerk SDK's `session.getToken()` **immediately before every request** (the SDK refreshes transparently) and sends `Authorization: Bearer <fresh token>`; server `auth()` resolves it to the same `Account.clerkId`. Base URL from build config. A `401 {error:"Unauthorized"}` JSON response (guaranteed by the step-1 middleware change — previously this path returned a 307→HTML login page that URLSession would silently follow) triggers one token re-mint + retry, then surfaces an auth error; the client never treats a redirect as success.
3. **Codable DTOs** mirroring the contracts byte-for-byte: `MealLogDTO` (including `clientRequestId`), `MacroSnapshotDTO`, `DayTargetDTO` (with `basis`), `MealLogCreateRequest` (`clientRequestId: UUID().uuidString`, `localDate` from `DateFormatter` `"yyyy-MM-dd"` in the device's **current local calendar** — string-for-string agreement with the server's grouping and the web's `formatLocalDate`), `DailyLogResponse`, `MacroStatsDTO`.
4. **Offline queue — full lifecycle, including edit/delete of not-yet-synced rows.** Local rows are keyed by `clientRequestId` from birth; the server id is learned later (from the create response or from delta sync, both of which echo `clientRequestId`). Rules:
   - **Create offline** → queue `create(clientRequestId, payload)`; row renders locally immediately.
   - **Edit a row whose create is still queued** → **coalesce**: mutate the queued create's payload in place. Nothing extra is sent; the eventual create carries the corrected values. (This is why the very common "log offline, fix the servings a minute later, reconnect" flow loses nothing.)
   - **Delete a row whose create is still queued** → **cancel**: remove the queued create entirely. Nothing is ever sent.
   - **Edit/delete a row whose create has already been sent (or that came from the server)** → queue `PATCH`/`DELETE` addressed by **server id if known, else `clientRequestId`** — the routes accept either (§ PATCH/DELETE). A `DELETE` by `clientRequestId` that 404s means the create was cancelled/never synced → drop the op.
   - **Flush order per row:** create → patches (in order) → delete. Because the create upsert is `update: {}`, a duplicate create replay after a landed patch is a no-op — the edit survives by construction.
   - Queue drain re-mints the bearer token **per attempt** (step 2), since a drain can outlive many 60 s token lifetimes.
   - Periodic `GET /api/meal-log?updatedSince=<lastSync>` applies creates/edits/tombstones from other devices; rows are matched to local state by server id, falling back to `clientRequestId`.
5. **Phase 6 Stats tab:** `StatsViewModel` → `GET /api/journey` (`macroStats`) + `GET /api/meal-log?date=`; renders with `wCard`, `WBadge` (note: `.info` is a teal alias of `.success` — use `.primary`/`.warning`/`.error` for distinguishable macro states), Swift Charts trend + donut in `WColor` tokens; ring uses `WColor.primary`. Replaces `StatsPlaceholderView`.
6. **Phase 3/4:** Scan and Fridge result screens call one shared `AddToLogService.log(_:)` → `POST /api/meal-log` / `/batch`. `VerdictBadge` renders the Picture verdict.

Sync across web and iOS is satisfied by: same DB, same routes, idempotent no-op-on-conflict writes, dual-addressed edits/deletes with client-side coalescing for unsynced rows, tombstoned deletes, delta reads — plus the middleware JSON-401 so auth failure is machine-distinguishable from success.

---

## Edge-case handling (each constraint explicitly)

- **Edit logged meal:** `PATCH /api/meal-log/[idOrClientRequestId]`, ownership-scoped, re-validated; `servings` edits rescale server-side from the immutable **unrounded** per-serving snapshot; `updatedAt` bump feeds delta sync.
- **Edit/delete before first sync (offline):** coalesced client-side into the queued create (edit) or cancelled outright (delete); after the create lands, ops address the row by `clientRequestId` until the server id is known. No lost updates: replayed creates are `update: {}` no-ops.
- **Delete logged meal:** soft delete (`deletedAt`), excluded from every read/aggregate, tombstoned for sync, undoable via Toast → `PATCH { deletedAt: null }`. `Recipe` deletion is `onDelete: SetNull` — history survives.
- **Partial servings:** `servings Float`, validated `0 < s ≤ 50`; totals = `scaleSnapshot(perServing, servings)`; 0.5 and 1.5 exact; whole-dish→per-serving division happens exactly once, in `recipeToPerServing` (Recipe `servings` null/0 → 1), stored unrounded so N servings re-sum to the whole dish exactly.
- **Same planned dish twice (leftovers):** two independent `MealLog` rows; `journalMealId` is non-unique provenance, so nothing conflicts and no P2002 is possible.
- **Days with no logs:** absent from range `days[]` → UI shows "no data / log a meal", never a misleading "0 kcal". Day GET on an empty day returns zeroed totals + present target.
- **Days where nothing was priceable:** flagged `incomplete`, shown in `dailyMacros`, but quarantined out of averages and `daysOnTarget` (`daysIncomplete` count surfaces them) — a 0-kcal artifact never drags the mean.
- **Timezone boundaries:** `localDate` is a client-supplied local `"YYYY-MM-DD"` string — **required, 400 when absent, never server-defaulted** — derived from local getters on web (`formatLocalDate`) and `DateFormatter` on iOS, stored and grouped as a string end-to-end. A meal at 11 pm in UTC-7 lands on the correct local day on web and iOS. Additionally the still-live UTC-parse bug in `app/api/journal/route.ts` (lines 22 and 44) is fixed, not just avoided.
- **Idempotency / double-tap / offline replay:** `clientRequestId` + `@@unique([patientId, clientRequestId])` upsert with **pinned `update: {}`** on single and batch writes; replay returns the row as it currently exists (edits preserved). Postgres NULL-distinctness keeps id-less manual logs unaffected.
- **Concurrent web + iOS:** distinct rows per action; per-row last-write-wins via `updatedAt`; deletes win via tombstone; replayed creates never overwrite edits; aggregation is always a fresh sum → devices converge.
- **Stale/edited recipe macros:** point-in-time snapshot → history frozen; `recipeId` is provenance only.
- **Ad-hoc meals with no recipe:** first-class (`MANUAL`/`PICTURE`/`FRIDGE` inline macros; `CUSTOM` via `snapshotFromCustomIngredient`); `recipeId` null throughout.
- **CUSTOM scaling:** stored snapshot is the ingredient's per-unit macros verbatim; `servings` (= quantity in the freeform unit) is the sole multiplier, applied exactly once at read — no double-scaling path exists. Missing fiber column → fiber 0 without an `incomplete` flag.
- **Null/unpriced macros:** summed as 0 but `incomplete: true` propagates row → dayTotals → an "incomplete" `Badge`; `toGrams` unknown units invoke `onUnknownUnit` (logged) — undercounting is never invisible.
- **Incomplete caloric profile:** `dayTarget: null` (never 422 on tracking routes); logging and totals fully functional; UI shows a "complete your profile" `Badge`.
- **Ramp vs steady-state target:** plan-ramp wins while a plan covers the day; `basis` field makes the difference legible in both UIs.
- **Expired iOS token:** middleware returns JSON 401 (never an HTML redirect) → client re-mints via `session.getToken()` and retries; offline drains re-mint per attempt.
- **Skipped meals:** moot — `MealLog` only ever contains eaten rows; `JournalMeal.skipped` stays in the completion domain.
- **Bounded inputs:** servings ≤ 50, macros ≤ 10000, batch ≤ 50 items, range ≤ 366 days, name ≤ 120 chars, delta page ≤ 500 — all 400 on violation.

---

## Audit-compliance notes (T1–T12 / C1–C6 patterns explicitly avoided)

- **T1 (unanchored matchers):** every string check uses an anchored regex (`^\d{4}-\d{2}-\d{2}$`) or an exact allow-list; no substring matching anywhere in validation. The already-shipped anchored guard in `lib/journey.ts fmt` is left untouched.
- **T2 (rate-limit quirks):** reuses `lib/rate-limit.ts` as-is with distinct namespaces (`meal-log`, `meal-log-read`); no new limiter logic; limits are never 0.
- **T3 (journey date off-by-one + double-count):** already fixed on this branch (27f1fb6) — this plan does not re-fix or weaken it; the tracking path never hydrates Dates at all, and the remaining live instance (`app/api/journal/route.ts:22,44`) is fixed at the source.
- **T4 (float boundary comparisons):** `daysOnTarget` and all threshold checks are ratio-based (`|actual/target − 1| ≤ 0.10`); no float equality anywhere in `lib/macros.ts`/`lib/meal-log.ts`.
- **T5 (unclamped inputs, real clock):** `resolveDailyTargets` guards `calories <= 0`; `computeMacroStats` and all `lib/` functions are pure with injectable inputs (no `Date.now()` reads); `localDate` is never derived on the server.
- **T6/T7–T10 (labeling/cosmetic):** `mealType` is a strict 4-value enum on this path — no fallback-to-last-sorted-type mislabeling.
- **T11/T12 (DB-bound logic untestable):** all logic extracted to pure `lib/macros.ts` / `lib/meal-log.ts` / `lib/journey-data.ts`; routes stay thin per convention.
- **C3 (missing catch on streams):** tracking routes are plain JSON with normal try/catch → typed 4xx/5xx JSON errors; the streaming anti-pattern is structurally absent. Picture Mode's contract mandates structured JSON, not a text stream.
- **C5 (unbounded inputs):** every list/window/value is capped (≤50 items, ≤366 days, ≤500 delta rows, macro ceilings).
- **Premium gating:** the verified inline `hasActivePremium` (`app/(dashboard)/layout.tsx:11-14`) is extracted to `lib/auth.ts` and shared by the layout, `PremiumGuard` usage, and the `CUSTOM` route check (which explicitly loads the subscription it needs) — one gate, no drift, no new pattern. Meal-log gates only CUSTOM; Picture/Fridge gating (if any) lives upstream.
- **Duplicate-math guard:** both inline deviation copies (`lib/meal-plan.ts:79-82`, `app/api/meal-plan/[menuId]/swap/route.ts:70-73`) are removed in favor of `macroDeviation`; a grep test fails CI if `* 9) / cal` / `* 4) / cal` reappears outside `lib/macros.ts`.
- **Backfill pending on prod (tasks/todo.md:23):** this design touches no meal-plan/weight joins beyond the read-only `getPlanDayCalories` lookup, so it neither depends on nor blocks that backfill.

---

## Test plan (`node --test` via `npm test`; logic in `lib/`, thin routes — matches the 245-passing convention)

- **`lib/macros.test.ts`** (new): `toGrams` known units / unknown → null + callback fired; `sumIngredientMacros` per-100g scaling with **golden-fixture parity against the script's post-rounding output** (fixture applies `Math.round` to calories and r1 to protein/carbs/fat exactly as `fetch-nutrition.mjs:270-281` does, fiber excluded — byte-identical DB writes pre/post extraction); `recipeToPerServing` (servings 1, 2, 3 — asserting `scaleSnapshot(perServing, 3)` returns the exact whole-dish calories for an indivisible 1000/3 case — null→1, 0→1); `snapshotFromMacros` nullish→0 + `incomplete` flag; `snapshotFromCustomIngredient` maps per-unit fields 1:1, fiber 0 **without** incomplete, and `scaleSnapshot(snap, 2)` yields exactly 2× (no double-scaling); `scaleSnapshot` fractional 0.5/1.5, r1 at the boundary only; `sumMealLogs` excludes tombstones, empty → `ZERO_SNAPSHOT`, `incomplete` propagation; `macroRatios`/`macroDeviation` regression-match **both** old inline copies (`lib/meal-plan.ts:79-82` values and the swap route's `> 0.50` boundary cases); **grep guard**: scans `app/`, `lib/`, `scripts/` for `* 4) / cal` / `* 9) / cal` outside `lib/macros.ts` → must be zero.
- **`lib/meal-log.test.ts`** (new): `parseMealLogInput` — **missing `localDate` rejected (never defaulted)**, anchored `localDate` (`"2026-7-9"`, `"2026-07-19x"` rejected), mealType/source allow-lists, servings bounds (0, −1, 51, 1.5), macro bounds, name trim/length, batch 0/51 rejected; `formatLocalDate` local-getter output (fixture Date at 23:30 local); snapshot-resolution branch selection per `source` (RECIPE ignores client macros; CUSTOM requires premium flag input and stores per-unit snapshot); **upsert-args builder returns `update: {}`** (pinned no-op — a replayed create can never carry payload into the update branch); PATCH/DELETE lookup builder produces the `OR: [{id},{clientRequestId}]` ownership-scoped where-clause.
- **`lib/journey.test.ts`** (extend): `computeMacroStats` grouping by string date (UTC-7 fixture asserts no shift), no-log day absent vs zero-calorie item logged, **all-incomplete day quarantined** (fixture: 3 days, one fully incomplete → excluded from `avgCalories`/`daysOnTarget`, counted in `daysIncomplete`, present in `dailyMacros` flagged), `daysComplete` denominator, `daysOnTarget` ±10% edges (target 2100 vs 1889/1891 and 2309/2311), tombstone exclusion, target passthrough/null. **Existing fmt/mealSourceBreakdown pins are NOT touched** — they already assert the fixed behavior.
- **`lib/caloric-engine.test.ts`** (extend): `resolveDailyCalorieTarget` deficit/surplus/maintenance (`weeklyTarget: null`)/floor-at-0, value-parity with the old CaloricProfileCard inline math; `resolveDailyTargets` balanced/diabetic/gain_muscle wiring, `calories ≤ 0 → null`, **`planDayCalories` precedence + `basis` field** (plan-ramp wins when present, steady-state fallback).
- **`lib/journey-data.test.ts`** (new): `getJourneyPayload` with an injected prisma stub (same stub fidelity pattern as commit 581f1fb) — single fetch path serves both route and page.
- **`middleware.test.ts`** (extend): unauthenticated `/api/meal-log` request → JSON 401 body, **not** a 307 redirect; unauthenticated page request still redirects to `/login`; public routes unaffected.
- Route-level DB behavior verified manually against the Neon dev branch, consistent with the T11/T12 convention that DB-bound paths are not in the unit sweep — explicitly including: **create → PATCH edit → replay original create → edit survives** (the `update: {}` guarantee end-to-end); logging the same planned dish twice with the same `journalMealId` → two rows, no P2002; `$transaction` batch retry idempotence; PATCH/DELETE by `clientRequestId`.

---

## Build order (numbered tasks with files to touch)

**1. Backend + model** *(shippable alone; API usable with zero UI)*
   1.1 `MealLog` + `MealLogSource` migration — `prisma/schema.prisma` (+ `Patient`/`Recipe` back-relations; `journalMealId` plain nullable, NOT unique).
   1.2 Shared module + extractions — new `lib/macros.ts`; edit `scripts/fetch-nutrition.mjs` (import back `toGrams`/`sumIngredientMacros`, keep call-site rounding, fiber noted absent), **`package.json` (`db:fetch-nutrition` → `node --import tsx scripts/fetch-nutrition.mjs`)**, `lib/meal-plan.ts` (replace the 79-82 deviation block with `macroDeviation`; add `getPlanDayCalories` extraction), **`app/api/meal-plan/[menuId]/swap/route.ts` (replace the 70-73 duplicate with `macroDeviation`, keep the `> 0.50` threshold)**, `app/api/meal-plan/route.ts` GET (call `getPlanDayCalories`), `lib/caloric-engine.ts` (add `resolveDailyCalorieTarget`, `resolveDailyTargets` with `planDayCalories`/`basis`).
   1.3 Auth plumbing — `lib/auth.ts` (add `hasActivePremium`, `getAccountWithSubscription`), `app/(dashboard)/layout.tsx` (import it); **`middleware.ts` (JSON 401 for unauthenticated `/api/*` instead of redirect)** + `middleware.test.ts` extension.
   1.4 Live-bug fix — `app/api/journal/route.ts` **only** (local date parse at lines 22 and 44). *(The formerly-listed `lib/journey.ts` fmt/breakdown fixes and test-pin updates are dropped — already shipped in 27f1fb6; do not touch that code or its tests.)*
   1.5 Routes + logic — new `lib/meal-log.ts` (`parseMealLogInput`, `formatLocalDate`, upsert-args with pinned `update: {}`, dual-address lookup builder), `app/api/meal-log/route.ts` (POST + GET day/range/updatedSince), `app/api/meal-log/[id]/route.ts` (PATCH/DELETE, id-or-clientRequestId), `app/api/meal-log/batch/route.ts`.
   1.6 Tests — new `lib/macros.test.ts` (incl. grep guard + golden fixture at script rounding), `lib/meal-log.test.ts`; extend `lib/caloric-engine.test.ts`, `lib/journey.test.ts`, `middleware.test.ts`. `npm test` green. Manual Neon checks incl. the create→edit→replay sequence.

**2. Logging UI (web)** *(invoke `ui-ux-pro-max:ui-ux-pro-max` first)*
   Files: new `components/tracking/DailyLogCard.tsx`, `components/tracking/MealLogRow.tsx`, `components/tracking/AddToLogButton.tsx`, `components/tracking/MealLogModal.tsx`; edit `app/(dashboard)/overview/page.tsx` (mount card), `components/DishCard.tsx` (AddToLogButton + servings stepper), `components/dashboard/CaloricProfileCard.tsx` (use `resolveDailyCalorieTarget`, add actual arc + ramp label). All writes derive `localDate` via `formatLocalDate`.

**3. Picture Mode hook** *(contract fixed now; wires when vision endpoint lands)*
   Files: the future vision result card drops in `AddToLogButton` with the `/api/meal-log/batch` payload (per-item `clientRequestId = pictureResultId + "-" + index`); vision endpoint spec pinned to the structured-JSON shape above; premium gating (if any) lives in the vision endpoint. No tracking-side changes.

**4. Fridge Mode hook**
   Files: future Fridge "I cooked this" screen → `AddToLogButton` single POST (`source: "FRIDGE"`, `fridgeRecipeId`, per-serving macros priced via shared `sumIngredientMacros`); if persisted, include `recipeId`. No tracking-side changes.

**5. Stats**
   Files: new `lib/journey-data.ts` (+ test), `components/journey/CalorieTrendLine.tsx`, `components/journey/MacroSplitDonut.tsx`; edit `lib/journey.ts` (`computeMacroStats` **added**; existing functions untouched), `types/index.ts` (append `MacroStats`, `MacroDay`), `app/api/journey/route.ts` (use `getJourneyPayload`, return `macroStats`), `app/(dashboard)/journey/page.tsx` (use `getJourneyPayload`), `components/journey/JourneyDashboard.tsx` (macro tiles + charts).

**6. Sync (iOS — Clara repo, Phases 2/3/4/6)**
   Files: `Clara/project.yml` (Clerk SPM); new `Clara/Clara/Networking/WondishAPIClient.swift` (fresh `session.getToken()` per request, 401-JSON handling), `ClaraKeychain.swift` (Clerk credentials, never the JWT), `MealLogDTOs.swift`, `AddToLogService.swift`, `OfflineLogQueue.swift` (coalesce/cancel rules for unsynced rows, per-attempt token refresh, dual-address ops); new `Clara/Clara/Features/Stats/StatsViewModel.swift` + real `StatsView.swift` replacing `StatsPlaceholderView`; Scan/Fridge views call `AddToLogService`. Delta sync via `?updatedSince=`, replay via `clientRequestId`.

Each step ships independently. Steps 3, 4, and 5 add **no** new server surface beyond step 1's contract; step 6 also adds none — but it **depends on the middleware JSON-401 change that step 1 delivers** (without it, iOS auth failures return HTML redirects and the offline queue cannot function).

---

## Verification fixes applied

- **[critical] Offline edit/delete of unsynced rows unaddressable** → PATCH/DELETE now accept the server id **or** `clientRequestId` (ownership-scoped `OR` lookup); iOS offline queue spec gained explicit lifecycle rules: edits to a still-queued create **coalesce** into its payload, deletes of a still-queued create **cancel** it, later ops address by `clientRequestId` until the server id is learned (every DTO echoes `clientRequestId` to enable the mapping). Flush order pinned create→patches→delete.
- **[critical] Duplicate deviation math in swap route violates single-source constraint** → verified the byte-identical copy at `app/api/meal-plan/[menuId]/swap/route.ts:70-73`; added it to the extraction list (build 1.2), both call sites now import `macroDeviation` (swap keeps its `> 0.50` threshold, meal-plan its `× 40` weight), plus a grep-guard test failing CI on any future `* 4) / cal` / `* 9) / cal` copy.
- **[critical] Middleware 307-redirects unauthenticated API requests (breaks iOS Bearer failure path)** → verified `middleware.ts:27-30`; step 1.3 adds a `pathname.startsWith("/api")` → JSON 401 branch, `middleware.test.ts` extended, iOS client spec handles 401→refresh→retry, and the "no new server surface" claim re-scoped (steps 3/4/5/6 still add none; step 6 depends on step 1's middleware change).
- **[important] Upsert update clause unspecified (replay could clobber edits)** → pinned `update: {}` (create-or-return-existing) in the schema of both single and batch writes, with the benign `@updatedAt` bump noted; unit test on the upsert-args builder plus a manual Neon create→edit→replay check asserting the edit survives.
- **[important] `journalMealId @unique` conflicts with the idempotency key (P2002 500 on second log)** → `@unique` dropped; `journalMealId` is a plain nullable best-effort provenance pointer; "same planned dish twice" is defined (two rows, no conflict) and covered by a manual check. This also resolves the related minor "one intake per planned dish" finding.
- **[important] Two divergent daily-target sources (ring formula vs `gradualDailyCals`)** → explicit decision: plan-ramp budget wins whenever an active plan covers the day (extracted `getPlanDayCalories` shared with `/api/meal-plan` GET so there is one ramp computation), steady-state `resolveDailyCalorieTarget` is the fallback; `dayTarget.basis` field makes the source legible, and the CaloricProfileCard divergence during a ramp is documented as intentional and labeled in the UI.
- **[important] All-incomplete days drag Stats means** → `computeMacroStats` quarantines days where every row is incomplete: excluded from `avgCalories`/macro averages and `daysOnTarget`, surfaced via new `daysComplete`/`daysIncomplete` counters, still visible (flagged) in `dailyMacros`; fixture test added.
- **[important] journey.ts "live bugs" premise half-false** → verified `lib/journey.ts` lines 37-44/48-54 already contain the exclusive buckets and the **anchored** fmt passthrough (27f1fb6); all plan text proposing to re-fix them, update pins, or replace the guard with `slice(0,10)` was deleted; build 1.4 re-scoped to only `app/api/journal/route.ts` (fixing both verified `new Date(date)` sites, lines 22 and 44).
- **[important] CUSTOM double-scaling (4×) ambiguity** → `snapshotFromCustomIngredient` loses its quantity parameter and maps per-unit macros 1:1; `servings` (documented as "quantity in the ingredient's unit", UI-labeled with `ci.unit`) is the sole multiplier, applied once at read by `scaleSnapshot`; fiber (absent from the verified schema) defaults to 0 without flagging `incomplete`; no-double-scaling test added.
- **[important] iOS token model would fail offline replay** → Keychain stores Clerk session credentials, never the ~60 s bearer JWT; `WondishAPIClient` mints a fresh token via `session.getToken()` before every request and the offline drain refreshes per attempt.
- **[minor] per-serving rounding drift** → snapshots stored unrounded; r1 applied only at the `scaleSnapshot`/DTO boundary; 1000 kcal ÷ 3 × 3 = 1000 test added.
- **[minor] web `localDate` derivation/required-ness** → `localDate` required on every write (400 if missing, never server-defaulted); shared `formatLocalDate` (local getters) specified for all web writes, mirroring the iOS DateFormatter.
- **[minor] `db:fetch-nutrition` runs bare node** → verified `package.json:18`; build 1.2 changes it to `node --import tsx scripts/fetch-nutrition.mjs`.
- **[minor] golden-fixture parity vs rounding mismatch** → `sumIngredientMacros` returns raw sums; the script keeps its own call-site rounding (`Math.round` calories, r1 macros) and ignores fiber (gap noted, not silently changed); the fixture asserts the script's post-rounding output.
- **[minor] CUSTOM branch lacks subscription data** → the CUSTOM path explicitly loads `account.subscription` (include or `lib/auth.ts getAccountWithSubscription`) before calling `hasActivePremium`.
- **[minor] premium-gating scope ambiguity** → contract states meal-log gates only CUSTOM; any Picture/Fridge premium gating is enforced upstream in those future endpoints, restated in both integration contracts.