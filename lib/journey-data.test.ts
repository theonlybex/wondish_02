import { test } from "node:test";
import assert from "node:assert/strict";

// getJourneyPayload reads the prisma singleton from @/lib/db, which resolves
// `globalThis.prisma ?? createPrismaClient()`. Injecting a fabricated data stub
// on globalThis BEFORE the module loads turns the payload into a pure
// data-in/data-out function (same pattern as lib/meal-plan.test.ts). The stub
// honors the where-clauses it receives (patientId, date window, localDate
// window, deletedAt: null) rather than returning fixtures blindly, so a source
// regression that drops a filter fails here. It deliberately has NO menu/plan
// models: if the steady-state target derivation ever tried a plan-ramp lookup
// (getPlanDayCalories), the stub would throw — pinning usePlanRamp=false.
const db = {
  journalEntries: [] as any[],
  mealLogs: [] as any[],
  patient: null as any,
};
const calls = {
  journalEntry: [] as any[],
  mealLog: [] as any[],
};

(globalThis as any).prisma = {
  journalEntry: {
    findMany: async (args: any) => {
      calls.journalEntry.push(args);
      const { gte, lte } = args?.where?.date ?? {};
      return db.journalEntries.filter(
        (e) =>
          e.patientId === args?.where?.patientId &&
          (gte === undefined || e.date >= gte) &&
          (lte === undefined || e.date <= lte)
      );
    },
  },
  mealLog: {
    findMany: async (args: any) => {
      calls.mealLog.push(args);
      const { gte, lte } = args?.where?.localDate ?? {};
      return db.mealLogs.filter(
        (r) =>
          r.patientId === args?.where?.patientId &&
          (args?.where?.deletedAt !== null || r.deletedAt == null) &&
          (gte === undefined || r.localDate >= gte) &&
          (lte === undefined || r.localDate <= lte)
      );
    },
  },
  patient: {
    findUnique: async (args: any) =>
      db.patient && db.patient.id === args?.where?.id ? db.patient : null,
  },
};

// Dynamic import so the assignment above runs before lib/db initialises.
const modPromise = import("./journey-data");

// Caloric profile complete → getDayTarget yields a steady-state DailyTargets.
const completePatient = () => ({
  id: "p1",
  weight: 80,
  weightUnit: "kg",
  height: 180,
  heightUnit: "cm",
  birthday: new Date(1990, 0, 15),
  sexAtBirth: "male",
  goalWeight: null,
  goalWeightUnit: null,
  mealPlanWeight: null,
  mealPlanStartDate: null,
  physicalActivity: { level: 2 },
  healthConditions: [] as any[],
  motivations: [] as any[],
});

const entryRow = (over: Partial<any> = {}) => ({
  id: "je1",
  patientId: "p1",
  date: new Date(2026, 6, 5), // local Jul 5
  mood: "3",
  energyLevel: null,
  weight: null,
  meals: [{ skipped: false, preparation: "cooked" }],
  ...over,
});

const logRow = (over: Partial<any> = {}) => ({
  patientId: "p1",
  localDate: "2026-07-05",
  servings: 1,
  calories: 2000,
  protein: 100,
  carbs: 200,
  fat: 60,
  fiber: 20,
  incomplete: false,
  deletedAt: null as Date | null,
  ...over,
});

// Callers' window convention: local midnight → local end-of-day.
const FROM = new Date(2026, 6, 1, 0, 0, 0, 0);
const TO = new Date(2026, 6, 10, 23, 59, 59, 999);

function reset() {
  db.journalEntries = [];
  db.mealLogs = [];
  db.patient = completePatient();
  calls.journalEntry.length = 0;
  calls.mealLog.length = 0;
}

test("getJourneyPayload: one fetch path yields stats + macroStats + entries", async () => {
  const { getJourneyPayload } = await modPromise;
  reset();
  db.journalEntries = [entryRow()];
  db.mealLogs = [
    logRow(),
    logRow({ localDate: "2026-07-06", calories: 1800, protein: 90, carbs: 180, fat: 55 }),
  ];

  const payload = await getJourneyPayload("p1", FROM, TO);

  // stats come from computeJourneyStats over the fetched entries, with the
  // window's totalDays (10) as the engagement denominator — 1 engaged / 10.
  assert.equal(payload.stats.avgMood, 3);
  assert.equal(payload.stats.engagementPercent, 10);

  // macroStats come from computeMacroStats over the fetched logs.
  assert.deepEqual(
    payload.macroStats.dailyMacros.map((d) => [d.date, d.calories]),
    [
      ["2026-07-05", 2000],
      ["2026-07-06", 1800],
    ]
  );
  assert.equal(payload.macroStats.daysLogged, 2);
  assert.equal(payload.macroStats.avgCalories, 1900);

  // entries pass through for the route's existing consumers.
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].id, "je1");
});

test("getJourneyPayload: meal-log query is patient-scoped to the localDate string window, tombstones excluded", async () => {
  const { getJourneyPayload } = await modPromise;
  reset();
  db.mealLogs = [
    logRow(),
    logRow({ localDate: "2026-06-30", calories: 900 }), // before window
    logRow({ localDate: "2026-07-11", calories: 900 }), // after window
    logRow({ localDate: "2026-07-05", calories: 400, deletedAt: new Date(2026, 6, 6) }),
    logRow({ patientId: "p2", localDate: "2026-07-05", calories: 555 }),
  ];

  const payload = await getJourneyPayload("p1", FROM, TO);

  assert.equal(calls.mealLog.length, 1);
  assert.deepEqual(calls.mealLog[0].where, {
    patientId: "p1",
    localDate: { gte: "2026-07-01", lte: "2026-07-10" },
    deletedAt: null,
  });
  assert.deepEqual(
    payload.macroStats.dailyMacros.map((d) => [d.date, d.calories]),
    [["2026-07-05", 2000]]
  );
});

test("getJourneyPayload: complete profile → steady-state target attached to macroStats", async () => {
  const { getJourneyPayload } = await modPromise;
  reset();
  db.mealLogs = [logRow()];

  const payload = await getJourneyPayload("p1", FROM, TO);

  const target = payload.macroStats.target;
  assert.ok(target, "target should be derived from the complete caloric profile");
  assert.ok(target!.calories > 0);
  assert.ok(target!.protein > 0);
  // The range contract pins the steady-state basis (usePlanRamp=false); the
  // full DailyTargets object passes through so the basis stays legible.
  assert.equal((target as any).basis, "steady-state");
});

test("getJourneyPayload: incomplete caloric profile → target null, logging stats intact", async () => {
  const { getJourneyPayload } = await modPromise;
  reset();
  db.patient = { ...completePatient(), weight: null };
  db.mealLogs = [logRow()];

  const payload = await getJourneyPayload("p1", FROM, TO);

  assert.equal(payload.macroStats.target, null);
  assert.equal(payload.macroStats.daysOnTarget, 0);
  assert.equal(payload.macroStats.daysLogged, 1);
  assert.equal(payload.macroStats.avgCalories, 2000);
});
