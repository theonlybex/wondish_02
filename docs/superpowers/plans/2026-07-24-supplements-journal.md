# Supplements & Journal (Meal Plan hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a segmented switcher (Meal Plan | Supplements | Journal) to the iOS center tab, backed by a new user-managed supplements tracker (Prisma + `/api/supplements/*`) and a read-only journal history of past days' dishes and supplements.

**Architecture:** Backend-first: pure validation in `lib/supplements.ts`, two Prisma models (`Supplement`, soft-deleted; `SupplementIntake`, unique per supplement+day), four thin route files mirroring `/api/journal` patterns, and a non-breaking `?allMeals=1` mode on `/api/journal/calendar`. Then iOS: `Features/Supplements` and `Features/Journal` (DTO → Service → `@Observable @MainActor` ViewModel → View, exactly the `MealPlan` layering), composed under a new `PlanHubView` that owns the nav title and a design-system segmented pill.

**Tech Stack:** Next.js 14 App Router (sync `params`), Prisma/Postgres, Clerk auth, `node:test` via `npm test`; SwiftUI iOS 17 floor, XCTest.

**Spec:** `docs/superpowers/specs/2026-07-24-supplements-journal-design.md`

## Global Constraints

- Backend repo: `/Users/becks/Desktop/NewView/wondish_02`. iOS repo: `/Users/becks/Desktop/NewView/Clara`.
- All new routes: Clerk-authed, patient scoped via `prisma.patient.findFirst({ where: { account: { clerkId: userId } } })`, 401 unauthenticated / 404 no patient — copy `/api/journal/route.ts` exactly.
- Dates are local-date strings `YYYY-MM-DD`; parse ONLY with `parseLocalDateStrict` from `lib/journal.ts`; store at local midnight (`setHours(0,0,0,0)`).
- Time slots are exactly `"MORNING" | "AFTERNOON" | "EVENING"`.
- Supplement delete is a soft delete (`deletedAt`); intake history must survive it.
- Diet-match standing rule does NOT apply (supplements are free text, not food surfaces).
- Backend tests: `npm test` (node --test over `lib/*.test.ts`). All existing tests stay green.
- iOS: `xcodegen` NOT installed — every new Swift file is hand-registered in `Clara.xcodeproj/project.pbxproj` (4 insertion points; commit `78b1089` in the Clara repo is the worked example). Test command: `cd /Users/becks/Desktop/NewView/Clara && xcodebuild test -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1"` (iPhone 17 Pro).
- iOS design tokens only: `WColor`/`WFont`/`WSpacing`/`WRadius`, `.wCard()`, `WButtonStyle`, `WBadge`. No stock `UISegmentedControl`, no shadows, no emoji icons (SF Symbols only).
- ViewModels: `@Observable @MainActor final class`, protocol-typed service seam (`...Providing: Sendable`), mirroring `MealPlanViewModel`.
- Commit after every task (both repos have their own git history — commit in the repo the task touched).

---

### Task 1: Backend validation — `lib/supplements.ts`

**Files:**
- Create: `lib/supplements.ts`
- Test: `lib/supplements.test.ts`

**Interfaces:**
- Consumes: `parseLocalDateStrict` from `lib/journal.ts`.
- Produces (used by Tasks 3–5):
  - `type SupplementTimeSlot = "MORNING" | "AFTERNOON" | "EVENING"`
  - `validateSupplementBody(body, { partial }): { ok: true; name?: string; dosage?: string | null; timeSlot?: SupplementTimeSlot } | { ok: false; error: string }` — with `partial: false` `name` and `timeSlot` are required; with `partial: true` only provided keys are validated/returned.
  - `validateIntakeBody(body): { ok: true; date: Date; taken: boolean } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/supplements.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSupplementBody, validateIntakeBody } from "./supplements";

test("supplement create: accepts name + slot, trims, defaults dosage null", () => {
  const r = validateSupplementBody({ name: "  Vitamin D3 ", timeSlot: "MORNING" }, { partial: false });
  assert.deepEqual(r, { ok: true, name: "Vitamin D3", dosage: null, timeSlot: "MORNING" });
});

test("supplement create: keeps trimmed dosage", () => {
  const r = validateSupplementBody({ name: "Omega-3", dosage: " 1000 mg ", timeSlot: "EVENING" }, { partial: false });
  assert.deepEqual(r, { ok: true, name: "Omega-3", dosage: "1000 mg", timeSlot: "EVENING" });
});

test("supplement create: rejects missing/empty/whitespace name", () => {
  for (const name of [undefined, "", "   ", 42]) {
    const r = validateSupplementBody({ name, timeSlot: "MORNING" }, { partial: false });
    assert.equal(r.ok, false);
  }
});

test("supplement create: rejects name/dosage over 100 chars", () => {
  assert.equal(validateSupplementBody({ name: "x".repeat(101), timeSlot: "MORNING" }, { partial: false }).ok, false);
  assert.equal(validateSupplementBody({ name: "Zinc", dosage: "x".repeat(101), timeSlot: "MORNING" }, { partial: false }).ok, false);
});

test("supplement create: rejects bad timeSlot", () => {
  for (const timeSlot of [undefined, "NIGHT", "morning", 3]) {
    assert.equal(validateSupplementBody({ name: "Zinc", timeSlot }, { partial: false }).ok, false);
  }
});

test("supplement patch: partial accepts subset and omits missing keys", () => {
  const r = validateSupplementBody({ dosage: "500 mg" }, { partial: true });
  assert.deepEqual(r, { ok: true, dosage: "500 mg" });
  const r2 = validateSupplementBody({}, { partial: true });
  assert.deepEqual(r2, { ok: true });
});

test("supplement patch: explicit null dosage clears it, but null name rejected", () => {
  assert.deepEqual(validateSupplementBody({ dosage: null }, { partial: true }), { ok: true, dosage: null });
  assert.equal(validateSupplementBody({ name: null }, { partial: true }).ok, false);
});

test("intake: accepts YYYY-MM-DD + boolean taken, normalizes to local midnight", () => {
  const r = validateIntakeBody({ date: "2026-07-24", taken: true });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.taken, true);
    assert.deepEqual(
      [r.date.getFullYear(), r.date.getMonth(), r.date.getDate(), r.date.getHours()],
      [2026, 6, 24, 0],
    );
  }
});

test("intake: rejects bad date and non-boolean taken", () => {
  assert.equal(validateIntakeBody({ date: "07/24/2026", taken: true }).ok, false);
  assert.equal(validateIntakeBody({ date: "2026-07-24", taken: "yes" }).ok, false);
  assert.equal(validateIntakeBody({ taken: true }).ok, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/becks/Desktop/NewView/wondish_02 && npm test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './supplements'`.

- [ ] **Step 3: Implement `lib/supplements.ts`**

```ts
// Pure validation for the /api/supplements routes, following lib/journal.ts:
// routes stay thin, everything decidable without Prisma lives (and is tested) here.
import { parseLocalDateStrict } from "./journal";

export type SupplementTimeSlot = "MORNING" | "AFTERNOON" | "EVENING";
const TIME_SLOTS: readonly string[] = ["MORNING", "AFTERNOON", "EVENING"];
const MAX_LEN = 100;

export type SupplementBodyValidation =
  | { ok: true; name?: string; dosage?: string | null; timeSlot?: SupplementTimeSlot }
  | { ok: false; error: string };

/**
 * partial:false (POST) requires name + timeSlot; partial:true (PATCH)
 * validates only the keys present so a rename doesn't have to resend the slot.
 * dosage:null is a deliberate "clear it"; name:null is rejected.
 */
export function validateSupplementBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): SupplementBodyValidation {
  const out: { ok: true; name?: string; dosage?: string | null; timeSlot?: SupplementTimeSlot } = { ok: true };

  if (body.name !== undefined || !partial) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { ok: false, error: "name must be a non-empty string" };
    }
    const name = body.name.trim();
    if (name.length > MAX_LEN) return { ok: false, error: `name must be at most ${MAX_LEN} characters` };
    out.name = name;
  }

  if (body.dosage !== undefined || !partial) {
    if (body.dosage === undefined || body.dosage === null || body.dosage === "") {
      out.dosage = null;
    } else if (typeof body.dosage === "string") {
      const dosage = body.dosage.trim();
      if (dosage.length > MAX_LEN) return { ok: false, error: `dosage must be at most ${MAX_LEN} characters` };
      out.dosage = dosage.length === 0 ? null : dosage;
    } else {
      return { ok: false, error: "dosage must be a string" };
    }
  }

  if (body.timeSlot !== undefined || !partial) {
    if (typeof body.timeSlot !== "string" || !TIME_SLOTS.includes(body.timeSlot)) {
      return { ok: false, error: "timeSlot must be MORNING, AFTERNOON or EVENING" };
    }
    out.timeSlot = body.timeSlot as SupplementTimeSlot;
  }

  return out;
}

export type IntakeBodyValidation =
  | { ok: true; date: Date; taken: boolean }
  | { ok: false; error: string };

export function validateIntakeBody(body: Record<string, unknown>): IntakeBodyValidation {
  const date = parseLocalDateStrict(body.date);
  if (!date) return { ok: false, error: "date must be a YYYY-MM-DD string" };
  date.setHours(0, 0, 0, 0);
  if (typeof body.taken !== "boolean") return { ok: false, error: "taken must be a boolean" };
  return { ok: true, date, taken: body.taken };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: all pass (existing suites + 9 new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/supplements.ts lib/supplements.test.ts
git commit -m "feat(supplements): pure validation for supplement + intake bodies"
```

---

### Task 2: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma` (add two models; add one back-relation line to `Patient`)

**Interfaces:**
- Produces (used by Tasks 3–5): `prisma.supplement`, `prisma.supplementIntake` with the exact fields below.

- [ ] **Step 1: Add models to `prisma/schema.prisma`**

Append after the `JournalMeal` model:

```prisma
model Supplement {
  id        String             @id @default(cuid())
  patientId String
  patient   Patient            @relation(fields: [patientId], references: [id], onDelete: Cascade)
  name      String
  dosage    String?
  timeSlot  String // "MORNING" | "AFTERNOON" | "EVENING"
  deletedAt DateTime? // soft delete: past journal days keep showing real intakes
  createdAt DateTime           @default(now())
  intakes   SupplementIntake[]

  @@index([patientId])
}

model SupplementIntake {
  id           String     @id @default(cuid())
  supplementId String
  supplement   Supplement @relation(fields: [supplementId], references: [id], onDelete: Cascade)
  patientId    String // scalar copy for range queries; cascade rides the supplement relation
  date         DateTime // local midnight, journal-style
  createdAt    DateTime   @default(now())

  @@unique([supplementId, date])
  @@index([patientId, date])
}
```

In `model Patient`, after `mealLogs          MealLog[]` add:

```prisma
  supplements       Supplement[]
```

- [ ] **Step 2: Create the migration**

Run: `cd /Users/becks/Desktop/NewView/wondish_02 && npx prisma migrate dev --name add_supplements 2>&1 | tail -5`
Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/`.
If no local database is reachable, run `npx prisma migrate dev --name add_supplements --create-only` instead (authors the SQL without executing — matches this repo's "authored, NOT executed" release posture) and then `npx prisma generate`.

- [ ] **Step 3: Verify the client compiles**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: no new errors (`prisma generate` gave the client `supplement` / `supplementIntake` delegates).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(supplements): Supplement + SupplementIntake models (soft delete, unique per day)"
```

---

### Task 3: `GET/POST /api/supplements`

**Files:**
- Create: `app/api/supplements/route.ts`

**Interfaces:**
- Consumes: `validateSupplementBody` (Task 1), Prisma models (Task 2), `parseLocalDateStrict` (`lib/journal.ts`).
- Produces (consumed by iOS Task 7): `GET ?date=YYYY-MM-DD` → `{ supplements: [{ id, name, dosage, timeSlot, takenToday }] }` ordered by timeSlot (MORNING, AFTERNOON, EVENING) then createdAt; `POST {name, dosage?, timeSlot}` → `{ supplement: { id, name, dosage, timeSlot, takenToday: false } }` (201).

- [ ] **Step 1: Write `app/api/supplements/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";
import { validateSupplementBody } from "@/lib/supplements";

const SLOT_ORDER: Record<string, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };

async function resolvePatient(userId: string) {
  return prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const dateParam = req.nextUrl.searchParams.get("date");
  let date: Date;
  if (dateParam) {
    const parsed = parseLocalDateStrict(dateParam);
    if (!parsed) return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
    date = parsed;
  } else {
    date = new Date();
  }
  date.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const rows = await prisma.supplement.findMany({
    where: { patientId: patient.id, deletedAt: null },
    include: { intakes: { where: { date: { gte: date, lte: dateEnd } }, select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });

  const supplements = rows
    .map((s) => ({
      id: s.id,
      name: s.name,
      dosage: s.dosage,
      timeSlot: s.timeSlot,
      takenToday: s.intakes.length > 0,
    }))
    .sort((a, b) => (SLOT_ORDER[a.timeSlot] ?? 9) - (SLOT_ORDER[b.timeSlot] ?? 9));

  return NextResponse.json({ supplements });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateSupplementBody(body, { partial: false });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const created = await prisma.supplement.create({
    data: { patientId: patient.id, name: v.name!, dosage: v.dosage ?? null, timeSlot: v.timeSlot! },
  });
  return NextResponse.json(
    { supplement: { id: created.id, name: created.name, dosage: created.dosage, timeSlot: created.timeSlot, takenToday: false } },
    { status: 201 },
  );
}
```

- [ ] **Step 2: Verify compile + existing tests**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: clean compile, all tests pass (route logic is thin; its validation is Task 1's tested code).

- [ ] **Step 3: Commit**

```bash
git add app/api/supplements/route.ts
git commit -m "feat(supplements): list + create routes (per-day takenToday)"
```

---

### Task 4: `PATCH/DELETE /api/supplements/[id]` + `POST /api/supplements/[id]/intake`

**Files:**
- Create: `app/api/supplements/[id]/route.ts`
- Create: `app/api/supplements/[id]/intake/route.ts`

**Interfaces:**
- Consumes: `validateSupplementBody`, `validateIntakeBody` (Task 1); Prisma (Task 2).
- Produces (consumed by iOS Task 7): `PATCH {name?, dosage?, timeSlot?}` → `{ supplement: {id, name, dosage, timeSlot} }`; `DELETE` → `{ ok: true }` (soft delete); `POST /intake {date, taken}` → `{ ok: true, taken }` (idempotent upsert/delete).

- [ ] **Step 1: Write `app/api/supplements/[id]/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateSupplementBody } from "@/lib/supplements";

/** 404s unless the supplement exists, is live, and belongs to the caller. */
async function resolveOwnedSupplement(userId: string, id: string) {
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return null;
  const supplement = await prisma.supplement.findFirst({
    where: { id, patientId: patient.id, deletedAt: null },
  });
  return supplement ? { patient, supplement } : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owned = await resolveOwnedSupplement(userId, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateSupplementBody(body, { partial: true });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.supplement.update({
    where: { id: owned.supplement.id },
    data: {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.dosage !== undefined ? { dosage: v.dosage } : {}),
      ...(v.timeSlot !== undefined ? { timeSlot: v.timeSlot } : {}),
    },
  });
  return NextResponse.json({
    supplement: { id: updated.id, name: updated.name, dosage: updated.dosage, timeSlot: updated.timeSlot },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owned = await resolveOwnedSupplement(userId, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Soft delete: history keeps showing what was actually taken.
  await prisma.supplement.update({ where: { id: owned.supplement.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write `app/api/supplements/[id]/intake/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateIntakeBody } from "@/lib/supplements";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const supplement = await prisma.supplement.findFirst({
    where: { id: params.id, patientId: patient.id, deletedAt: null },
  });
  if (!supplement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateIntakeBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // Idempotent: upsert on (supplementId, date) when taking; deleteMany when untaking.
  if (v.taken) {
    await prisma.supplementIntake.upsert({
      where: { supplementId_date: { supplementId: supplement.id, date: v.date } },
      create: { supplementId: supplement.id, patientId: patient.id, date: v.date },
      update: {},
    });
  } else {
    await prisma.supplementIntake.deleteMany({
      where: { supplementId: supplement.id, date: v.date },
    });
  }
  return NextResponse.json({ ok: true, taken: v.taken });
}
```

- [ ] **Step 3: Verify compile + tests**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: clean; all pass.

- [ ] **Step 4: Commit**

```bash
git add "app/api/supplements/[id]"
git commit -m "feat(supplements): update, soft-delete, and idempotent per-day intake toggle"
```

---

### Task 5: `GET /api/supplements/history`

**Files:**
- Create: `app/api/supplements/history/route.ts`

**Interfaces:**
- Consumes: Prisma (Task 2), `parseLocalDateStrict` (`lib/journal.ts`).
- Produces (consumed by iOS Task 10): `GET ?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ days: [{ date: "YYYY-MM-DD", taken: [{ name }], total }] }` — `taken` includes soft-deleted supplements' past intakes; `total` = count of supplements live on that day is intentionally simplified to the CURRENT live count (see comment in code); days with no data are omitted.

- [ ] **Step 1: Write `app/api/supplements/history/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const from = parseLocalDateStrict(req.nextUrl.searchParams.get("from"));
  const to = parseLocalDateStrict(req.nextUrl.searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD strings" }, { status: 400 });
  }
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  const [intakes, liveCount] = await Promise.all([
    prisma.supplementIntake.findMany({
      where: { patientId: patient.id, date: { gte: from, lte: to } },
      // Includes soft-deleted supplements: past days stay truthful.
      include: { supplement: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    // "of N" denominator: current live supplement count. Per-day historical
    // denominators would need created/deleted interval math the journal
    // doesn't need — YAGNI, revisit if users notice.
    prisma.supplement.count({ where: { patientId: patient.id, deletedAt: null } }),
  ]);

  const byDate = new Map<string, { name: string }[]>();
  for (const intake of intakes) {
    const key = fmtDate(new Date(intake.date));
    const list = byDate.get(key) ?? [];
    list.push({ name: intake.supplement.name });
    byDate.set(key, list);
  }

  const days = Array.from(byDate.entries()).map(([date, taken]) => ({
    date,
    taken,
    total: Math.max(liveCount, taken.length),
  }));
  return NextResponse.json({ days });
}
```

- [ ] **Step 2: Verify compile + tests**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: clean; all pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/supplements/history
git commit -m "feat(supplements): per-day intake history for the journal"
```

---

### Task 6: `?allMeals=1` on `/api/journal/calendar`

**Files:**
- Modify: `app/api/journal/calendar/route.ts` (the `ratedMeals` filter block, ~line 148)
- Modify: `lib/journal.ts` (add pure meal-filter helper)
- Test: `lib/journal.test.ts` (append tests)

**Interfaces:**
- Consumes: existing calendar route internals.
- Produces (consumed by iOS Task 10): with `?allMeals=1`, each entry's `meals` includes ALL non-skipped meals — `{ mealType, recipeName, rating: number | null }` (rating `null`/`0` = unrated). Without the param, behavior is byte-identical to today (web unaffected).
- New in `lib/journal.ts`: `filterCalendarMeals<T extends { skipped: boolean; rating: number | null }>(meals: T[], allMeals: boolean): T[]`.

- [ ] **Step 1: Append failing tests to `lib/journal.test.ts`**

```ts
test("filterCalendarMeals: default keeps only rated, non-skipped meals", () => {
  const meals = [
    { skipped: false, rating: 1 },
    { skipped: false, rating: 0 },
    { skipped: false, rating: null },
    { skipped: true, rating: 1 },
  ];
  assert.deepEqual(filterCalendarMeals(meals, false), [{ skipped: false, rating: 1 }]);
});

test("filterCalendarMeals: allMeals keeps every non-skipped meal", () => {
  const meals = [
    { skipped: false, rating: 1 },
    { skipped: false, rating: null },
    { skipped: true, rating: 1 },
  ];
  assert.deepEqual(filterCalendarMeals(meals, true), [
    { skipped: false, rating: 1 },
    { skipped: false, rating: null },
  ]);
});
```

(Import `filterCalendarMeals` alongside the file's existing `./journal` imports.)

- [ ] **Step 2: Run to verify failure** — `npm test 2>&1 | tail -5` — expect FAIL (`filterCalendarMeals` not exported).

- [ ] **Step 3: Implement**

In `lib/journal.ts` append:

```ts
// Calendar meal filter: the web journal shows only rated meals; the iOS
// journal (allMeals) shows everything eaten. Skipped meals never render.
export function filterCalendarMeals<T extends { skipped: boolean; rating: number | null }>(
  meals: T[],
  allMeals: boolean,
): T[] {
  return meals.filter((m) => !m.skipped && (allMeals || (m.rating != null && m.rating !== 0)));
}
```

In `app/api/journal/calendar/route.ts`:
- Change the signature `export async function GET()` to `export async function GET(req: NextRequest)` and add `NextRequest` to the `next/server` import.
- Add near the top of the handler: `const allMeals = req.nextUrl.searchParams.get("allMeals") === "1";`
- Replace the rated-meals block:

```ts
      const ratedMeals = entry.meals
        .filter((m) => !m.skipped && m.rating != null && m.rating !== 0)
        .map((m) => ({
```

with:

```ts
      const ratedMeals = filterCalendarMeals(entry.meals, allMeals)
        .map((m) => ({
```

- In the same `.map`, change `rating: m.rating!` to `rating: allMeals ? m.rating ?? null : m.rating!` and import `filterCalendarMeals` from `@/lib/journal`.

- [ ] **Step 4: Run tests** — `npm test 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3` — expect all pass, clean compile.

- [ ] **Step 5: Commit**

```bash
git add lib/journal.ts lib/journal.test.ts app/api/journal/calendar/route.ts
git commit -m "feat(journal): allMeals=1 calendar mode for the iOS journal (default unchanged)"
```

---

### Task 7: iOS Supplements DTOs + service

**Files (Clara repo):**
- Create: `Clara/Features/Supplements/SupplementDTOs.swift`
- Create: `Clara/Features/Supplements/SupplementService.swift`
- Test: `ClaraTests/SupplementDTOTests.swift`
- Modify: `Clara.xcodeproj/project.pbxproj` (register all three)

**Interfaces:**
- Consumes: `WondishAPIClient`, `APIRequest` (existing Core/Networking).
- Produces (used by Tasks 8–9):

```swift
enum SupplementTimeSlot: String, Codable, CaseIterable { case morning = "MORNING", afternoon = "AFTERNOON", evening = "EVENING" }
struct SupplementDTO: Codable, Identifiable, Equatable { let id, name: String; let dosage: String?; let timeSlot: SupplementTimeSlot; var takenToday: Bool }
protocol SupplementProviding: Sendable {
    func list(date: String) async throws -> [SupplementDTO]
    func create(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO
    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO
    func delete(id: String) async throws
    func setIntake(id: String, date: String, taken: Bool) async throws
}
```

- [ ] **Step 1: Write failing decode tests** (`ClaraTests/SupplementDTOTests.swift`)

```swift
import XCTest
@testable import Clara

final class SupplementDTOTests: XCTestCase {
    func testDecodesListEnvelope() throws {
        let json = """
        {"supplements":[{"id":"s1","name":"Vitamin D3","dosage":"2000 IU","timeSlot":"MORNING","takenToday":true},
                        {"id":"s2","name":"Probiotic","dosage":null,"timeSlot":"EVENING","takenToday":false}]}
        """.data(using: .utf8)!
        let envelope = try JSONDecoder().decode(SupplementListDTO.self, from: json)
        XCTAssertEqual(envelope.supplements.count, 2)
        XCTAssertEqual(envelope.supplements[0].timeSlot, .morning)
        XCTAssertTrue(envelope.supplements[0].takenToday)
        XCTAssertNil(envelope.supplements[1].dosage)
    }

    func testUnknownTimeSlotFailsLoudly() {
        let json = """
        {"supplements":[{"id":"s1","name":"X","dosage":null,"timeSlot":"NIGHT","takenToday":false}]}
        """.data(using: .utf8)!
        XCTAssertThrowsError(try JSONDecoder().decode(SupplementListDTO.self, from: json))
    }
}
```

- [ ] **Step 2: Register the test file in pbxproj + run to verify compile failure**

Register `SupplementDTOTests.swift` in `project.pbxproj` (ClaraTests group + ClaraTests Sources phase — 4-point hand-edit per commit `78b1089`: PBXBuildFile entry, PBXFileReference entry, group `children` entry, Sources `files` entry; generate each 24-hex UUID with `uuidgen | tr -d - | cut -c1-24 | tr a-f A-F`).
Run: `cd /Users/becks/Desktop/NewView/Clara && xcodebuild test -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" -only-testing ClaraTests/SupplementDTOTests 2>&1 | tail -5`
Expected: compile FAIL — `SupplementListDTO` undefined.

- [ ] **Step 3: Write `SupplementDTOs.swift`**

```swift
import Foundation

// Wire types for /api/supplements — mirrors the route payloads exactly.
// timeSlot is a closed enum: an unknown slot is a contract break we want to
// hear about (decode failure), not silently mis-bucket.
enum SupplementTimeSlot: String, Codable, CaseIterable {
    case morning = "MORNING"
    case afternoon = "AFTERNOON"
    case evening = "EVENING"

    var displayName: String {
        switch self {
        case .morning: return "Morning"
        case .afternoon: return "Afternoon"
        case .evening: return "Evening"
        }
    }

    var symbolName: String {
        switch self {
        case .morning: return "sun.max"
        case .afternoon: return "clock"
        case .evening: return "moon"
        }
    }
}

struct SupplementDTO: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let dosage: String?
    let timeSlot: SupplementTimeSlot
    var takenToday: Bool
}

struct SupplementListDTO: Codable {
    let supplements: [SupplementDTO]
}

struct SupplementEnvelopeDTO: Codable {
    let supplement: SupplementDTO
}
```

Note: `POST /api/supplements` and `PATCH .../[id]` responses omit `takenToday` on PATCH — the PATCH payload is `{id,name,dosage,timeSlot}`. Give `SupplementDTO.takenToday` a decode default so one DTO serves both:

```swift
    // (inside SupplementDTO)
    enum CodingKeys: String, CodingKey { case id, name, dosage, timeSlot, takenToday }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        dosage = try c.decodeIfPresent(String.self, forKey: .dosage)
        timeSlot = try c.decode(SupplementTimeSlot.self, forKey: .timeSlot)
        takenToday = try c.decodeIfPresent(Bool.self, forKey: .takenToday) ?? false
    }
    init(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot, takenToday: Bool) {
        self.id = id; self.name = name; self.dosage = dosage; self.timeSlot = timeSlot; self.takenToday = takenToday
    }
```

- [ ] **Step 4: Write `SupplementService.swift`**

```swift
import Foundation

protocol SupplementProviding: Sendable {
    func list(date: String) async throws -> [SupplementDTO]
    func create(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO
    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO
    func delete(id: String) async throws
    func setIntake(id: String, date: String, taken: Bool) async throws
}

struct SupplementService: SupplementProviding {
    private let api: WondishAPIClient
    init(api: WondishAPIClient) { self.api = api }

    func list(date: String) async throws -> [SupplementDTO] {
        try await api.send(APIRequest(path: "/api/supplements",
                                      query: [URLQueryItem(name: "date", value: date)]),
                           as: SupplementListDTO.self).supplements
    }

    func create(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO {
        struct Body: Encodable { let name: String; let dosage: String?; let timeSlot: String }
        return try await api.send(APIRequest(path: "/api/supplements", method: .post,
                                             body: Body(name: name, dosage: dosage, timeSlot: timeSlot.rawValue)),
                                  as: SupplementEnvelopeDTO.self).supplement
    }

    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO {
        struct Body: Encodable { let name: String; let dosage: String?; let timeSlot: String }
        return try await api.send(APIRequest(path: "/api/supplements/\(id)", method: .patch,
                                             body: Body(name: name, dosage: dosage, timeSlot: timeSlot.rawValue)),
                                  as: SupplementEnvelopeDTO.self).supplement
    }

    func delete(id: String) async throws {
        try await api.send(APIRequest(path: "/api/supplements/\(id)", method: .delete))
    }

    func setIntake(id: String, date: String, taken: Bool) async throws {
        struct Body: Encodable { let date: String; let taken: Bool }
        try await api.send(APIRequest(path: "/api/supplements/\(id)/intake", method: .post,
                                      body: Body(date: date, taken: taken)))
    }
}
```

(If `APIRequest.Method` lacks `.delete`, add `case delete = "DELETE"` to it — check `Clara/Core/Networking/APIRequest.swift` first.)

- [ ] **Step 5: Register both app files in pbxproj (app target Sources), run the Step-2 test command** — expect `Test Suite 'SupplementDTOTests' passed`.

- [ ] **Step 6: Commit (Clara repo)**

```bash
cd /Users/becks/Desktop/NewView/Clara && git add Clara/Features/Supplements ClaraTests/SupplementDTOTests.swift Clara.xcodeproj/project.pbxproj Clara/Core/Networking/APIRequest.swift
git commit -m "feat(supplements): DTOs + service for /api/supplements"
```

---

### Task 8: iOS `SupplementsViewModel` + tests

**Files (Clara repo):**
- Create: `Clara/Features/Supplements/SupplementsViewModel.swift`
- Test: `ClaraTests/SupplementsViewModelTests.swift`
- Modify: `Clara.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: `SupplementProviding` (Task 7), `localDateString(for:)` (existing helper used by `MealPlanViewModel`).
- Produces (used by Task 9's view):

```swift
@Observable @MainActor final class SupplementsViewModel {
    enum State: Equatable { case loading, loaded, failed }
    private(set) var state: State
    private(set) var supplements: [SupplementDTO]      // server order (slot-grouped)
    private(set) var currentDate: String               // YYYY-MM-DD
    private(set) var togglingIDs: Set<String>
    var actionError: String?
    var takenCount: Int { get }
    func grouped(_ slot: SupplementTimeSlot) -> [SupplementDTO]
    func load() async
    func retry() async
    func toggle(_ supplement: SupplementDTO) async     // optimistic, reverts on error
    func add(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async -> Bool
    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async -> Bool
    func remove(_ supplement: SupplementDTO) async
    func clearActionError()
}
```

- [ ] **Step 1: Write failing tests** (`ClaraTests/SupplementsViewModelTests.swift`)

```swift
import XCTest
@testable import Clara

@MainActor
final class SupplementsViewModelTests: XCTestCase {

    final class ScriptedSupplementService: SupplementProviding, @unchecked Sendable {
        private let lock = NSLock()
        var listResult: Result<[SupplementDTO], APIError> = .success([])
        var createResult: Result<SupplementDTO, APIError> = .failure(.transport)
        var updateResult: Result<SupplementDTO, APIError> = .failure(.transport)
        var deleteError: APIError?
        var intakeError: APIError?
        private(set) var recordedIntakes: [(id: String, date: String, taken: Bool)] = []

        func list(date: String) async throws -> [SupplementDTO] { try listResult.get() }
        func create(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO { try createResult.get() }
        func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO { try updateResult.get() }
        func delete(id: String) async throws { if let deleteError { throw deleteError } }
        func setIntake(id: String, date: String, taken: Bool) async throws {
            if let intakeError { throw intakeError }
            lock.lock(); recordedIntakes.append((id, date, taken)); lock.unlock()
        }
    }

    private func dto(_ id: String, slot: SupplementTimeSlot = .morning, taken: Bool = false) -> SupplementDTO {
        SupplementDTO(id: id, name: "Supp \(id)", dosage: nil, timeSlot: slot, takenToday: taken)
    }

    func testLoadGroupsBySlotAndCountsTaken() async {
        let service = ScriptedSupplementService()
        service.listResult = .success([dto("a", slot: .morning, taken: true),
                                       dto("b", slot: .morning),
                                       dto("c", slot: .evening)])
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        XCTAssertEqual(vm.state, .loaded)
        XCTAssertEqual(vm.grouped(.morning).map(\.id), ["a", "b"])
        XCTAssertEqual(vm.grouped(.afternoon), [])
        XCTAssertEqual(vm.grouped(.evening).map(\.id), ["c"])
        XCTAssertEqual(vm.takenCount, 1)
    }

    func testLoadFailureSetsFailed() async {
        let service = ScriptedSupplementService()
        service.listResult = .failure(.transport)
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        XCTAssertEqual(vm.state, .failed)
    }

    func testToggleIsOptimisticAndPostsIntake() async {
        let service = ScriptedSupplementService()
        service.listResult = .success([dto("a")])
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        await vm.toggle(vm.supplements[0])
        XCTAssertTrue(vm.supplements[0].takenToday)
        XCTAssertEqual(service.recordedIntakes.count, 1)
        XCTAssertEqual(service.recordedIntakes[0].taken, true)
        XCTAssertEqual(service.recordedIntakes[0].date, vm.currentDate)
    }

    func testToggleRevertsOnError() async {
        let service = ScriptedSupplementService()
        service.listResult = .success([dto("a")])
        service.intakeError = .transport
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        await vm.toggle(vm.supplements[0])
        XCTAssertFalse(vm.supplements[0].takenToday)
        XCTAssertNotNil(vm.actionError)
    }

    func testAddAppendsOnSuccess() async {
        let service = ScriptedSupplementService()
        service.listResult = .success([])
        service.createResult = .success(dto("new", slot: .afternoon))
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        let ok = await vm.add(name: "Magnesium", dosage: "400 mg", timeSlot: .afternoon)
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.grouped(.afternoon).map(\.id), ["new"])
    }

    func testRemoveDeletesLocallyOnSuccessAndKeepsOnFailure() async {
        let service = ScriptedSupplementService()
        service.listResult = .success([dto("a"), dto("b")])
        let vm = SupplementsViewModel(service: service)
        await vm.load()
        await vm.remove(vm.supplements[0])
        XCTAssertEqual(vm.supplements.map(\.id), ["b"])
        service.deleteError = .transport
        await vm.remove(vm.supplements[0])
        XCTAssertEqual(vm.supplements.map(\.id), ["b"])
        XCTAssertNotNil(vm.actionError)
    }
}
```

- [ ] **Step 2: Register test file in pbxproj, run** `-only-testing ClaraTests/SupplementsViewModelTests` — expect compile FAIL (`SupplementsViewModel` undefined).

- [ ] **Step 3: Implement `SupplementsViewModel.swift`**

```swift
import Foundation
import Observation

// Same posture as MealPlanViewModel: @Observable @MainActor, protocol seam,
// optimistic toggles that revert on server failure.
@Observable @MainActor
final class SupplementsViewModel {
    enum State: Equatable { case loading, loaded, failed }

    private(set) var state: State = .loading
    private(set) var supplements: [SupplementDTO] = []
    private(set) var currentDate: String = localDateString(for: Date())
    private(set) var togglingIDs: Set<String> = []
    var actionError: String?

    private let service: SupplementProviding
    init(service: SupplementProviding) { self.service = service }

    var takenCount: Int { supplements.filter(\.takenToday).count }

    func grouped(_ slot: SupplementTimeSlot) -> [SupplementDTO] {
        supplements.filter { $0.timeSlot == slot }
    }

    func load() async {
        state = .loading
        currentDate = localDateString(for: Date())
        do {
            supplements = try await service.list(date: currentDate)
            state = .loaded
        } catch {
            state = .failed
        }
    }

    func retry() async { await load() }

    func toggle(_ supplement: SupplementDTO) async {
        guard let index = supplements.firstIndex(where: { $0.id == supplement.id }),
              !togglingIDs.contains(supplement.id) else { return }
        let newValue = !supplements[index].takenToday
        supplements[index].takenToday = newValue
        togglingIDs.insert(supplement.id)
        defer { togglingIDs.remove(supplement.id) }
        do {
            try await service.setIntake(id: supplement.id, date: currentDate, taken: newValue)
        } catch {
            if let revertIndex = supplements.firstIndex(where: { $0.id == supplement.id }) {
                supplements[revertIndex].takenToday = !newValue
            }
            actionError = "Couldn't save that check-off. Please try again."
        }
    }

    func add(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async -> Bool {
        do {
            let created = try await service.create(name: name, dosage: dosage, timeSlot: timeSlot)
            supplements.append(created)
            return true
        } catch {
            actionError = "Couldn't add the supplement. Please try again."
            return false
        }
    }

    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async -> Bool {
        do {
            let updated = try await service.update(id: id, name: name, dosage: dosage, timeSlot: timeSlot)
            if let index = supplements.firstIndex(where: { $0.id == id }) {
                let taken = supplements[index].takenToday
                supplements[index] = SupplementDTO(id: updated.id, name: updated.name, dosage: updated.dosage,
                                                   timeSlot: updated.timeSlot, takenToday: taken)
            }
            return true
        } catch {
            actionError = "Couldn't save the changes. Please try again."
            return false
        }
    }

    func remove(_ supplement: SupplementDTO) async {
        do {
            try await service.delete(id: supplement.id)
            supplements.removeAll { $0.id == supplement.id }
        } catch {
            actionError = "Couldn't delete the supplement. Please try again."
        }
    }

    func clearActionError() { actionError = nil }
}
```

- [ ] **Step 4: Register in pbxproj, run** `ClaraTests/SupplementsViewModelTests` — expect pass. Then run the FULL suite once (no `-only-testing`) — expect all green.

- [ ] **Step 5: Commit**

```bash
git add Clara/Features/Supplements/SupplementsViewModel.swift ClaraTests/SupplementsViewModelTests.swift Clara.xcodeproj/project.pbxproj
git commit -m "feat(supplements): view model — grouped list, optimistic check-off, CRUD"
```

---

### Task 9: iOS `SupplementsView` (list + add/edit sheet)

**Files (Clara repo):**
- Create: `Clara/Features/Supplements/SupplementsView.swift`
- Modify: `Clara.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: `SupplementsViewModel` (Task 8), design system, `LaunchFixtures` (stub wired in Task 12).
- Produces: `struct SupplementsView: View` with `init(vm: SupplementsViewModel?)` — `PlanHubView` (Task 11) owns VM creation and passes it in (hub owns all three VMs so segment switches don't lose state).

- [ ] **Step 1: Implement the view** — accepted mockup is the source of truth. Structure:

```swift
import SwiftUI

// Supplements segment of the Plan hub. Mirrors the accepted mockup:
// summary card with progress bar, slot-grouped check-off rows, add/edit sheet.
struct SupplementsView: View {
    let vm: SupplementsViewModel?
    @State private var editorTarget: SupplementEditorTarget?

    var body: some View {
        VStack(alignment: .leading, spacing: WSpacing.xl) {
            content
        }
        .sheet(item: $editorTarget) { target in
            if let vm {
                SupplementEditorSheet(vm: vm, target: target)
                    .presentationDetents([.medium])
            }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { vm?.actionError != nil },
            set: { if !$0 { vm?.clearActionError() } }
        )) {
            Button("OK", role: .cancel) {}
        } message: { Text(vm?.actionError ?? "") }
        .task {
            guard let vm else { return }
            if case .loading = vm.state { await vm.load() }
        }
    }

    @ViewBuilder private var content: some View {
        switch vm?.state ?? .loading {
        case .loading: loadingSection
        case .failed: failedSection
        case .loaded:
            if let vm {
                if vm.supplements.isEmpty { emptySection }
                else {
                    summaryCard(vm)
                    ForEach(SupplementTimeSlot.allCases, id: \.self) { slot in
                        let items = vm.grouped(slot)
                        if !items.isEmpty { slotSection(slot, items: items, vm: vm) }
                    }
                    Button("Add supplement") { editorTarget = .create }
                        .buttonStyle(WButtonStyle(variant: .primary, size: .lg))
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}
```

Required pieces (all in this file, matching the mockup):
- `summaryCard(_:)` — kicker `"TODAY, \(MealPlanView.displayDate(vm.currentDate))"`, `"\(vm.takenCount)"` big + `"of \(vm.supplements.count) taken"`, `WBadge(text: vm.takenCount == vm.supplements.count ? "all done" : "on track", variant: .success)`, and a progress bar: `Capsule().fill(WColor.surfaceSecondary)` track (height 6) overlaid by a `Capsule().fill(WColor.success)` fill scaled to `CGFloat(vm.takenCount) / CGFloat(max(vm.supplements.count, 1))` with `.animation(.easeOut(duration: 0.25), value: vm.takenCount)`.
- `slotSection(_:items:vm:)` — header `Label(slot.displayName.uppercased(), systemImage: slot.symbolName)` styled kicker-muted (`WFont.inter(11, .bold)`, tracking 1.6, `WColor.textTertiary`, icon `WColor.primaryLight`); rows inside one `.wCard(padding: WSpacing.md)` `VStack(spacing: 0)` with `Divider().overlay(WColor.border)` between rows.
- `supplementRow` — `Button` toggling via `Task { await vm.toggle(item) }`: leading 26pt circle (`checkmark` white when taken, `WColor.success` fill; `WColor.border` stroke when not), name `WFont.inter(15, .semibold)` (strikethrough + `textTertiary` when taken), dosage caption `WFont.inter(12)` `textTertiary`; `minHeight: 52`, `.contentShape(Rectangle())`, `.accessibilityAddTraits(item.takenToday ? .isSelected : [])`, `.accessibilityLabel("\(item.name), \(item.timeSlot.displayName)")`. Swipe actions via wrapping rows in a `List`? NO — the hub scroll is a `ScrollView`; instead add `.contextMenu` with "Edit" (`editorTarget = .edit(item)`) and "Delete" (role: .destructive, confirmation `.alert`) — simpler than nested `List` swipe and still discoverable; add a trailing "⋯" `Menu` button (SF Symbol `ellipsis`) with the same two actions for visibility.
- `emptySection` — `pills` SF Symbol (44pt light, `WColor.primary`), "No supplements yet" (`WFont.inter(20, .extrabold)`), caption "Add the vitamins and supplements you take, and check them off each day." (`WFont.inter(14)`, `textSecondary`, centered), primary lg "Add supplement" button setting `editorTarget = .create`.
- `loadingSection` — 3 redacted placeholder cards (copy `MealPlanView.loadingSection` shape, texts "SUPPLEMENT" / "Loading your list" / "One moment").
- `failedSection` — copy `MealPlanView.failedSection` with text "Couldn't load your supplements", retry calls `vm.retry()`.
- `enum SupplementEditorTarget: Identifiable { case create; case edit(SupplementDTO); var id: String { ... } }` (`create` → `"create"`, `edit` → the DTO id).
- `SupplementEditorSheet` — `NavigationStack` with `WTextField(label: "Name", ...)` (required), `WTextField(label: "Dosage (optional)", placeholder: "e.g. 500 mg · 1 tablet")`, and a 3-chip slot picker (`ForEach(SupplementTimeSlot.allCases)` buttons: selected = `WColor.primary.opacity(0.08)` bg + primary border + primary text; unselected = white bg + `WColor.border`); prefilled when editing. Save button (primary lg, title "Add supplement" / "Save changes") disabled while saving or when name trimmed empty; on success `dismiss()`. Cancel toolbar button.

- [ ] **Step 2: Register in pbxproj; build** — `xcodebuild build -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" 2>&1 | tail -3` — expect `BUILD SUCCEEDED`.

- [ ] **Step 3: Run full test suite** — expect all green (view compiles; logic already covered by Task 8 tests).

- [ ] **Step 4: Commit**

```bash
git add Clara/Features/Supplements/SupplementsView.swift Clara.xcodeproj/project.pbxproj
git commit -m "feat(supplements): slot-grouped check-off screen with add/edit sheet"
```

---

### Task 10: iOS Journal DTOs + service + view model

**Files (Clara repo):**
- Create: `Clara/Features/Journal/JournalDTOs.swift`
- Create: `Clara/Features/Journal/JournalService.swift`
- Create: `Clara/Features/Journal/JournalViewModel.swift`
- Test: `ClaraTests/JournalViewModelTests.swift`
- Modify: `Clara.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: `WondishAPIClient`; server contracts from Tasks 5–6.
- Produces (used by Task 11's view):

```swift
struct JournalCalendarDTO: Codable {
    let planStartDate: String
    let planEndDate: String
    let entries: [String: JournalCalendarEntryDTO]   // keyed by YYYY-MM-DD
}
struct JournalCalendarEntryDTO: Codable, Equatable {
    let dailyCalorieTarget: Double?
    let meals: [JournalCalendarMealDTO]
}
struct JournalCalendarMealDTO: Codable, Equatable {
    let mealType: String
    let recipeName: String
    let rating: Double?
}
struct SupplementHistoryDTO: Codable {
    let days: [SupplementHistoryDayDTO]
}
struct SupplementHistoryDayDTO: Codable, Equatable {
    let date: String
    let taken: [SupplementHistoryItemDTO]
    let total: Int
}
struct SupplementHistoryItemDTO: Codable, Equatable { let name: String }

protocol JournalProviding: Sendable {
    func calendar() async throws -> JournalCalendarDTO           // GET /api/journal/calendar?allMeals=1
    func supplementHistory(from: String, to: String) async throws -> [SupplementHistoryDayDTO]
}

struct JournalDay: Identifiable, Equatable {
    let date: String            // YYYY-MM-DD
    var id: String { date }
    let calorieTarget: Double?
    let meals: [JournalCalendarMealDTO]
    let supplementsTaken: [String]   // names
    let supplementsTotal: Int
}

@Observable @MainActor final class JournalViewModel {
    enum State: Equatable { case loading, loaded, failed }
    private(set) var state: State
    private(set) var days: [JournalDay]   // newest first; only days with any data; no future days
    func load() async
    func retry() async
}
```

- [ ] **Step 1: Write failing tests** (`ClaraTests/JournalViewModelTests.swift`)

```swift
import XCTest
@testable import Clara

@MainActor
final class JournalViewModelTests: XCTestCase {

    final class ScriptedJournalService: JournalProviding, @unchecked Sendable {
        var calendarResult: Result<JournalCalendarDTO, APIError> = .failure(.transport)
        var historyResult: Result<[SupplementHistoryDayDTO], APIError> = .success([])
        private(set) var historyRanges: [(from: String, to: String)] = []
        func calendar() async throws -> JournalCalendarDTO { try calendarResult.get() }
        func supplementHistory(from: String, to: String) async throws -> [SupplementHistoryDayDTO] {
            historyRanges.append((from, to))
            return try historyResult.get()
        }
    }

    private func calendar(_ entries: [String: JournalCalendarEntryDTO],
                          start: String = "2026-07-20", end: String = "2026-07-24") -> JournalCalendarDTO {
        JournalCalendarDTO(planStartDate: start, planEndDate: end, entries: entries)
    }
    private func meal(_ name: String, rating: Double? = nil) -> JournalCalendarMealDTO {
        JournalCalendarMealDTO(mealType: "Lunch", recipeName: name, rating: rating)
    }

    func testMergesMealsAndSupplementsNewestFirstDroppingEmptyDays() async {
        let service = ScriptedJournalService()
        service.calendarResult = .success(calendar([
            "2026-07-21": JournalCalendarEntryDTO(dailyCalorieTarget: 1900, meals: [meal("Oats", rating: 1)]),
            "2026-07-22": JournalCalendarEntryDTO(dailyCalorieTarget: 1900, meals: []),
            "2026-07-23": JournalCalendarEntryDTO(dailyCalorieTarget: 2000, meals: [meal("Salad")]),
        ]))
        service.historyResult = .success([
            SupplementHistoryDayDTO(date: "2026-07-22", taken: [SupplementHistoryItemDTO(name: "D3")], total: 3),
        ])
        let vm = JournalViewModel(service: service, today: "2026-07-24")
        await vm.load()
        XCTAssertEqual(vm.state, .loaded)
        XCTAssertEqual(vm.days.map(\.date), ["2026-07-23", "2026-07-22", "2026-07-21"])
        XCTAssertEqual(vm.days[1].supplementsTaken, ["D3"])
        XCTAssertEqual(vm.days[1].supplementsTotal, 3)
        XCTAssertEqual(vm.days[1].meals, [])   // supplement-only day still shows
        XCTAssertEqual(vm.days[2].meals.first?.recipeName, "Oats")
    }

    func testExcludesFutureDaysAndQueriesHistoryOverPlanRange() async {
        let service = ScriptedJournalService()
        service.calendarResult = .success(calendar([
            "2026-07-23": JournalCalendarEntryDTO(dailyCalorieTarget: nil, meals: [meal("Salad")]),
            "2026-07-25": JournalCalendarEntryDTO(dailyCalorieTarget: nil, meals: [meal("Future Dish")]),
        ], start: "2026-07-20", end: "2026-07-26"))
        let vm = JournalViewModel(service: service, today: "2026-07-24")
        await vm.load()
        XCTAssertEqual(vm.days.map(\.date), ["2026-07-23"])
        XCTAssertEqual(historyRangeUsed(service), "2026-07-20...2026-07-24")
    }

    func testCalendarFailureIsFailedEvenIfHistorySucceeds() async {
        let service = ScriptedJournalService()
        service.calendarResult = .failure(.transport)
        let vm = JournalViewModel(service: service, today: "2026-07-24")
        await vm.load()
        XCTAssertEqual(vm.state, .failed)
    }

    func testHistoryFailureStillShowsMeals() async {
        let service = ScriptedJournalService()
        service.calendarResult = .success(calendar([
            "2026-07-23": JournalCalendarEntryDTO(dailyCalorieTarget: nil, meals: [meal("Salad")]),
        ]))
        service.historyResult = .failure(.transport)
        let vm = JournalViewModel(service: service, today: "2026-07-24")
        await vm.load()
        XCTAssertEqual(vm.state, .loaded)
        XCTAssertEqual(vm.days.map(\.date), ["2026-07-23"])
        XCTAssertEqual(vm.days[0].supplementsTotal, 0)
    }
}

extension JournalViewModelTests {
    func historyRangeUsed(_ service: ScriptedJournalService) -> String {
        guard let r = service.historyRanges.first else { return "none" }
        return "\(r.from)...\(r.to)"
    }
}
```


- [ ] **Step 2: Register test file in pbxproj, run** `-only-testing ClaraTests/JournalViewModelTests` — expect compile FAIL.

- [ ] **Step 3: Implement the three files**

`JournalDTOs.swift` — exactly the structs from **Interfaces** above (plain `Codable`, no custom decoding).

`JournalService.swift`:

```swift
import Foundation

protocol JournalProviding: Sendable {
    func calendar() async throws -> JournalCalendarDTO
    func supplementHistory(from: String, to: String) async throws -> [SupplementHistoryDayDTO]
}

struct JournalService: JournalProviding {
    private let api: WondishAPIClient
    init(api: WondishAPIClient) { self.api = api }

    func calendar() async throws -> JournalCalendarDTO {
        try await api.send(APIRequest(path: "/api/journal/calendar",
                                      query: [URLQueryItem(name: "allMeals", value: "1")]),
                           as: JournalCalendarDTO.self)
    }

    func supplementHistory(from: String, to: String) async throws -> [SupplementHistoryDayDTO] {
        try await api.send(APIRequest(path: "/api/supplements/history", query: [
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
        ]), as: SupplementHistoryDTO.self).days
    }
}
```

`JournalViewModel.swift`:

```swift
import Foundation
import Observation

// Read-only history: merges the journal calendar (meals per day) with the
// supplement intake history into newest-first day cards. History failure is
// non-fatal (meals still render); calendar failure is the real failed state.
@Observable @MainActor
final class JournalViewModel {
    enum State: Equatable { case loading, loaded, failed }

    private(set) var state: State = .loading
    private(set) var days: [JournalDay] = []

    private let service: JournalProviding
    private let today: String

    init(service: JournalProviding, today: String = localDateString(for: Date())) {
        self.service = service
        self.today = today
    }

    func load() async {
        state = .loading
        do {
            let calendar = try await service.calendar()
            let to = min(calendar.planEndDate, today)   // YYYY-MM-DD sorts lexicographically
            let history = (try? await service.supplementHistory(from: calendar.planStartDate, to: to)) ?? []
            let historyByDate = Dictionary(uniqueKeysWithValues: history.map { ($0.date, $0) })

            var merged: [JournalDay] = []
            let allDates = Set(calendar.entries.keys).union(historyByDate.keys)
            for date in allDates where date <= today {
                let entry = calendar.entries[date]
                let supps = historyByDate[date]
                let meals = entry?.meals ?? []
                guard !meals.isEmpty || supps != nil else { continue }
                merged.append(JournalDay(date: date,
                                         calorieTarget: entry?.dailyCalorieTarget,
                                         meals: meals,
                                         supplementsTaken: supps?.taken.map(\.name) ?? [],
                                         supplementsTotal: supps?.total ?? 0))
            }
            days = merged.sorted { $0.date > $1.date }
            state = .loaded
        } catch {
            state = .failed
        }
    }

    func retry() async { await load() }
}
```

- [ ] **Step 4: Register all files in pbxproj, run** `ClaraTests/JournalViewModelTests` — expect pass; then full suite — green.

- [ ] **Step 5: Commit**

```bash
git add Clara/Features/Journal ClaraTests/JournalViewModelTests.swift Clara.xcodeproj/project.pbxproj
git commit -m "feat(journal): DTOs, service, and day-merge view model"
```

---

### Task 11: iOS `JournalView` + `PlanHubView` + RootTabView wiring

**Files (Clara repo):**
- Create: `Clara/Features/Journal/JournalView.swift`
- Create: `Clara/Features/MealPlan/PlanHubView.swift`
- Modify: `Clara/Features/MealPlan/MealPlanView.swift` (host inside hub: remove its own `NavigationStack`/`navigationTitle`)
- Modify: `Clara/App/RootTabView.swift:27` (`MealPlanView()` → `PlanHubView()`)
- Modify: `Clara.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: everything above.
- Produces: `PlanHubView` — the new center-tab root.

- [ ] **Step 1: Implement `JournalView.swift`** — day cards per the mockup:

```swift
import SwiftUI

// Journal segment: read-only reverse-chronological day cards (dishes eaten
// with thumbs ratings + which supplements were taken).
struct JournalView: View {
    let vm: JournalViewModel?

    var body: some View {
        VStack(alignment: .leading, spacing: WSpacing.md) {
            content
        }
        .task {
            guard let vm else { return }
            if case .loading = vm.state { await vm.load() }
        }
    }

    @ViewBuilder private var content: some View {
        switch vm?.state ?? .loading {
        case .loading: loadingSection
        case .failed: failedSection
        case .loaded:
            if let vm {
                if vm.days.isEmpty { emptySection }
                else { ForEach(vm.days) { day in dayCard(day) } }
            }
        }
    }
}
```

Required pieces:
- `dayCard(_:)` — `.wCard(padding: WSpacing.lg)`: header row with `Self.displayLabel(day.date)` kicker (`WFont.inter(11, .bold)`, tracking 1.6, `WColor.primary`) and, when `day.calorieTarget != nil`, `"\(Int(target)) kcal"` caption right-aligned (`WFont.inter(12)` monospacedDigit, textTertiary); meal rows (`VStack(spacing: 0)`, `Divider().overlay(WColor.surfaceSecondary)` between): meal-type label uppercased (`WFont.inter(10, .bold)`, tracking 0.8, textTertiary, width 74 leading-aligned), recipe name (`WFont.inter(14, .semibold)`, textPrimary), trailing thumbs icon when rated (`hand.thumbsup.fill` `WColor.success` for rating > 0, `hand.thumbsdown.fill` `WColor.error` for rating < 0, 13pt); supplements footer when `day.supplementsTotal > 0 || !day.supplementsTaken.isEmpty` — top divider, `pills` SF Symbol (`WColor.primary`), `Text("\(day.supplementsTaken.count) of \(day.supplementsTotal) taken")` bold 13 + `" — " + day.supplementsTaken.joined(separator: ", ")` regular 13 textSecondary, lineLimit 2.
- `static func displayLabel(_ localDate: String) -> String` — reuse `MealPlanView.displayDate` for the "JUL 23" part and prefix the weekday computed via `DateComponents` through `Calendar.current` (build the `Date` with the local-time constructor, NEVER `Date(string:)`): result like `"WED · JUL 23"`.
- `emptySection` — `book.closed` SF Symbol, "No history yet", caption "Logged meals and supplements will show up here day by day."
- `loadingSection` — 3 redacted day-card placeholders; `failedSection` — copy pattern, "Couldn't load your journal", retry → `vm.retry()`.

- [ ] **Step 2: Implement `PlanHubView.swift`**

```swift
import SwiftUI

// Center-tab root: "Meal Plan | Supplements | Journal" segmented pill that
// swaps content below, mirroring the bottom tab bar. Owns all three VMs so
// switching segments never loses state. Design-system pill, not
// UISegmentedControl (mockup accepted 2026-07-24).
struct PlanHubView: View {
    enum Segment: String, CaseIterable {
        case mealPlan, supplements, journal
        var title: String {
            switch self {
            case .mealPlan: return "Meal Plan"
            case .supplements: return "Supplements"
            case .journal: return "Journal"
            }
        }
    }

    @State private var segment: Segment = .mealPlan
    @State private var supplementsVM: SupplementsViewModel?
    @State private var journalVM: JournalViewModel?
    @Environment(\.apiClient) private var apiClient

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WSpacing.xl) {
                    switch segment {
                    case .mealPlan: MealPlanView()
                    case .supplements: SupplementsView(vm: supplementsVM)
                    case .journal: JournalView(vm: journalVM)
                    }
                }
                .padding(WSpacing.lg)
                .padding(.bottom, WSpacing.xxl)
                .animation(.easeOut(duration: 0.2), value: segment)
            }
            .background(WColor.background.ignoresSafeArea())
            .navigationTitle("Meal Plan")
            .safeAreaInset(edge: .top, spacing: 0) { switcher }
        }
        .tint(WColor.primary)
        .task { attachViewModelsIfNeeded() }
    }

    private var switcher: some View {
        HStack(spacing: WSpacing.xs) {
            ForEach(Segment.allCases, id: \.self) { s in
                Button {
                    segment = s
                } label: {
                    Text(s.title)
                        .font(WFont.inter(13, segment == s ? .bold : .semibold))
                        .foregroundStyle(segment == s ? WColor.primary : WColor.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(segment == s ? AnyShapeStyle(WColor.surface) : AnyShapeStyle(Color.clear))
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(segment == s ? WColor.border : .clear, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(segment == s ? .isSelected : [])
            }
        }
        .padding(WSpacing.xs)
        .background(WColor.surfaceSecondary)
        .clipShape(Capsule())
        .padding(.horizontal, WSpacing.lg)
        .padding(.bottom, WSpacing.sm)
        .background(WColor.background)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Meal plan sections")
    }

    private func attachViewModelsIfNeeded() {
        guard supplementsVM == nil, journalVM == nil else { return }
        #if DEBUG
        if let fixture = LaunchFixtures.current {
            if let stub = fixture.stubSupplementProviding { supplementsVM = SupplementsViewModel(service: stub) }
            if let stub = fixture.stubJournalProviding { journalVM = JournalViewModel(service: stub) }
            if supplementsVM != nil || journalVM != nil { return }
        }
        #endif
        guard let apiClient else { return }
        supplementsVM = SupplementsViewModel(service: SupplementService(api: apiClient))
        journalVM = JournalViewModel(service: JournalService(api: apiClient))
    }
}
```

(`stubSupplementProviding` / `stubJournalProviding` don't exist until Task 12 — for THIS task's build, keep the `#if DEBUG` block commented out with `// Task 12 wires fixtures here`, and uncomment in Task 12. The plan's Task 12 includes that uncomment.)

- [ ] **Step 3: Refit `MealPlanView`** — it currently owns `NavigationStack`, `ScrollView`, `.navigationTitle`, and `.padding`. The hub now owns those. Edit `MealPlanView.body` to:

```swift
    var body: some View {
        VStack(alignment: .leading, spacing: WSpacing.xl) {
            content
        }
        .task { ... unchanged ... }
        .fullScreenCover(...) { ... unchanged ... }
        .sheet(...) { ... unchanged ... }
        .alert(...) { ... unchanged ... }
    }
```

i.e. delete the `NavigationStack { ScrollView { ... } .background(...) .navigationTitle("Meal Plan") }` wrapper and the `.tint(WColor.primary)` (hub owns both), keep every modifier that hangs state off the view (`.task`, `.fullScreenCover`, `.sheet`, `.alert`) attached to the `VStack`. Also delete the inner `.padding(WSpacing.lg)` / `.padding(.bottom, WSpacing.xxl)` (hub applies them). `#Preview` becomes `#Preview { PlanHubView() }`.

- [ ] **Step 4: Point `RootTabView` at the hub** — `Clara/App/RootTabView.swift:27`: `MealPlanView()` → `PlanHubView()` (tab item label unchanged).

- [ ] **Step 5: Register new files in pbxproj; build + full test suite** — expect `BUILD SUCCEEDED`, all tests green.

- [ ] **Step 6: Commit**

```bash
git add Clara/Features/Journal/JournalView.swift Clara/Features/MealPlan/PlanHubView.swift Clara/Features/MealPlan/MealPlanView.swift Clara/App/RootTabView.swift Clara.xcodeproj/project.pbxproj
git commit -m "feat(plan-hub): segmented Meal Plan | Supplements | Journal center tab"
```

---

### Task 12: LaunchFixtures stubs + simulator verification

**Files (Clara repo):**
- Modify: `Clara/App/LaunchFixtures.swift` (add fixture cases + stub providers)
- Modify: `Clara/Features/MealPlan/PlanHubView.swift` (uncomment the fixture block from Task 11; add `-segment` launch-arg handling)
- Modify: `Clara.xcodeproj/project.pbxproj` (nothing new — files already registered)

**Interfaces:**
- Consumes: `SupplementProviding`, `JournalProviding`.
- Produces: fixtures `supplementsLoaded`, `supplementsEmpty`, `journalLoaded` + `stubSupplementProviding` / `stubJournalProviding` accessors mirroring `stubMealPlanProviding`; DEBUG launch args `-tab mealplan -segment supplements|journal` for deterministic screenshots.

- [ ] **Step 1: Add fixture cases and stubs to `LaunchFixtures.swift`**

Add `supplementsLoaded, supplementsEmpty, journalLoaded` to the fixture enum, then (mirroring `stubMealPlanProviding` — every OTHER accessor's exhaustive `switch` also gains these three cases in its `nil` branch):

```swift
    // MARK: - Supplements + Journal stubs (Plan-hub cycle)

    var stubSupplementProviding: SupplementProviding? {
        switch self {
        case .supplementsLoaded: return FixtureSupplementProviding(empty: false)
        case .supplementsEmpty: return FixtureSupplementProviding(empty: true)
        case .journalLoaded: return FixtureSupplementProviding(empty: false)
        default: return nil
        }
    }

    var stubJournalProviding: JournalProviding? {
        switch self {
        case .supplementsLoaded, .supplementsEmpty, .journalLoaded:
            return FixtureJournalProviding()
        default: return nil
        }
    }
```

(If the file's existing accessors use exhaustive switches without `default`, follow that style instead and enumerate the cases.) Fixture data:

```swift
struct FixtureSupplementProviding: SupplementProviding {
    let empty: Bool
    func list(date: String) async throws -> [SupplementDTO] {
        guard !empty else { return [] }
        return [
            SupplementDTO(id: "f1", name: "Vitamin D3", dosage: "2000 IU · 1 capsule", timeSlot: .morning, takenToday: true),
            SupplementDTO(id: "f2", name: "Omega-3 Fish Oil", dosage: "1000 mg · 2 softgels", timeSlot: .morning, takenToday: true),
            SupplementDTO(id: "f3", name: "Magnesium Glycinate", dosage: "400 mg · 2 tablets", timeSlot: .afternoon, takenToday: false),
            SupplementDTO(id: "f4", name: "Probiotic", dosage: "10B CFU · 1 capsule", timeSlot: .evening, takenToday: false),
        ]
    }
    func create(name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO {
        SupplementDTO(id: UUID().uuidString, name: name, dosage: dosage, timeSlot: timeSlot, takenToday: false)
    }
    func update(id: String, name: String, dosage: String?, timeSlot: SupplementTimeSlot) async throws -> SupplementDTO {
        SupplementDTO(id: id, name: name, dosage: dosage, timeSlot: timeSlot, takenToday: false)
    }
    func delete(id: String) async throws {}
    func setIntake(id: String, date: String, taken: Bool) async throws {}
}

struct FixtureJournalProviding: JournalProviding {
    func calendar() async throws -> JournalCalendarDTO {
        JournalCalendarDTO(planStartDate: "2026-07-20", planEndDate: "2026-07-27", entries: [
            "2026-07-23": JournalCalendarEntryDTO(dailyCalorieTarget: 1960, meals: [
                JournalCalendarMealDTO(mealType: "Breakfast", recipeName: "Overnight Oats", rating: 1),
                JournalCalendarMealDTO(mealType: "Lunch", recipeName: "Chicken Shawarma Wrap", rating: 1),
                JournalCalendarMealDTO(mealType: "Dinner", recipeName: "Zucchini Pasta Bolognese", rating: nil),
            ]),
            "2026-07-22": JournalCalendarEntryDTO(dailyCalorieTarget: 2080, meals: [
                JournalCalendarMealDTO(mealType: "Breakfast", recipeName: "Shakshuka with Feta", rating: 1),
                JournalCalendarMealDTO(mealType: "Lunch", recipeName: "Poke Bowl", rating: -1),
                JournalCalendarMealDTO(mealType: "Dinner", recipeName: "Turkey Meatballs & Orzo", rating: nil),
            ]),
        ])
    }
    func supplementHistory(from: String, to: String) async throws -> [SupplementHistoryDayDTO] {
        [
            SupplementHistoryDayDTO(date: "2026-07-23",
                                    taken: [.init(name: "Vitamin D3"), .init(name: "Omega-3"), .init(name: "Magnesium")],
                                    total: 3),
            SupplementHistoryDayDTO(date: "2026-07-22",
                                    taken: [.init(name: "Vitamin D3"), .init(name: "Omega-3")],
                                    total: 3),
        ]
    }
}
```

- [ ] **Step 2: Uncomment the fixture block in `PlanHubView.attachViewModelsIfNeeded()`** (Task 11 left it commented) and add the `-segment` launch arg to `PlanHubView.init`, mirroring `RootTabView`'s `-tab`:

```swift
    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "-segment"), idx + 1 < args.count,
           let s = Segment(rawValue: args[idx + 1]) {
            _segment = State(initialValue: s)
        }
        #endif
    }
```

- [ ] **Step 3: Build, install, screenshot all three segments**

```bash
cd /Users/becks/Desktop/NewView/Clara
xcodebuild build -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" 2>&1 | tail -3
xcrun simctl boot 9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1 || true
xcrun simctl install 9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1 build/Build/Products/Debug-iphonesimulator/Clara.app 2>/dev/null || xcrun simctl install booted "$(find ~/Library/Developer/Xcode/DerivedData -name Clara.app -path '*Debug-iphonesimulator*' | head -1)"
for seg in supplements journal; do
  xcrun simctl terminate booted io.wondish.clara 2>/dev/null
  xcrun simctl launch booted io.wondish.clara -fixture supplementsLoaded -tab mealplan -segment "$seg"
  sleep 3 && xcrun simctl io booted screenshot "/tmp/hub-$seg.png"
done
```

(Adjust bundle id / fixture launch-arg spelling to whatever `LaunchFixtures.current` actually parses — check the top of `LaunchFixtures.swift`.)
Expected: screenshots match the accepted mockup (summary card + slot groups + check circles; journal day cards with thumbs + pill lines).

- [ ] **Step 4: Full test suite one last time** — all green.

- [ ] **Step 5: Commit**

```bash
git add Clara/App/LaunchFixtures.swift Clara/Features/MealPlan/PlanHubView.swift
git commit -m "feat(plan-hub): launch fixtures + -segment arg for deterministic screenshots"
```

---

### Task 13: Wrap-up

- [ ] **Step 1: Full verification, both repos**

```bash
cd /Users/becks/Desktop/NewView/wondish_02 && npm test 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
cd /Users/becks/Desktop/NewView/Clara && xcodebuild test -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" 2>&1 | tail -5
```

Expected: everything green.

- [ ] **Step 2: Update plan checkboxes, commit the plan file (wondish_02), and show the user the Task 12 screenshots** for acceptance against the approved mockup.

- [ ] **Step 3: Release notes** — remind the user: the Prisma migration must run against production before the routes deploy (`npm run db:migrate:deploy` in the release pipeline), matching the repo's authored-not-executed posture.
