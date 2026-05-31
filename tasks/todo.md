# Meal-Plan Reliability + Strategy B — Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make meal-plan generation reliable ("a watch") — the profile save never hangs, a regenerate never leaves the user planless, and the user keeps following their live plan until a new one is fully built.

**Architecture:** Blue/green plan versioning. `generateMealPlan` keeps its exact selection algorithm but stops writing; a new orchestrator builds the next version's menus, inserts them under a new `Menu.planVersion`, then atomically flips `Patient.activePlanVersion`. All meal reads filter by the active version, so a half-built or failed run is invisible. A claim-lock on `Patient.mealPlanStatus` prevents concurrent runs. Profile saves stop generating and instead set `mealPlanStale=true`; the UI shows a Regenerate button (Strategy B).

**Tech Stack:** Next.js 14 (App Router), Prisma + Neon (uses `prisma db push`, migrations are git-ignored), Clerk, TypeScript.

**Testing approach (adapted to this repo):** There is no unit-test runner configured. Each task's gate is `npm run build` (full type-check, no `ignoreBuildErrors`). Runtime behavior is verified at integration points with the dev server + browser (playwright-skill) and a DB verification script (`scripts/verify-meal-plan.ts`, Task 8). Commit after each task.

**Constraint:** Do NOT change the dish-selection logic inside `generateMealPlan` (the scoring/picking/family-tracking). Only its persistence is refactored out.

---

### Task 1: Schema — versioning + status fields

**Files:**
- Modify: `prisma/schema.prisma` (Patient model ~line 121, Menu model ~line 398)

- [ ] **Step 1: Add the status enum and Patient fields**

In `prisma/schema.prisma`, add the enum (near the other enums) and these fields to `model Patient` (after `mealPlanStartDate`):

```prisma
enum MealPlanStatus {
  IDLE
  GENERATING
  READY
  FAILED
}
```

```prisma
  // Meal-plan reliability (Phase A)
  activePlanVersion   Int            @default(0)
  mealPlanStatus      MealPlanStatus @default(IDLE)
  mealPlanStale       Boolean        @default(false)
  mealPlanGenStartedAt DateTime?
  mealPlanError       String?
```

- [ ] **Step 2: Add planVersion to Menu**

In `model Menu`, add after `date`:

```prisma
  planVersion Int      @default(0)
```

Add an index for fast active-version reads (in `model Menu`):

```prisma
  @@index([patientId, planVersion, date])
```

- [ ] **Step 3: Push schema + regenerate client**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema." Existing menus get `planVersion=0`; existing patients get `activePlanVersion=0` — so current plans stay active (version 0 matches).

Run: `npm run db:generate`
Expected: "Generated Prisma Client".

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles (the new fields aren't referenced yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(meal-plan): add plan versioning + status fields to schema"
```

---

### Task 2: Make `generateMealPlan` build-only (no writes), tagged with a version

**Files:**
- Modify: `lib/meal-plan.ts` (signature ~line 138; remove `deleteMany` ~line 267; change menu push shape ~line 385, 481; replace final write ~line 488-491)

- [ ] **Step 1: Change the menus array type to include planVersion**

Replace the declaration at `lib/meal-plan.ts:269`:

```ts
  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date }[] = [];
```

with:

```ts
  const menus: { patientId: string; recipeId: string; mealTypeId: string; date: Date; planVersion: number }[] = [];
```

- [ ] **Step 2: Change the signature to accept the target version and return the rows**

Replace the signature at `lib/meal-plan.ts:138-141`:

```ts
export async function generateMealPlan(
  patientId: string,
  startDate: Date,
): Promise<number> {
```

with:

```ts
export type MenuRow = { patientId: string; recipeId: string; mealTypeId: string; date: Date; planVersion: number };

// Pure builder: computes the menu rows for a plan. Does NOT touch the DB's menu
// table. Persistence + version flip is handled by the orchestrator (meal-plan-runner).
export async function buildMealPlanMenus(
  patientId: string,
  startDate: Date,
  planVersion: number,
): Promise<MenuRow[]> {
```

- [ ] **Step 3: Remove the destructive delete**

Delete this line at `lib/meal-plan.ts:267`:

```ts
  await prisma.menu.deleteMany({ where: { patientId } });
```

- [ ] **Step 4: Stamp planVersion on every pushed row**

There are two `menus.push(...)` calls. Update both to include `planVersion`:

At ~line 385:
```ts
        menus.push({ patientId, recipeId: recipe.id, mealTypeId: mealType.id, date: new Date(current) });
```
→
```ts
        menus.push({ patientId, recipeId: recipe.id, mealTypeId: mealType.id, date: new Date(current), planVersion });
```

At ~line 481:
```ts
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current) });
```
→
```ts
        menus.push({ patientId, recipeId: extra.id, mealTypeId: snackMealType.id, date: new Date(current), planVersion });
```

- [ ] **Step 5: Return the rows instead of writing them**

Replace the final block at `lib/meal-plan.ts:488-491`:

```ts
  if (menus.length > 0) {
    await prisma.menu.createMany({ data: menus });
  }
  return menus.length;
```

with:

```ts
  return menus;
```

- [ ] **Step 6: Verify build (expect callers to break — that's the next task)**

Run: `npm run build`
Expected: type errors ONLY in `app/api/meal-plan/route.ts` and `app/api/meal-plan/start-date/route.ts` and `app/api/patient/profile/route.ts` (they still call the old `generateMealPlan`). These are fixed in Tasks 3–4 and 6. Do not commit yet.

---

### Task 3: Orchestrator — claim-lock, build, atomic flip, cleanup

**Files:**
- Create: `lib/meal-plan-runner.ts`

- [ ] **Step 1: Write the orchestrator**

Create `lib/meal-plan-runner.ts`:

```ts
import { prisma } from "@/lib/db";
import { buildMealPlanMenus } from "@/lib/meal-plan";

// Thrown when a generation is already in flight for this patient.
export class MealPlanBusyError extends Error {
  constructor() {
    super("MEAL_PLAN_BUSY");
    this.name = "MealPlanBusyError";
  }
}

// A GENERATING run older than this is considered dead and may be re-claimed.
const STUCK_AFTER_MS = 3 * 60 * 1000;

/**
 * Regenerate a patient's meal plan as a blue/green swap:
 *  1. Atomically claim the slot (status -> GENERATING). Reject if already running.
 *  2. Build the next version's menus in memory (algorithm unchanged).
 *  3. Insert them under a NEW planVersion (invisible to reads).
 *  4. Atomically flip activePlanVersion -> new version (+ READY, stale=false).
 *  5. Best-effort delete of stale older-version rows.
 * On any failure after claiming, status -> FAILED and the OLD plan stays active.
 */
export async function regeneratePlan(patientId: string, startDate: Date): Promise<number> {
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS);

  // 1. Claim. Succeeds only if not GENERATING, OR the previous run is stuck.
  const claim = await prisma.patient.updateMany({
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

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { activePlanVersion: true },
    });
    const nextVersion = (patient?.activePlanVersion ?? 0) + 1;

    // 2 + 3. Build and insert the new version (still invisible to reads).
    const rows = await buildMealPlanMenus(patientId, startDate, nextVersion);
    if (rows.length > 0) {
      await prisma.menu.createMany({ data: rows });
    }

    // 4. Atomic flip — the moment reads start seeing the new plan.
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        activePlanVersion: nextVersion,
        mealPlanStartDate: start,
        mealPlanStatus: "READY",
        mealPlanStale: false,
        mealPlanError: null,
      },
    });

    // 5. Best-effort cleanup of old versions. Safe to fail (orphans only).
    await prisma.menu.deleteMany({ where: { patientId, planVersion: { not: nextVersion } } }).catch(() => {});

    return rows.length;
  } catch (err) {
    await prisma.patient.update({
      where: { id: patientId },
      data: { mealPlanStatus: "FAILED", mealPlanError: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    throw err;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: same pre-existing errors in the 3 caller routes (fixed next). `lib/meal-plan-runner.ts` itself compiles.

- [ ] **Step 3: Commit Tasks 2+3 together (builder + orchestrator)**

```bash
git add lib/meal-plan.ts lib/meal-plan-runner.ts
git commit -m "feat(meal-plan): split generation into pure builder + atomic blue/green orchestrator"
```

---

### Task 4: API — regenerate + status endpoints; route POST entry points through orchestrator

**Files:**
- Create: `app/api/meal-plan/regenerate/route.ts`
- Create: `app/api/meal-plan/status/route.ts`
- Modify: `app/api/meal-plan/route.ts` (POST, ~line 155)
- Modify: `app/api/meal-plan/start-date/route.ts` (~lines 22-24)

- [ ] **Step 1: Create the regenerate endpoint (premium-gated, rate-limited)**

Create `app/api/meal-plan/regenerate/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { regeneratePlan, MealPlanBusyError } from "@/lib/meal-plan-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_INTERVAL_MS = 2 * 60 * 1000; // anti-spam: 1 regenerate / 2 min

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account.subscription;
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: { id: true, profileCompleted: true, mealPlanStatus: true, mealPlanGenStartedAt: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  // Anti-spam: block only successful READY runs that finished recently.
  if (
    patient.mealPlanStatus === "READY" &&
    patient.mealPlanGenStartedAt &&
    Date.now() - patient.mealPlanGenStartedAt.getTime() < MIN_INTERVAL_MS
  ) {
    return NextResponse.json({ error: "Please wait a moment before regenerating again." }, { status: 429 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const count = await regeneratePlan(patient.id, today);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    console.error("[regenerate]", err);
    return NextResponse.json({ error: "Generation failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the status endpoint (for UI polling)**

Create `app/api/meal-plan/status/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: {
      mealPlanStatus: true,
      mealPlanStale: true,
      mealPlanError: true,
      activePlanVersion: true,
      mealPlanStartDate: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  return NextResponse.json({
    status: patient.mealPlanStatus,
    stale: patient.mealPlanStale,
    error: patient.mealPlanError,
    hasPlan: patient.activePlanVersion > 0 && patient.mealPlanStartDate != null,
  });
}
```

- [ ] **Step 3: Route `/api/meal-plan` POST through the orchestrator**

In `app/api/meal-plan/route.ts`, replace the import of `generateMealPlan` (line 4):

```ts
import { generateMealPlan } from "@/lib/meal-plan";
```
→
```ts
import { regeneratePlan, MealPlanBusyError } from "@/lib/meal-plan-runner";
```

Replace line 155:

```ts
  const count = await generateMealPlan(patient.id, start);

  return NextResponse.json({ ok: true, count });
```
→
```ts
  try {
    const count = await regeneratePlan(patient.id, start);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    throw err;
  }
```

- [ ] **Step 4: Route `/api/meal-plan/start-date` through the orchestrator (remove the unguarded delete)**

Replace `app/api/meal-plan/start-date/route.ts:1-27` body. Change import line 4:

```ts
import { generateMealPlan } from "@/lib/meal-plan";
```
→
```ts
import { regeneratePlan, MealPlanBusyError } from "@/lib/meal-plan-runner";
```

Replace lines 21-26:

```ts
  // Wipe all existing menus before generating a fresh plan.
  await prisma.menu.deleteMany({ where: { patientId: patient.id } });
  await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: start } });
  const count = await generateMealPlan(patient.id, start);

  return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
```
with:

```ts
  // Atomic blue/green regenerate — no unguarded wipe.
  try {
    const count = await regeneratePlan(patient.id, start);
    return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    throw err;
  }
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: compiles clean except (still) `app/api/patient/profile/route.ts` (fixed in Task 6).

- [ ] **Step 6: Commit**

```bash
git add app/api/meal-plan/regenerate/route.ts app/api/meal-plan/status/route.ts app/api/meal-plan/route.ts app/api/meal-plan/start-date/route.ts
git commit -m "feat(meal-plan): regenerate + status endpoints; route POST paths through atomic orchestrator"
```

---

### Task 5: Apply the active-version filter to ALL menu reads

> During a regenerate, the DB briefly holds BOTH the active version's menus AND the
> new (not-yet-flipped) version's menus. Any read without a `planVersion` filter
> would return both → duplicates. So EVERY menu read must scope to the patient's
> `activePlanVersion`. Where the patient isn't already loaded with that field,
> fetch it first (these reads run in `Promise.all` before `patient` is known —
> restructure to load `patient.activePlanVersion` first, then query menus).

**Per-patient reads (add `planVersion: patient.activePlanVersion` to the menu `where`):**
- Modify: `lib/queries.ts:29` (getOverviewPatient — `menus` include; add a `planVersion` filter using the patient row's own `activePlanVersion`, also added to its select)
- Modify: `app/(dashboard)/overview/page.tsx:51`
- Modify: `app/(dashboard)/meal-plan/page.tsx:26` AND remove the inline `generateMealPlan` block at lines 57-82 (first-gen moves to the client view in Task 7); add `activePlanVersion` to the patient select at line 46
- Modify: `app/(dashboard)/meal-plan/weekly/page.tsx:38` AND remove the inline `generateMealPlan` block (~lines 44-60); add `activePlanVersion` to the patient select
- Modify: `app/(dashboard)/journal/page.tsx:22`
- Modify: `app/(dashboard)/grocery-list/page.tsx:20`
- Modify: `app/api/grocery-list/route.ts:24`
- Modify: `app/api/meal-plan/route.ts:97` (GET) — add `activePlanVersion: true` to the patient select (lines 60-69) first
- Modify: `app/api/meal-plan/[menuId]/swap/route.ts:30` and `:90` (load patient `activePlanVersion`; the `update` at :146 stays on the same row so needs no version change)

**Cross-patient provider reads (filter in JS — Prisma can't compare two columns in `where`):**
- Modify: `app/(dashboard)/provider/meal-plans/page.tsx:17` and `app/api/provider/meal-plans/route.ts:20` — `include: { patient: { select: { activePlanVersion: true } } }`, then `.filter((m) => m.planVersion === m.patient.activePlanVersion)` after the query.

Note: `lib/journey.ts` and `app/api/meal-plan/alternatives/route.ts` were checked — confirm during execution whether they read `prisma.menu` directly; if so, apply the same filter (grep `prisma.menu` in each before editing).

- [ ] **Step 1: For each read, fetch the patient's `activePlanVersion` and add it to the `where`**

Pattern — wherever a `patient` (or patientId) is already in scope, ensure `activePlanVersion` is selected, then add `planVersion: patient.activePlanVersion` to the menu `where`. Example for `app/api/meal-plan/route.ts` GET (the `select` at lines 60-69 must add `activePlanVersion: true`), then the read at line 97:

```ts
  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
```
→
```ts
  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: startDate, lte: endDate } },
```

- [ ] **Step 2: Repeat for the remaining read sites**

For each file, locate the menu `findMany`, confirm the patient record in that function `select`s `activePlanVersion` (add it if missing — in `lib/queries.ts` and `lib/journey.ts` the patient lookups need `activePlanVersion: true` added to their `select`/`include`), and add `planVersion: <patient>.activePlanVersion` to the menu `where`. Do this in: `lib/queries.ts` (both reads), `lib/journey.ts:43`, `app/api/grocery-list/route.ts:38`, `app/api/meal-plan/[menuId]/swap/route.ts:54`, `app/api/meal-plan/alternatives/route.ts`.

Note: the swap route's `prisma.menu.update` (line 99) operates on a menu row already fetched from the active version, so it stays on the same version — no change needed beyond the read filter at line 54.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add lib/queries.ts lib/journey.ts "app/api/grocery-list/route.ts" "app/api/meal-plan/route.ts" "app/api/meal-plan/[menuId]/swap/route.ts" "app/api/meal-plan/alternatives/route.ts"
git commit -m "feat(meal-plan): scope all menu reads to active plan version"
```

---

### Task 6: Profile save — stop generating, set `mealPlanStale` (Strategy B)

**Files:**
- Modify: `app/api/patient/profile/route.ts` (import line 4; block at lines 189-199)

- [ ] **Step 1: Drop the meal-plan import**

Remove line 4:

```ts
import { generateMealPlan } from "@/lib/meal-plan";
```

- [ ] **Step 2: Replace the fire-and-forget generation with a staleness flag**

Replace lines 189-199:

```ts
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!patient.mealPlanStartDate || mealPlanFieldsChanged) {
    // Stamp the start date immediately so re-saves don't re-trigger generation.
    await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: today } });
    // Generate the meal plan in the background — don't block the HTTP response.
    generateMealPlan(patient.id, today).catch((e) =>
      console.error("[profile] meal plan generation failed:", e)
    );
  }

  return NextResponse.json({ ok: true, patientId: patient.id });
```

with:

```ts
  // Strategy B: the profile save NEVER generates. If a plan already exists and a
  // plan-affecting field changed, mark it stale so the meal-plan page can offer
  // a Regenerate button. First-ever generation happens on the meal-plan page.
  if (patient.mealPlanStartDate && mealPlanFieldsChanged) {
    await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } });
  }

  return NextResponse.json({ ok: true, patientId: patient.id });
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles clean (no more references to the old `generateMealPlan`).

- [ ] **Step 4: Manual check — profile save is instant**

Run: `npm run dev`. Log in, open Profile, change weight, Save.
Expected: save returns immediately; no hang. In the DB, `mealPlanStale=true` if a plan already existed; the existing plan's menus are unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/api/patient/profile/route.ts
git commit -m "feat(meal-plan): profile save sets stale flag instead of generating (Strategy B)"
```

---

### Task 7: Frontend — Strategy B states in the meal-plan view

**Files:**
- Modify: `app/(dashboard)/meal-plan/page.tsx` (pass status props)
- Modify: `components/meal-plan/DailyMealPlanView.tsx` (add setup screen, stale banner, Regenerate button, polling)

- [ ] **Step 1: Pass plan status from the page to the view**

In `app/(dashboard)/meal-plan/page.tsx`, extend the patient `select` (line 22) to include the new fields and pass them down:

```ts
    select: { profileCompleted: true, mealPlanStartDate: true },
```
→
```ts
    select: { profileCompleted: true, mealPlanStartDate: true, mealPlanStatus: true, mealPlanStale: true, activePlanVersion: true },
```

Pass new props to `<DailyMealPlanView>`:

```tsx
      mealPlanStartDate={patient?.mealPlanStartDate?.toISOString() ?? null}
      initialStatus={patient?.mealPlanStatus ?? "IDLE"}
      initialStale={patient?.mealPlanStale ?? false}
      hasPlan={(patient?.activePlanVersion ?? 0) > 0 && patient?.mealPlanStartDate != null}
```

- [ ] **Step 2: Add the three states to `DailyMealPlanView`**

Open `components/meal-plan/DailyMealPlanView.tsx`. Add the new props to its props type (`initialStatus: "IDLE"|"GENERATING"|"READY"|"FAILED"; initialStale: boolean; hasPlan: boolean;`). Add a `regenerate` handler and a `status` state. Behavior:
  - **No plan yet** (`!hasPlan`) and profile complete: show a centered card "Setting up your plan… this takes just a second", call `POST /api/meal-plan/regenerate` once on mount, then poll `GET /api/meal-plan/status` every 1.5s until `status === "READY"`, then `router.refresh()`.
  - **Plan exists + stale**: render a non-blocking banner above the plan: "Your profile changed — Regenerate to apply." with a **Regenerate** button.
  - **Regenerate clicked / GENERATING**: disable the button, show "Checking everything for you…", poll status until `READY`, then `router.refresh()`. On `FAILED`, show "Something went wrong — Try again."

Reference handler:

```tsx
async function regenerate() {
  setStatus("GENERATING");
  const res = await fetch("/api/meal-plan/regenerate", { method: "POST" });
  if (res.status === 429) { /* show "wait a moment" toast */ }
  // poll
  const poll = setInterval(async () => {
    const s = await fetch("/api/meal-plan/status").then((r) => r.json());
    if (s.status === "READY") { clearInterval(poll); setStatus("READY"); router.refresh(); }
    if (s.status === "FAILED") { clearInterval(poll); setStatus("FAILED"); }
  }, 1500);
}
```

(Follow the file's existing styling/components — `Button`, toast, card classes — rather than inventing new ones.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 4: Manual UI verification (dev server + browser)**

Run: `npm run dev`. Verify, in order:
  1. A fresh profile-complete user with no plan → sees "Setting up your plan…", then the plan appears.
  2. Change weight in Profile, return to meal-plan → stale banner with Regenerate shows; old plan still visible.
  3. Click Regenerate → "Checking everything…" → new plan appears; previously liked/disliked dishes are still recorded in the journal for their days.
  4. Double-click Regenerate fast → second call returns 409, no corruption.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/meal-plan/page.tsx" components/meal-plan/DailyMealPlanView.tsx
git commit -m "feat(meal-plan): Strategy B UI — setup screen, stale banner, Regenerate button"
```

---

### Task 8: End-to-end verification script + final gate

**Files:**
- Create: `scripts/verify-meal-plan.ts`

- [ ] **Step 1: Write a DB verification script**

Create `scripts/verify-meal-plan.ts` that, against the dev DB: picks a `profileCompleted` patient, records `activePlanVersion`, runs `regeneratePlan` once, and asserts: (a) `activePlanVersion` incremented by 1; (b) all menus for the patient have `planVersion === activePlanVersion` (no orphans left); (c) `mealPlanStatus === "READY"`, `mealPlanStale === false`; (d) calling `regeneratePlan` again from two parallel promises yields exactly one `MealPlanBusyError`. Print PASS/FAIL per assertion.

```ts
import { prisma } from "../lib/db";
import { regeneratePlan, MealPlanBusyError } from "../lib/meal-plan-runner";

async function main() {
  const patient = await prisma.patient.findFirst({ where: { profileCompleted: true }, select: { id: true, activePlanVersion: true } });
  if (!patient) throw new Error("No profileCompleted patient to test with");
  const before = patient.activePlanVersion;
  const today = new Date(); today.setHours(0,0,0,0);

  await regeneratePlan(patient.id, today);
  const after = await prisma.patient.findUnique({ where: { id: patient.id }, select: { activePlanVersion: true, mealPlanStatus: true, mealPlanStale: true } });
  console.log("version bumped:", after!.activePlanVersion === before + 1 ? "PASS" : "FAIL");
  const orphans = await prisma.menu.count({ where: { patientId: patient.id, planVersion: { not: after!.activePlanVersion } } });
  console.log("no orphan versions:", orphans === 0 ? "PASS" : `FAIL (${orphans})`);
  console.log("status READY + not stale:", after!.mealPlanStatus === "READY" && !after!.mealPlanStale ? "PASS" : "FAIL");

  const results = await Promise.allSettled([regeneratePlan(patient.id, today), regeneratePlan(patient.id, today)]);
  const busy = results.filter((r) => r.status === "rejected" && r.reason instanceof MealPlanBusyError).length;
  console.log("concurrent claim rejected exactly once:", busy === 1 ? "PASS" : `FAIL (busy=${busy})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-meal-plan.ts` (install tsx if missing: `npm i -D tsx`)
Expected: four `PASS` lines.

- [ ] **Step 3: Final build gate**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-meal-plan.ts package.json package-lock.json
git commit -m "test(meal-plan): blue/green + claim-lock verification script"
```

---

## Review
_(fill in after execution: what changed, what was verified, anything deferred to a later phase)_

## Out of scope (later phases — agreed)
- Generator speed-up (single recipe-pool load) — **suggestion-only**, do not apply without explicit OK (algorithm must stay unchanged).
- Neon pooled (PgBouncer) connection string; reference-data + recipe-catalog caching.
- Auto-retry on FAILED; stuck-job sweeper cron; Sentry.
- Journal → calendar redesign (month view + day-card with completed dishes + journal + journey data) — its own brainstorm/spec, includes a visual companion pass.
