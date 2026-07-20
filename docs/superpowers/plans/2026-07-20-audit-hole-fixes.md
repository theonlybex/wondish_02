# Audit Hole Fixes (T1–T12 + C6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 26 open defects from the 2026-07-12 unit-test sweep (tasks/todo.md items T1–T12) plus C6 (disable adaptive thinking on Clara), flipping the pinning tests from documents-the-bug to asserts-the-fix.

**Architecture:** Every finding already has a test in the suite that PINS the buggy behavior ("documents current behavior"). TDD here means: edit the pinned assertion to expect the CORRECT behavior → run → watch it fail (RED) → fix the source → run → pass (GREEN) → full suite → commit. One commit per task.

**Tech Stack:** Next.js 14, TypeScript, node:test via `npm test` (`node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts`), Prisma.

## Global Constraints

- Do NOT run the dev server or touch the database. Pure-logic fixes only; `npm test` and (for tasks touching route/build surface) `npm run build` are the verification commands.
- The full suite must be green (currently 245 passing) after every commit. Test output must be pristine.
- Product decisions already made by the user — do not re-litigate:
  - **T6:** when no "snack" meal type exists in the DB, SKIP the calorie top-up entirely (day may undershoot the 90% floor). Never stamp top-up rows with another meal type. Never fail the build for this.
  - **C6:** Clara stays on `claude-sonnet-5`; disable thinking explicitly with `thinking: { type: "disabled" }` (valid on Sonnet 5) for chat latency.
- `middleware.test.ts` line 26 has a guard asserting `config.matcher[0]` keeps the `/(<regex>)` shape — any matcher fix must preserve that shape.
- Commit messages follow existing repo style (`fix(scope): ...`, `test(scope): ...`, `refactor(scope): ...`) and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Wave A — Security / correctness (middleware, rate-limit)

### Task 1: T1 — middleware matcher anchoring

**Files:**
- Modify: `middleware.ts:44` (matcher[0] only; matcher[1] `"/(api|trpc)(.*)"` unchanged)
- Test: `middleware.test.ts` (tests at lines 70–125)

**The bug (3 holes):** the extension exclusion `[^?]*\.(?:...)` is unanchored, so (a) page routes with an excluded extension mid-path (`/some.js/route`, `/release-v1.zip/notes`) bypass Clerk; (b) prefix extensions leak (`.jsx` via `js(?!on)`, `.csvx` via `csv`); (c) `_next` is not anchored with `/`, so `/_next-steps` bypasses.

- [ ] **Step 1: Flip the pinned assertions**

In `middleware.test.ts`:
- Line 89: `assert.equal(re.test("_next-steps"), false)` → `assert.ok(re.test("_next-steps"))` (remove the KNOWN QUIRK comment).
- Line 100: `assert.equal(re.test("some.js/route"), false)` → `assert.ok(re.test("some.js/route"))`.
- Line 101: `assert.equal(re.test("release-v1.zip/notes"), false)` → `assert.ok(re.test("release-v1.zip/notes"))`.
- Line 99 (`blog/why-node.js`): KEEP `false` but change the comment: a path that genuinely **ends** with an asset extension is treated as a static asset by design — that part is intended.
- Line 120: `assert.equal(re.test("app.jsx"), false)` → `assert.ok(re.test("app.jsx"))`.
- Line 121: `assert.equal(re.test("data.csvx"), false)` → `assert.ok(re.test("data.csvx"))`.
- Keep lines 73–75 (`app.js` excluded, `app.json` / `api/data.json` covered) and 123–124 (`file.pn`, `archive.zi` covered) as-is — they must still pass.
- Rename the test titles so they describe correct behavior, not "current behavior"/"KNOWN QUIRK".

- [ ] **Step 2: Run — expect the flipped assertions to FAIL**

Run: `npm test`
Expected: failures only in middleware.test.ts on the flipped lines.

- [ ] **Step 3: Fix the matcher**

In `middleware.ts` replace matcher[0] with (single change: `_next` → `_next(?:/|$)`, and `$` appended after the extension group inside the lookahead):

```ts
"/((?!_next(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)",
```

Add a brief comment above noting this is Clerk's stock matcher hardened with end-of-path anchoring so only genuine asset paths bypass auth.

- [ ] **Step 4: Run — expect all green**

Run: `npm test` — full suite passes.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "fix(middleware): anchor matcher exclusions to end-of-path (T1)"
```

### Task 2: T2 — in-memory rate limiter

**Files:**
- Modify: `lib/rate-limit.ts:32-42` (memoryLimit), `lib/rate-limit.ts:63` (fallback key)
- Test: `lib/rate-limit.test.ts:67-82`

**The bug (2 holes):** (a) entry is created with `count: 1` and returns success BEFORE any compare, so `limit=0` allows the first request; (b) fallback key `` `${name}:${identifier}` `` makes `("x","y:z")` and `("x:y","z")` collide.

- [ ] **Step 1: Flip the pinned assertions**

- Line 71: `limit=0` first request → expect `success: false` (rename test: "limit of 0 blocks every request").
- Lines 75–82: collision test → expect `("t-col","y:z")` and `("t-col:y","z")` to be INDEPENDENT: both first requests succeed; a second request on the same (name, identifier) pair fails. Rename accordingly.

- [ ] **Step 2: Run** `npm test` — expect the two flipped tests to FAIL.

- [ ] **Step 3: Fix**

```ts
function memoryLimit(id: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  if (limit < 1) return { success: false };
  const entry = memStore.get(id);
  if (!entry || now > entry.resetAt) {
    memStore.set(id, { count: 1, resetAt: now + windowSec * 1000 });
    return { success: true };
  }
  if (entry.count >= limit) return { success: false };
  entry.count++;
  return { success: true };
}
```

Line 63: `return memoryLimit(JSON.stringify([name, identifier]), limit, windowSec);` — JSON tuple key cannot collide across (name, identifier) splits.

- [ ] **Step 4: Run** `npm test` — all green.
- [ ] **Step 5: Commit** `fix(rate-limit): block limit=0 and de-collide memory fallback keys (T2)`

---

## Wave B — Analytics / engine correctness (journey, prediction-data, caloric-engine)

### Task 3: T3 — lib/journey.ts (4 holes)

**Files:**
- Modify: `lib/journey.ts:32, 38-43, 47-50, 62-64`
- Test: `lib/journey.test.ts:112-125, 176-185, 197-212` (+ new fmt test)

- [ ] **Step 1: Flip/add assertions**
- Double-count test (lines 112–125): a meal with `skipped: true, preparation: "cooked"` counts ONLY in `skipped` → `cooked` expectation drops from 2 to 1.
- NaN mood test (lines 197–204): non-numeric mood `"great"` is EXCLUDED from `dailyMoods` → `assert.deepEqual(s.dailyMoods, [])` (avgMood stays 0).
- Mood "0" test (lines 206–212): `"0"` excluded from BOTH chart and average → `dailyMoods` is `[]`, avgMood 0.
- NEW test: an entry whose date is the plain string `"2026-06-01"` formats as `"2026-06-01"` in every timezone (no previous-day shift) — this is deterministic after the fix, so a plain equality assert works.

- [ ] **Step 2: Run** — expect those to FAIL.

- [ ] **Step 3: Fix**

```ts
const isSkipped = (m: (typeof allMeals)[number]) => m.skipped || m.preparation === "skipped";
const activeMeals = allMeals.filter((m) => !isSkipped(m));
const mealSourceBreakdown = {
  cooked: activeMeals.filter((m) => m.preparation === "cooked").length,
  skipped: allMeals.filter(isSkipped).length,
  readyToEat: activeMeals.filter((m) => m.preparation === "ready-to-eat").length,
  restaurant: activeMeals.filter((m) => m.preparation === "restaurant").length,
};
```

```ts
const fmt = (d: Date | string) => {
  // A date-only ISO string is already the answer; parsing it would shift it a day
  // west of UTC (new Date("YYYY-MM-DD") is midnight UTC read back in local time).
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
```

```ts
dailyMoods: entries
  .map((e) => ({ date: e.date, mood: parseFloat(e.mood ?? "") }))
  .filter(({ mood }) => Number.isFinite(mood) && mood > 0)
  .map(({ date, mood }) => ({ date: fmt(date), mood })),
```

(avgMood at line 32 keeps its `n > 0` filter — chart and average now share the same inclusion rule.)

- [ ] **Step 4: Run** — all green. **Step 5: Commit** `fix(journey): exclusive meal buckets, numeric-only moods, tz-safe date-only fmt (T3)`

### Task 4: T4 — lib/prediction-data.ts (+ classifyCBMI in caloric-engine) (3 holes)

**Files:**
- Modify: `lib/caloric-engine.ts:108-111` (classifyCBMI), `lib/prediction-data.ts:45-50, 84-121`
- Test: `lib/prediction-data.test.ts:69-86, 145-162, 249-256`, `lib/caloric-engine.test.ts` (classifyCBMI boundary)

- [ ] **Step 1: Flip/add assertions**
- resolveSex: line 85 `resolveSex(" male ")` → expect `"male"` (trims).
- BMI boundary: ADD an assertion that a profile at nominally exactly BMI 25 (64 kg at 1.60 m) classifies as overweight → non-null estimate. In caloric-engine.test.ts add `classifyCBMI(64 / (1.6 * 1.6)) === "overweight"`.
- Activity override below profile (lines 249–256): when the goal is still reachable at the lower level, expect a FINITE, LONGER estimate than baseline (assert `reduced.days > base.days` relationally); null remains correct only when the lower TDEE makes any deficit impossible. Keep/adjust one null case for a genuinely unreachable configuration if one exists.

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Fix**
- `resolveSex`: `const s = (sexAtBirth ?? "").trim().toLowerCase();`
- `classifyCBMI`: absorb float error at the class boundaries before comparing:

```ts
export function classifyCBMI(cbmi: number): CBMIClass {
  const b = Math.round(cbmi * 1e6) / 1e6; // 1.6*1.6 === 2.5600000000000005 puts a nominal BMI 25 a hair under
  // ...existing comparisons, against b instead of cbmi
}
```

- Activity override: replace the bolted-on `extraBurnPerDay` mechanism (lines 86–97, 115). Instead, when `overrides.activityLevel` is set, recompute the walk's profile with the overridden activity level (same `computeAllMetrics`/profile-derivation path the base profile uses) so a LOWER level yields a genuinely lower TDEE → smaller daily deficit → longer but finite ETA. The classification gate (line 84) stays on the BASE profile. The 3650-day cap and its null remain the "not reachable in 10 years" answer. Read the whole file before editing — keep `walkDay`, severity caps, and floors intact; the change is *which profile* feeds the walk, not the walk itself. Update the above-profile-override tests relationally (`increased.days < base.days`) if their pinned absolute numbers shift.

- [ ] **Step 4: Run** — all green. **Step 5: Commit** `fix(prediction): trim sex input, float-safe BMI classes, what-if walks on overridden profile (T4)`

### Task 5: T5 — lib/caloric-engine.ts (3 holes)

**Files:**
- Modify: `lib/caloric-engine.ts:75-82 (calcAge), 91-93 (calcIBW), 403-407 (computeAllMetrics)`
- Test: `lib/caloric-engine.test.ts:404-417, 872` (+ new clock test)

- [ ] **Step 1: Flip/add assertions**
- Line 407: `calcAge(future birthday)` → expect `0` (clamped), not `-1`.
- Line 416: `calcIBW(100, "female")` → expect `0` (floored), not `-8`.
- Line 872: `computeAllMetrics` zero-height → `p.ibwKg === 0`, not `-108`.
- NEW: `computeAllMetrics(input, new Date("2030-01-01"))` yields the age as of that injected date (pick a birthday making the assertion unambiguous).

- [ ] **Step 2: Run** — failures. **Step 3: Fix**

```ts
export function calcAge(birthday: Date, now: Date = new Date()): number {
  // ...existing computation...
  return Math.max(0, age); // a future birthday is age 0, never negative
}

export function calcIBW(heightCm: number, sex: Sex): number {
  return Math.max(0, sex === "female" ? heightCm - 108 : heightCm - 105);
}

export function computeAllMetrics(input: CaloricProfileInput, now: Date = new Date()): CaloricProfile {
  // ...
  const age = calcAge(birthday, now);
```

(Optional second param — all existing callers compile unchanged. Check whether downstream helpers inside computeAllMetrics also read the clock; thread `now` through any that do.)

- [ ] **Step 4: Run** — all green. **Step 5: Commit** `fix(caloric-engine): clamp age/IBW at 0, injectable clock for computeAllMetrics (T5)`

---

## Wave C — Product-decided + cosmetic + cleanup (meal-plan, emoji, dishes, onboarding, admin-params, Clara)

### Task 6: T6 — meal-plan snack top-up (user decision: skip)

**Files:** Modify: `lib/meal-plan.ts:292`; Test: `lib/meal-plan.test.ts` (top-up test at 586–602 + new no-snack test)

- [ ] **Step 1:** ADD a test: with meal types breakfast/lunch/dinner only (no snack), a low-calorie day produces NO top-up rows (rows.length === count of regular meals; no row carries a mealTypeId other than its own meal's). Follow the existing test's stub-recipe setup pattern at 586–602.
- [ ] **Step 2:** Run — new test FAILS (top-up currently pads with dinner-stamped rows).
- [ ] **Step 3:** Fix line 292:

```ts
// Product decision 2026-07-20: no "snack" meal type in the DB means NO calorie
// top-up — never stamp top-up rows with another meal type. The day may land
// under the 90% floor; a missing snack type is a data problem that stays visible.
const snackMealType = mealTypes.find((mt) => mt.name.toLowerCase() === "snack") ?? null;
```

(The existing `if (snackMealType && ...)` guard at 473 already handles null.)
- [ ] **Step 4:** Run — all green (existing top-up test with real snack type must still pass). **Step 5: Commit** `fix(meal-plan): skip calorie top-up when no snack meal type exists (T6)`

### Task 7: T7 + T10 — recipe emoji patterns and dish emojis

**Files:** Modify: `lib/recipeEmoji.ts:10, 28, 30, 33`, `data/dishes.ts:126, 178`; Test: `lib/recipeEmoji.test.ts:62-69, 152-162`

- [ ] **Step 1: Flip assertions**
- "Overnight Oats" → `"🥣"` (both bare and with breakfast fallback arg).
- "Cinnamon Roll" → no longer `"🍣"`; assert the actual post-fix value (run the fixed matcher mentally: no sushi/dessert pattern hit → whatever the file's fallback chain yields; verify and assert that literal).
- "Veggie Burger" → `"🍔"`. "Turkey Burger" stays `"🦃"` (turkey pattern precedes — keep). "Cheeseburger" stays `"🍔"`. Beef titles ("Beef Stir Fry" etc.) must still be `"🥩"` — keep those assertions.

- [ ] **Step 2:** Run — failures. **Step 3: Fix**

```ts
// line 10 — remove "burger" from the beef pattern:
[/\b(beef|steak|bœuf|carne|meatball|bolognese|mince|ground beef)\b/i, "🥩"],
// line 28 — pluralize oats:
[/\b(oats?|porridge|granola|muesli|overnight oats?)\b/i, "🥣"],
// line 30 — drop the bare "roll":
[/\b(sushi|maki|temaki|sushi roll|california roll)\b/i, "🍣"],
// line 33 unchanged — now reachable for standalone "burger":
[/\b(burger|cheeseburger|slider)\b/i, "🍔"],
```

- `data/dishes.ts:126` → `emoji: "🥗"` (Mediterranean Quinoa Bowl); `data/dishes.ts:178` → `emoji: "🐟"` (Tuna Niçoise Salad). The generic dishes.test.ts emoji test already accepts these.

- [ ] **Step 4:** Run — all green. **Step 5: Commit** `fix(emoji): oats plural, sushi-only rolls, reachable burger, correct dish glyphs (T7, T10)`

### Task 8: T8 — onboarding isProfileComplete

**Files:** Modify: `lib/onboarding.ts:27-34`; Test: `lib/onboarding.test.ts:124-152` (+ new 5ft-0in test)

- [ ] **Step 1: Flip assertions:** weight 0 → `false`; height 0 → `false`; Invalid Date birthday → `false`. ADD: `heightFt: 5, heightIn: 0` (metric height null) → `true` (0 inches is legitimate).
- [ ] **Step 2:** Run — failures. **Step 3: Fix**

```ts
export function isProfileComplete(patient: ProfileCompletionInput): boolean {
  if (!patient) return false;
  const pos = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n > 0;
  const nonNeg = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n >= 0;
  const hasHeight = pos(patient.height) || (pos(patient.heightFt) && nonNeg(patient.heightIn));
  const validBirthday =
    patient.birthday instanceof Date
      ? !Number.isNaN(patient.birthday.getTime())
      : Boolean(patient.birthday);
  return Boolean(validBirthday && hasHeight && pos(patient.weight) && patient.physicalActivityId);
}
```

(Match the actual `ProfileCompletionInput` field types in the file — if `birthday` can be a string, keep the truthiness branch for strings.)
- [ ] **Step 4:** Run — all green. **Step 5: Commit** `fix(onboarding): reject zero measurements and invalid birthdays (T8)`

### Task 9: T9 + C6 — delete admin-params leftover; disable Clara thinking

**Files:** Modify: `app/api/admin/parameters/[type]/route.ts:2`, `app/api/dish-checker/route.ts:74-76`; Delete: `lib/admin-params.ts`

- [ ] **Step 1:** In `app/api/admin/parameters/[type]/route.ts` change `import { prisma } from "@/lib/admin-params";` → `import { prisma } from "@/lib/db";`. Delete `lib/admin-params.ts` (dossier-verified: that route was its only importer).
- [ ] **Step 2:** In `app/api/dish-checker/route.ts`, add to the `anthropic.messages.stream({...})` params (after `max_tokens`):

```ts
    thinking: { type: "disabled" },
```

with a one-line comment: Sonnet 5 defaults to adaptive thinking when the param is omitted; chat latency wants it off (C6).
- [ ] **Step 3:** Run `npm test` (no test covers these; suite must stay green) AND `npm run build` (route-surface change — build is the verification).
- [ ] **Step 4: Commit** `chore: remove admin-params re-export (T9); disable Clara adaptive thinking (C6)`

---

## Wave D — Testability refactors

### Task 10: T11 — extract prediction-profile normalization

**Files:**
- Create: `lib/prediction-profile.ts`, `lib/prediction-profile.test.ts`
- Modify: `lib/queries.ts:41-79`

**Interfaces:**
- Produces: `normalizePredictionPatient(row: PredictionPatientRow): PredictionProfileInput | null` where `PredictionPatientRow` mirrors the Prisma select at queries.ts:45-51 (`weight, weightUnit, goalWeight, goalWeightUnit, height, heightUnit, birthday: Date, sexAtBirth, physicalActivity: { level } | null` — all nullable as in the schema).
- Consumes: `resolveSex` from `lib/prediction-data`, `toKg`/`fromKg` from wherever queries.ts imports them.

- [ ] **Step 1: Write failing tests** in `lib/prediction-profile.test.ts` (new file, so RED = module not found), covering: complete row round-trips; null when weight/goalWeight/height/birthday missing; null when sex unresolvable or activity missing; `goalWeightUnit` null falls back to `weightUnit`; non-"lbs" units default kg / non-"in" default cm; lbs→kg goal conversion when units differ (assert the `fromKg(toKg(...))` number to 1 decimal); `goalWeight >= weight` → null.
- [ ] **Step 2:** `npm test` — new file fails.
- [ ] **Step 3:** Create `lib/prediction-profile.ts` containing EXACTLY the logic currently at queries.ts:54-77 (verbatim move, no behavior change), typed against `PredictionPatientRow`. It must import NOTHING that touches Prisma/db.
- [ ] **Step 4:** Rewire `getPredictionProfileInput` in queries.ts to `return patient ? normalizePredictionPatient(patient) : null;`.
- [ ] **Step 5:** `npm test` green + `npm run build` clean. **Step 6: Commit** `refactor(queries): extract pure prediction-profile normalization (T11)`

### Task 11: T12 — dependency-inject regeneratePlan

**Files:**
- Modify: `lib/meal-plan-runner.ts:34` signature
- Test: `lib/meal-plan-runner.test.ts` (remove the line-5 "intentionally NOT tested" carve-out)

**Interfaces:**
- Produces: `regeneratePlan(patientId: string, startDate: Date, deps: RunnerDeps = defaultDeps): Promise<number>` where `RunnerDeps = { prisma: PrismaLike; buildMealPlanMenus: typeof buildMealPlanMenus }`. `PrismaLike` needs only the members the function uses: `patient.updateMany/findUnique/update`, `menu.deleteMany/createMany`. Default value uses the real imports — all 5 existing call sites (3 API routes, scripts/verify-meal-plan.ts ×2) compile unchanged.

- [ ] **Step 1: Write failing tests** (extend `lib/meal-plan-runner.test.ts`, following its existing prisma-stub fidelity conventions): (a) claim-lock: stub `patient.updateMany` returning `{count: 0}` → rejects with `MealPlanBusyError`, no menu writes; (b) empty plan: builder returns `{rows: [], builtForWeight: 70}` → rejects `EmptyPlanError` AND patient status set to FAILED in the catch; (c) happy path ordering: purge (`menu.deleteMany` for nextVersion) happens BEFORE `menu.createMany`, and the version-flip `patient.update` (activePlanVersion=nextVersion, status READY, mealPlanStale false, mealPlanWeight=builtForWeight) happens AFTER createMany — assert via a call-order log in the stub; (d) returns the created row count.
- [ ] **Step 2:** RED (deps param doesn't exist). **Step 3:** Add the `deps` parameter with defaults; replace internal `prisma.` / `buildMealPlanMenus` references with `deps.`. No logic changes. Keep Sentry usage as-is (module import is fine — tests won't trigger it except the FAILED path; if Sentry capture fires in test (b), stub-guard it via `deps` only if the test output isn't pristine otherwise).
- [ ] **Step 4:** `npm test` green + `npm run build`. **Step 5: Commit** `refactor(meal-plan-runner): inject prisma/builder deps, cover regeneratePlan (T12)`

---

## Final task: ledger + verification

- [ ] Update `tasks/todo.md`: check off T1–T12 and C6 with commit SHAs; note T6/C6 product decisions and the `blog/why-node.js` end-of-path caveat on T1.
- [ ] Run `npm test` (expect ≥245, all passing, pristine output) and `npm run build`.
- [ ] Commit: `docs(tasks): mark audit findings T1-T12 and C6 fixed`
