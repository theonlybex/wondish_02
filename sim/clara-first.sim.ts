// Clara-first user simulation — simulated people living through the new
// first run, Numbers, Log, cooking, pills and Clara's dish tools, against the
// REAL route handlers and library code, in-process, on an in-memory store
// (sim/fake-db.ts createClaraStore). Nothing touches a database or the network:
// Clerk's auth() is mocked (sim/setup.ts), and the dish model is a FAKE that
// returns raw model output (sim/clara-dishes.ts) which then goes through the
// product's real parser, oil repair and every server-side gate.
//
//   npm run sim:snapshot        # read-only export from the shared DB (once)
//   npm run sim:clara-first     # this file; report → docs/qa/clara-first-sim.md
//
// Every person gets a seeded persona and a scripted journey on a simulated
// clock (Date is mocked; the process runs in UTC like Vercel; each person has
// their own time zone and sends their LOCAL date as `today`, as the app does).
// After every step the invariants below are checked. A failed invariant whose
// id is listed in KNOWN_FINDINGS is a recorded product finding (reported, not
// fatal); any other failure fails the run.
import "./setup"; // mocks server-only + Clerk auth, loads the snapshot — must load first
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { snap, state, ingById, ingByName } from "./setup";
import { createClaraStore } from "./fake-db";
import { buildProfiles, makePatient, type Profile, type RuleKey } from "./profiles";
import { makeOracle } from "./oracle";
import { TEMPLATES, fromTemplate, fromLibrary, withSlippedIn, withGenericOil, fakeDishStream, type ModelDish } from "./clara-dishes";

// ── isolation: the dish model, the clock, the store ─────────────────────────
type FakeModelCall = { system: string; user: string; offered: ModelDish[] };
// "garbage": output that is not the schema; "hang": no answer until the deadline aborts the call.
type FakeAnswer = ModelDish[] | "garbage" | "hang";
const fakeModel = {
  decide: null as null | ((meal: string, servings: number, system: string) => FakeAnswer),
  calls: [] as FakeModelCall[],
};
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    // The only client the dish generator builds. It never leaves the process.
    createAnthropic: () => ({
      messages: {
        create: async (params: any, opts?: { signal?: AbortSignal }) => {
          const system = String(params.system ?? "");
          const user = String(params.messages?.[0]?.content ?? "");
          const meal = (user.match(/Suggest the \d+ (\w+) dishes/)?.[1] ?? "dinner").replace(/^./, (c) => c.toUpperCase());
          const servings = Number(system.match(/servings is (\d+)/)?.[1] ?? 1);
          const answer = fakeModel.decide ? fakeModel.decide(meal, servings, system) : [];
          const offered = Array.isArray(answer) ? answer : [];
          fakeModel.calls.push({ system, user, offered });
          // The dish generator streams a schema-constrained answer (lib/clara/dish-output.ts).
          if (!params.stream || !params.output_config?.format) throw new Error("sim: the dish generator must stream structured output");
          return fakeDishStream(answer === "garbage" ? { kind: "garbage" } : answer === "hang" ? { kind: "hang" } : { kind: "dishes", dishes: offered }, opts?.signal);
        },
      },
    }),
    HAIKU_MODEL: "claude-haiku-5-5",
    claraBusyStatus: () => null,
    CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.",
    ANTHROPIC_TIMEOUT_MS: 90_000,
    ANTHROPIC_MAX_RETRIES: 1,
  },
});
// generateGated returns [] without a key; the client above is the fake.
process.env.ANTHROPIC_API_KEY = "sim-fake-key-never-sent";

const SIM_START = Date.UTC(2026, 9, 20, 12); // 2026-10-20, before every journey
mock.timers.enable({ apis: ["Date"], now: SIM_START });

const store = createClaraStore(snap);
(globalThis as any).prisma = store.client; // before any product module loads @/lib/db
// lib/rate-limit's in-memory store (no Upstash env in the simulation); created when that module loads.
const rateStore = () => (globalThis as any).__wondishRateLimitStore as Map<string, unknown> | undefined;

// ── the level catalogue as the PLAN states it (independent of lib/level-catalogue) ──
type Unit = "g" | "mg" | "mcg";
type Dir = "enough" | "under" | "match";
const PLAN_LEVELS: [string, string, "food" | "minerals" | "vitamins", Unit, Dir, number, number | null][] = [
  ["protein", "Protein", "food", "g", "enough", 50, null], ["carbs", "Carbohydrate", "food", "g", "match", 275, null],
  ["fibre", "Fibre", "food", "g", "enough", 28, null], ["addedSugar", "Added sugar", "food", "g", "under", 50, null],
  ["saturatedFat", "Saturated fat", "food", "g", "under", 20, null], ["sodium", "Sodium", "food", "mg", "under", 2300, null],
  ["omega3", "Omega-3", "food", "mg", "enough", 250, null], ["potassium", "Potassium", "minerals", "mg", "enough", 4700, null],
  ["calcium", "Calcium", "minerals", "mg", "enough", 1300, 2500], ["iron", "Iron", "minerals", "mg", "enough", 18, 45],
  ["magnesium", "Magnesium", "minerals", "mg", "enough", 420, null], ["zinc", "Zinc", "minerals", "mg", "enough", 11, 40],
  ["iodine", "Iodine", "minerals", "mcg", "enough", 150, 1100], ["vitaminA", "Vitamin A", "vitamins", "mcg", "enough", 900, 3000],
  ["vitaminB6", "Vitamin B6", "vitamins", "mg", "enough", 1.7, 100], ["vitaminB12", "Vitamin B12", "vitamins", "mcg", "enough", 2.4, null],
  ["vitaminC", "Vitamin C", "vitamins", "mg", "enough", 90, 2000], ["vitaminD", "Vitamin D", "vitamins", "mcg", "enough", 20, 100],
  ["vitaminE", "Vitamin E", "vitamins", "mg", "enough", 15, 1000], ["vitaminK", "Vitamin K", "vitamins", "mcg", "enough", 120, null],
  ["folate", "Folate", "vitamins", "mcg", "enough", 400, 1000], ["phosphorus", "Phosphorus", "minerals", "mg", "under", 1250, null],
];
const LV = new Map(PLAN_LEVELS.map(([key, name, group, unit, direction, target, upper]) => [key, { key, name, group, unit, direction, target, upper }]));
const LEVEL_KEYS = PLAN_LEVELS.map((l) => l[0]);
const PILLS = ["Vitamin D", "Vitamin B12", "Multivitamin", "Omega-3", "Magnesium", "Iron", "Calcium"] as const;
type Pill = (typeof PILLS)[number];
type Content = { key: string; amount: number; unit: Unit };
const multi = (k: string): Content => ({ key: k, amount: LV.get(k)!.target, unit: LV.get(k)!.unit });
const TYPICAL: Record<Pill, Content[]> = {
  "Vitamin D": [{ key: "vitaminD", amount: 25, unit: "mcg" }],
  "Vitamin B12": [{ key: "vitaminB12", amount: 250, unit: "mcg" }],
  "Omega-3": [{ key: "omega3", amount: 300, unit: "mg" }],
  Magnesium: [{ key: "magnesium", amount: 250, unit: "mg" }],
  Iron: [{ key: "iron", amount: 18, unit: "mg" }],
  Calcium: [{ key: "calcium", amount: 500, unit: "mg" }],
  Multivitamin: [...["vitaminA", "vitaminB6", "vitaminB12", "vitaminC", "vitaminD", "vitaminE", "vitaminK", "folate"].map(multi), { key: "zinc", amount: 11, unit: "mg" }, { key: "iodine", amount: 150, unit: "mcg" }],
};
const MCG: Record<Unit, number> = { mcg: 1, mg: 1000, g: 1_000_000 };
const convert = (n: number, from: Unit, to: Unit) => (n * MCG[from]) / MCG[to];
const EATING_KEYS = ["veg", "fruit", "beans", "grains", "fish", "meat", "dairy", "packaged", "sweet"] as const;
type Eating = Record<(typeof EATING_KEYS)[number], 0 | 1 | 2 | null>;
const emptyEating = (): Eating => Object.fromEntries(EATING_KEYS.map((k) => [k, null])) as Eating;

/** The plan's starting-picture rules, written out again: a rule fires only when every answer it reads is given. */
function expectedPicture(v: Eating, pills: Set<string>) {
  const has = (p: string) => pills.has(p);
  const m = has("Multivitamin");
  const s = (...xs: (number | null)[]) => (xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));
  const le = (x: number | null, n: number) => x !== null && x <= n;
  const little: string[] = [];
  if (le(s(v.veg, v.fruit, v.beans, v.grains), 3)) little.push("fibre");
  if (le(s(v.beans, v.meat), 1) && !has("Iron")) little.push("iron");
  if (le(s(v.veg, v.fruit, v.beans), 2)) little.push("potassium");
  if (v.dairy === 0 && !has("Calcium")) little.push("calcium");
  if (v.fish === 0 && !has("Omega-3")) little.push("omega3");
  if (v.fish !== null && v.fish < 2 && !has("Vitamin D") && !m) little.push("vitaminD");
  if (v.meat === 0 && v.dairy === 0 && !has("Vitamin B12") && !m) little.push("vitaminB12");
  if (le(s(v.veg, v.fruit), 1) && !m) little.push("vitaminC");
  if (le(s(v.beans, v.grains, v.veg), 1) && !has("Magnesium")) little.push("magnesium");
  const aLot: string[] = [];
  if (v.packaged === 2) aLot.push("sodium");
  if (v.sweet === 2) aLot.push("addedSugar");
  if (v.meat === 2 && v.dairy === 2) aLot.push("saturatedFat");
  return { little, aLot };
}
function expectedWord(direction: Dir, amount: number, target: number, upper: number | null): string {
  const pct = amount / target;
  if (direction === "under") return pct <= 1 ? "within limit" : "a lot";
  if (direction === "match") return pct < 0.7 ? "little" : pct <= 1.3 ? "on track" : "a lot";
  if (pct < 0.7) return "little";
  if (upper != null && amount > upper) return "more than needed";
  return "on track";
}

// ── wire contracts as shapes (exact keys, types, nullability, enums) ────────
// { opt } is a key the server sends only when it has a value (a log entry's calories, a level's wordTarget).
type Sh = "string" | "number" | "int" | "boolean" | "iso" | "date" | { n: Sh } | { opt: Sh } | { arr: Sh } | { obj: Record<string, Sh> } | { en: readonly unknown[] } | "any";
function conform(v: unknown, s: Sh, path: string, errs: string[]) {
  if (errs.length > 8) return;
  if (s === "any") return;
  if (typeof s === "object" && "n" in s) { if (v !== null) conform(v, s.n, path, errs); return; }
  if (typeof s === "object" && "opt" in s) { conform(v, s.opt, path, errs); return; }
  if (typeof s === "object" && "en" in s) { if (!s.en.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} not in ${JSON.stringify(s.en)}`); return; }
  if (typeof s === "object" && "arr" in s) { if (!Array.isArray(v)) { errs.push(`${path}: not an array`); return; } v.forEach((x, i) => conform(x, s.arr, `${path}[${i}]`, errs)); return; }
  if (typeof s === "object" && "obj" in s) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) { errs.push(`${path}: not an object`); return; }
    const keys = Object.keys(v as object);
    for (const k of keys) if (!(k in s.obj)) errs.push(`${path}.${k}: unexpected key`);
    for (const [k, sub] of Object.entries(s.obj)) {
      if (!(k in (v as object))) { if (!(typeof sub === "object" && "opt" in sub)) errs.push(`${path}.${k}: missing`); }
      else conform((v as any)[k], sub, `${path}.${k}`, errs);
    }
    return;
  }
  const ok =
    s === "string" ? typeof v === "string" :
    s === "number" ? typeof v === "number" && Number.isFinite(v) :
    s === "int" ? Number.isInteger(v) :
    s === "boolean" ? typeof v === "boolean" :
    s === "iso" ? typeof v === "string" && !Number.isNaN(Date.parse(v)) :
    s === "date" ? typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) : false;
  if (!ok) errs.push(`${path}: ${JSON.stringify(v)} is not ${s}`);
}
const KEY = { en: LEVEL_KEYS } as const;
const NAMED = { arr: { obj: { key: KEY, name: "string" } } } as const;
const SH = {
  onboarding: { obj: {
    complete: "boolean",
    conditions: { arr: { obj: { id: "string", name: "string", common: "boolean", label: "string" } } },
    allergies: { arr: { obj: { id: "string", name: "string" } } },
    activities: { arr: { obj: { id: "string", name: "string" } } },
    profile: { obj: { weightUnit: { en: ["kg", "lbs"] }, heightUnit: { n: { en: ["cm", "in", "ftin"] } }, conditionIds: { arr: "string" }, noCondition: "boolean", birthday: { n: "date" }, sexAtBirth: { n: { en: ["MALE", "FEMALE"] } },
      heightCm: { n: "number" }, weightKg: { n: "number" }, activityId: { n: "string" }, allergyIds: { arr: "string" } } },
    usualEating: { obj: Object.fromEntries(EATING_KEYS.map((k) => [k, { en: [0, 1, 2, null] }])) },
    pills: { arr: { en: PILLS } },
    weightGoal: { n: { en: ["lose", "keep", "gain", "none"] } },
    startingPicture: { obj: { little: NAMED, aLot: NAMED } },
  } },
  full: { obj: {
    summary: { obj: { fromDate: "date", toDate: "date", daysCounted: "int", enoughLogs: "boolean" } },
    source: { en: ["logged", "answers", "none"] },
    calories: { obj: { amount: { n: "number" }, target: { n: "number" } } },
    // The Macros block (lib/numbers-full.ts FullMacros), added to the app after this contract was written.
    macros: { obj: { loggedShare: "number", loggedShareRaw: "number", daysCounted: "int",
      rows: { arr: { obj: { key: { en: ["protein", "carbs", "fat"] }, name: "string", average: { n: "number" }, target: { n: "number" }, wordTarget: { opt: "number" },
        today: { n: "number" }, word: { n: { en: ["little", "on track", "a lot"] } } } } } } },
    weight: { n: { obj: { value: "number", unit: { en: ["kg", "lbs"] }, change: { n: "number" } } } },
    levels: { arr: { obj: { key: KEY, name: "string", group: { en: ["food", "minerals", "vitamins"] }, direction: { en: ["enough", "under", "match"] },
      unit: { en: ["g", "mg", "mcg"] }, target: "number", upperLimit: { n: "number" }, amount: { n: "number" }, pillAmount: "number",
      foodCounted: "boolean", estimate: "boolean", word: { n: { en: ["little", "on track", "within limit", "a lot", "more than needed"] } },
      wordTarget: { opt: "number" }, tracked: "boolean", goal: { n: "number" } } } },
    areas: { arr: { obj: { key: "string", name: "string", uses: { arr: KEY } } } },
    startingPicture: { n: { obj: { little: NAMED, aLot: NAMED } } },
  } },
  numbersOld: { obj: {
    summary: { obj: { fromDate: "date", toDate: "date", daysCounted: "int", enoughLogs: "boolean",
      levels: { arr: { obj: { key: { en: ["calories", "protein", "carbs", "fat", "fibre", "sodium"] }, name: "string", direction: { en: ["enough", "under", "match"] },
        amount: { n: "number" }, target: { n: "number" }, unit: { en: ["kcal", "g", "mg"] }, word: { n: { en: ["little", "on track", "within limit", "a lot"] } } } } },
      little: { arr: "string" }, aLot: { arr: "string" } } },
    weight: { n: { obj: { value: "number", unit: { en: ["kg", "lbs"] }, change: { n: "number" } } } },
  } },
  log: { obj: { days: { arr: { obj: { date: "date", entries: { arr: { obj: { id: "string", mealType: { en: ["breakfast", "lunch", "dinner", "snack"] }, name: "string", source: "string", estimated: "boolean",
    photoId: { opt: "string" }, calories: { opt: "number" }, protein: { opt: "number" }, carbs: { opt: "number" }, fat: { opt: "number" } } } } } } } } },
  tracked: { obj: { tracked: { arr: KEY } } },
  goals: { obj: { goals: { arr: { obj: { key: KEY, amount: { n: "number" } } } } } },
  weight: { obj: { weight: { obj: { value: "number", unit: { en: ["kg", "lbs"] } } } } },
  ok: { obj: { ok: { en: [true] } } },
  profilePatch: { obj: { ok: { en: [true] }, patientId: "string" } },
  error: { obj: { error: "string", field: "any" } },
  mealLogDto: { obj: {
    id: "string", localDate: "date", mealType: "string", source: "string", name: "string", servings: "number", unit: { n: "string" }, clientRequestId: { n: "string" },
    perServing: { obj: { calories: { n: "number" }, protein: { n: "number" }, carbs: { n: "number" }, fat: { n: "number" }, fiber: { n: "number" }, incomplete: "boolean" } },
    totals: { obj: { calories: "number", protein: "number", carbs: "number", fat: "number", fiber: "number", incomplete: "boolean" } },
    recipeId: { n: "string" }, restaurantDishId: { n: "string" }, customIngredientId: { n: "string" }, journalMealId: { n: "string" }, pictureResultId: { n: "string" },
    fridgeRecipeId: { n: "string" }, note: { n: "string" }, deletedAt: { n: "iso" }, loggedAt: "iso", updatedAt: "iso",
  } },
} satisfies Record<string, Sh>;
const SUPP = (taken: boolean): Sh => ({ obj: { id: "string", name: "string", dosage: { n: "string" }, timeSlot: { en: ["MORNING", "AFTERNOON", "EVENING"] },
  ...(taken ? { takenToday: "boolean" } : {}), contents: { n: { arr: { obj: { key: KEY, amount: "number", unit: { en: ["g", "mg", "mcg"] } } } } }, estimated: "boolean" } });
const MACROS: Sh = { obj: { calories: "number", protein: "number", carbs: "number", fat: "number", fiber: "number", incomplete: "boolean" } };
const MEALLOG_POST: Sh = { obj: { log: SH.mealLogDto, dayTotals: MACROS, dayTarget: { n: "any" }, remaining: { n: { obj: { calories: "number", protein: "number", carbs: "number", fat: "number" } } } } };

// ── findings: invariant ids that are known product defects (reported, not fatal) ──
// Filled in from triage; every entry is written up in docs/qa/clara-first-sim.md.
const KNOWN_FINDINGS: Record<string, { severity: "Critical" | "Important" | "Minor"; title: string }> = {
  "pills.catalogue-pill-counts": { severity: "Minor", title: "A pill entered on the website counts for nothing on Numbers" },
  "onboarding.resume-step4": { severity: "Minor", title: "Closing the app on step 4 skips the weight question for good" },
  "units.untouched-weight-stable": { severity: "Minor", title: "Re-saving untouched basics nudges the stored weight by 0.1 lb" },
  "units.edit-keeps-weight-unit": { severity: "Minor", title: "Editing basics from Account resets the weight unit to the phone's locale" },
};

// ── harness ─────────────────────────────────────────────────────────────────
type Failure = { id: string; person: string; step: string; detail: string };
const failures: Failure[] = [];
const counts = { requests: 0, assertions: 0, byRoute: new Map<string, number>(), statuses: new Map<number, number>() };
let current = { person: "", step: "" };
// How often each situation actually happened — so a passing invariant is not a vacuous one.
const coverage = new Map<string, number>();
const cover = (k: string) => coverage.set(k, (coverage.get(k) ?? 0) + 1);
function check(id: string, cond: boolean, detail: () => string) {
  counts.assertions++;
  if (!cond) failures.push({ id, person: current.person, step: current.step, detail: detail().slice(0, 400) });
}
function shape(id: string, v: unknown, s: Sh) {
  const errs: string[] = [];
  conform(v, s, "$", errs);
  check(`contract:${id}`, errs.length === 0, () => errs.join("; "));
}

let NextRequestCtor: any;
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const serverErrors: string[] = [];
type Res = { status: number; json: any };
async function call(label: string, fn: (req: any, ctx: any) => Promise<Response>, opts: { method?: string; path?: string; query?: Record<string, string>; body?: unknown; params?: Record<string, string> } = {}): Promise<Res> {
  counts.requests++;
  counts.byRoute.set(label, (counts.byRoute.get(label) ?? 0) + 1);
  rateStore()?.clear(); // rate limits are not what is simulated: a person replays dozens of taps in one simulated minute
  const url = new URL(opts.path ?? "/api/sim", "http://sim.local");
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const req = new NextRequestCtor(url, {
    method: opts.method ?? "GET",
    ...(opts.body !== undefined ? { body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body), headers: { "content-type": "application/json" } } : {}),
  });
  console.log = console.warn = console.info = () => {};
  console.error = (...a: unknown[]) => serverErrors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 600));
  let res: Response;
  try {
    res = await fn(req, { params: opts.params ?? {} });
  } catch (e) {
    Object.assign(console, quiet);
    check("no-throw", false, () => `${label} threw: ${e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" | ") : String(e)}`);
    return { status: 599, json: null };
  } finally {
    Object.assign(console, quiet);
  }
  counts.statuses.set(res.status, (counts.statuses.get(res.status) ?? 0) + 1);
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  check("no-5xx", res.status < 500, () => `${label} → ${res.status} ${JSON.stringify(json)?.slice(0, 200)} ${serverErrors.slice(-1)[0] ?? ""}`);
  return { status: res.status, json };
}

// ── time: each person's own clock and local date ────────────────────────────
function localDate(ms: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/** The UTC instant of a local wall-clock time in `tz` (DST-aware). */
function zoned(date: string, hour: number, minute: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    guess += Date.UTC(y, m - 1, d, hour, minute) - asUtc;
  }
  return guess;
}
const addDays = (date: string, n: number) => { const [y, m, d] = date.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
let simNow = SIM_START;
function setClock(ms: number) {
  // Within one journey the simulated clock only moves forward.
  simNow = Math.max(simNow + 1000, ms);
  mock.timers.setTime(simNow);
}

// ── seeded randomness ───────────────────────────────────────────────────────
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const pick = <T,>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: R, p: number) => r() < p;
const round1 = (n: number) => Math.round(n * 10) / 10;
const LBS_PER_KG_APP = 2.2046226218; // the app's constant (FirstRunViewModel)

// ── personas ────────────────────────────────────────────────────────────────
type Flow = "straight" | "interrupt1" | "interrupt2" | "interrupt3" | "doublePut" | "editLater";
type Persona = {
  id: string; idx: number; tier: string; rules: RuleKey[]; clerkId: string; seed: number;
  web: boolean; oldApp: boolean; tz: string; startDate: string;
  sex: "MALE" | "FEMALE"; birthday: string; age: number; metric: boolean;
  heightCm: number; heightEntry: { cm?: number; ft?: number; inch?: number }; weightEntry: number; // kg or lbs as typed
  displayUnit: "kg" | "lbs"; activityLevel: number; goal: "lose" | "keep" | "gain" | "none"; goalWeightLbs: number | null;
  eating: Partial<Eating>; eatingLabel: string; pills: Pill[]; pillsLabel: string; websiteVitaminD: boolean; flow: Flow;
  mealsPattern: number[]; // meals per day, days 1–10
};
const TZS = ["Europe/London", "America/Los_Angeles", "Pacific/Auckland", "Pacific/Honolulu", "Asia/Kolkata", "UTC", "America/New_York"];
const EATING_PATTERNS: [string, () => Partial<Eating>][] = [
  ["all unanswered", () => ({})],
  ["all rarely", () => Object.fromEntries(EATING_KEYS.map((k) => [k, 0])) as Partial<Eating>],
  ["all most days", () => Object.fromEntries(EATING_KEYS.map((k) => [k, 2])) as Partial<Eating>],
  ["mockup sample", () => ({ veg: 1, fruit: 1, beans: 0, grains: 1, fish: 0, meat: 1, dairy: 1, packaged: 2, sweet: 1 })],
  ["partial (veg, fish, packaged)", () => ({ veg: 0, fish: 0, packaged: 2 })],
  ["partial (dairy only)", () => ({ dairy: 0 })],
];
const PILL_SETS: [string, Pill[]][] = [["none", []], ["all seven", [...PILLS]], ["Multivitamin only", ["Multivitamin"]], ["D + Omega-3", ["Vitamin D", "Omega-3"]], ["Iron + Calcium + B12", ["Iron", "Calcium", "Vitamin B12"]]];

function buildPersonas(): Persona[] {
  const keep = (k: RuleKey) => /^(allergy|avoid|condition|diet|goal):/.test(k); // trials, dislikes, own plans: no route in this flow
  const all = buildProfiles(snap, { pairs: false, random: 12 });
  const chosen: Profile[] = [];
  chosen.push(...all.filter((p) => p.tier === "real"));
  chosen.push(...all.filter((p) => p.tier === "curated"));
  const singles = new Set([
    "allergy:Dairy", "allergy:Eggs", "allergy:Fish", "allergy:Peanuts", "allergy:Sesame", "allergy:Shellfish", "allergy:Soy", "allergy:Tree nuts", "allergy:Wheat",
    "condition:Chronic Kidney Disease stage 1-2", "condition:Chronic kidney disease – stage 3", "condition:Celiac Disease", "condition:Pregnancy",
    "condition:Type 2 Diabetes", "condition:Hypertension", "condition:High Cholesterol", "condition:PCOS", "condition:Fatty Liver Disease (NAFLD)",
    "diet:Vegan", "diet:Vegetarian", "diet:Keto", "condition:GERD", "condition:Migraine", "condition:IBS-C",
  ]);
  chosen.push(...all.filter((p) => p.tier === "single" && singles.has(p.rules[0])));
  chosen.push(...all.filter((p) => p.tier === "random").slice(0, 6));
  chosen.push(...all.filter((p) => p.tier === "everything"));
  for (let i = 0; i < 5; i++) chosen.push({ id: `empty${i}`, tier: "curated", rules: [] });
  // New app people with heavy mixes: the conditions and allergies of random and
  // curated combinations — what a person can set in the app's first run.
  const appOnly = (k: RuleKey) => /^(allergy|condition):/.test(k);
  [...all.filter((p) => p.tier === "random").slice(6, 12), ...all.filter((p) => p.tier === "curated")]
    .map((p) => p.rules.filter(appOnly))
    .filter((rules) => rules.length >= 2)
    .slice(0, 12)
    .forEach((rules, i) => chosen.push({ id: `app${i}:${rules.join("+").replace(/[^a-z0-9+]+/gi, "_").slice(0, 70)}`, tier: "app mix" as Profile["tier"], rules }));
  // Old-app people: only the pre-existing endpoints, ever.
  const old: Profile[] = [{ id: "old0:Shellfish", tier: "real", rules: ["allergy:Shellfish", "goal:Eat healthier"] }, { id: "old1:empty", tier: "curated", rules: [] }, { id: "old2:Hypertension", tier: "single", rules: ["condition:Hypertension"] }];
  const out: Persona[] = [];
  const special = { thirteen: 0 };
  [...chosen.map((p) => ({ p, oldApp: false })), ...old.map((p) => ({ p, oldApp: true }))].forEach(({ p, oldApp }, idx) => {
    const seed = 20261112 + idx * 7919;
    const r = rng(seed);
    const rules = p.rules.filter(keep);
    const needsWeb = rules.some((k) => /^(avoid|diet|goal):/.test(k));
    const web = oldApp || needsWeb || ((p.tier as string) !== "app mix" && chance(r, 0.2));
    let tz = TZS[idx % TZS.length];
    const startDate = idx % 3 === 2 ? "2026-10-27" : "2026-10-22"; // both cross 1 Nov (month + US DST); the first also EU DST (25 Oct)
    const sex = chance(r, 0.55) ? "FEMALE" : "MALE";
    // Ages 13–85, with a 13th birthday on day 0 and a 50/51 iron boundary in the mix.
    // The 13th birthday falls on day 0 for the first new-app person (a website profile would predate it).
    // Two of them: one in Auckland (morning there is the previous evening in UTC), one in Los Angeles.
    const thirteen = !web && !oldApp && special.thirteen < 2 && idx >= 3 ? ++special.thirteen > 0 : false;
    const age = thirteen ? 13 : idx === 4 ? 51 : idx === 5 ? 50 : idx === 6 ? 85 : 13 + Math.floor(r() * 73);
    if (thirteen) tz = special.thirteen === 1 ? "Pacific/Auckland" : "America/Los_Angeles";
    const birthYear = Number(startDate.slice(0, 4)) - age;
    const birthday = thirteen ? `${birthYear}${startDate.slice(4)}` : `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
    const realAge = Number(startDate.slice(0, 4)) - Number(birthday.slice(0, 4)) - (startDate.slice(5) < birthday.slice(5) ? 1 : 0);
    const metric = chance(r, 0.5);
    const heightCm = round1(sex === "MALE" ? 160 + r() * 35 : 148 + r() * 32);
    const bmi = idx === 7 ? 44 : idx === 8 ? 17 : 19 + r() * 16;
    const kg = (bmi * (heightCm / 100) ** 2);
    const heightEntry: { cm?: number; ft?: number; inch?: number } = metric ? { cm: heightCm } : (() => { const inches = Math.round(heightCm / 2.54); return { ft: Math.floor(inches / 12), inch: inches % 12 }; })();
    const weightEntry = metric ? round1(kg) : Math.round(kg * LBS_PER_KG_APP);
    const goal = pick(r, ["lose", "keep", "gain", "none"] as const);
    const [eatingLabel, eatingFn] = idx < EATING_PATTERNS.length * 2 ? EATING_PATTERNS[idx % EATING_PATTERNS.length] : chance(r, 0.4) ? pick(r, EATING_PATTERNS) : ["random", () => Object.fromEntries(EATING_KEYS.filter(() => chance(r, 0.85)).map((k) => [k, Math.floor(r() * 3)])) as Partial<Eating>];
    const [pillsLabel, pills] = idx < PILL_SETS.length * 2 ? PILL_SETS[idx % PILL_SETS.length] : chance(r, 0.5) ? pick(r, PILL_SETS) : ["random", PILLS.filter(() => chance(r, 0.3))];
    const flows: Flow[] = ["straight", "interrupt1", "interrupt2", "interrupt3", "doublePut", "editLater"];
    const flow = flows[idx % flows.length];
    const mealsPattern = Array.from({ length: 10 }, (_, d) => (idx % 9 === 0 ? [0, 1, 0, 1, 0, 0, 1, 0, 0, 1][d] : idx % 11 === 0 ? [6, 0, 6, 1, 2, 0, 0, 2, 3, 2][d] : pick(r, [0, 1, 2, 2, 3, 3, 3, 4, 6])));
    out.push({
      id: p.id.slice(0, 80), idx, tier: oldApp ? "old app" : p.rules.length === 0 ? "empty" : p.tier, rules, clerkId: `clerk_sim_${idx}`, seed,
      web, oldApp, tz, startDate, sex, birthday, age: realAge, metric, heightCm: metric ? heightCm : round1(((heightEntry.ft! * 12) + heightEntry.inch!) * 2.54), heightEntry, weightEntry,
      displayUnit: metric ? (chance(r, 0.85) ? "kg" : "lbs") : chance(r, 0.15) ? "kg" : "lbs",
      activityLevel: 1 + Math.floor(r() * 4), goal, goalWeightLbs: web && goal !== "keep" && goal !== "none" ? Math.round(kg * LBS_PER_KG_APP * (goal === "lose" ? 0.9 : 1.08)) : null,
      eating: eatingFn(), eatingLabel, pills: [...pills], pillsLabel, websiteVitaminD: idx % 5 === 1, flow, mealsPattern,
    });
  });
  return out;
}

// ── per-person expected state (the simulation's own ledger) ─────────────────
type MealEntry = {
  key: string; id: string | null; localDate: string; mealType: string; name: string; source: string; estimated: boolean; live: boolean;
  servings: number; per: { cal: number | null; p: number | null; c: number | null; f: number | null; fib: number | null; sodium: number | null; satFat: number | null; addedSugar: number | null };
  recipeId?: string;
};
type SuppEntry = { id: string; name: string; contents: Content[] | null; estimated: boolean; live: boolean };
type Ledger = {
  conditions: string[]; allergies: string[]; avoids: string[]; diets: string[]; goals: string[]; noCondition: boolean;
  basicsSaved: boolean; heightStoredCm: number | null; heightUnit: string; weightLbs: number | null; displayUnit: string | null;
  usualEating: Eating | null; weightGoal: string | null; goalWeightLbs: number | null;
  supplements: SuppEntry[]; meals: MealEntry[]; tracked: Set<string> | null; goalsSaved: Map<string, number>;
  weighIns: Map<string, number>; journalNotes: Map<string, { mood: string; notes: string }>;
};

// ── the run ─────────────────────────────────────────────────────────────────
test("Clara-first: simulated people through first run, Numbers, Log, cooking, pills and Clara's dishes", { timeout: 60 * 60 * 1000 }, async () => {
  assert.equal(process.env.TZ, "UTC", "run with TZ=UTC (npm run sim:clara-first): the server runs in UTC on Vercel");
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  const onboarding = await import("@/app/api/onboarding/route");
  const profile = await import("@/app/api/patient/profile/route");
  const numbers = await import("@/app/api/numbers/route");
  const tracked = await import("@/app/api/numbers/tracked/route");
  const goals = await import("@/app/api/numbers/goals/route");
  const weight = await import("@/app/api/numbers/weight/route");
  const log = await import("@/app/api/log/route");
  const mealLog = await import("@/app/api/meal-log/route");
  const mealLogId = await import("@/app/api/meal-log/[id]/route");
  const cook = await import("@/app/api/clara/conversations/[id]/cook/route");
  const supplements = await import("@/app/api/supplements/route");
  const supplementId = await import("@/app/api/supplements/[id]/route");
  const journal = await import("@/app/api/journal/route");
  const me = await import("@/app/api/me/route");
  const { makeConversationStore } = await import("@/lib/clara/conversations");
  const { dishSkill, dishTiming } = await import("@/lib/clara/skills/dish");
  // The live budget is seconds; the fake model answers at once or hangs until
  // aborted, so a short budget keeps the hang cases from slowing the run.
  dishTiming.budgetMs = 150;
  const { defaultTracked } = await import("@/lib/level-catalogue");
  const { computeAllMetrics, computeWeeklyTarget, resolveDailyTargets } = await import("@/lib/caloric-engine");
  const { buildDietMatchers, derivePatientBans } = await import("@/lib/diet-match");
  const conversations = makeConversationStore();
  const suggestTool = dishSkill.tools.find((t) => t.def.name === "dish_suggest")!.handler;
  const planTool = dishSkill.tools.find((t) => t.def.name === "dish_plan_today")!.handler;

  const personas = buildPersonas();
  const dishStats = { modes: {} as Record<string, number>, servedGenerated: 0, servedLibrary: 0, libraryHadOne: 0, honestBothEmpty: 0, calls: 0, offered: 0, offeredViolating: 0, served: 0, couldntFit: 0, servedViolations: 0, repairsOffered: 0, slipsInSteps: 0, picturePath: 0, logsPath: 0, guests: 0, plans: 0 };
  const perPerson: { id: string; tier: string; flow: string; tz: string; requests: number; meals: number; findings: number }[] = [];
  const observations: string[] = [];
  const fibreStats = { responses: 0, little: 0, wordChanged: 0 };
  // Someone else's rows, for the ownership checks of the next person.
  let prevOwn: { conversationId?: string; supplementId?: string; mealLogId?: string } = {};
  const libraryByMeal = new Map<string, typeof snap.recipes>();
  const mealName = new Map(snap.mealTypes.map((m) => [m.id, m.name]));
  for (const r of snap.recipes) { const m = mealName.get(r.mealTypeId ?? "") ?? "Dinner"; libraryByMeal.set(m, [...(libraryByMeal.get(m) ?? []), r]); }

  for (const P of personas) {
    current = { person: P.id, step: "setup" };
    const r = rng(P.seed + 1);
    const reqStart = counts.requests, failStart = failures.length;
    store.seedAccount(P.clerkId, `${P.clerkId}@sim.invalid`);
    state.patient = { account: { clerkId: P.clerkId } }; // sim/setup.ts's Clerk mock answers with this clerkId
    const L: Ledger = {
      conditions: [], allergies: [], avoids: [], diets: [], goals: [], noCondition: false, basicsSaved: false, heightStoredCm: null, heightUnit: "ftin",
      weightLbs: null, displayUnit: null, usualEating: null, weightGoal: null, goalWeightLbs: null, supplements: [], meals: [], tracked: null,
      goalsSaved: new Map(), weighIns: new Map(), journalNotes: new Map(),
    };
    const ruleNames = (kind: string) => P.rules.filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
    const intended = { conditions: ruleNames("condition"), allergies: ruleNames("allergy"), avoids: ruleNames("avoid"), diets: ruleNames("diet"), goals: ruleNames("goal") };
    const idsOf = (kind: "healthCondition" | "foodAllergy" | "foodToAvoid" | "foodPreference" | "motivation", names: string[]) => names.map((n) => store.ref(kind, n).id);
    // The oracle is built from what the person MEANS to have right now (their
    // own choices as the ledger records them), never from the store.
    let oracle!: ReturnType<typeof makeOracle>;
    let allergyMatchers: RegExp[] = [];
    let bannedForMe: typeof snap.ingredients = [];
    let oracleKey = "";
    const currentRules = (): RuleKey[] => [
      ...L.allergies.map((n) => `allergy:${n}` as RuleKey), ...L.avoids.map((n) => `avoid:${n}` as RuleKey), ...L.conditions.map((n) => `condition:${n}` as RuleKey),
      ...L.diets.map((n) => `diet:${n}` as RuleKey), ...L.goals.map((n) => `goal:${n}` as RuleKey),
    ];
    const refreshOracle = () => {
      const rules = currentRules();
      const k = JSON.stringify(rules);
      if (k === oracleKey) return;
      oracleKey = k;
      const patientGraph = makePatient(snap, { id: P.id, tier: "curated", rules });
      oracle = makeOracle(patientGraph as any, rules);
      allergyMatchers = buildDietMatchers(derivePatientBans(patientGraph as any)).allergyMatchers;
      bannedForMe = snap.ingredients.filter((ing) => { const v = oracle.judge(ing.name, ing.allergenGroups); return v.engine.length > 0 || v.groups.length > 0; });
    };

    // Each journey runs on its own simulated calendar, from before its first day.
    simNow = SIM_START;
    mock.timers.setTime(SIM_START);
    let day = P.startDate;
    cover(`time zone ${P.tz}`);
    cover(`flow ${P.web ? "website first" : P.flow}`);
    cover(`eating: ${P.eatingLabel}`);
    cover(`pills: ${P.pillsLabel}`);
    const at = (d: string, h: number, m = 0) => { day = d; setClock(zoned(d, h, m, P.tz)); };
    const today = () => localDate(simNow, P.tz);

    // ── helpers bound to this person ───────────────────────────────────────
    const getOnboarding = async () => {
      const res = await call("GET /api/onboarding", () => onboarding.GET() as any);
      check("onboarding.get-200", res.status === 200, () => `status ${res.status}`);
      if (res.status === 200) shape("GET /api/onboarding", res.json, SH.onboarding);
      return res.json;
    };
    const patch = async (body: Record<string, unknown>, label = "PATCH /api/patient/profile") => {
      // The app sends its local date (finding 8 fix: the age check uses it); the website does not.
      const res = await call(label, profile.PATCH as any, { method: "PATCH", body, path: "/api/patient/profile", ...(label.includes("(web)") ? {} : { query: { today: today() } }) });
      if (res.status === 200) shape("PATCH /api/patient/profile", res.json, SH.profilePatch);
      return res;
    };
    const put = async (body: Record<string, unknown>) => {
      const res = await call("PUT /api/onboarding", onboarding.PUT as any, { method: "PUT", body });
      check("onboarding.put-200", res.status === 200, () => `PUT ${JSON.stringify(body)} → ${res.status} ${JSON.stringify(res.json)}`);
      if (res.status === 200) shape("PUT /api/onboarding", res.json, SH.onboarding);
      return res;
    };
    const liveSupps = () => L.supplements.filter((s) => s.live);
    const applyPills = (pills: Pill[]) => {
      // The documented reconcile: the list is authoritative for the seven catalogue names.
      const fold = (s: string) => s.trim().toLowerCase();
      const want = new Set(pills.map(fold));
      const isCat = (n: string) => PILLS.some((p) => fold(p) === fold(n));
      for (const s of liveSupps()) {
        if (isCat(s.name) && !want.has(fold(s.name))) s.live = false;
        else if (isCat(s.name) && want.has(fold(s.name)) && s.contents == null) { s.contents = TYPICAL[PILLS.find((p) => fold(p) === fold(s.name))!]; s.estimated = true; }
      }
      for (const p of pills) if (!liveSupps().some((s) => fold(s.name) === fold(p))) L.supplements.push({ id: "?", name: p, contents: TYPICAL[p], estimated: true, live: true });
    };
    const expectStoredRules = (why: string) => {
      const pid = store.tables.patient.find((x) => x.accountId === store.tables.account.find((a) => a.clerkId === P.clerkId)?.id)?.id;
      if (!pid) return;
      const names = (table: string, refTable: string, key: string) =>
        store.tables[table].filter((x) => x.patientId === pid).map((x) => store.tables[refTable].find((c) => c.id === x[key])?.name).sort();
      check("safety.allergies-kept", JSON.stringify(names("patientFoodAllergy", "foodAllergy", "foodId")) === JSON.stringify([...L.allergies].sort()),
        () => `${why}: stored allergies ${JSON.stringify(names("patientFoodAllergy", "foodAllergy", "foodId"))}, meant ${JSON.stringify(L.allergies)}`);
      check("state.conditions-kept", JSON.stringify(names("patientHealthCondition", "healthCondition", "conditionId")) === JSON.stringify([...L.conditions].sort()),
        () => `${why}: stored conditions ${JSON.stringify(names("patientHealthCondition", "healthCondition", "conditionId"))}, meant ${JSON.stringify(L.conditions)}`);
      for (const [t, rt, k, list] of [["patientFoodToAvoid", "foodToAvoid", "foodId", L.avoids], ["patientFoodPreference", "foodPreference", "foodId", L.diets], ["patientMotivation", "motivation", "motivationId", L.goals]] as const)
        check("safety.web-rules-kept", JSON.stringify(names(t, rt, k)) === JSON.stringify([...list].sort()), () => `${why}: stored ${t} ${JSON.stringify(names(t, rt, k))}, meant ${JSON.stringify(list)}`);
    };

    // The app's four steps, as FirstRunViewModel sends them.
    const appStep = {
      condition: async (conditionIds: string[], none: boolean) => {
        current.step = "first run · step 1";
        const res = await patch({ healthConditionIds: [...conditionIds].sort() });
        check("onboarding.step1-patch-200", res.status === 200, () => `→ ${res.status} ${JSON.stringify(res.json)}`);
        if (res.status !== 200) return false;
        const put1 = await put({ noCondition: none });
        if (put1.status !== 200) return false;
        L.conditions = conditionIds.map((id) => store.tables.healthCondition.find((c) => c.id === id)!.name);
        L.noCondition = none;
        return true;
      },
      eating: async (answers: Partial<Eating>, pills: Pill[]) => {
        current.step = "first run · step 2";
        const res = await put({ usualEating: answers, pills: [...pills].sort() });
        if (res.status !== 200) return false;
        if (Object.keys(answers).length > 0) L.usualEating = { ...(L.usualEating ?? emptyEating()), ...answers } as Eating;
        applyPills(pills);
        return true;
      },
      basics: async (allergyNames: string[]) => {
        current.step = "first run · step 3";
        const lbs = P.metric ? round1(P.weightEntry * LBS_PER_KG_APP) : round1(P.weightEntry);
        const body = {
          birthday: P.birthday, sexAtBirth: P.sex, height: round1(P.heightCm), heightUnit: "cm", weight: lbs,
          displayWeightUnit: P.displayUnit, physicalActivityId: snap.physicalActivities.find((a) => a.level === P.activityLevel)!.id,
          foodAllergyIds: idsOf("foodAllergy", allergyNames).sort(),
        };
        const res = await patch(body);
        if (res.status !== 200) return res;
        L.basicsSaved = true; L.heightStoredCm = round1(P.heightCm); L.heightUnit = "cm"; L.weightLbs = lbs; L.displayUnit = P.displayUnit; L.allergies = [...allergyNames];
        return res;
      },
      goal: async (goal: string) => {
        current.step = "first run · step 4";
        const res = await put({ weightGoal: goal });
        if (res.status === 200) L.weightGoal = goal;
        return res.status === 200;
      },
    };

    // ── expectations on GET /api/onboarding ──────────────────────────────────
    const checkOnboarding = (o: any, why: string) => {
      if (!o) return;
      check("onboarding.allergies-shown", JSON.stringify([...o.profile.allergyIds].sort()) === JSON.stringify(idsOf("foodAllergy", L.allergies).sort()),
        () => `${why}: allergyIds ${JSON.stringify(o.profile.allergyIds)} vs meant ${JSON.stringify(L.allergies)}`);
      check("onboarding.conditions-shown", JSON.stringify([...o.profile.conditionIds].sort()) === JSON.stringify(idsOf("healthCondition", L.conditions).sort()),
        () => `${why}: conditionIds ${JSON.stringify(o.profile.conditionIds)} vs ${JSON.stringify(L.conditions)}`);
      check("onboarding.noCondition", o.profile.noCondition === (L.noCondition && L.conditions.length === 0), () => `${why}: noCondition ${o.profile.noCondition}, ledger ${L.noCondition}/${L.conditions.length}`);
      const pillsNow = new Set(liveSupps().map((s) => PILLS.find((p) => p.toLowerCase() === s.name.trim().toLowerCase())).filter(Boolean) as string[]);
      check("onboarding.pills", JSON.stringify([...o.pills].sort()) === JSON.stringify([...pillsNow].sort()), () => `${why}: pills ${JSON.stringify(o.pills)} vs ${JSON.stringify([...pillsNow])}`);
      const exp = L.usualEating ? expectedPicture(L.usualEating, pillsNow) : { little: [], aLot: [] };
      check("onboarding.picture", JSON.stringify(o.startingPicture.little.map((x: any) => x.key)) === JSON.stringify(exp.little) && JSON.stringify(o.startingPicture.aLot.map((x: any) => x.key)) === JSON.stringify(exp.aLot),
        () => `${why}: picture ${JSON.stringify(o.startingPicture)} vs expected ${JSON.stringify(exp)} (answers ${JSON.stringify(L.usualEating)})`);
      for (const it of [...o.startingPicture.little, ...o.startingPicture.aLot]) check("onboarding.picture-names", LV.get(it.key)?.name === it.name, () => `${it.key} named ${it.name}`);
      check("onboarding.eating", JSON.stringify(o.usualEating) === JSON.stringify(L.usualEating ?? emptyEating()), () => `${why}: usualEating ${JSON.stringify(o.usualEating)} vs ${JSON.stringify(L.usualEating)}`);
      check("onboarding.weightGoal", o.weightGoal === L.weightGoal, () => `${why}: weightGoal ${o.weightGoal} vs ${L.weightGoal}`);
      if (L.basicsSaved) {
        const unit = L.displayUnit === "kg" || L.displayUnit === "lbs" ? L.displayUnit : L.heightUnit === "cm" ? "kg" : "lbs";
        check("onboarding.units", o.profile.weightUnit === unit && o.profile.heightUnit === L.heightUnit, () => `${why}: units ${o.profile.weightUnit}/${o.profile.heightUnit} vs ${unit}/${L.heightUnit}`);
        check("units.height-roundtrip", Math.abs(o.profile.heightCm - L.heightStoredCm!) <= 0.05, () => `${why}: heightCm ${o.profile.heightCm} vs stored ${L.heightStoredCm}`);
        check("units.weight-roundtrip", Math.abs(o.profile.weightKg - L.weightLbs! * 0.45359237) <= 0.051, () => `${why}: weightKg ${o.profile.weightKg} vs ${L.weightLbs} lbs`);
        check("onboarding.birthday", o.profile.birthday === P.birthday, () => `${why}: birthday ${o.profile.birthday} vs ${P.birthday}`);
      }
      check("onboarding.nothing-preselected", !(!L.basicsSaved && !P.web) || (o.profile.sexAtBirth === null && o.profile.activityId === null && o.weightGoal === L.weightGoal),
        () => `${why}: a new person sees preselected basics ${JSON.stringify(o.profile)}`);
    };

    // ── the website first, for people whose rules only the website sets ─────
    if (P.web) {
      at(addDays(P.startDate, -5), 20);
      current.step = "website profile";
      const body: Record<string, unknown> = {
        firstName: "Sim", lastName: `Person ${P.idx}`, birthday: P.birthday, sexAtBirth: P.sex,
        ...(P.metric ? { height: round1(P.heightCm), heightUnit: "cm" } : { height: round1(P.heightCm / 2.54), heightUnit: "in" }),
        weight: P.metric ? round1(P.weightEntry * LBS_PER_KG_APP) : P.weightEntry,
        physicalActivityId: snap.physicalActivities.find((a) => a.level === P.activityLevel)!.id,
        ...(P.goalWeightLbs ? { goalWeight: P.goalWeightLbs } : {}),
        motivationIds: idsOf("motivation", intended.goals), healthConditionIds: idsOf("healthCondition", intended.conditions),
        foodPreferenceIds: idsOf("foodPreference", intended.diets), foodToAvoidIds: idsOf("foodToAvoid", intended.avoids),
        foodAllergyIds: idsOf("foodAllergy", intended.allergies), agreedTerms: true,
      };
      const res = await patch(body, "PATCH /api/patient/profile (web)");
      check("web.profile-200", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
      Object.assign(L, { conditions: intended.conditions, allergies: intended.allergies, avoids: intended.avoids, diets: intended.diets, goals: intended.goals, basicsSaved: true,
        heightStoredCm: round1(P.heightCm), heightUnit: P.metric ? "cm" : "in", weightLbs: body.weight as number, goalWeightLbs: P.goalWeightLbs });
      if (!P.metric) L.heightStoredCm = round1(round1(P.heightCm / 2.54) * 2.54);
      expectStoredRules("after website profile");
      if (P.websiteVitaminD) {
        const s = await call("POST /api/supplements", supplements.POST as any, { method: "POST", body: { name: "vitamin d", dosage: "1000 IU", timeSlot: "MORNING" } });
        check("supplements.post-201", s.status === 201, () => `${s.status}`);
        if (s.status === 201) { shape("POST /api/supplements", s.json, { obj: { supplement: SUPP(true) } }); L.supplements.push({ id: s.json.supplement.id, name: "vitamin d", contents: null, estimated: false, live: true }); }
      }
      // A day's mood and notes, logged on the website — a weigh-in later must keep them.
      const jd = addDays(P.startDate, 3);
      const j = await call("POST /api/journal", journal.POST as any, { method: "POST", body: { date: jd, mood: "good", notes: `sim note ${P.idx}` } });
      check("journal.post-200", j.status === 200, () => `${j.status} ${JSON.stringify(j.json)}`);
      L.journalNotes.set(jd, { mood: "good", notes: `sim note ${P.idx}` });
    }

    // ── old app: only the endpoints that existed before ─────────────────────
    if (P.oldApp) {
      await oldAppJourney();
      perPerson.push({ id: P.id, tier: P.tier, flow: "old app", tz: P.tz, requests: counts.requests - reqStart, meals: L.meals.length, findings: failures.length - failStart });
      continue;
    }

    // ── Day 0: first run ─────────────────────────────────────────────────────
    at(P.startDate, 8, 5);
    current.step = "day 0 · open app";
    {
      const m = await call("GET /api/me", me.GET as any);
      check("me.200", m.status === 200, () => `${m.status}`);
      if (!P.web) check("me.firstRun-for-new", m.json?.onboardingComplete === false, () => `new person: onboardingComplete ${m.json?.onboardingComplete}`);
    }
    let o = await getOnboarding();
    checkOnboarding(o, "first GET");
    if (P.web) {
      // RootGate: complete basics from the website → straight to the tabs, no first run.
      check("onboarding.web-complete", o?.complete === true, () => `website person: complete ${o?.complete}`);
    } else {
    const conditionIds = idsOf("healthCondition", intended.conditions);
    const none = conditionIds.length === 0;
    const reps = P.flow === "doublePut" ? 2 : 1;
    let interruptedAt = 0;
    for (let rep = 0; rep < reps; rep++) await appStep.condition(conditionIds, none);
    checkOnboarding(await getOnboarding(), "after step 1");
    if (P.flow === "interrupt1") {
      interruptedAt = 1;
      at(P.startDate, 13);
      o = await getOnboarding();
      checkOnboarding(o, "resumed after step 1");
      check("onboarding.resume-step", !(o.profile.conditionIds.length === 0 && !o.profile.noCondition), () => `resume would land on step 1 again: ${JSON.stringify(o.profile)}`);
    }
    {
      current.step = "first run · step 2";
      const first = await put({ usualEating: P.eating, pills: [...P.pills].sort() });
      if (P.flow === "doublePut") {
        const again = await put({ usualEating: P.eating, pills: [...P.pills].sort() });
        check("onboarding.put-idempotent", JSON.stringify(first.json) === JSON.stringify(again.json), () => `the same PUT twice answered differently`);
      }
      if (Object.keys(P.eating).length > 0) L.usualEating = { ...(L.usualEating ?? emptyEating()), ...P.eating } as Eating;
      applyPills(P.pills);
    }
    o = await getOnboarding();
    checkOnboarding(o, "after step 2");
    if (P.flow === "doublePut") {
      const catalogueRows = store.tables.supplement.filter((s) => s.deletedAt === null && store.tables.patient.find((p) => p.id === s.patientId)?.accountId === store.tables.account.find((a) => a.clerkId === P.clerkId)?.id);
      const names = catalogueRows.map((s) => s.name.toLowerCase());
      check("onboarding.double-put-no-duplicate-pills", new Set(names).size === names.length, () => `duplicate pills after a double PUT: ${JSON.stringify(names)}`);
    }
    if (P.flow === "interrupt2") {
      interruptedAt = 2;
      at(P.startDate, 18);
      o = await getOnboarding();
      checkOnboarding(o, "resumed after step 2");
      const m = await call("GET /api/me", me.GET as any);
      check("me.still-first-run-after-step2", m.json?.onboardingComplete === false || P.web, () => `after step 2: onboardingComplete ${m.json?.onboardingComplete}`);
    }
    // Step 3: the allergies the person has (None when none).
    let b = await appStep.basics(intended.allergies);
    if (b.status === 422 && P.age === 13) {
      // A person whose 13th birthday is today: the app lets them continue (calendar age 13).
      cover("13th birthday on day 0: refused");
      check("onboarding.age13-accepted", false, () => `13th birthday today (${P.birthday}): PATCH → 422 ${JSON.stringify(b.json)}`);
      at(addDays(P.startDate, 1), 8);
      b = await appStep.basics(intended.allergies);
    }
    if (P.age === 13 && b.status === 200) cover("13th birthday on day 0: accepted");
    check("onboarding.step3-200", b.status === 200, () => `step 3 → ${b.status} ${JSON.stringify(b.json)}`);
    if (P.flow === "doublePut") await appStep.basics(intended.allergies);
    expectStoredRules("after step 3");
    o = await getOnboarding();
    checkOnboarding(o, "after step 3");
    check("onboarding.complete-after-basics", o.complete === true, () => `complete ${o.complete} after basics`);
    if (P.flow === "interrupt3") {
      // The app closes before step 4. Next launch: RootGate reads me.onboardingComplete.
      interruptedAt = 3;
      at(addDays(P.startDate, 0), 21);
      const m = await call("GET /api/me", me.GET as any);
      check("onboarding.resume-step4", m.json?.onboardingComplete === false, () => `interrupted before step 4 ("Is weight part of this?"): me.onboardingComplete is ${m.json?.onboardingComplete}, so the app opens the tabs and the weight question is never asked; weightGoal stays ${L.weightGoal}`);
    } else {
      for (let rep = 0; rep < reps; rep++) await appStep.goal(P.goal);
    }
    o = await getOnboarding();
    checkOnboarding(o, "after first run");
    expectStoredRules("after first run");
    void interruptedAt;
    }
    {
      const m = await call("GET /api/me", me.GET as any);
      const oo = await getOnboarding();
      check("me.agrees-with-onboarding", m.json?.onboardingComplete === oo?.complete, () => `me.onboardingComplete ${m.json?.onboardingComplete} vs onboarding.complete ${oo?.complete}`);
    }

    {
      const acc = store.tables.account.find((a) => a.clerkId === P.clerkId);
      const hasPatient = store.tables.patient.some((x) => x.accountId === acc?.id);
      check("journey.patient-exists", hasPatient, () => `no profile after the first run (${P.flow}, age ${P.age}, birthday ${P.birthday})`);
      if (!hasPatient) { perPerson.push({ id: P.id, tier: P.tier, flow: P.flow, tz: P.tz, requests: counts.requests - reqStart, meals: 0, findings: failures.length - failStart }); continue; }
    }
    // ── Day 0: Numbers is the starting picture or the honest empty state ────
    current.step = "day 0 · Numbers";
    const engineTargets = () => {
      if (L.weightLbs == null || L.heightStoredCm == null) return null;
      const heightIn = L.heightUnit === "in";
      const profileM = computeAllMetrics({
        sex: P.sex === "MALE" ? "male" : "female", birthday: new Date(P.birthday), heightValue: heightIn ? round1(P.heightCm / 2.54) : L.heightStoredCm, heightUnit: heightIn ? "in" : "cm",
        cbwValue: L.weightLbs, cbwUnit: "lbs", activityLevel: P.activityLevel, utbwValue: L.goalWeightLbs, utbwUnit: L.goalWeightLbs == null ? null : "lbs",
      } as any);
      const weekly = computeWeeklyTarget({ profile: profileM, anchorStartKg: null, planStartDate: null });
      return resolveDailyTargets({ tdeeCBW: profileM.tdeeCBW, weeklyTarget: weekly } as any, L.conditions, L.goals, null);
    };
    const pillsNowSet = () => new Set(liveSupps().map((s) => PILLS.find((p) => p.toLowerCase() === s.name.trim().toLowerCase())).filter(Boolean) as string[]);

    let lastDefault: string | null = null;
    const getDefault = async () => {
      const res = await call("GET /api/numbers", numbers.GET as any, { path: "/api/numbers", query: { days: "7", today: today() } });
      check("numbers.default-200", res.status === 200, () => `${res.status}`);
      if (res.status === 200) shape("GET /api/numbers (old)", res.json, SH.numbersOld);
      return res;
    };
    const getFull = async (why: string) => {
      const res = await call("GET /api/numbers?full=1", numbers.GET as any, { path: "/api/numbers", query: { full: "1", days: "7", today: today() } });
      check("numbers.full-200", res.status === 200, () => `${res.status}`);
      if (res.status !== 200) return null;
      shape("GET /api/numbers?full=1", res.json, SH.full);
      checkFull(res.json, why);
      return res.json;
    };

    // The independent recomputation of the week.
    const checkFull = (n: any, why: string) => {
      const t = today();
      const from = addDays(t, -6);
      if (t !== new Date(simNow).toISOString().slice(0, 10)) cover(`local date ${t > new Date(simNow).toISOString().slice(0, 10) ? "ahead of" : "behind"} the server date`);
      check("numbers.window", n.summary.fromDate === from && n.summary.toDate === t, () => `${why}: window ${n.summary.fromDate}..${n.summary.toDate}, expected ${from}..${t}`);
      const live = L.meals.filter((m) => m.live && m.localDate >= from && m.localDate <= t);
      const byDay = new Map<string, MealEntry[]>();
      for (const m of live) byDay.set(m.localDate, [...(byDay.get(m.localDate) ?? []), m]);
      const days = [...byDay.values()];
      const enough = days.filter((d) => d.length >= 2).length >= 3;
      const ledgerVsStore = () => {
        const pid = ctx().patientId;
        const stored = store.tables.mealLog.filter((m) => m.patientId === pid && m.deletedAt === null && m.localDate >= from && m.localDate <= t);
        const extra = stored.filter((m) => !live.some((x) => x.id === m.id)).map((m) => `${m.localDate} ${m.source} ${m.name} (${m.clientRequestId})`);
        const missing = live.filter((x) => !stored.some((m) => m.id === x.id)).map((x) => `${x.localDate} ${x.source} ${x.name}`);
        return `store has ${stored.length}, ledger ${live.length}; only in store: ${extra.join("; ")}; only in ledger: ${missing.join("; ")}`;
      };
      check("arith.daysCounted", n.summary.daysCounted === days.length, () => `${why}: daysCounted ${n.summary.daysCounted}, expected ${days.length} — ${ledgerVsStore()}`);
      check("arith.enoughLogs", n.summary.enoughLogs === enough, () => `${why}: enoughLogs ${n.summary.enoughLogs}, expected ${enough} (${days.map((d) => d.length).join(",")})`);
      const sum = (d: MealEntry[], f: (m: MealEntry) => number | null) => d.reduce((a, m) => a + (f(m) ?? 0) * m.servings, 0);
      const avg = (f: (m: MealEntry) => number | null) => (days.length ? days.reduce((a, d) => a + sum(d, f), 0) / days.length : null);
      const level = (k: string) => n.levels.find((l: any) => l.key === k);
      const near = (a: number | null, b: number | null, tol = 0.051) => (a === null || b === null ? a === b : Math.abs(a - b) <= tol + Math.abs(b) * 1e-9);
      const tg = engineTargets();
      check("arith.calories-target", near(n.calories.target, tg?.calories ?? null, 0.5), () => `${why}: calories target ${n.calories.target}, engine ${tg?.calories}`);
      const cal = avg((m) => m.per.cal);
      check("arith.calories", near(n.calories.amount, cal === null ? null : Math.round(cal), 0.5), () => `${why}: calories ${n.calories.amount}, expected ${cal}`);
      const pills = liveSupps();
      const kidney = L.conditions.some((c) => c.toLowerCase().includes("kidney"));
      check("state.phosphorus", Boolean(level("phosphorus")) === kidney, () => `${why}: phosphorus shown ${Boolean(level("phosphorus"))}, kidney ${kidney}`);
      check("contract.level-count", n.levels.length === (kidney ? 22 : 21), () => `${why}: ${n.levels.length} levels`);
      const storedRows = L.tracked;
      const trackedExpected = storedRows ?? new Set(defaultTracked(L.conditions));
      if (!storedRows && L.conditions.length === 0) check("state.default-six", JSON.stringify([...trackedExpected]) === JSON.stringify(["protein", "fibre", "addedSugar", "sodium", "iron", "vitaminD"]), () => `${[...trackedExpected]}`);
      if (!storedRows && kidney) check("state.kidney-defaults", ["sodium", "potassium", "phosphorus", "protein"].every((k) => trackedExpected.has(k)), () => `${[...trackedExpected]}`);
      for (const l of n.levels) {
        const def = LV.get(l.key)!;
        check("contract.catalogue", l.name === def.name && l.group === def.group && l.unit === def.unit && l.direction === def.direction && l.upperLimit === def.upper,
          () => `${l.key}: ${JSON.stringify(l)} vs plan ${JSON.stringify(def)}`);
        let target = def.target;
        if (l.key === "iron" && (P.sex === "MALE" || (P.sex === "FEMALE" && ageOnDate(P.birthday, t) > 50))) target = 8;
        if ((l.key === "protein" || l.key === "carbs") && tg) target = (tg as any)[l.key];
        check("arith.target", near(l.target, target, 0.001), () => `${why}: ${l.key} target ${l.target}, expected ${target}`);
        // Pills: every live pill, once a day, converted to the level's unit.
        let pillAmt = 0, est = false;
        for (const s of pills) for (const c of s.contents ?? []) if (c.key === l.key) { pillAmt += convert(c.amount, c.unit, def.unit); if (s.estimated) est = true; }
        check("arith.pills", near(l.pillAmount, pillAmt, pillAmt < 1 ? 0.006 : 0.051), () => `${why}: ${l.key} pillAmount ${l.pillAmount}, expected ${pillAmt} from ${JSON.stringify(pills.map((p) => [p.name, p.contents]))}`);
        if (l.key === "vitaminD") {
          const unpriced = pills.filter((s) => s.contents == null && PILLS.some((p) => p.toLowerCase() === s.name.trim().toLowerCase()));
          check("pills.catalogue-pill-counts", unpriced.length === 0, () => `${why}: "${unpriced.map((s) => s.name).join(", ")}" is a pill the person takes (shown ticked in the app) but adds nothing on Numbers: it has no contents until re-ticked in the first run`);
        }
        check("honesty.estimate", l.estimate === est, () => `${why}: ${l.key} estimate ${l.estimate}, expected ${est}`);
        // Food: protein, carbs, fibre from every counted day; sodium, saturated fat, added sugar only when every meal carries them.
        const pick: Record<string, (m: MealEntry) => number | null> = { protein: (m) => m.per.p, carbs: (m) => m.per.c, fibre: (m) => m.per.fib, sodium: (m) => m.per.sodium, saturatedFat: (m) => m.per.satFat, addedSugar: (m) => m.per.addedSugar };
        let foodCounted = false, foodAvg: number | null = null;
        if (pick[l.key] && days.length > 0) {
          // Fibre follows the sodium rule (finding 1, fixed): counted only when every meal carries it.
          if (["protein", "carbs"].includes(l.key)) { foodCounted = true; foodAvg = avg(pick[l.key]); }
          else if (days.every((d) => d.every((m) => pick[l.key](m) !== null))) { foodCounted = true; foodAvg = avg(pick[l.key]); }
        }
        check("arith.foodCounted", l.foodCounted === foodCounted, () => `${why}: ${l.key} foodCounted ${l.foodCounted}, expected ${foodCounted}`);
        const amount = foodCounted ? (foodAvg ?? 0) + pillAmt : pillAmt > 0 ? pillAmt : null;
        check("arith.amount", near(l.amount, amount, amount !== null && Math.abs(amount) < 1 ? 0.006 : 0.051), () => `${why}: ${l.key} amount ${l.amount}, expected ${amount}`);
        check("honesty.amount-sane", l.amount === null || (Number.isFinite(l.amount) && l.amount >= 0), () => `${l.key} amount ${l.amount}`);
        if (l.amount !== null && l.amount > 20 * l.target) {
          // Explained when every bit over 20× is a pill the person takes (B12 typical dose is 104× target).
          const explained = Math.abs(l.amount - pillAmt) <= 20 * l.target;
          check("honesty.absurd-amount", explained, () => `${why}: ${l.key} ${l.amount} ${l.unit} is ${Math.round(l.amount / l.target)}× target`);
          if (explained) observations.push(`${l.key}:${Math.round(l.amount / l.target)}x`);
        }
        // From the unrounded average, as the server judges it (19.58 g is "little" though it shows as 19.6).
        // A whole-day need is judged against the part of the day that was logged (lib/numbers-full.ts `prorated`):
        // the server then sends wordTarget = target × the logged share. This check predates that and compared
        // against the whole target, so a lunch-only week read "little" here and "on track" in the app.
        const judged: number = l.wordTarget ?? l.target;
        const word = foodCounted && enough && amount !== null ? expectedWord(def.direction, amount, judged, def.upper) : null;
        // wordTarget is rounded on the wire, so an amount sitting on a boundary may fall either side.
        const onEdge = amount !== null && judged > 0 && [0.7, 1, 1.3].some((b) => Math.abs(amount / judged - b) < 0.01);
        check("honesty.word", l.word === word || (onEdge && l.word !== null), () => `${why}: ${l.key} word ${l.word}, expected ${word} (foodCounted ${foodCounted}, enough ${enough}, amount ${l.amount}/${judged}${l.wordTarget !== undefined ? ` of ${l.target}` : ""})`);
        if (l.wordTarget !== undefined) check("honesty.word-target", near(l.wordTarget, l.target * n.macros.loggedShare, l.target * 0.006 + 0.06), () => `${why}: ${l.key} wordTarget ${l.wordTarget}, expected ${l.target} × ${n.macros.loggedShare}`);
        if (!foodCounted || !enough) check("honesty.word-null", l.word === null, () => `${l.key} word ${l.word} while not counted/enough`);
        // Fibre honesty: a fibre figure that is partly unknown is not a fibre figure.
        if (l.key === "fibre" && foodCounted && live.some((m) => m.per.fib === null)) {
          // How much the unknowns change what the person is told: the word from the meals whose fibre is known.
          const knownDays = days.map((d) => d.filter((m) => m.per.fib !== null)).filter((d) => d.length > 0);
          const knownAvg = knownDays.length ? knownDays.reduce((a, d) => a + sum(d, (m) => m.per.fib), 0) / knownDays.length : null;
          const honestWord = enough && knownAvg !== null ? expectedWord("enough", knownAvg, l.target, null) : null;
          fibreStats.responses++;
          if (l.word === "little") fibreStats.little++;
          if (l.word !== honestWord) fibreStats.wordChanged++;
        }
        if (l.key === "fibre" && foodCounted) check("honesty.fibre-unknown-as-zero", live.every((m) => m.per.fib !== null),
          () => `${why}: fibre counted as known (amount ${l.amount} g, word ${l.word}) though ${live.filter((m) => m.per.fib === null).length} of ${live.length} logged meals have no fibre figure (${live.filter((m) => m.per.fib === null).slice(0, 2).map((m) => m.name).join(", ")})`);
        if ((l.key === "protein" || l.key === "carbs") && foodCounted) check("honesty.macro-unknown-as-zero", live.every((m) => (l.key === "protein" ? m.per.p : m.per.c) !== null),
          () => `${why}: ${l.key} counted though some meals have no ${l.key} figure`);
        check("state.tracked", l.tracked === trackedExpected.has(l.key), () => `${why}: ${l.key} tracked ${l.tracked}, expected ${trackedExpected.has(l.key)}`);
        check("state.goal", l.goal === (L.goalsSaved.get(l.key) ?? null), () => `${why}: ${l.key} goal ${l.goal}, expected ${L.goalsSaved.get(l.key) ?? null}`);
      }
      // Source and the starting picture.
      const pic = L.usualEating ? expectedPicture(L.usualEating, pillsNowSet()) : null;
      const hasPic = !!pic && (pic.little.length > 0 || pic.aLot.length > 0);
      const source = enough ? "logged" : hasPic ? "answers" : "none";
      cover(`numbers source ${n.source}`);
      cover(`window days with ≥2 meals: ${days.filter((d) => d.length >= 2).length} (${why.startsWith("day ") ? "end of day" : "other"})`);
      for (const l of n.levels) if (l.word) cover(`word "${l.word}" (${l.key})`);
      if (n.weight) cover(`weight row in ${n.weight.unit}`);
      if (n.levels.some((l: any) => l.key === "phosphorus")) cover("phosphorus shown (kidney)");
      if (n.levels.every((l: any) => !l.tracked)) cover("nothing tracked");
      if (n.levels.some((l: any) => l.goal !== null)) cover("a goal shown");
      if (n.levels.some((l: any) => l.estimate)) cover("estimated pill counted");
      check("honesty.source", n.source === source, () => `${why}: source ${n.source}, expected ${source}`);
      if (source === "answers") check("honesty.picture", JSON.stringify(n.startingPicture?.little.map((x: any) => x.key)) === JSON.stringify(pic!.little) && JSON.stringify(n.startingPicture?.aLot.map((x: any) => x.key)) === JSON.stringify(pic!.aLot),
        () => `${why}: picture ${JSON.stringify(n.startingPicture)} vs ${JSON.stringify(pic)}`);
      else check("honesty.picture-null", n.startingPicture === null, () => `${why}: picture shown with source ${n.source}`);
      // Weight row.
      const showWeight = L.weightGoal === "lose" || L.weightGoal === "gain" || L.goalWeightLbs != null;
      const unit = L.displayUnit === "kg" || L.displayUnit === "lbs" ? L.displayUnit : L.heightUnit === "cm" ? "kg" : "lbs";
      const ins = [...L.weighIns.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
      if (!showWeight) check("state.weight-hidden", n.weight === null, () => `${why}: weight shown without a weight goal: ${JSON.stringify(n.weight)}`);
      else {
        const latestLbs = ins.length ? ins[0][1] : L.weightLbs;
        const v = latestLbs == null ? null : unit === "kg" ? round1(latestLbs * 0.45359237) : latestLbs;
        check("units.weight-unit", n.weight === null ? v === null : n.weight.unit === unit && near(n.weight.value, v, 0.051), () => `${why}: weight ${JSON.stringify(n.weight)}, expected ${v} ${unit}`);
      }
    };
    const ageOnDate = (bd: string, t: string) => Number(t.slice(0, 4)) - Number(bd.slice(0, 4)) - (t.slice(5) < bd.slice(5) ? 1 : 0);

    let n0 = await getFull("day 0");
    if (n0) {
      check("day0.no-logs", n0.summary.daysCounted === 0 && n0.calories.amount === null, () => `day 0: ${JSON.stringify(n0.summary)} calories ${n0.calories.amount}`);
      check("day0.no-words", n0.levels.every((l: any) => l.word === null), () => `day 0 shows words`);
      check("day0.answers-or-empty", n0.source === "answers" || n0.source === "none", () => `day 0 source ${n0.source}`);
    }
    {
      const d = await getDefault();
      lastDefault = JSON.stringify(d.json);
    }

    // ── Days 1–10 ───────────────────────────────────────────────────────────
    const conv: { id: string; dishes: Map<string, { name: string; recipe: any; started: boolean; ateLogged: boolean }> }[] = [];
    let mealCounter = 0;
    // Every fifth person only logs meals with a fibre figure, so fibre words (and Clara's claims) happen.
    const fibreKnownOnly = P.idx % 5 === 3;
    if (fibreKnownOnly) cover("person logs only meals with a fibre figure");
    const compliantLibrary = (meal: string) => {
      refreshOracle();
      const pool = (libraryByMeal.get(meal) ?? []).filter((x) => !fibreKnownOnly || x.fiber != null);
      for (let tries = 0; tries < 60; tries++) {
        const rec = pick(r, pool);
        const items = rec.ingredients.map((ri) => ingById.get(ri.ingredientId)).filter(Boolean).map((i) => ({ name: i!.name, allergenGroups: i!.allergenGroups }));
        if (items.length === 0) continue;
        if (oracle.judgeMany(items).every((v) => v.engine.length === 0 && v.groups.length === 0)) return rec;
      }
      return null;
    };
    const logRecipe = async (mealType: string, opts: { servings?: number; retry?: boolean } = {}) => {
      const meal = mealType[0].toUpperCase() + mealType.slice(1);
      const rec = compliantLibrary(meal === "Snack" ? "Snack" : meal);
      if (!rec) return;
      const servings = opts.servings ?? pick(r, [1, 1, 1, 0.5, 2, 1.5]);
      const key = chance(r, 0.6) ? `sim-${P.idx}-${++mealCounter}` : undefined;
      const body = { localDate: today(), mealType, source: "RECIPE", recipeId: rec.id, servings, ...(key ? { clientRequestId: key } : {}) };
      current.step = `${today()} · log ${mealType}`;
      const res = await call("POST /api/meal-log", mealLog.POST as any, { method: "POST", body });
      check("meallog.created", res.status === 201, () => `${res.status} ${JSON.stringify(res.json)?.slice(0, 200)}`);
      if (res.status !== 201) return;
      shape("POST /api/meal-log", res.json, MEALLOG_POST);
      const per = rec.servings && rec.servings > 0 ? rec.servings : 1;
      const nv = (v: number | null | undefined) => (v == null ? null : v / per);
      const entry: MealEntry = {
        key: key ?? res.json.log.id, id: res.json.log.id, localDate: today(), mealType, name: rec.name, source: "RECIPE", estimated: false, live: true, servings, recipeId: rec.id,
        per: { cal: nv(rec.calories) ?? 0, p: nv(rec.protein) ?? 0, c: nv(rec.carbs) ?? 0, f: nv(rec.fat) ?? 0, fib: nv(rec.fiber), sodium: nv(rec.sodium), satFat: nv(rec.saturatedFat), addedSugar: nv(rec.addedSugars) },
      };
      L.meals.push(entry);
      const row = store.tables.mealLog.find((m) => m.id === res.json.log.id);
      if (rec.sodium != null) check("meallog.recipe-sodium", row?.sodium != null, () => `"${rec.name}" has ${rec.sodium} mg sodium in the library, but its RECIPE log stores sodium ${row?.sodium}`);
      if (opts.retry && key) {
        const again = await call("POST /api/meal-log", mealLog.POST as any, { method: "POST", body });
        check("meallog.replay-200", again.status === 200 && again.json?.log?.id === res.json.log.id, () => `replay → ${again.status} id ${again.json?.log?.id} vs ${res.json.log.id}`);
      }
    };
    const logEstimate = async (mealType: string) => {
      const withFibre = fibreKnownOnly || chance(r, 0.5);
      const per = { calories: 300 + Math.round(r() * 400), protein: 10 + Math.round(r() * 30), carbs: 20 + Math.round(r() * 60), fat: 5 + Math.round(r() * 25), ...(withFibre ? { fiber: Math.round(r() * 12) } : {}) };
      const sodium = chance(r, 0.5) ? Math.round(200 + r() * 1500) : undefined;
      const body = { localDate: today(), mealType, source: "MANUAL", name: "Takeaway bowl (estimate)", perServing: per, estimated: true, ...(sodium !== undefined ? { sodium } : {}), clientRequestId: `est-${P.idx}-${++mealCounter}` };
      current.step = `${today()} · estimate ${mealType}`;
      const res = await call("POST /api/meal-log", mealLog.POST as any, { method: "POST", body });
      check("meallog.created", res.status === 201, () => `${res.status} ${JSON.stringify(res.json)?.slice(0, 200)}`);
      if (res.status !== 201) return;
      shape("POST /api/meal-log", res.json, MEALLOG_POST);
      L.meals.push({ key: body.clientRequestId, id: res.json.log.id, localDate: today(), mealType, name: body.name, source: "MANUAL", estimated: true, live: true, servings: 1,
        per: { cal: per.calories, p: per.protein, c: per.carbs, f: per.fat, fib: withFibre ? (per as any).fiber : null, sodium: sodium ?? null, satFat: null, addedSugar: null } });
    };
    const deleteMeal = async () => {
      const liveToday = L.meals.filter((m) => m.live && m.id);
      if (!liveToday.length) return;
      const m = pick(r, liveToday);
      current.step = `${today()} · delete a log`;
      const res = await call("DELETE /api/meal-log/[id]", mealLogId.DELETE as any, { method: "DELETE", params: { id: m.id! } });
      check("meallog.deleted", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
      if (res.status === 200) m.live = false;
    };

    // Clara's dish tools, with the fake model deciding what it "generates".
    const ctx = () => {
      const pid = store.tables.patient.find((x) => x.accountId === store.tables.account.find((a) => a.clerkId === P.clerkId)?.id)!.id;
      const acc = store.tables.account.find((a) => a.clerkId === P.clerkId)!;
      return { patientId: pid, accountId: acc.id, firstName: "Sim", isPremium: false, today: today(), surface: "ios" as const, disabledSkills: [] as string[] };
    };
    const violators = (meal: string, servings: number): ModelDish[] => {
      const out: ModelDish[] = [];
      const tpl = TEMPLATES.filter((x) => x.meal === meal);
      for (const tp of tpl) {
        const d = fromTemplate(tp, servings);
        if (oracle.judgeMany(d.usesIngredients.map((n) => ({ name: n, allergenGroups: ingByName.get(n.toLowerCase())?.allergenGroups ?? [] }))).some((v) => v.engine.length || v.groups.length)) out.push(d);
      }
      return out;
    };
    const libraryCompliantCount = (mealType: string) => {
      refreshOracle();
      const meal = mealType[0].toUpperCase() + mealType.slice(1);
      let n = 0;
      for (const rec of libraryByMeal.get(meal) ?? []) {
        if (rec.fiber == null || !Array.isArray(rec.steps) || rec.steps.length === 0 || rec.ingredients.length < 2) continue;
        if (rec.ingredients.some((ri) => !(ri.quantity != null && ri.quantity > 0))) continue;
        const items = rec.ingredients.map((ri) => ingById.get(ri.ingredientId)).filter(Boolean).map((i) => ({ name: i!.name, allergenGroups: i!.allergenGroups }));
        if (oracle.judgeMany(items).every((v) => v.engine.length === 0 && v.groups.length === 0)) n++;
      }
      return n;
    };
    const compliantTemplates = (meal: string, servings: number): ModelDish[] =>
      TEMPLATES.filter((x) => x.meal === meal).map((tp) => fromTemplate(tp, servings))
        .filter((d) => oracle.judgeMany(d.usesIngredients.map((n) => ({ name: n, allergenGroups: ingByName.get(n.toLowerCase())?.allergenGroups ?? [] }))).every((v) => !v.engine.length && !v.groups.length));
    let lastSlips: string[] = [];
    fakeModel.decide = (meal, servings) => {
      refreshOracle();
      // A violating candidate always comes FIRST: a leaking gate would serve it.
      const out: ModelDish[] = [];
      // nothing / garbage / hang: the model gives no usable dish at all (empty
      // list, output that is not the schema, no answer before the deadline).
      const mode = pick(r, ["mixed", "mixed", "slip", "allViolating", "library", "oil", "nothing", "garbage", "hang"]);
      dishStats.modes[mode] = (dishStats.modes[mode] ?? 0) + 1;
      if (mode === "garbage" || mode === "hang") return mode;
      if (mode === "nothing") return [];
      const good = compliantTemplates(meal, servings);
      const bad = violators(meal, servings);
      const libRec = compliantLibrary(meal);
      const lib = libRec ? fromLibrary(snap, ingById as any, libRec, meal, servings) : null;
      const banned = bannedForMe.length ? pick(r, bannedForMe).name : null;
      const rename = (d: ModelDish, suffix: string) => ({ ...d, name: `${d.name} ${suffix}` });
      if (mode === "allViolating") { out.push(...bad.slice(0, 3)); if (banned && good[0]) out.push(rename(withSlippedIn(good[0], banned, "list"), "Deluxe")); }
      else if (mode === "slip" && banned && good.length) {
        out.push(rename(withSlippedIn(pick(r, good), banned, "list"), "Special"));
        if (L.allergies.length) { const allergen = L.allergies[0]; out.push(rename(withSlippedIn(pick(r, good), allergen, "step"), "Plus")); dishStats.slipsInSteps++; lastSlips.push(allergen); }
        out.push(...good.slice(0, 1));
        lastSlips.push(banned);
      } else if (mode === "oil" && good.length) { out.push(rename(withGenericOil(pick(r, good)), "(any oil)")); dishStats.repairsOffered++; out.push(...bad.slice(0, 1), ...good.slice(0, 1)); }
      else if (mode === "library") { if (bad[0]) out.push(bad[0]); if (lib) out.push(lib); out.push(...good.slice(0, 1)); }
      else { if (bad[0]) out.push(bad[0]); out.push(...good.slice(0, 2)); }
      const capped = out.slice(0, 3);
      dishStats.offered += capped.length;
      dishStats.offeredViolating += capped.filter((d) => oracle.judgeMany(d.usesIngredients.map((n) => ({ name: n, allergenGroups: ingByName.get(n.toLowerCase())?.allergenGroups ?? [] }))).some((v) => v.engine.length || v.groups.length)).length;
      return capped;
    };
    const BODY_STATE = /\byour (?:\w+ ){0,2}(?:level|levels|intake)? ?(?:is|are) (?:low|high|deficient|too low|too high)\b|\bdeficien|\byou are (?:low|deficient)\b|\byour (?:iron|fibre|fiber|sodium|calcium|potassium|magnesium|protein|vitamin \w+|b12|omega-3) (?:is|are)\b/i;
    const judgeServed = (part: any, why: string) => {
      refreshOracle();
      const recipe = part.recipe;
      check("dish.has-recipe", !!recipe, () => `${why}: dish part without recipe`);
      if (!recipe) return;
      dishStats.served++;
      const items = recipe.ingredients.map((i: any) => ({ name: i.name, allergenGroups: ingByName.get(String(i.name).toLowerCase())?.allergenGroups ?? [] }));
      const verdicts = oracle.judgeMany(items);
      const bad = verdicts.map((v, i) => ({ v, n: items[i].name })).filter(({ v }) => v.engine.length || v.groups.length);
      if (bad.length) dishStats.servedViolations++;
      check("safety.dish-served", bad.length === 0, () => `${why}: "${recipe.name}" served with ${bad.map(({ n, v }) => `${n} (${[...v.engine, ...v.groups.map((g) => `${g.rule}→${g.group}`)].join(", ")})`).join("; ")}`);
      const text = [recipe.name, ...recipe.steps].join(" \n ").toLowerCase();
      for (const s of lastSlips) check("safety.dish-text", !text.includes(s.toLowerCase()), () => `${why}: "${recipe.name}" served with "${s}" in its text: ${recipe.steps.join(" / ").slice(0, 200)}`);
      check("safety.dish-allergen-text", !allergyMatchers.some((m) => m.test(text)), () => `${why}: "${recipe.name}" names an allergen in its text`);
      check("dish.contract", Number.isInteger(part.minutes) && part.minutes >= 1 && Number.isFinite(part.calories) && recipe.steps.length >= 1, () => `${why}: ${JSON.stringify(part).slice(0, 200)}`);
    };
    let callsMark = 0;
    const wording = (result: any, picture: boolean, why: string) => {
      const blob = JSON.stringify(result);
      const sys = fakeModel.calls.slice(callsMark).map((c) => c.system).join("\n");
      check("honesty.no-body-state-prompt", !BODY_STATE.test(sys), () => `${why}: body-state wording in the generator prompt: ${sys.match(BODY_STATE)?.[0]}`);
      check("honesty.no-body-state", !BODY_STATE.test(blob), () => `${why}: body-state wording: ${blob.match(BODY_STATE)?.[0]}`);
      if (picture) {
        check("honesty.answers-wording", !/from what you logged|you've had|this week/i.test(JSON.stringify(result.parts ?? [])) && !/They have had (little|a lot)/.test(sys),
          () => `${why}: answers path talks about logs: ${blob.match(/from what you logged|you've had[^"]*|this week[^"]*/i)?.[0] ?? sys.match(/They have had[^\n]*/)?.[0]}`);
        check("honesty.answers-phrase", /from your answers/.test(blob), () => `${why}: answers path without "from your answers"`);
      }
    };
    // Numbers and Clara must say the same thing about the same week (finding 2, fixed).
    const agree = (res: any, fullNow: any, picture: boolean, why: string) => {
      if (!fullNow || !res?.ok) return;
      const lv = res.data.levels;
      if (!lv) return; // every meal already logged: no levels handed over at all
      if (picture) {
        const pic = fullNow.startingPicture;
        const names = (xs: any[]) => xs.map((x: any) => LV.get(x.key)!.name.toLowerCase());
        check("agree.picture", !!pic && JSON.stringify(lv.little) === JSON.stringify(names(pic.little)) && JSON.stringify(lv.aLot) === JSON.stringify(names(pic.aLot)),
          () => `${why}: Clara's picture ${JSON.stringify([lv.little, lv.aLot])} vs Numbers ${JSON.stringify(pic)}`);
        return;
      }
      const word = (k: string) => fullNow.levels.find((l: any) => l.key === k)?.word ?? null;
      const claimsLittleFibre = lv.little.includes("fibre"), claimsALotSodium = lv.aLot.includes("sodium");
      check("agree.fibre", claimsLittleFibre === (word("fibre") === "little"), () => `${why}: Clara little fibre ${claimsLittleFibre}, Numbers fibre word ${word("fibre")} (enoughLogs ${fullNow.summary.enoughLogs})`);
      check("agree.sodium", claimsALotSodium === (word("sodium") === "a lot"), () => `${why}: Clara a lot of sodium ${claimsALotSodium}, Numbers sodium word ${word("sodium")}`);
      check("agree.no-other-claims", lv.little.every((k: string) => k === "fibre") && lv.aLot.every((k: string) => k === "sodium"), () => `${why}: ${JSON.stringify(lv)}`);
      cover(`Clara and Numbers compared (${claimsLittleFibre || claimsALotSodium ? "a claim" : "no claim"})`);
    };
    const dishSuggest = async (input: Record<string, unknown>) => {
      current.step = `${today()} · Clara dish_suggest ${JSON.stringify(input)}`;
      lastSlips = [];
      dishStats.calls++;
      counts.requests++;
      const fullNow = await getFull("before dish");
      const picture = !!fullNow && !fullNow.summary.enoughLogs && fullNow.source === "answers";
      if (picture) dishStats.picturePath++; else dishStats.logsPath++;
      if ((input.servings as number) > 1) dishStats.guests++;
      let res: any;
      callsMark = fakeModel.calls.length;
      console.log = console.warn = console.info = () => {};
      try { res = await suggestTool(ctx() as any, input); } catch (e) { check("no-throw", false, () => `dish_suggest threw ${(e as Error).stack?.split("\n").slice(0, 3).join(" | ")}`); return null; } finally { Object.assign(console, quiet); }
      // Always a dish: when the library holds plenty of complete recipes this
      // person may eat (judged by the independent oracle), "couldn't make one"
      // means the safety net failed. Time limits and guests narrow the library
      // further, so the check covers the plain one-serving ask.
      const libCount = libraryCompliantCount(String(input.mealType));
      const plainAsk = !input.maxMinutes && !((input.servings as number) > 1);
      if (plainAsk && libCount >= 10) dishStats.libraryHadOne++;
      if (!res.ok) {
        dishStats.couldntFit++;
        check("dish.fail-reason", res.reason === "FAILED" || res.reason === "INVALID_INPUT", () => JSON.stringify(res));
        check("dish.always-a-dish", !(plainAsk && libCount >= 10), () => `couldn't make one, yet ${libCount} complete library ${input.mealType} recipes pass this person's rules`);
        if (libCount === 0) dishStats.honestBothEmpty++;
        return null;
      }
      if (res.data.dish.source === "library") dishStats.servedLibrary++; else dishStats.servedGenerated++;
      check("dish.source", res.data.dish.source === "generated" || res.data.dish.source === "library", () => JSON.stringify(res.data.dish));
      check("honesty.library-not-made", res.data.dish.source !== "library" || /never say you made/.test(res.data.dish.note ?? ""), () => JSON.stringify(res.data.dish));
      const dish = res.parts.find((p: any) => p.kind === "dish");
      const levelsPart = res.parts.find((p: any) => p.kind === "levels");
      check("dish.picture-no-levels-part", !picture || !levelsPart, () => `answers path still emits a levels part`);
      check("dish.levels-source", picture ? res.data.levels.source === "answers" : res.data.levels.enoughLogs !== undefined, () => `${JSON.stringify(res.data.levels)}`);
      if (!picture && !res.data.levels.enoughLogs) {
        check("honesty.clara-levels-need-enough-logs", !levelsPart && !dish.reasons.some((x: any) => /you've had/.test(x.text)),
          () => `not enough logs (${res.data.levels.daysCounted} day(s) logged) yet Clara is handed little=${JSON.stringify(res.data.levels.little)} aLot=${JSON.stringify(res.data.levels.aLot)}${levelsPart ? " and shows a levels chip row" : ""}; reasons: ${dish.reasons.map((x: any) => x.text).join(" / ")}`);
      }
      agree(res, fullNow, picture, "dish_suggest");
      judgeServed(dish, "dish_suggest");
      if ((input.servings as number) > 1) check("dish.guests", dish.recipe.servings === input.servings, () => `servings ${dish.recipe.servings} vs ${input.servings}`);
      wording(res, picture, "dish_suggest");
      return dish;
    };
    const dishPlan = async (occasion: string) => {
      current.step = `${today()} · Clara dish_plan_today ${occasion}`;
      lastSlips = [];
      dishStats.calls++; dishStats.plans++;
      counts.requests++;
      const fullNow = await getFull("before plan");
      const picture = !!fullNow && !fullNow.summary.enoughLogs && fullNow.source === "answers";
      let res: any;
      callsMark = fakeModel.calls.length;
      console.log = console.warn = console.info = () => {};
      try { res = await planTool(ctx() as any, { occasion }); } catch (e) { check("no-throw", false, () => `dish_plan_today threw ${(e as Error).message}`); return []; } finally { Object.assign(console, quiet); }
      if (!res.ok) { dishStats.couldntFit++; return []; }
      const loggedToday = new Set(L.meals.filter((m) => m.live && m.localDate === today()).map((m) => m.mealType));
      agree(res, fullNow, picture, `plan ${occasion}`);
      if (!picture && res.data.levels && !res.data.levels.enoughLogs) check("honesty.clara-levels-need-enough-logs", !(res.parts ?? []).some((p: any) => p.kind === "levels") && res.data.levels.little.length === 0 && res.data.levels.aLot.length === 0,
        () => `plan: not enough logs yet Clara is handed ${JSON.stringify(res.data.levels)}`);
      for (const p of res.parts ?? []) { judgeServed(p, `plan ${occasion}`); }
      for (const d of res.data.dishes ?? []) { if (d.source === "library") dishStats.servedLibrary++; else dishStats.servedGenerated++; }
      check("dish.plan-skips-logged", (res.data.dishes ?? []).every((d: any) => !loggedToday.has(d.mealType)), () => `plan includes an already-logged meal: ${JSON.stringify(res.data.dishes.map((d: any) => d.mealType))} logged ${[...loggedToday]}`);
      if (occasion === "eating_out") check("dish.eating-out", (res.data.dishes ?? []).every((d: any) => d.mealType !== "dinner"), () => `eating out still plans dinner`);
      if (occasion === "guests") for (const d of res.data.dishes ?? []) check("dish.guests-dinner", d.mealType !== "dinner" || d.servings === 6, () => `guests dinner servings ${d.servings}`);
      wording(res, picture, "dish_plan_today");
      return res.parts ?? [];
    };

    // Cooking: start → done → ate / ate some / didn't eat, with replays.
    const cookDish = async (dishPart: any | null, mealType: string) => {
      refreshOracle();
      const c = await conversations.create(ctx().patientId, "What should I eat?", "ios");
      const cid = (c as any).id ?? (c as any).conversation?.id;
      check("cook.conversation", typeof cid === "string", () => `conversation create returned ${JSON.stringify(c)}`);
      if (typeof cid !== "string") return;
      const recipe = dishPart?.recipe ?? (() => {
        // A dish card from earlier in the chat; built here from a compliant template.
        const tp = compliantTemplates(mealType[0].toUpperCase() + mealType.slice(1), 1)[0] ?? compliantTemplates("Dinner", 1)[0];
        if (!tp) return null;
        return { name: tp.name, servings: 1, minutes: tp.prepMinutes + tp.cookMinutes, ingredients: tp.amounts.map((a) => ({ name: a.name, quantity: a.quantity, unit: a.unit })), steps: tp.steps,
          perServing: { calories: tp.perServing.calories, protein: tp.perServing.protein, carbs: tp.perServing.carbs, fat: tp.perServing.fat, fibre: tp.perServing.fiber, sodium: chance(r, 0.5) ? 300 : null } };
      })();
      if (!recipe) return;
      const dishId = dishPart?.dishId ?? `frg_sim_${P.idx}_${mealCounter++}`;
      const send = (body: unknown) => call("POST cook", cook.POST as any, { method: "POST", body, params: { id: cid } });
      const variant = pick(r, ["ate", "ate", "ate some", "didn't eat", "ate twice", "out of order", "replay offline", "two dishes"]);
      current.step = `${today()} · cook (${variant})`;
      cover(`cook: ${variant}`);
      if (variant === "out of order") {
        const early = await send({ action: "ate", portion: 1, today: today(), mealType, dishId });
        check("cook.ate-before-start-409", early.status === 409, () => `ate before start → ${early.status}`);
      }
      const s = await send({ action: "start", dish: { dishId, name: recipe.name, recipe } });
      check("cook.start-200", s.status === 200, () => `start → ${s.status} ${JSON.stringify(s.json)}`);
      if (s.status === 200) shape("POST cook", s.json, SH.ok);
      if (variant === "replay offline") await send({ action: "start", dish: { dishId, name: recipe.name, recipe } });
      const d = await send({ action: "done", dishId });
      check("cook.done-200", d.status === 200, () => `done → ${d.status}`);
      const before = store.tables.mealLog.filter((m) => m.clientRequestId?.startsWith(`cook-${cid}`)).length;
      let portion: 1 | 0.5 | null = variant === "didn't eat" ? null : variant === "ate some" ? 0.5 : 1;
      if (portion !== null) {
        const a = await send({ action: "ate", portion, today: today(), mealType, dishId });
        check("cook.ate-200", a.status === 200, () => `ate → ${a.status} ${JSON.stringify(a.json)}`);
        if (variant === "ate twice" || variant === "replay offline") {
          await send({ action: "ate", portion: 0.5, today: today(), mealType, dishId });
          await send({ action: "ate", portion: 1, today: today(), mealType, dishId });
        }
      }
      let second: string | null = null;
      if (variant === "two dishes") {
        second = `${dishId}-b`;
        await send({ action: "start", dish: { dishId: second, name: `${recipe.name} (second)`, recipe: { ...recipe, name: `${recipe.name} (second)` } } });
        await send({ action: "ate", portion: 1, today: today(), mealType: "snack", dishId: second });
        // The first dish answered late, after the second started: it is still logged once.
        await send({ action: "ate", portion: 1, today: today(), mealType, dishId });
      }
      const after = store.tables.mealLog.filter((m) => m.clientRequestId?.startsWith(`cook-${cid}`));
      const expected = (portion === null ? 0 : 1) + (second ? 1 : 0);
      check("state.ate-once", after.length - before === expected && after.length === expected, () => `${variant}: ${after.length} cook logs for conversation (expected ${expected})`);
      const mine = after.find((m) => m.clientRequestId === `cook-${cid}-${dishId}`);
      if (portion !== null && mine) {
        check("cook.portion-first-wins", mine.servings === portion, () => `${variant}: servings ${mine.servings} vs first answer ${portion}`);
        check("cook.local-date", mine.localDate === today(), () => `cook log dated ${mine.localDate}, person's today ${today()}`);
        const ps = recipe.perServing;
        L.meals.push({ key: mine.clientRequestId, id: mine.id, localDate: mine.localDate, mealType, name: mine.name, source: "CLARA", estimated: false, live: true, servings: portion,
          per: { cal: ps.calories, p: ps.protein, c: ps.carbs, f: ps.fat, fib: ps.fibre, sodium: ps.sodium, satFat: null, addedSugar: null } });
      }
      if (second) {
        const m2 = after.find((m) => m.clientRequestId === `cook-${cid}-${second}`);
        if (m2) { const ps = recipe.perServing; L.meals.push({ key: m2.clientRequestId, id: m2.id, localDate: m2.localDate, mealType: "snack", name: m2.name, source: "CLARA", estimated: false, live: true, servings: 1,
          per: { cal: ps.calories, p: ps.protein, c: ps.carbs, f: ps.fat, fib: ps.fibre, sodium: ps.sodium, satFat: null, addedSugar: null } }); }
      }
    };

    const checkLog = async () => {
      current.step = `${today()} · Log`;
      const res = await call("GET /api/log", log.GET as any, { path: "/api/log", query: { today: today() } });
      check("log.200", res.status === 200, () => `${res.status}`);
      if (res.status !== 200) return;
      shape("GET /api/log", res.json, SH.log);
      const from = addDays(today(), -13);
      const live = L.meals.filter((m) => m.live && m.localDate >= from && m.localDate <= today());
      const dates = [...new Set(live.map((m) => m.localDate))].sort().reverse();
      check("log.days", JSON.stringify(res.json.days.map((d: any) => d.date)) === JSON.stringify(dates), () => `Log days ${JSON.stringify(res.json.days.map((d: any) => d.date))} vs ${JSON.stringify(dates)}`);
      for (const d of res.json.days) {
        const exp = live.filter((m) => m.localDate === d.date);
        check("log.entries", d.entries.length === exp.length && d.entries.every((e: any) => exp.some((m) => m.id === e.id)), () => `${d.date}: ${d.entries.length} entries vs ${exp.length}`);
        for (const e of d.entries) { const m = exp.find((x) => x.id === e.id); if (m) check("log.estimated", e.estimated === m.estimated && e.source === m.source, () => `${e.name}: estimated ${e.estimated}/${m.estimated} source ${e.source}/${m.source}`); }
      }
    };
    const defaultUnaffected = async (why: string, mutate: () => Promise<void>) => {
      const before = await getDefault();
      await mutate();
      const after = await getDefault();
      check("oldclient.default-unaffected", JSON.stringify(before.json) === JSON.stringify(after.json), () => `${why} changed GET /api/numbers (no full=1)`);
    };
    const setTracked = async (keys: string[], why: string) => {
      current.step = `${today()} · tracked: ${why}`;
      const res = await call("PUT /api/numbers/tracked", tracked.PUT as any, { method: "PUT", body: { tracked: keys } });
      const kidney = L.conditions.some((c) => c.toLowerCase().includes("kidney"));
      if (keys.includes("phosphorus") && !kidney) { check("state.phosphorus-refused", res.status === 422, () => `phosphorus accepted for a non-kidney person (${res.status})`); return; }
      check("tracked.200", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
      if (res.status !== 200) return;
      shape("PUT /api/numbers/tracked", res.json, SH.tracked);
      L.tracked = new Set(keys);
      check("tracked.echo", JSON.stringify([...res.json.tracked].sort()) === JSON.stringify([...new Set(keys)].sort()), () => `echo ${res.json.tracked}`);
    };
    const saveGoals = async (entries: { key: string; amount: number | null }[], why: string) => {
      current.step = `${today()} · goals: ${why}`;
      const fullNow = await getFull("before goal");
      const trackedBefore = fullNow ? fullNow.levels.filter((l: any) => l.tracked).map((l: any) => l.key) : [];
      const res = await call("PUT /api/numbers/goals", goals.PUT as any, { method: "PUT", body: { goals: entries }, path: "/api/numbers/goals", query: { today: today() } });
      const tooBig = entries.some((e) => { const l = fullNow?.levels.find((x: any) => x.key === e.key); return e.amount !== null && l && e.amount > 3 * l.target; });
      if (tooBig) { check("goals.refuse-over-3x", res.status === 422, () => `goal over 3× accepted (${res.status})`); return; }
      check("goals.200", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
      if (res.status !== 200) return;
      shape("PUT /api/numbers/goals", res.json, SH.goals);
      if (L.tracked === null) L.tracked = new Set(defaultTracked(L.conditions));
      for (const e of entries) { if (e.amount === null) L.goalsSaved.delete(e.key); else L.goalsSaved.set(e.key, e.amount); }
      const after = await getFull("after goal");
      if (after) {
        const trackedAfter = after.levels.filter((l: any) => l.tracked).map((l: any) => l.key);
        check("state.goal-keeps-tracked", JSON.stringify(trackedAfter) === JSON.stringify(trackedBefore), () => `${why}: tracked ${JSON.stringify(trackedBefore)} → ${JSON.stringify(trackedAfter)}`);
      }
    };
    const weighIn = async (lbsValue: number, twice: boolean) => {
      current.step = `${today()} · weigh-in`;
      const t = today();
      const notesBefore = store.tables.journalEntry.filter((j) => j.patientId === ctx().patientId).map((j) => ({ d: j.date.toISOString().slice(0, 10), mood: j.mood, notes: j.notes }));
      cover(twice ? "weigh-in twice in a day" : "weigh-in");
      if (L.journalNotes.has(t)) cover("weigh-in on a day with journal notes");
      for (const w of twice ? [lbsValue + 0.4, lbsValue] : [lbsValue]) {
        // The app converts what the person typed (kg or lbs) to pounds, 1 decimal.
        const typedKg = L.displayUnit === "kg";
        const sent = typedKg ? round1(round1(w * 0.45359237) * LBS_PER_KG_APP) : round1(w);
        const res = await call("POST /api/numbers/weight", weight.POST as any, { method: "POST", body: { date: t, weight: sent } });
        check("weight.200", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
        if (res.status !== 200) continue;
        shape("POST /api/numbers/weight", res.json, SH.weight);
        const unit = L.displayUnit === "kg" || L.displayUnit === "lbs" ? L.displayUnit : L.heightUnit === "cm" ? "kg" : "lbs";
        check("units.weight-echo-unit", res.json.weight.unit === unit, () => `weigh-in answered in ${res.json.weight.unit}, person reads ${unit}`);
        if (typedKg) check("units.kg-roundtrip", Math.abs(res.json.weight.value - round1(w * 0.45359237)) < 0.051, () => `typed ${round1(w * 0.45359237)} kg, shown ${res.json.weight.value} kg`);
        L.weighIns.set(t, sent);
        L.weightLbs = [...L.weighIns.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))[0][1];
      }
      const after = store.tables.journalEntry.filter((j) => j.patientId === ctx().patientId);
      for (const nb of notesBefore) {
        if (!nb.mood && !nb.notes) continue;
        const a = after.find((j) => j.date.toISOString().slice(0, 10) === nb.d);
        check("weight.keeps-journal", a?.mood === nb.mood && a?.notes === nb.notes, () => `weigh-in on ${t} changed ${nb.d}'s journal: ${JSON.stringify(nb)} → ${JSON.stringify({ mood: a?.mood, notes: a?.notes })}`);
      }
      const sameDay = after.filter((j) => j.date.toISOString().slice(0, 10) === new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))).toISOString().slice(0, 10));
      check("weight.one-entry-per-day", sameDay.length <= 1, () => `${sameDay.length} journal entries on ${t}`);
    };
    const pillsChange = async (what: string) => {
      current.step = `${today()} · pills: ${what}`;
      if (what === "add custom") {
        const body = { name: "Iron bisglycinate", dosage: "25 mg", timeSlot: "EVENING", contents: [{ key: "iron", amount: 25, unit: "mg" }, { key: "vitaminC", amount: 0.1, unit: "g" }], estimated: false };
        const res = await call("POST /api/supplements", supplements.POST as any, { method: "POST", body });
        check("supplements.post-201", res.status === 201, () => `${res.status} ${JSON.stringify(res.json)}`);
        if (res.status === 201) { shape("POST /api/supplements", res.json, { obj: { supplement: SUPP(true) } }); L.supplements.push({ id: res.json.supplement.id, name: body.name, contents: body.contents as Content[], estimated: false, live: true }); }
      } else if (what === "edit omega in grams") {
        const list = await call("GET /api/supplements", supplements.GET as any, { path: "/api/supplements" });
        const om = list.json?.supplements?.find((s: any) => s.name === "Omega-3");
        if (!om) return;
        const res = await call("PATCH /api/supplements/[id]", supplementId.PATCH as any, { method: "PATCH", body: { contents: [{ key: "omega3", amount: 1, unit: "g" }] }, params: { id: om.id } });
        check("supplements.patch-200", res.status === 200, () => `${res.status}`);
        if (res.status === 200) { shape("PATCH /api/supplements/[id]", res.json, { obj: { supplement: SUPP(false) } }); const s = liveSupps().find((x) => x.name === "Omega-3"); if (s) { s.contents = [{ key: "omega3", amount: 1, unit: "g" }]; s.estimated = false; } }
      } else if (what === "untick one") {
        const list = await call("GET /api/supplements", supplements.GET as any, { path: "/api/supplements" });
        const s = list.json?.supplements?.[0];
        if (!s) return;
        const res = await call("DELETE /api/supplements/[id]", supplementId.DELETE as any, { method: "DELETE", params: { id: s.id } });
        check("supplements.delete-200", res.status === 200, () => `${res.status}`);
        const mine = liveSupps().find((x) => x.name === s.name);
        if (res.status === 200 && mine) mine.live = false;
      }
      const list = await call("GET /api/supplements", supplements.GET as any, { path: "/api/supplements" });
      if (list.status === 200) {
        shape("GET /api/supplements", list.json, { obj: { supplements: { arr: SUPP(true) } } });
        for (const sv of list.json.supplements) {
          const mine = liveSupps().find((x) => x.name === sv.name);
          check("supplements.contents", !!mine && JSON.stringify(sv.contents) === JSON.stringify(mine.contents) && sv.estimated === mine.estimated,
            () => `${sv.name}: server ${JSON.stringify([sv.contents, sv.estimated])} vs ${JSON.stringify(mine && [mine.contents, mine.estimated])}`);
        }
        check("supplements.list", list.json.supplements.length === liveSupps().length, () => `${list.json.supplements.length} live vs ${liveSupps().length}: ${JSON.stringify(list.json.supplements.map((s: any) => s.name))} vs ${JSON.stringify(liveSupps().map((s) => s.name))}`);
      }
    };
    const editFirstRun = async () => {
      // Account → "Conditions and eating": the same four steps, prefilled.
      current.step = `${today()} · edit first run`;
      const oo = await getOnboarding();
      checkOnboarding(oo, "edit: load");
      if (!oo) return;
      const flip = L.conditions.length > 0 ? { ids: [] as string[], none: true } : { ids: [store.ref("healthCondition", pick(r, ["Hypertension", "Chronic Kidney Disease stage 1-2", "Celiac Disease", "Type 2 Diabetes"])).id], none: false };
      await appStep.condition(flip.ids, flip.none);
      // Untick one pill, keep the answers.
      const keepPills = (oo.pills as Pill[]).slice(1);
      await appStep.eating(Object.fromEntries(Object.entries(oo.usualEating).filter(([, v]) => v !== null)) as Partial<Eating>, keepPills);
      // Basics re-sent as the app holds them: the allergies the server returned.
      const allergyNames = (oo.profile.allergyIds as string[]).map((id) => store.tables.foodAllergy.find((a) => a.id === id)!.name);
      const wBefore = L.weightLbs;
      const lbsFromKg = round1(oo.profile.weightKg * LBS_PER_KG_APP);
      const body = { birthday: oo.profile.birthday, sexAtBirth: oo.profile.sexAtBirth, height: round1(oo.profile.heightCm), heightUnit: "cm", weight: lbsFromKg,
        // The app's unit toggle starts from the phone's locale (FirstRunViewModel.usesMetric), not from the stored preference.
        displayWeightUnit: P.metric ? "kg" : "lbs", physicalActivityId: oo.profile.activityId, foodAllergyIds: [...oo.profile.allergyIds].sort() };
      current.step = `${today()} · edit first run · step 3`;
      const res = await patch(body);
      check("onboarding.edit-step3-200", res.status === 200, () => `${res.status} ${JSON.stringify(res.json)}`);
      if (res.status === 200) {
        check("units.untouched-weight-stable", Math.abs(lbsFromKg - (wBefore ?? lbsFromKg)) < 0.05, () => `re-saving untouched basics moves the weight ${wBefore} lbs → ${lbsFromKg} lbs (server sends weightKg rounded to 0.1 kg)`);
        const readBefore = L.displayUnit === "kg" || L.displayUnit === "lbs" ? L.displayUnit : L.heightUnit === "cm" ? "kg" : "lbs";
        check("units.edit-keeps-weight-unit", readBefore === body.displayWeightUnit, () => `opening "Conditions and eating" and pressing Continue switches the weight unit ${readBefore} → ${body.displayWeightUnit} (the app's toggle starts from the phone locale; GET /api/onboarding does not carry the stored preference)`);
        L.weightLbs = lbsFromKg; L.heightStoredCm = round1(oo.profile.heightCm); L.heightUnit = "cm"; L.allergies = allergyNames; L.displayUnit = body.displayWeightUnit;
      }
      expectStoredRules("after editing first run");
      if (L.weightGoal) await appStep.goal(L.weightGoal);
      checkOnboarding(await getOnboarding(), "edit: done");
    };

    for (let d = 1; d <= 10; d++) {
      const date = addDays(P.startDate, d);
      const nMeals = P.mealsPattern[d - 1];
      const slots: [string, number][] = [["breakfast", 7], ["lunch", 12], ["dinner", 19], ["snack", 16], ["snack", 22], ["dinner", 23]];
      for (let i = 0; i < nMeals; i++) {
        const [mealType, hour] = slots[i];
        at(date, hour, 30);
        const how = pick(r, ["recipe", "recipe", "recipe", "cook", "estimate"]);
        // Some mornings the person looks at Numbers and the Log right after breakfast (Auckland: ahead of the server's date).
        const morningLook = i === 0 && chance(r, 0.3);
        if (how === "recipe") await logRecipe(mealType, { retry: chance(r, 0.2) });
        else if (how === "estimate") await logEstimate(mealType);
        else {
          const dish = d % 3 === 0 ? await dishSuggest({ mealType, ...(chance(r, 0.2) ? { servings: 4 } : {}) }) : null;
          await cookDish(dish, mealType);
        }
        if (morningLook) { await getFull(`morning ${d}`); await checkLog(); }
      }
      at(date, 21, 15);
      if (chance(r, 0.15)) await deleteMeal();
      await getFull(`day ${d}`);
      if (d % 2 === 0) await checkLog();
      if (d === 2) await defaultUnaffected("tracked: Track all", () => setTracked([...LEVEL_KEYS.filter((k) => k !== "phosphorus"), ...(L.conditions.some((c) => /kidney/i.test(c)) ? ["phosphorus"] : [])], "Track all"));
      if (d === 3) await setTracked(["phosphorus", "iron"], "phosphorus for anyone");
      if (d === 3) { const t = L.tracked ?? new Set(defaultTracked(L.conditions)); const k = pick(r, LEVEL_KEYS.filter((x) => x !== "phosphorus")); const next = new Set(t); if (next.has(k)) next.delete(k); else next.add(k); await setTracked([...next], `toggle ${k}`); }
      if (d === 4) {
        const n = await getFull("goal targets");
        if (n) {
          const lv = (k: string) => n.levels.find((l: any) => l.key === k);
          await defaultUnaffected("goals", () => saveGoals([{ key: "fibre", amount: round1(lv("fibre").target * 0.01) }, { key: "iron", amount: lv("iron").target }, { key: "vitaminD", amount: lv("vitaminD").target * 1.5 }], "1%, 100%, 150%"));
          await saveGoals([{ key: "sodium", amount: lv("sodium").target * 4 }], "400% refused");
        }
      }
      if (d === 5 && P.idx % 4 === 0) await setTracked([], "Clear all");
      if (d === 6) await saveGoals([{ key: "fibre", amount: null }, { key: "protein", amount: 60 }], "clear one, set protein");
      if (d === 6 && L.tracked && L.tracked.size === 0) { const n = await getFull("after clear all"); if (n) check("state.clear-all-persists", n.levels.every((l: any) => !l.tracked), () => `Clear all then a goal save: ${n.levels.filter((l: any) => l.tracked).map((l: any) => l.key)}`); }
      if (d === 3 || d === 7) { at(date, 7, 0); const base = (L.weightLbs ?? 150) + (P.goal === "lose" ? -1 : 0.5); await weighIn(round1(base), d === 7); }
      if (P.web && d === 2) { at(addDays(P.startDate, 3), 6, 45); await weighIn(round1((L.weightLbs ?? 150) - 0.6), false); }
      if (d === 4) await defaultUnaffected("pills: add a custom pill", () => pillsChange("add custom"));
      if (d === 5) await pillsChange("edit omega in grams");
      if (d === 8) await defaultUnaffected("pills: untick", () => pillsChange("untick one"));
      if (d === 5 && P.flow === "editLater") { at(date, 21, 40); await editFirstRun(); }
      if (d === 5 && P.flow !== "editLater") await defaultUnaffected("onboarding PUT (answers)", async () => { await put({ usualEating: { sweet: 1 } }); L.usualEating = { ...(L.usualEating ?? emptyEating()), sweet: 1 }; });
      if (d === 1 || d === 7) { at(date, 17, 0); await dishSuggest({ mealType: "dinner", ...(d === 7 ? { servings: 4 } : {}) }); }
      if (d === 8) { at(date, 6, 30); const occ = pick(r, ["normal", "eating_out", "guests", "little_time"]); const parts = await dishPlan(occ); if (parts[0] && chance(r, 0.5)) await cookDish(parts[0], "breakfast"); }
      if (d === 10) { at(date, 22, 0); await checkLog(); await getDefault(); }
    }
    // ── ownership: another person's chat, pill and log are not reachable ───
    current.step = "ownership";
    if (prevOwn.conversationId) {
      const before = store.tables.mealLog.length;
      const x = await call("POST cook", cook.POST as any, { method: "POST", body: { action: "ate", portion: 1, today: today(), mealType: "dinner" }, params: { id: prevOwn.conversationId } });
      check("ownership.cook", x.status === 404 && store.tables.mealLog.length === before, () => `someone else's chat → ${x.status}`);
    }
    if (prevOwn.supplementId) {
      const x = await call("PATCH /api/supplements/[id]", supplementId.PATCH as any, { method: "PATCH", body: { name: "mine now" }, params: { id: prevOwn.supplementId } });
      check("ownership.supplement", x.status === 404, () => `someone else's pill → ${x.status}`);
    }
    if (prevOwn.mealLogId) {
      const x = await call("DELETE /api/meal-log/[id]", mealLogId.DELETE as any, { method: "DELETE", params: { id: prevOwn.mealLogId } });
      check("ownership.meallog", x.status === 404 && store.tables.mealLog.find((m) => m.id === prevOwn.mealLogId)?.deletedAt === null, () => `someone else's log → ${x.status}`);
    }
    {
      const pid = ctx().patientId;
      prevOwn = {
        conversationId: store.tables.claraConversation.find((c) => c.patientId === pid)?.id,
        supplementId: store.tables.supplement.find((x) => x.patientId === pid && x.deletedAt === null)?.id,
        mealLogId: store.tables.mealLog.find((m) => m.patientId === pid && m.deletedAt === null)?.id,
      };
    }
    perPerson.push({ id: P.id, tier: P.tier, flow: P.flow, tz: P.tz, requests: counts.requests - reqStart, meals: L.meals.filter((m) => m.live).length, findings: failures.length - failStart });

    // ── old-app journey (pre-existing endpoints only) ───────────────────────
    async function oldAppJourney() {
      current.step = "old app";
      for (let d = 0; d < 6; d++) {
        const date = addDays(P.startDate, d);
        at(date, 12, 0);
        const rec = (libraryByMeal.get("Lunch") ?? [])[P.idx * 13 + d];
        const res = await call("POST /api/meal-log", mealLog.POST as any, { method: "POST", body: { localDate: date, mealType: "lunch", source: "RECIPE", recipeId: rec.id, servings: 1 } });
        check("meallog.created", res.status === 201, () => `${res.status}`);
        if (res.status === 201) {
          shape("POST /api/meal-log (old app)", res.json, MEALLOG_POST);
          check("oldclient.no-new-keys", !("sodium" in res.json.log) && !("estimated" in res.json.log) && !("nutrients" in res.json.log), () => `new keys leak into the old meal-log DTO: ${Object.keys(res.json.log)}`);
        }
        const day = await call("GET /api/meal-log?date", mealLog.GET as any, { path: "/api/meal-log", query: { date } });
        check("oldclient.day-200", day.status === 200, () => `${day.status}`);
        if (day.status === 200) for (const l of day.json.logs) shape("GET /api/meal-log?date (old app) log", l, SH.mealLogDto);
        const n = await call("GET /api/numbers", numbers.GET as any, { path: "/api/numbers", query: { days: "7", today: date } });
        if (n.status === 200) shape("GET /api/numbers (old app)", n.json, SH.numbersOld);
        const n2 = await call("GET /api/numbers", numbers.GET as any, { path: "/api/numbers", query: { days: "7" } });
        check("oldclient.no-today-200", n2.status === 200, () => `${n2.status}`);
        const s = await call("GET /api/supplements", supplements.GET as any, { path: "/api/supplements" });
        if (s.status === 200) shape("GET /api/supplements (old app)", s.json, { obj: { supplements: { arr: SUPP(true) } } });
      }
      const prof = await call("GET /api/patient/profile", profile.GET as any);
      check("oldclient.profile-200", prof.status === 200, () => `${prof.status}`);
      if (prof.status === 200) {
        const extra = ["usualEating", "startingPicture", "weightGoal", "noCondition"].filter((k) => k in prof.json.patient);
        if (extra.length) observations.push(`old GET /api/patient/profile now carries ${extra.join(", ")} (additive)`);
      }
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const byId = new Map<string, Failure[]>();
  for (const f of failures) byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
  const unknown = [...byId.entries()].filter(([id]) => !KNOWN_FINDINGS[id]);
  const known = [...byId.entries()].filter(([id]) => KNOWN_FINDINGS[id]);
  const lines: string[] = [];
  lines.push(`# Clara-first user simulation`, ``);
  lines.push(`Run ${new Date(Date.now()).toISOString().slice(0, 10)} (simulated clock) · snapshot ${snap.takenAt}`, ``);
  lines.push(`**People:** ${personas.length} (${personas.filter((p) => !p.oldApp).length} on the new app, ${personas.filter((p) => p.oldApp).length} on an old build) · **requests:** ${counts.requests} · **assertions:** ${counts.assertions} · **failed checks:** ${failures.length} in ${byId.size} invariants (${known.length} known findings, ${unknown.length} unexplained).`, ``);
  lines.push(`Clara dish tools: ${dishStats.calls} calls (${dishStats.plans} day plans, ${dishStats.guests} for guests; ${dishStats.picturePath} from the starting picture, ${dishStats.logsPath} from logs), ${dishStats.offered} candidate dishes offered by the fake model of which ${dishStats.offeredViolating} broke the person's rules, ${dishStats.repairsOffered} said "cooking oil", ${dishStats.slipsInSteps} hid an allergen in a step only; ${dishStats.served} dishes served, ${dishStats.servedViolations} of them breaking a rule; ${dishStats.couldntFit} "couldn't make one that fits". Served ${dishStats.servedGenerated} generated and ${dishStats.servedLibrary} library dishes; fake-model answers by kind ${JSON.stringify(dishStats.modes)}; ${dishStats.libraryHadOne} plain asks had ≥10 complete rule-compliant library recipes (each must get a dish); ${dishStats.honestBothEmpty} "couldn't make one" with an empty library.`, ``);
  lines.push(`Fibre with unknown meals: ${fibreStats.responses} Numbers responses counted a meal without a fibre figure as 0 g; ${fibreStats.little} of them said "little"; in ${fibreStats.wordChanged} the word differs from the one the known meals alone give.`, ``);
  lines.push(`| Invariant | Failures | People | Example |`, `|---|---:|---:|---|`);
  for (const [id, fs] of [...byId.entries()].sort((a, b) => b[1].length - a[1].length))
    lines.push(`| ${id}${KNOWN_FINDINGS[id] ? ` (finding: ${KNOWN_FINDINGS[id].severity})` : ""} | ${fs.length} | ${new Set(fs.map((f) => f.person)).size} | ${fs[0].person} · ${fs[0].step}: ${fs[0].detail.replace(/\|/g, "/").slice(0, 300)} |`);
  lines.push(``, `## Coverage (how often each situation happened)`, ``, `| Situation | Times |`, `|---|---:|`);
  for (const [k, v] of [...coverage.entries()].sort()) lines.push(`| ${k} | ${v} |`);
  lines.push(``, `## Requests by route`, ``, `| Route | Calls |`, `|---|---:|`);
  for (const [k, v] of [...counts.byRoute.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  lines.push(``, `Status codes: ${[...counts.statuses.entries()].sort().map(([s, c]) => `${s}×${c}`).join(", ")}.`, ``);
  lines.push(`## People`, ``, `| Person | Tier | Flow | Time zone | Requests | Live meals | Failed checks |`, `|---|---|---|---|---:|---:|---:|`);
  for (const p of perPerson) lines.push(`| ${p.id} | ${p.tier} | ${p.flow} | ${p.tz} | ${p.requests} | ${p.meals} | ${p.findings} |`);
  const obs = new Map<string, number>();
  for (const o of observations) obs.set(o, (obs.get(o) ?? 0) + 1);
  lines.push(``, `## Observations`, ``, ...[...obs.entries()].map(([o, n]) => `- ${o} (${n})`), ``);
  lines.push(`## Server errors logged`, ``, ...[...new Set(serverErrors)].slice(0, 20).map((e) => `- ${e.replace(/\n/g, " ").slice(0, 300)}`), ``);
  mkdirSync(join(__dirname, ".snapshot"), { recursive: true });
  writeFileSync(join(__dirname, ".snapshot", "clara-first-run.md"), lines.join("\n"));
  writeFileSync(join(__dirname, ".snapshot", "clara-first-failures.json"), JSON.stringify({ failures, counts: { ...counts, byRoute: Object.fromEntries(counts.byRoute), statuses: Object.fromEntries(counts.statuses) }, dishStats, perPerson, store: store.stats }, null, 1));
  quiet.log(lines.slice(0, 8 + byId.size).join("\n"));
  quiet.log(`\nfull run log: sim/.snapshot/clara-first-run.md`);

  assert.equal(unknown.length, 0, `${unknown.length} unexplained invariant failures: ${unknown.map(([id, fs]) => `${id}×${fs.length}`).join(", ")}`);
});
