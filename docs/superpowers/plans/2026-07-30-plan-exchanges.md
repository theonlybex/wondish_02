# Plan Exchanges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pull a restaurant dish or a fridge-generated recipe into today's meal plan as a pending item, then exchange it for a planned dish of their choosing in the Meal Plan screen — with day macros, grocery list, and journal adjusting, and the web app reflecting the same composed plan.

**Architecture:** Overlay model (spec: `docs/superpowers/specs/2026-07-30-plan-exchanges-design.md`). Two new additive Prisma tables (`RestaurantPlanExchange`, `FridgePlanExchange`) never mutate `Menu` rows; a composition layer in `lib/plan-exchanges.ts` filters displaced menus and surfaces exchanged-in dishes. New REST endpoints create/resolve/cancel exchanges. "Eaten" = a `MealLog` row carrying new `planExchangeId` provenance. Web gets display parity; iOS gets the full interaction.

**Tech Stack:** Next.js 14 App Router + Prisma/Neon (wondish_02), node:test via `npm test` (pure lib tests only — no DB in tests), SwiftUI iOS 17 (repo `~/Desktop/BeTech/Clara`).

## Global Constraints

- Migrations are **additive only** and authored offline; they apply via `prisma migrate deploy` at the release gate, never mid-cycle (cycle.md §2.3, §7).
- **Pinned wire contracts:** default responses of existing GETs stay byte-identical; new behavior rides opt-in query params (cycle.md §4.2). `?exchanges=1` is honored **only on single-day** `/api/meal-plan` reads; the week view is unchanged this cycle.
- **Server prices macros** for RESTAURANT sources; clients never send them (cycle.md §4.3). Fridge snapshots are client-supplied (existing FRIDGE MealLog precedent).
- No new premium gate on exchange endpoints: plan generation is already premium-gated, so a free user has no menus to exchange against; mirrors `/api/meal-log` which has no gate except CUSTOM.
- iOS DTO dates stay `String` (cycle.md §4.5). New Swift files are hand-registered in `project.pbxproj` (4-point insert, cycle.md §4.6).
- `Config/Debug.xcconfig` is never committed/reverted/staged (cycle.md §4.7).
- UI tasks invoke `ui-ux-pro-max:ui-ux-pro-max` (+ `mobile-ios-design` on iOS) before editing view code.
- Full suite green + `tsc` clean of new errors + build green after every task. Web tests: `npm test` (runs `node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts` — lib tests must be pure, DB reads go through injected row arguments, following `lib/meal-log.ts`'s `RecipeDep` pattern).
- Restaurant dishes served/accepted only when `status: "PUBLISHED", available: true` (parity with `app/api/restaurants/[slug]/route.ts:45`).

---

## Pinned wire shapes (used by several tasks)

`ExchangeDTO` — the JSON shape both new tables serialize to (server → client):

```ts
// types/index.ts addition (Task E2 creates it; later tasks import it)
export type PlanExchangeStatus = "PENDING" | "RESOLVED" | "CANCELLED";
export type PlanExchangeSource = "RESTAURANT" | "FRIDGE";

export interface PlanExchangePerServing {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

export interface PlanExchangeDTO {
  id: string;
  source: PlanExchangeSource;
  localDate: string;            // "YYYY-MM-DD"
  status: PlanExchangeStatus;   // CANCELLED never serialized in GET
  servings: number;
  displacedMenuId: string | null;
  name: string;
  originLabel: string;          // "Ristorante Roma" | "Your fridge"
  emoji: string | null;         // fridge only, null for restaurant
  perServing: PlanExchangePerServing;
  incomplete: boolean;
  eaten: boolean;               // derived: MealLog with planExchangeId exists
  createdAt: string;            // ISO
}
```

`GET /api/meal-plan?date=YYYY-MM-DD&exchanges=1` response = existing body plus:

```json
"exchanges": { "pending": [ExchangeDTO], "resolved": [ExchangeDTO] }
```

Endpoint summary:

| Method/Path | Body | Success |
|---|---|---|
| `POST /api/meal-plan/exchanges/restaurant` | `{ restaurantDishId, localDate, servings? }` | 201 `{ exchange: ExchangeDTO, verdict: { fits: boolean, conflicts: string[] } }` |
| `POST /api/meal-plan/exchanges/fridge` | `{ localDate, servings?, recipe: <FridgeRecipe minus fitsPlan/conflicts>, fridgeRecipeId? }` | 201 `{ exchange: ExchangeDTO }` |
| `PATCH /api/meal-plan/exchanges/[id]` | `{ action: "resolve", menuId }` \| `{ action: "cancel" }` | 200 `{ exchange: ExchangeDTO }` |

Error codes shared by the PATCH: 400 invalid body · 404 exchange/menu not found (or wrong patient) · 409 conflict (menu already displaced, stale planVersion, dish already eaten, cancel-after-eaten).

---

### Task E1: Prisma schema + additive migration

**Files:**
- Modify: `prisma/schema.prisma` (new enum + 2 models; back-relations on `Patient`, `Menu`, `RestaurantDish`; one new column on `MealLog`)
- Create: `prisma/migrations/20260730000000_plan_exchanges/migration.sql`

**Interfaces:**
- Consumes: existing models `Patient` (line ~142 `activePlanVersion Int`), `Menu` (line 503), `RestaurantDish` (line 449), `MealLog` (line 614).
- Produces: Prisma delegates `prisma.restaurantPlanExchange`, `prisma.fridgePlanExchange`; `MealLog.planExchangeId: string | null`. Every later backend task depends on these names.

- [ ] **Step 1: Add schema blocks**

In `prisma/schema.prisma`, below the `Menu` model (after line 516), add:

```prisma
// ─── Plan Exchanges (spec 2026-07-30-plan-exchanges-design.md) ───────────────
// Day-scoped overlay rows; Menu rows are never mutated. Two tables — two
// features flowing into one plan. displacedMenuId is @unique per table;
// cross-table single-displacement is enforced in the resolve transaction.
// CANCELLED rows must null displacedMenuId so the unique slot is freed.

enum PlanExchangeStatus {
  PENDING
  RESOLVED
  CANCELLED
}

model RestaurantPlanExchange {
  id        String  @id @default(cuid())
  patientId String
  patient   Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  localDate   String // "YYYY-MM-DD" local calendar date (MealLog convention)
  planVersion Int    // patient.activePlanVersion at creation
  status      PlanExchangeStatus @default(PENDING)

  displacedMenuId String? @unique
  displacedMenu   Menu?   @relation(fields: [displacedMenuId], references: [id], onDelete: SetNull)

  servings Float @default(1)

  // Provenance + display; macros are a SERVER-PRICED whole-dish snapshot
  // (RestaurantDish macros are whole-dish, not per-serving) stored unrounded.
  restaurantDishId String?
  restaurantDish   RestaurantDish? @relation(fields: [restaurantDishId], references: [id], onDelete: SetNull)
  name             String
  restaurantName   String
  calories         Float?
  protein          Float?
  carbs            Float?
  fat              Float?
  fiber            Float?
  incomplete       Boolean @default(false) // any macro null at snapshot time

  createdAt  DateTime  @default(now())
  resolvedAt DateTime?

  @@index([patientId, planVersion, localDate, status])
}

model FridgePlanExchange {
  id        String  @id @default(cuid())
  patientId String
  patient   Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  localDate   String
  planVersion Int
  status      PlanExchangeStatus @default(PENDING)

  displacedMenuId String? @unique
  displacedMenu   Menu?   @relation(fields: [displacedMenuId], references: [id], onDelete: SetNull)

  servings Float @default(1)

  // Full client-supplied snapshot — the generated recipe exists nowhere else.
  fridgeRecipeId  String? // opaque provenance
  name            String
  emoji           String?
  mealType        String?
  usesIngredients String[]
  steps           String[]
  calories        Float
  protein         Float
  carbs           Float
  fat             Float
  fiber           Float

  createdAt  DateTime  @default(now())
  resolvedAt DateTime?

  @@index([patientId, planVersion, localDate, status])
}
```

- [ ] **Step 2: Add back-relations and the MealLog column**

In `model Patient`, add: `restaurantPlanExchanges RestaurantPlanExchange[]` and `fridgePlanExchanges FridgePlanExchange[]`.
In `model Menu`, add: `restaurantPlanExchange RestaurantPlanExchange?` and `fridgePlanExchange FridgePlanExchange?`.
In `model RestaurantDish`, add: `planExchanges RestaurantPlanExchange[]`.
In `model MealLog`, in the "Provenance only" block after `fridgeRecipeId`, add:

```prisma
  planExchangeId     String? // id of a RestaurantPlanExchange or FridgePlanExchange
  // row this intake fulfills. Plain provenance (no FK — two possible tables);
  // NEVER read for macro math. Presence of such a log = the exchange is eaten.
```

- [ ] **Step 3: Author the offline migration**

Create `prisma/migrations/20260730000000_plan_exchanges/migration.sql`:

```sql
-- Additive only (cycle.md §2.3). Two overlay tables + MealLog provenance column.
CREATE TYPE "PlanExchangeStatus" AS ENUM ('PENDING', 'RESOLVED', 'CANCELLED');

CREATE TABLE "RestaurantPlanExchange" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "status" "PlanExchangeStatus" NOT NULL DEFAULT 'PENDING',
    "displacedMenuId" TEXT,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "restaurantDishId" TEXT,
    "name" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "RestaurantPlanExchange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FridgePlanExchange" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "status" "PlanExchangeStatus" NOT NULL DEFAULT 'PENDING',
    "displacedMenuId" TEXT,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fridgeRecipeId" TEXT,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "mealType" TEXT,
    "usesIngredients" TEXT[],
    "steps" TEXT[],
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "FridgePlanExchange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MealLog" ADD COLUMN "planExchangeId" TEXT;

CREATE UNIQUE INDEX "RestaurantPlanExchange_displacedMenuId_key" ON "RestaurantPlanExchange"("displacedMenuId");
CREATE UNIQUE INDEX "FridgePlanExchange_displacedMenuId_key" ON "FridgePlanExchange"("displacedMenuId");
CREATE INDEX "RestaurantPlanExchange_patientId_planVersion_localDate_stat_idx" ON "RestaurantPlanExchange"("patientId", "planVersion", "localDate", "status");
CREATE INDEX "FridgePlanExchange_patientId_planVersion_localDate_status_idx" ON "FridgePlanExchange"("patientId", "planVersion", "localDate", "status");

ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_displacedMenuId_fkey" FOREIGN KEY ("displacedMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_restaurantDishId_fkey" FOREIGN KEY ("restaurantDishId") REFERENCES "RestaurantDish"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FridgePlanExchange" ADD CONSTRAINT "FridgePlanExchange_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FridgePlanExchange" ADD CONSTRAINT "FridgePlanExchange_displacedMenuId_fkey" FOREIGN KEY ("displacedMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate client and verify**

Run: `npx prisma generate && npx tsc --noEmit 2>&1 | grep -v "\.test\.ts" | head` and `npm test`.
Expected: generate succeeds; no new tsc errors (pre-existing `*.test.ts` TS2802/TS7006 errors are known); suite green. Do NOT run `prisma migrate dev`/`db push` — migration applies at the release gate.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260730000000_plan_exchanges/
git commit -m "feat(plan-exchanges): additive schema — RestaurantPlanExchange, FridgePlanExchange, MealLog.planExchangeId"
```

---

### Task E2: `lib/plan-exchanges.ts` — pure core + query helpers (TDD)

**Files:**
- Create: `lib/plan-exchanges.ts`, `lib/plan-exchanges.test.ts`
- Modify: `types/index.ts` (append the `PlanExchange*` types from "Pinned wire shapes" verbatim)

**Interfaces:**
- Consumes: `parseLocalDateStrict` from `@/lib/journal`; Prisma delegates from E1; `PlanExchangeDTO` types.
- Produces (later tasks import these exact names):

```ts
// Pure — unit-tested:
export interface ExchangeRowLike {           // structural union of both tables' rows
  id: string; localDate: string; planVersion: number;
  status: "PENDING" | "RESOLVED" | "CANCELLED";
  displacedMenuId: string | null; servings: number;
  name: string; createdAt: Date;
  // restaurant-only:
  restaurantName?: string; incomplete?: boolean;
  // fridge-only:
  emoji?: string | null;
  calories: number | null; protein: number | null;
  carbs: number | null; fat: number | null; fiber: number | null;
}
export function toExchangeDTO(row: ExchangeRowLike, source: PlanExchangeSource, eatenIds: Set<string>): PlanExchangeDTO;
export function splitByStatus(dtos: PlanExchangeDTO[]): { pending: PlanExchangeDTO[]; resolved: PlanExchangeDTO[] };
export function displacedMenuIdSet(dtos: PlanExchangeDTO[]): Set<string>;   // RESOLVED only
export function localDayWindow(localDate: string): { start: Date; end: Date } | null; // local midnight..23:59:59.999

// Prisma-backed (thin, no logic beyond queries — reviewed, not unit-tested):
export async function getExchangesForRange(patientId: string, planVersion: number, fromLocalDate: string, toLocalDate: string): Promise<PlanExchangeDTO[]>; // non-CANCELLED, eaten derived via one MealLog query on planExchangeId
export async function getDisplacedMenuIdsForRange(patientId: string, planVersion: number, fromLocalDate: string, toLocalDate: string): Promise<Set<string>>;
export async function findExchangeById(patientId: string, id: string): Promise<{ row: ExchangeRowLike; source: PlanExchangeSource } | null>; // tries restaurant table, then fridge
```

- [ ] **Step 1: Write failing tests** (`lib/plan-exchanges.test.ts`, node:test style used by `lib/fridge.test.ts`)

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toExchangeDTO, splitByStatus, displacedMenuIdSet, localDayWindow } from "./plan-exchanges";

const base = {
  id: "x1", localDate: "2026-07-30", planVersion: 3, status: "PENDING" as const,
  displacedMenuId: null, servings: 1, name: "Salmon Teriyaki", createdAt: new Date("2026-07-30T10:00:00Z"),
  calories: 620, protein: 40, carbs: 55, fat: 22, fiber: 4,
};

describe("toExchangeDTO", () => {
  it("maps a restaurant row: originLabel = restaurantName, emoji null, incomplete carried", () => {
    const dto = toExchangeDTO({ ...base, restaurantName: "Ristorante Roma", incomplete: true }, "RESTAURANT", new Set());
    assert.equal(dto.originLabel, "Ristorante Roma");
    assert.equal(dto.emoji, null);
    assert.equal(dto.incomplete, true);
    assert.equal(dto.source, "RESTAURANT");
    assert.equal(dto.eaten, false);
    assert.equal(dto.perServing.calories, 620);
  });
  it("maps a fridge row: originLabel 'Your fridge', incomplete false, emoji carried", () => {
    const dto = toExchangeDTO({ ...base, emoji: "🍳" }, "FRIDGE", new Set());
    assert.equal(dto.originLabel, "Your fridge");
    assert.equal(dto.emoji, "🍳");
    assert.equal(dto.incomplete, false);
  });
  it("derives eaten from the id set", () => {
    const dto = toExchangeDTO({ ...base, restaurantName: "R" }, "RESTAURANT", new Set(["x1"]));
    assert.equal(dto.eaten, true);
  });
});

describe("splitByStatus / displacedMenuIdSet", () => {
  const p = toExchangeDTO({ ...base, restaurantName: "R" }, "RESTAURANT", new Set());
  const r = toExchangeDTO({ ...base, id: "x2", status: "RESOLVED", displacedMenuId: "m9", restaurantName: "R" }, "RESTAURANT", new Set());
  it("splits pending vs resolved", () => {
    const s = splitByStatus([p, r]);
    assert.deepEqual(s.pending.map((d) => d.id), ["x1"]);
    assert.deepEqual(s.resolved.map((d) => d.id), ["x2"]);
  });
  it("collects displaced menu ids from RESOLVED rows only", () => {
    assert.deepEqual([...displacedMenuIdSet([p, r])], ["m9"]);
  });
});

describe("localDayWindow", () => {
  it("returns local midnight → end-of-day", () => {
    const w = localDayWindow("2026-07-30");
    assert.ok(w);
    assert.equal(w!.start.getHours(), 0);
    assert.equal(w!.end.getHours(), 23);
    assert.equal(w!.start.getDate(), 30);
  });
  it("rejects garbage", () => { assert.equal(localDayWindow("2026-7-30"), null); });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test lib/plan-exchanges.test.ts`
Expected: FAIL — cannot find module `./plan-exchanges`.

- [ ] **Step 3: Implement**

`lib/plan-exchanges.ts` — pure part first, then thin Prisma helpers:

```ts
// Plan-exchange overlay core (spec 2026-07-30-plan-exchanges-design.md).
// Pure mapping/composition up top (unit-tested); thin Prisma-backed range
// helpers below (queries only — logic stays in the pure part).
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";
import type { PlanExchangeDTO, PlanExchangeSource } from "@/types";

export interface ExchangeRowLike { /* exact block from Interfaces above */ }

export function toExchangeDTO(row: ExchangeRowLike, source: PlanExchangeSource, eatenIds: Set<string>): PlanExchangeDTO {
  return {
    id: row.id,
    source,
    localDate: row.localDate,
    status: row.status,
    servings: row.servings,
    displacedMenuId: row.displacedMenuId,
    name: row.name,
    originLabel: source === "RESTAURANT" ? row.restaurantName ?? "" : "Your fridge",
    emoji: source === "FRIDGE" ? row.emoji ?? null : null,
    perServing: { calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, fiber: row.fiber },
    incomplete: source === "RESTAURANT" ? row.incomplete ?? false : false,
    eaten: eatenIds.has(row.id),
    createdAt: row.createdAt.toISOString(),
  };
}

export function splitByStatus(dtos: PlanExchangeDTO[]) {
  return {
    pending: dtos.filter((d) => d.status === "PENDING"),
    resolved: dtos.filter((d) => d.status === "RESOLVED"),
  };
}

export function displacedMenuIdSet(dtos: PlanExchangeDTO[]): Set<string> {
  return new Set(dtos.filter((d) => d.status === "RESOLVED" && d.displacedMenuId).map((d) => d.displacedMenuId as string));
}

export function localDayWindow(localDate: string): { start: Date; end: Date } | null {
  const start = parseLocalDateStrict(localDate);
  if (!start) return null;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ── Prisma-backed helpers ───────────────────────────────────────────────────

const NOT_CANCELLED = { in: ["PENDING", "RESOLVED"] as const };

export async function getExchangesForRange(patientId: string, planVersion: number, fromLocalDate: string, toLocalDate: string): Promise<PlanExchangeDTO[]> {
  const where = { patientId, planVersion, status: NOT_CANCELLED, localDate: { gte: fromLocalDate, lte: toLocalDate } };
  const [restRows, fridgeRows] = await Promise.all([
    prisma.restaurantPlanExchange.findMany({ where, orderBy: { createdAt: "asc" } }),
    prisma.fridgePlanExchange.findMany({ where, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...restRows, ...fridgeRows].map((r) => r.id);
  const eatenLogs = ids.length
    ? await prisma.mealLog.findMany({ where: { patientId, planExchangeId: { in: ids } }, select: { planExchangeId: true } })
    : [];
  const eaten = new Set(eatenLogs.map((l) => l.planExchangeId as string));
  return [
    ...restRows.map((r) => toExchangeDTO(r, "RESTAURANT", eaten)),
    ...fridgeRows.map((r) => toExchangeDTO(r, "FRIDGE", eaten)),
  ];
}

export async function getDisplacedMenuIdsForRange(patientId: string, planVersion: number, fromLocalDate: string, toLocalDate: string): Promise<Set<string>> {
  return displacedMenuIdSet(await getExchangesForRange(patientId, planVersion, fromLocalDate, toLocalDate));
}

export async function findExchangeById(patientId: string, id: string): Promise<{ row: ExchangeRowLike; source: PlanExchangeSource } | null> {
  const rest = await prisma.restaurantPlanExchange.findFirst({ where: { id, patientId } });
  if (rest) return { row: rest, source: "RESTAURANT" };
  const fridge = await prisma.fridgePlanExchange.findFirst({ where: { id, patientId } });
  if (fridge) return { row: fridge, source: "FRIDGE" };
  return null;
}
```

("`/* exact block from Interfaces above */`" means: paste the `ExchangeRowLike` field list from this task's Interfaces section — it is written out there in full.)

- [ ] **Step 4: Run tests + suite**

Run: `node --import tsx --test lib/plan-exchanges.test.ts` → all PASS. Then `npm test` → green (new file is picked up by the `lib/*.test.ts` glob automatically).

- [ ] **Step 5: Commit**

```bash
git add lib/plan-exchanges.ts lib/plan-exchanges.test.ts types/index.ts
git commit -m "feat(plan-exchanges): composition core + range helpers (TDD)"
```

---

### Task E3: `POST /api/meal-plan/exchanges/restaurant`

**Files:**
- Create: `app/api/meal-plan/exchanges/restaurant/route.ts`
- Test: extend `lib/plan-exchanges.test.ts` with the pure input-validation function this route uses.

**Interfaces:**
- Consumes: `toExchangeDTO`, `localDayWindow` (E2); `derivePatientBans`, `buildDietMatchers`, `evaluateDishAgainstProfile`, `PATIENT_DIET_INCLUDE` from `@/lib/diet-match` (same usage as `app/api/meal-plan/[menuId]/swap/route.ts`).
- Produces: `parseRestaurantExchangeInput(raw: unknown): { ok: true; value: { restaurantDishId: string; localDate: string; servings: number } } | { ok: false; error: string }` exported from `lib/plan-exchanges.ts`.

- [ ] **Step 1: Failing tests for the parser** (append to `lib/plan-exchanges.test.ts`)

```ts
import { parseRestaurantExchangeInput } from "./plan-exchanges";

describe("parseRestaurantExchangeInput", () => {
  it("accepts minimal valid input, defaults servings to 1", () => {
    const r = parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30" });
    assert.ok(r.ok && r.value.servings === 1);
  });
  it("rejects missing dish id, bad localDate, out-of-range servings", () => {
    assert.equal(parseRestaurantExchangeInput({ localDate: "2026-07-30" }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "yesterday" }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", servings: 0 }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", servings: 21 }).ok, false);
  });
  it("rejects client-supplied macros — server prices RESTAURANT (standing rule 3)", () => {
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", calories: 100 }).ok, false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node --import tsx --test lib/plan-exchanges.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement parser in `lib/plan-exchanges.ts`**

```ts
const MACRO_KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

export function parseRestaurantExchangeInput(raw: unknown):
  | { ok: true; value: { restaurantDishId: string; localDate: string; servings: number } }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;
  for (const k of MACRO_KEYS) if (k in r) return { ok: false, error: `${k} is server-priced; do not send it` };
  const restaurantDishId = typeof r.restaurantDishId === "string" && r.restaurantDishId ? r.restaurantDishId : null;
  if (!restaurantDishId) return { ok: false, error: "restaurantDishId is required" };
  if (typeof r.localDate !== "string" || !localDayWindow(r.localDate)) return { ok: false, error: "localDate must be YYYY-MM-DD" };
  let servings = 1;
  if (r.servings !== undefined) {
    if (typeof r.servings !== "number" || !isFinite(r.servings) || r.servings <= 0 || r.servings > 20) {
      return { ok: false, error: "servings must be a number in (0, 20]" };
    }
    servings = r.servings;
  }
  return { ok: true, value: { restaurantDishId, localDate: r.localDate, servings } };
}
```

Run tests → PASS.

- [ ] **Step 4: Implement the route**

`app/api/meal-plan/exchanges/restaurant/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { parseRestaurantExchangeInput, toExchangeDTO } from "@/lib/plan-exchanges";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const parsed = parseRestaurantExchangeInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Serving parity with app/api/restaurants/[slug]/route.ts:45 — PUBLISHED + available only.
  const dish = await prisma.restaurantDish.findFirst({
    where: { id: parsed.value.restaurantDishId, status: "PUBLISHED", available: true },
    include: { restaurant: { select: { name: true, status: true } }, ingredients: { include: { ingredient: true } } },
  });
  if (!dish || dish.restaurant.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Dish not found" }, { status: 404 });
  }

  // Informational verdict — the user's choice wins (Restaurants-surface parity).
  const matchers = buildDietMatchers(derivePatientBans(patient));
  const verdict = evaluateDishAgainstProfile(
    { name: dish.name, ingredients: dish.ingredients.map((i) => i.ingredient.name) },
    matchers
  );

  const incomplete = dish.calories == null || dish.protein == null || dish.carbs == null || dish.fat == null || dish.fiber == null;
  const row = await prisma.restaurantPlanExchange.create({
    data: {
      patientId: patient.id,
      localDate: parsed.value.localDate,
      planVersion: patient.activePlanVersion,
      servings: parsed.value.servings,
      restaurantDishId: dish.id,
      name: dish.name,
      restaurantName: dish.restaurant.name,
      calories: dish.calories, protein: dish.protein, carbs: dish.carbs, fat: dish.fat, fiber: dish.fiber,
      incomplete,
    },
  });

  return NextResponse.json({ exchange: toExchangeDTO(row, "RESTAURANT", new Set()), verdict }, { status: 201 });
}
```

Note for the implementer: before coding, open `lib/diet-match.ts` and check `evaluateDishAgainstProfile`'s exact parameter shape (the swap route at `app/api/meal-plan/[menuId]/swap/route.ts` calls it — mirror that call's shape verbatim; if it differs from the sketch above, the swap route's usage wins). Map its result onto `{ fits, conflicts }` the same way the restaurants public route does.

- [ ] **Step 5: Verify + commit**

Run: `npm test` green; `npx tsc --noEmit` no new errors; `npm run build` green.

```bash
git add app/api/meal-plan/exchanges/restaurant/route.ts lib/plan-exchanges.ts lib/plan-exchanges.test.ts
git commit -m "feat(plan-exchanges): create-pending endpoint for restaurant dishes (server-priced snapshot + verdict)"
```

---

### Task E4: `POST /api/meal-plan/exchanges/fridge`

**Files:**
- Create: `app/api/meal-plan/exchanges/fridge/route.ts`
- Modify: `lib/fridge.ts` (export a single-recipe validator), `lib/plan-exchanges.ts` (input parser)
- Test: `lib/plan-exchanges.test.ts`, `lib/fridge.test.ts`

**Interfaces:**
- Consumes: `lib/fridge.ts`'s private `parseOneRecipe(raw, mealTypeHint?)` (line ~108) — re-export it as `validateFridgeRecipeSnapshot`.
- Produces: `parseFridgeExchangeInput(raw): { ok: true; value: { localDate: string; servings: number; recipe: FridgeRecipe; fridgeRecipeId: string | null } } | { ok: false; error: string }`.

- [ ] **Step 1: Failing tests**

Append to `lib/fridge.test.ts`:

```ts
import { validateFridgeRecipeSnapshot } from "./fridge";
describe("validateFridgeRecipeSnapshot", () => {
  it("is parseOneRecipe exported: accepts a well-formed recipe and rejects junk", () => {
    const good = validateFridgeRecipeSnapshot({
      id: "f1", name: "Veggie Omelette", description: "", emoji: "🍳",
      usesIngredients: ["eggs"], missingIngredients: [], steps: ["whisk", "fry"],
      mealType: "breakfast", servings: 1,
      perServing: { calories: 320, protein: 22, carbs: 4, fat: 24, fiber: 1 },
      fitsPlan: true, conflicts: [],
    });
    assert.ok(good && good.name === "Veggie Omelette");
    assert.equal(validateFridgeRecipeSnapshot({ name: 42 }), null);
  });
});
```

Append to `lib/plan-exchanges.test.ts`:

```ts
import { parseFridgeExchangeInput } from "./plan-exchanges";
describe("parseFridgeExchangeInput", () => {
  const recipe = { id: "f1", name: "Veggie Omelette", description: "", emoji: "🍳", usesIngredients: ["eggs"], missingIngredients: [], steps: ["whisk"], mealType: "breakfast", servings: 1, perServing: { calories: 320, protein: 22, carbs: 4, fat: 24, fiber: 1 }, fitsPlan: true, conflicts: [] };
  it("accepts valid input", () => {
    const r = parseFridgeExchangeInput({ localDate: "2026-07-30", recipe });
    assert.ok(r.ok && r.value.recipe.name === "Veggie Omelette" && r.value.servings === 1);
  });
  it("rejects invalid recipe or localDate", () => {
    assert.equal(parseFridgeExchangeInput({ localDate: "2026-07-30", recipe: { name: 1 } }).ok, false);
    assert.equal(parseFridgeExchangeInput({ localDate: "nope", recipe }).ok, false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — both test files FAIL on missing exports.

- [ ] **Step 3: Implement**

In `lib/fridge.ts` (below `parseOneRecipe`): `export const validateFridgeRecipeSnapshot = parseOneRecipe;` (with a one-line comment: exchange endpoints re-validate the client-supplied snapshot with the same rules generation output obeys — F-D8 macro plausibility included).

In `lib/plan-exchanges.ts`:

```ts
import { validateFridgeRecipeSnapshot, type FridgeRecipe } from "@/lib/fridge";

export function parseFridgeExchangeInput(raw: unknown):
  | { ok: true; value: { localDate: string; servings: number; recipe: FridgeRecipe; fridgeRecipeId: string | null } }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;
  if (typeof r.localDate !== "string" || !localDayWindow(r.localDate)) return { ok: false, error: "localDate must be YYYY-MM-DD" };
  const recipe = validateFridgeRecipeSnapshot(r.recipe);
  if (!recipe) return { ok: false, error: "recipe failed validation" };
  let servings = 1;
  if (r.servings !== undefined) {
    if (typeof r.servings !== "number" || !isFinite(r.servings) || r.servings <= 0 || r.servings > 20) {
      return { ok: false, error: "servings must be a number in (0, 20]" };
    }
    servings = r.servings;
  }
  const fridgeRecipeId = typeof r.fridgeRecipeId === "string" && r.fridgeRecipeId ? r.fridgeRecipeId : null;
  return { ok: true, value: { localDate: r.localDate, servings, recipe, fridgeRecipeId } };
}
```

Route `app/api/meal-plan/exchanges/fridge/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseFridgeExchangeInput, toExchangeDTO } from "@/lib/plan-exchanges";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const parsed = parseFridgeExchangeInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true, activePlanVersion: true } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { recipe } = parsed.value;
  const row = await prisma.fridgePlanExchange.create({
    data: {
      patientId: patient.id,
      localDate: parsed.value.localDate,
      planVersion: patient.activePlanVersion,
      servings: parsed.value.servings,
      fridgeRecipeId: parsed.value.fridgeRecipeId,
      name: recipe.name,
      emoji: recipe.emoji,
      mealType: recipe.mealType,
      usesIngredients: recipe.usesIngredients,
      steps: recipe.steps,
      calories: recipe.perServing.calories, protein: recipe.perServing.protein,
      carbs: recipe.perServing.carbs, fat: recipe.perServing.fat, fiber: recipe.perServing.fiber,
    },
  });

  return NextResponse.json({ exchange: toExchangeDTO(row, "FRIDGE", new Set()) }, { status: 201 });
}
```

- [ ] **Step 4: Verify** — `npm test` green, `npx tsc --noEmit` no new errors, `npm run build` green.

- [ ] **Step 5: Commit**

```bash
git add app/api/meal-plan/exchanges/fridge/route.ts lib/plan-exchanges.ts lib/plan-exchanges.test.ts lib/fridge.ts lib/fridge.test.ts
git commit -m "feat(plan-exchanges): create-pending endpoint for fridge recipes (validated client snapshot)"
```

---

### Task E5: `PATCH /api/meal-plan/exchanges/[id]` — resolve / cancel

**Files:**
- Create: `app/api/meal-plan/exchanges/[id]/route.ts`
- Modify: `lib/plan-exchanges.ts` (pure guard logic), `lib/plan-exchanges.test.ts`

**Interfaces:**
- Consumes: `findExchangeById`, `localDayWindow`, `toExchangeDTO` (E2).
- Produces: `export function resolveGuard(args: { row: ExchangeRowLike; activePlanVersion: number; menu: { id: string; patientId: string; date: Date } | null; patientId: string; alreadyDisplaced: boolean; menuEaten: boolean }): string | null` — returns an error string or null-if-ok. The route maps non-null → 404/409 (see Step 3 mapping).

- [ ] **Step 1: Failing tests for the guard** (append to `lib/plan-exchanges.test.ts`)

```ts
import { resolveGuard } from "./plan-exchanges";

describe("resolveGuard", () => {
  const row = { ...base };                       // PENDING, planVersion 3, localDate 2026-07-30
  const menu = { id: "m1", patientId: "p1", date: new Date(2026, 6, 30, 12) }; // July is month 6
  const ok = { row, activePlanVersion: 3, menu, patientId: "p1", alreadyDisplaced: false, menuEaten: false };
  it("passes the happy path", () => assert.equal(resolveGuard(ok), null));
  it("rejects non-PENDING row", () => assert.match(resolveGuard({ ...ok, row: { ...row, status: "RESOLVED" } })!, /not pending/i));
  it("rejects stale planVersion", () => assert.match(resolveGuard({ ...ok, activePlanVersion: 4 })!, /plan changed/i));
  it("rejects missing/foreign menu", () => {
    assert.match(resolveGuard({ ...ok, menu: null })!, /menu not found/i);
    assert.match(resolveGuard({ ...ok, menu: { ...menu, patientId: "px" } })!, /menu not found/i);
  });
  it("rejects a menu outside the exchange's localDate", () =>
    assert.match(resolveGuard({ ...ok, menu: { ...menu, date: new Date(2026, 6, 31, 12) } })!, /different day/i));
  it("rejects already-displaced and already-eaten menus", () => {
    assert.match(resolveGuard({ ...ok, alreadyDisplaced: true })!, /already exchanged/i);
    assert.match(resolveGuard({ ...ok, menuEaten: true })!, /already eaten/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL on missing export.

- [ ] **Step 3: Implement guard + route**

Guard in `lib/plan-exchanges.ts`:

```ts
export function resolveGuard(args: { row: ExchangeRowLike; activePlanVersion: number; menu: { id: string; patientId: string; date: Date } | null; patientId: string; alreadyDisplaced: boolean; menuEaten: boolean }): string | null {
  const { row, activePlanVersion, menu, patientId, alreadyDisplaced, menuEaten } = args;
  if (row.status !== "PENDING") return "Exchange is not pending";
  if (row.planVersion !== activePlanVersion) return "Your plan changed since this dish was added";
  if (!menu || menu.patientId !== patientId) return "Menu not found";
  const w = localDayWindow(row.localDate);
  if (!w || menu.date < w.start || menu.date > w.end) return "That planned dish is on a different day";
  if (alreadyDisplaced) return "That planned dish was already exchanged";
  if (menuEaten) return "That planned dish is already eaten";
  return null;
}
```

Route `app/api/meal-plan/exchanges/[id]/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findExchangeById, resolveGuard, toExchangeDTO, localDayWindow } from "@/lib/plan-exchanges";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const { action, menuId } = (body ?? {}) as { action?: unknown; menuId?: unknown };
  if (action !== "resolve" && action !== "cancel") return NextResponse.json({ error: "action must be 'resolve' or 'cancel'" }, { status: 400 });
  if (action === "resolve" && (typeof menuId !== "string" || !menuId)) return NextResponse.json({ error: "menuId is required to resolve" }, { status: 400 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true, activePlanVersion: true } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const found = await findExchangeById(patient.id, params.id);
  if (!found) return NextResponse.json({ error: "Exchange not found" }, { status: 404 });
  const { row, source } = found;
  const delegate = source === "RESTAURANT" ? prisma.restaurantPlanExchange : prisma.fridgePlanExchange;

  if (action === "cancel") {
    if (row.status === "CANCELLED") return NextResponse.json({ error: "Already cancelled" }, { status: 409 });
    if (row.status === "RESOLVED") {
      const eatenLog = await prisma.mealLog.findFirst({ where: { patientId: patient.id, planExchangeId: row.id }, select: { id: true } });
      if (eatenLog) return NextResponse.json({ error: "Dish already eaten — remove the log first" }, { status: 409 });
    }
    // Null displacedMenuId so the @unique slot is freed (restores the planned dish).
    const updated = await (delegate as typeof prisma.restaurantPlanExchange).update({
      where: { id: row.id },
      data: { status: "CANCELLED", displacedMenuId: null },
    });
    return NextResponse.json({ exchange: toExchangeDTO(updated, source, new Set()) });
  }

  // action === "resolve" — all checks and the write inside one transaction.
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const menu = await tx.menu.findFirst({
        where: { id: menuId as string, planVersion: patient.activePlanVersion },
        select: { id: true, patientId: true, date: true, recipeId: true },
      });
      const [restHit, fridgeHit] = menu
        ? await Promise.all([
            tx.restaurantPlanExchange.findFirst({ where: { displacedMenuId: menu.id, status: { in: ["PENDING", "RESOLVED"] } }, select: { id: true } }),
            tx.fridgePlanExchange.findFirst({ where: { displacedMenuId: menu.id, status: { in: ["PENDING", "RESOLVED"] } }, select: { id: true } }),
          ])
        : [null, null];
      // "Eaten" for a planned dish = active JournalMeal with its recipeId on that date
      // (mirrors loggedRecipeIds in app/api/meal-plan/route.ts:74-86).
      let menuEaten = false;
      if (menu) {
        const w = localDayWindow(row.localDate)!;
        const entry = await tx.journalEntry.findFirst({
          where: { patientId: patient.id, date: { gte: w.start, lte: w.end } },
          include: { meals: { select: { recipeId: true, skipped: true } } },
        });
        menuEaten = (entry?.meals ?? []).some((m) => !m.skipped && m.recipeId === menu.recipeId);
      }
      const err = resolveGuard({
        row, activePlanVersion: patient.activePlanVersion, menu, patientId: patient.id,
        alreadyDisplaced: Boolean(restHit || fridgeHit), menuEaten,
      });
      if (err) throw new ResolveError(err);
      return (tx[source === "RESTAURANT" ? "restaurantPlanExchange" : "fridgePlanExchange"] as typeof tx.restaurantPlanExchange).update({
        where: { id: row.id },
        data: { status: "RESOLVED", displacedMenuId: menu!.id, resolvedAt: new Date() },
      });
    });
    const eaten = new Set<string>();
    return NextResponse.json({ exchange: toExchangeDTO(updated, source, eaten) });
  } catch (err) {
    if (err instanceof ResolveError) {
      const status = /not found/i.test(err.message) ? 404 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}

class ResolveError extends Error {}
```

- [ ] **Step 4: Verify** — parser/guard tests PASS (`npm test`), `npx tsc --noEmit` clean of new errors, `npm run build` green.

- [ ] **Step 5: Commit**

```bash
git add "app/api/meal-plan/exchanges/[id]/route.ts" lib/plan-exchanges.ts lib/plan-exchanges.test.ts
git commit -m "feat(plan-exchanges): resolve/cancel endpoint with transactional guards"
```

---

### Task E6: `GET /api/meal-plan?exchanges=1` + MealLog provenance acceptance

**Files:**
- Modify: `app/api/meal-plan/route.ts` (GET only), `lib/meal-log.ts` (`parseMealLogInput`, line 258), `app/api/meal-log/route.ts` (persist the new field)
- Test: `lib/meal-log.test.ts`, `lib/plan-exchanges.test.ts` (wire-shape test)

**Interfaces:**
- Consumes: `getExchangesForRange`, `splitByStatus` (E2).
- Produces: GET response gains `exchanges: { pending, resolved }` **only when** `?exchanges=1` and the request is single-day; `ParsedMealLog` gains `planExchangeId?: string`.

- [ ] **Step 1: Failing tests**

Append to `lib/meal-log.test.ts` (find the existing `parseMealLogInput` describe block and add):

```ts
it("accepts optional planExchangeId on any source and echoes it", () => {
  const r = parseMealLogInput({ source: "RESTAURANT", restaurantDishId: "d1", localDate: "2026-07-30", mealType: "lunch", name: "Salmon", servings: 1, planExchangeId: "x1" });
  assert.ok(r.ok && r.value.planExchangeId === "x1");
});
it("rejects a non-string planExchangeId", () => {
  assert.equal(parseMealLogInput({ source: "MANUAL", localDate: "2026-07-30", mealType: "lunch", name: "Toast", servings: 1, planExchangeId: 7 }).ok, false);
});
```

(Adapt the minimal valid fixture to whatever the neighboring passing tests in that file already use — copy one and add `planExchangeId`.)

- [ ] **Step 2: Run to verify failure** — `node --import tsx --test lib/meal-log.test.ts` FAILS.

- [ ] **Step 3: Implement**

1. `lib/meal-log.ts`: add `planExchangeId?: string;` to `ParsedMealLog` (line ~90). In `parseMealLogInput`, after the `restaurantDishId` handling (~line 240), add:

```ts
  let planExchangeId: string | undefined;
  if (raw.planExchangeId !== undefined) {
    if (typeof raw.planExchangeId !== "string" || !raw.planExchangeId) return fail("planExchangeId must be a non-empty string");
    planExchangeId = raw.planExchangeId;
  }
```

and include `planExchangeId` in the returned value object.

2. `app/api/meal-log/route.ts`: find where the parsed input is written with `prisma.mealLog.create` and add `planExchangeId: input.planExchangeId ?? null` to the `data` object. (Grep: `prisma.mealLog.create` in that file.)

3. `app/api/meal-plan/route.ts` GET: after the `dailyCalorieTarget` computation (line ~88), add:

```ts
  // Opt-in overlay (pinned wire contract: default response byte-identical).
  // Single-day requests only — the week view is unchanged this cycle.
  let exchanges: { pending: unknown[]; resolved: unknown[] } | undefined;
  if (!weekStartParam && searchParams.get("exchanges") === "1") {
    const day = toLocalDateString(startDate);
    const dtos = await getExchangesForRange(patient.id, patient.activePlanVersion, day, day);
    exchanges = splitByStatus(dtos);
  }

  return NextResponse.json({
    menus, mealPlanStartDate: patient.mealPlanStartDate, loggedRecipeIds, mealRatings, dailyCalorieTarget,
    ...(exchanges ? { exchanges } : {}),
  });
```

(with `import { getExchangesForRange, splitByStatus } from "@/lib/plan-exchanges";` at the top). The existing `return NextResponse.json({ menus, ... })` at line 92 is replaced by this spread version — when the param is absent, `exchanges` is `undefined` and the emitted JSON is key-for-key identical to before.

- [ ] **Step 4: Wire-shape regression test** (append to `lib/plan-exchanges.test.ts`)

```ts
describe("wire contract", () => {
  it("spreading an undefined exchanges key leaves the default body unchanged", () => {
    const exchanges = undefined as { pending: unknown[] } | undefined;
    const body = { menus: [], mealPlanStartDate: null, loggedRecipeIds: [], mealRatings: {}, dailyCalorieTarget: null, ...(exchanges ? { exchanges } : {}) };
    assert.deepEqual(Object.keys(body), ["menus", "mealPlanStartDate", "loggedRecipeIds", "mealRatings", "dailyCalorieTarget"]);
  });
});
```

- [ ] **Step 5: Verify + commit**

`npm test` green; `npx tsc --noEmit` clean of new errors; `npm run build` green.

```bash
git add app/api/meal-plan/route.ts app/api/meal-log/route.ts lib/meal-log.ts lib/meal-log.test.ts lib/plan-exchanges.test.ts
git commit -m "feat(plan-exchanges): opt-in exchanges overlay on day reads; MealLog planExchangeId provenance"
```

---

### Task E7: Displacement flows into grocery list + journal calendar

**Files:**
- Modify: `app/api/grocery-list/route.ts` (line 34 `menus` fetch), `app/api/journal/calendar/route.ts` (line 73 `menus` fetch)

**Interfaces:**
- Consumes: `getDisplacedMenuIdsForRange`, `getExchangesForRange` (E2). Range args are "YYYY-MM-DD" strings — derive them from the routes' existing `startDate`/`endDate`/`planStart`/`planEnd` Dates with a local `toLocalDateString` (copy the 6-line helper from `app/api/meal-plan/route.ts:15-19`).

- [ ] **Step 1: Grocery list — displaced dishes need no groceries**

In `app/api/grocery-list/route.ts`, after the `menus` fetch (line 34-37), add:

```ts
  // Plan-exchange overlay: displaced planned dishes drop out of the shopping
  // list (a restaurant meal needs no groceries; a fridge dish uses what the
  // user owns — spec 2026-07-30-plan-exchanges-design.md).
  const displaced = await getDisplacedMenuIdsForRange(
    patient.id, patient.activePlanVersion, toLocalDateString(startDate), toLocalDateString(endDate)
  );
  const effectiveMenus = menus.filter((m) => !displaced.has(m.id));
```

and change the aggregation loop's `for (const menu of menus)` to `for (const menu of effectiveMenus)`. Note: `patient` here is fetched without `activePlanVersion` — extend the `findFirst` at line 19 to `select: { id: true, activePlanVersion: true }` (it currently fetches the whole row, so `activePlanVersion` is already present; verify and leave as-is if so).

- [ ] **Step 2: Journal calendar — completion math skips displaced dishes, shows exchanged-in ones**

In `app/api/journal/calendar/route.ts`: after the `menus` fetch at line 73-80, filter the same way (`getDisplacedMenuIdsForRange` over `planStart..planEnd`), and fetch `getExchangesForRange` for the same window. Where the route builds its per-day planned-meals structure from `menus` (read the loop just below the fetch), append for each RESOLVED exchange on that day an entry shaped like the menu-derived ones with `{ name: dto.name }` (+ meal-type label if the structure carries one — use `dto.source === "FRIDGE" ? dto.name : dto.name`, and the exchanged dish counts as eaten when `dto.eaten`). Keep the change minimal: displaced out, resolved in, nothing else restructured.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean of new errors; `npm run build` green; `npm test` green.

- [ ] **Step 4: Commit**

```bash
git add app/api/grocery-list/route.ts app/api/journal/calendar/route.ts
git commit -m "feat(plan-exchanges): displaced dishes drop from grocery list and journal calendar; exchanged-in dishes appear"
```

---

### Task W1: Web display parity (DailyMealPlanView)

**Files:**
- Modify: `components/meal-plan/DailyMealPlanView.tsx` (client component; state block at lines ~254-292, totals at ~388-390, meal-card render below)

**Invoke `ui-ux-pro-max:ui-ux-pro-max` before editing view code (house rule).**

**Interfaces:**
- Consumes: `PlanExchangeDTO` from `@/types`; `GET /api/meal-plan?date=...&exchanges=1`.
- Produces: user-visible display parity only — no interactions beyond a link hint.

- [ ] **Step 1: Fetch the overlay**

Add state `const [exchanges, setExchanges] = useState<{ pending: PlanExchangeDTO[]; resolved: PlanExchangeDTO[] } | null>(null);`. In every fetch of `/api/meal-plan?date=...` inside this component (lines ~267, ~291, ~319, ~351 set `dailyCalorieTarget` — same fetches), append `&exchanges=1` to the URL and `setExchanges(data.exchanges ?? null)` beside the existing setters.

- [ ] **Step 2: Compose the day**

```tsx
const displacedMap = new Map<string, PlanExchangeDTO>(
  (exchanges?.resolved ?? []).filter((x) => x.displacedMenuId).map((x) => [x.displacedMenuId as string, x])
);
```

In the meal-card render loop, where each `menu` renders its recipe card: if `displacedMap.has(menu.id)`, render the exchange card instead — dish `name`, origin badge (`From {originLabel}`), per-serving macros × `servings`, and an "eaten" check when `x.eaten`. Keep the existing card's layout/classes; only the content source changes. Show the original dish name struck-through in small text underneath ("was: {menu.recipe.name}").

- [ ] **Step 3: Pending strip**

Above the meal list, when `exchanges?.pending.length`:

```tsx
<div className="rounded-2xl border px-4 py-3 mb-4 text-sm" style={{ borderColor: "#EAE4CA", background: "#FFFFFF" }}>
  <b>{exchanges.pending.length}</b> dish{exchanges.pending.length > 1 ? "es" : ""} waiting to join today's plan —
  choose what to exchange in the Wondish app.
  {exchanges.pending.map((x) => (
    <span key={x.id} className="inline-block ml-2 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#F5F1DD", color: "#5F1C35" }}>
      {x.emoji ? `${x.emoji} ` : ""}{x.name} · {x.originLabel}
    </span>
  ))}
</div>
```

- [ ] **Step 4: Day totals include eaten exchanges**

Where consumed totals sum `menus.filter((m) => loggedSet.has(m.recipe.id))` (lines ~388-390): exclude displaced menus (`!displacedMap.has(m.id)`) and add, for each resolved-and-eaten exchange, `x.perServing.<macro> * x.servings` (null-safe: `?? 0`).

- [ ] **Step 5: Verify + commit**

`npx tsc --noEmit` clean of new errors; `npm run build` green. Visual check is release-gated (local dev cannot render — Clerk env); disclose in the ledger, verify on the Vercel preview.

```bash
git add components/meal-plan/DailyMealPlanView.tsx
git commit -m "feat(plan-exchanges): web display parity — composed day view, pending strip, adjusted totals"
```

---

### Task T1 (iOS): DTOs + MealPlanService exchange methods

**Files (repo `~/Desktop/BeTech/Clara`):**
- Create: `Clara/Features/MealPlan/PlanExchangeDTOs.swift`
- Modify: `Clara/Features/MealPlan/MealPlanService.swift`, `Clara.xcodeproj/project.pbxproj` (4-point hand registration)
- Test: `ClaraTests/PlanExchangeDTOTests.swift` (register in pbxproj too)

**Interfaces:**
- Consumes: wire shapes from "Pinned wire shapes" (dates/strings stay `String`); existing request pattern in `MealPlanService.swift` (open it first and mirror exactly how it builds/executes requests via `WondishAPIClient`).
- Produces (T2-T4 call these):

```swift
struct PlanExchangeDTO: Decodable, Equatable, Identifiable {
    let id: String
    let source: String            // "RESTAURANT" | "FRIDGE"
    let localDate: String
    let status: String            // "PENDING" | "RESOLVED" | "CANCELLED"
    let servings: Double
    let displacedMenuId: String?
    let name: String
    let originLabel: String
    let emoji: String?
    let perServing: PlanExchangeMacrosDTO
    let incomplete: Bool
    let eaten: Bool
    let createdAt: String
}
struct PlanExchangeMacrosDTO: Decodable, Equatable {
    let calories: Double?; let protein: Double?; let carbs: Double?; let fat: Double?; let fiber: Double?
}
struct PlanExchangesEnvelopeDTO: Decodable, Equatable {
    let pending: [PlanExchangeDTO]; let resolved: [PlanExchangeDTO]
}
// MealPlanService additions:
func createRestaurantExchange(dishId: String, localDate: String, servings: Double) async throws -> PlanExchangeDTO
func createFridgeExchange(recipe: FridgeRecipeDTO, localDate: String, servings: Double) async throws -> PlanExchangeDTO
func resolveExchange(id: String, menuId: String) async throws -> PlanExchangeDTO
func cancelExchange(id: String) async throws -> PlanExchangeDTO
// Day fetch gains exchanges: extend the existing day-plan fetch to append
// exchanges=1 and decode an optional `exchanges: PlanExchangesEnvelopeDTO?`
// on its envelope (optional => older fixture payloads still decode).
```

- [ ] **Step 1: Write the decode test** (`ClaraTests/PlanExchangeDTOTests.swift`)

```swift
import XCTest
@testable import Clara

final class PlanExchangeDTOTests: XCTestCase {
    func testDecodesRestaurantExchange() throws {
        let json = """
        {"pending":[{"id":"x1","source":"RESTAURANT","localDate":"2026-07-30","status":"PENDING","servings":1,"displacedMenuId":null,"name":"Salmon Teriyaki","originLabel":"Ristorante Roma","emoji":null,"perServing":{"calories":620,"protein":40,"carbs":55,"fat":22,"fiber":4},"incomplete":false,"eaten":false,"createdAt":"2026-07-30T10:00:00.000Z"}],"resolved":[]}
        """.data(using: .utf8)!
        let env = try JSONDecoder().decode(PlanExchangesEnvelopeDTO.self, from: json)
        XCTAssertEqual(env.pending.first?.name, "Salmon Teriyaki")
        XCTAssertEqual(env.pending.first?.perServing.calories, 620)
        XCTAssertNil(env.pending.first?.displacedMenuId)
    }
}
```

- [ ] **Step 2: Build/test to verify failure** — from `~/Desktop/BeTech/Clara`, use the repo's `using-xcode-cli` conventions (`xcodebuild test -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 16'` or the scheme the repo's tests already use — check ClaraTests's existing run configuration). Expected: compile failure (types missing).

- [ ] **Step 3: Implement** `PlanExchangeDTOs.swift` (structs above verbatim + a header comment citing the wire source: `wondish_02 types/index.ts PlanExchangeDTO`); add the four service methods to `MealPlanService.swift` following its existing request-building pattern exactly (same client, same error mapping; bodies: `{"restaurantDishId":..., "localDate":..., "servings":...}`, `{"localDate":..., "servings":..., "recipe":{...}, "fridgeRecipeId":...}` — encode `FridgeRecipeDTO` with its existing `Encodable` conformance or add one; PATCH body `{"action":"resolve","menuId":...}` / `{"action":"cancel"}`). Extend the day-plan envelope struct with `let exchanges: PlanExchangesEnvelopeDTO?`.

- [ ] **Step 4: Register both new files in `project.pbxproj`** (PBXBuildFile, PBXFileReference, group children, Sources phase — test file goes in the ClaraTests target).

- [ ] **Step 5: Build + tests green; commit**

```bash
git add Clara/Features/MealPlan/PlanExchangeDTOs.swift Clara/Features/MealPlan/MealPlanService.swift ClaraTests/PlanExchangeDTOTests.swift Clara.xcodeproj/project.pbxproj
git commit -m "feat(plan-exchanges): DTOs + service methods (create/resolve/cancel, day overlay decode)"
```

(Never stage `Config/Debug.xcconfig`.)

---

### Task T2 (iOS): Restaurants — "Add to today's plan"

**Files:**
- Create: `Clara/Features/Restaurants/AddToPlanSheet.swift` (+ pbxproj registration)
- Modify: `Clara/Features/Restaurants/RestaurantDetailView.swift` (lines ~124-185: the Task-6b "Add to today" seam), `Clara/App/LaunchFixtures.swift` (fixture states)
- Delete from build: retire `AddToTodaySheet.swift` usage (leave the file until the audit drill confirms nothing references it, then remove it and its pbxproj entries in this same task)

**Invoke `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design` before editing view code.**

**Interfaces:**
- Consumes: `createRestaurantExchange(dishId:localDate:servings:)` (T1); `RestaurantDishDTO` (existing).
- Produces: dish cards' button labeled "Add to today's plan"; sheet posts the exchange and reports success via the existing `onLogged`-style callback (rename to `onAdded`).

- [ ] **Step 1: View-model-level test** — if the sheet logic lives in the view (current AddToTodaySheet pattern), extract the submit into a small `AddToPlanModel` (ObservableObject) with `func submit() async` calling the service; test success → `didAdd == true` and failure → `errorMessage != nil` using a mock conforming to the service seam. Follow `ClaraTests/ChatViewModelTests.swift`'s mocking style.

- [ ] **Step 2: Implement `AddToPlanSheet`** — copy `AddToTodaySheet.swift`'s structure; changes: title "Add to today's plan"; remove the meal-type picker (slot is chosen at exchange time in the plan screen); keep the servings stepper; footer text: "You'll pick which planned dish it replaces in your Meal Plan."; submit calls `createRestaurantExchange(dishId: dish.id, localDate: <derived like the old sheet derived localDate>, servings: servings)`. Success: transient checkmark then dismiss (existing pattern).

- [ ] **Step 3: Swap the entry point** in `RestaurantDetailView.swift` (~line 160): present `AddToPlanSheet` instead of `AddToTodaySheet`; button label "Add to today's plan". Update the screenshot-fixture hook (`openAddToTodaySheetForScreenshotIfNeeded`, ~line 182) to open the new sheet; rename accordingly.

- [ ] **Step 4: Fixtures** — add launch-argument fixture states in `LaunchFixtures.swift` for the sheet (default, submitting, error) following the existing fixture naming (`-tab restaurants` + a fixture name).

- [ ] **Step 5: Build + tests green; controller screenshots** of the sheet states; commit

```bash
git add Clara/Features/Restaurants/ Clara/App/LaunchFixtures.swift ClaraTests/ Clara.xcodeproj/project.pbxproj
git commit -m "feat(plan-exchanges): Restaurants 'Add to today's plan' sheet replaces instant log"
```

---

### Task T3 (iOS): Fridge — "Add to today's plan"

**Files:**
- Modify: `Clara/Features/Fridge/FridgeRecipeDetailView.swift`, `Clara/Features/Fridge/FridgeRecipeRow.swift` (button), `Clara/App/LaunchFixtures.swift`

**Invoke `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design` first.**

**Interfaces:**
- Consumes: `createFridgeExchange(recipe:localDate:servings:)` (T1); `FridgeRecipeDTO` (existing, `Features/Fridge/FridgeModels.swift:35`).
- Produces: a button under each generated recipe (row: compact; detail: primary) labeled "Add to today's plan".

- [ ] **Step 1: Reuse the T2 model** — generalize `AddToPlanModel` with a second initializer/factory for fridge (`submit` calls `createFridgeExchange`); add a test case mirroring T2's, with a fridge recipe fixture.
- [ ] **Step 2: Detail view** — primary button below the macro grid (`FridgeRecipeDetailView.swift:119` area): full-width, same styling family as the app's primary CTA; on tap present the same sheet (servings defaulted to `recipe.servings`).
- [ ] **Step 3: Row** — trailing compact button on `FridgeRecipeRow` ("Add" with plus icon, ≥44pt target) presenting the same sheet.
- [ ] **Step 4: Fixtures + screenshots** — fixture states for fridge-sheet default/error; controller screenshots.
- [ ] **Step 5: Build + tests green; commit**

```bash
git add Clara/Features/Fridge/ Clara/App/LaunchFixtures.swift ClaraTests/ Clara.xcodeproj/project.pbxproj
git commit -m "feat(plan-exchanges): Fridge recipes gain 'Add to today's plan'"
```

---

### Task T4 (iOS): Meal Plan — pending strip, exchange picker, eaten, un-exchange

**Files:**
- Create: `Clara/Features/MealPlan/ExchangePickerSheet.swift` (+ pbxproj)
- Modify: `Clara/Features/MealPlan/MealPlanViewModel.swift`, `Clara/Features/MealPlan/MealPlanView.swift` (or `PlanHubView.swift` — whichever renders today's meal list; read both first), `Clara/App/LaunchFixtures.swift`

**Invoke `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design` first.**

**Interfaces:**
- Consumes: day fetch with `exchanges` envelope, `resolveExchange(id:menuId:)`, `cancelExchange(id:)` (T1); existing meal-log posting seam for eaten (extend its wire struct with `planExchangeId: String?`).
- Produces: the complete user flow — pending strip → picker ("Choose a dish to exchange for this restaurant dish" / "…for this fridge dish") → composed plan → mark eaten → un-exchange via context menu.

- [ ] **Step 1: View-model tests first** (`MealPlanViewModelTests` style): given a day payload with one resolved exchange displacing menu `m1`, the composed rows replace `m1`'s dish with the exchange; given pending items, `pendingExchanges` is non-empty; `resolve(exchangeId:menuId:)` success updates state; failure surfaces `errorMessage`. Use the existing service-mock pattern.
- [ ] **Step 2: View model** — add `pendingExchanges: [PlanExchangeDTO]`, `resolvedByMenuId: [String: PlanExchangeDTO]`; fetch with exchanges; expose `resolve`, `cancelExchange`, `markExchangeEaten` (posts the meal log with `planExchangeId`, source `"RESTAURANT"`/`"FRIDGE"`, snapshot name/servings — macros come from the DTO for FRIDGE; for RESTAURANT the server snapshot governs, send what the existing restaurant logging path sends plus `planExchangeId`).
- [ ] **Step 3: Pending strip** — above today's meals: card per pending dish (emoji/name/origin + "Choose exchange" button) opening `ExchangePickerSheet`.
- [ ] **Step 4: Picker sheet** — title per source ("Choose a dish to exchange for this restaurant dish"); lists today's planned meals that are neither displaced nor eaten, each with name + meal-type label + calories; tap → confirm → `resolve`; disabled/empty state when nothing is exchangeable ("All of today's dishes are already eaten or exchanged").
- [ ] **Step 5: Composed slot rendering** — displaced slot shows the exchange dish with origin badge; context menu: "Mark eaten" (until eaten), "Undo exchange" (calls cancel; hidden once eaten).
- [ ] **Step 6: Fixtures + screenshots** — fixture payloads for: pending-only, resolved, resolved+eaten, empty-picker, error; controller screenshots of each; Dynamic Type XXL spot-check on the strip and picker.
- [ ] **Step 7: Build + tests green; commit**

```bash
git add Clara/Features/MealPlan/ Clara/App/LaunchFixtures.swift ClaraTests/ Clara.xcodeproj/project.pbxproj
git commit -m "feat(plan-exchanges): Meal Plan pending strip, exchange picker, eaten + undo"
```

---

### Task F1: Final review + audit drill + close-out

- [ ] **Step 1:** Whole-branch review on the strongest model (both repos' diffs): contract walk of every wire shape against "Pinned wire shapes"; verify default `/api/meal-plan` GET body unchanged; triage carried minors.
- [ ] **Step 2:** Audit drill (simulator QA subagent): clean build + full suite both repos; fixture sweep of every new state with screenshots; whole-tab sweep of Restaurants/Fridge/Meal Plan; console hygiene. Live-network smoke is release-gated (needs deploy + user sign-in) — disclose, don't fake.
- [ ] **Step 3:** Merge → push both repos (Clara pushes need the user's GitHub auth — origin `theonlybex/wondish_IOS`).
- [ ] **Step 4:** Close-out block in `.superpowers/sdd/progress.md`: commits, test counts, deviations, gotchas, post-merge tickets (known: provider meal-plans surface not composed; week view not composed; web exchange interaction), release gates.
- [ ] **Step 5:** Release gate: `npx prisma migrate status` / `prisma migrate deploy` against prod Neon **before** exercising the new routes; 401 probes of the three new endpoints return JSON; user live smoke on www.wondish.io + TestFlight/simulator.

---

## Self-review notes

- **Spec coverage:** data model → E1; composition → E2; endpoints → E3-E5; opt-in read + eaten provenance → E6; grocery/journal → E7; web parity → W1; iOS button/flows → T1-T4; testing distributed per task; regeneration behavior needs no code (planVersion filtering in E2 queries covers it).
- **Deliberately out (matches spec):** provider surface, week-view composition, web exchange interaction, future-day exchanges.
- **Type consistency check:** `PlanExchangeDTO` field list identical in types/index.ts (E2), route serializers (E3-E5 via `toExchangeDTO`), and Swift DTO (T1). `resolveGuard` name used in E5 only. `getExchangesForRange`/`getDisplacedMenuIdsForRange` names match between E2 and E6/E7.

---

AMENDMENT 2026-07-30 (execution, T4): "Eaten" moves server-side. The client
cannot post the RESTAURANT meal-log itself — PlanExchangeDTO carries no
restaurantDishId (by design) and standing rule 3 forbids client-priced
macros. The PATCH endpoint therefore gains `{ action: "eat" }`: guards
(RESOLVED, not already eaten) → in one transaction writes the MealLog row
from the exchange's own snapshot (per-serving macros verbatim, servings from
the row, mealType from the fridge row / displaced menu with "dinner"
fallback, provenance ids + planExchangeId) → returns the DTO with
eaten=true. iOS calls `eatExchange(id:)`; the MealLogging seam is untouched.
Un-eat stays log-deletion (existing DELETE), out of iOS v1. Supersedes E5/E6's
client-posts-planExchangeId flow for exchanges; the parser support added in
E6 remains valid wire surface.
