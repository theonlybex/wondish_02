// The dish brain's ACCEPTANCE run (docs/superpowers/specs/2026-11-21-clara-dish-brain-design.md,
// section A, "How we will know it works"). It grew out of the at-home foods
// check (2026-11-21-clara-ingredients-design.md) and keeps its machinery.
// The REAL dish model through the product's own dish_suggest handler
// (makeDishHandlers with liveDishDeps), the in-memory store only (no database:
// sim/clara-live-key.ts drops every database URL). Marks, onboarding answers
// and today's logged meals are written to the store, so the dish skill reads
// them the way it does in production (loadKeptMarks, loadBrainRows).
//
//   SIM_LIVE=1 npm run sim:clara-kept-foods      (real model, at most SIM_CALL_CAP calls)
//   SIM_DRY=1  npm run sim:clara-kept-foods      (no model: the stored-recipe step only, free)
//
// Env: SIM_OUT (default sim/.snapshot/dish-brain-live.jsonl, or dish-brain-dry.jsonl when dry),
// SIM_CALL_CAP (default 60, across all runs: sim/.snapshot/dish-brain-live-ledger.json),
// SIM_ONLY="A|C" runs only those scenarios, SIM_READ_ALL=0 stops reading the
// model's answer when the product does (default: the spy reads the rest of the
// SAME call in the background, so all three candidates are recorded; no extra
// call, only the output tokens the product would have cut off). Rows are
// appended as they finish; a request already in SIM_OUT is skipped, so a
// stopped run resumes without spending a call twice. The summary is printed
// from every row in SIM_OUT, one PASS / FAIL line per acceptance line; the
// process exits 0 either way.
import "./clara-live-key";
import "./setup";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { snap, state, ingByName } from "./setup";
import { createClaraStore } from "./fake-db";
import { makePatient, type RuleKey } from "./profiles";
import { makeOracle } from "./oracle";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import type { DishIngredient, HomeProtein } from "@/lib/clara/dish-protein";
import { DEFAULT_DISH_RULES } from "@/lib/clara/dish-rules";
// Product modules that reach @/lib/db are imported inside main(), after the
// in-memory store is installed as globalThis.prisma (a static import would bind
// the database client to the snapshot's read-only fake first).

const DRY = process.env.SIM_DRY === "1";
if (process.env.SIM_LIVE !== "1" && !DRY) {
  console.log("sim:clara-kept-foods is opt-in: SIM_LIVE=1 (real model, counted against SIM_CALL_CAP) or SIM_DRY=1 (no model).");
  process.exit(0);
}
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key && !DRY) { console.log("No ANTHROPIC_API_KEY in .env.local — skipped."); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key ?? "sim-dry-never-sent";

const OUT = process.env.SIM_OUT ?? join(__dirname, ".snapshot", DRY ? "dish-brain-dry.jsonl" : "dish-brain-live.jsonl");
const CAP = Number(process.env.SIM_CALL_CAP ?? 150);
const READ_ALL = process.env.SIM_READ_ALL !== "0";
const LEDGER = join(__dirname, ".snapshot", "dish-brain-live-ledger.json");
const ledger: { calls: number; models: Record<string, number> } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { calls: 0, models: {} };
const spend = (model: string) => {
  if (existsSync(LEDGER)) Object.assign(ledger, JSON.parse(readFileSync(LEDGER, "utf8")));
  if (ledger.calls >= CAP) throw new Error(`sim: live call cap ${CAP} reached`);
  ledger.calls++;
  ledger.models[model] = (ledger.models[model] ?? 0) + 1;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
};

// ── the spy between the product and the API (same shape as clara-fast-live) ──
type CallRec = {
  model: string; ms: number; inTokens: number; outTokens: number | null; stop: string | null; aborted: boolean; error?: string;
  /** The instructions the product sent (the system prompt), for the checks that read them. */
  system: string;
  /** The model's whole answer text (all of it with READ_ALL, else what the product read). */
  text: string;
  /** The product stopped reading before the answer ended (a dish accepted, or the deadline). */
  productStopped: boolean;
  /** Resolves when the background read of the rest of the answer ends. */
  fullRead?: Promise<void>;
};
const calls: CallRec[] = [];
const realClient = key ? new Anthropic({ apiKey: key }) : null;
const abortError = () => Object.assign(new Error("Request was aborted."), { name: "AbortError" });
const recordEvent = (rec: CallRec, ev: any) => {
  if (ev.type === "message_start") rec.inTokens = ev.message.usage.input_tokens + (ev.message.usage.cache_read_input_tokens ?? 0) + (ev.message.usage.cache_creation_input_tokens ?? 0);
  if (ev.type === "message_delta") { rec.outTokens = ev.usage.output_tokens; rec.stop = ev.delta.stop_reason; }
  if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") rec.text += ev.delta.text;
};
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    HAIKU_MODEL: "claude-haiku-5-5",
    createAnthropic: (o: { timeout?: number; maxRetries?: number } = {}) => ({
      messages: {
        create: async (params: any, opts?: { signal?: AbortSignal }) => {
          const rec: CallRec = { model: params.model, ms: 0, inTokens: 0, outTokens: null, stop: null, aborted: false, text: "", productStopped: false,
            system: typeof params.system === "string" ? params.system : Array.isArray(params.system) ? params.system.map((b: any) => b?.text ?? "").join("\n") : "" };
          calls.push(rec);
          const t0 = Date.now();
          if (DRY) {
            rec.model = `${params.model} (dry)`;
            if (!params.stream) return { content: [{ type: "tool_use", id: "t", name: "suggest_recipes", input: { recipes: [] } }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "tool_use" };
            rec.text = '{"dishes":[]}';
            return (async function* () { yield { type: "content_block_delta", delta: { type: "text_delta", text: '{"dishes":[]}' } }; })();
          }
          spend(params.model);
          const client = realClient!.withOptions({ timeout: o.timeout ?? 90_000, maxRetries: 0 });
          if (!params.stream) {
            try {
              const msg = await client.messages.create(params, opts);
              Object.assign(rec, { ms: Date.now() - t0, inTokens: msg.usage.input_tokens, outTokens: msg.usage.output_tokens, stop: msg.stop_reason });
              return msg;
            } catch (e) { rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
          }
          if (!READ_ALL) {
            let s: any;
            try { s = await client.messages.create(params, opts); } catch (e) { rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
            return (async function* () {
              let ended = false;
              try {
                for await (const ev of s) { recordEvent(rec, ev); yield ev; }
                ended = true;
              } catch (e) { rec.aborted = true; throw e; }
              finally { rec.ms = Date.now() - t0; if (!ended) rec.productStopped = true; if (rec.outTokens == null) rec.aborted = true; }
            })();
          }
          // READ_ALL: the real request has its own signal (60 s hard cap), so the
          // product stopping early does not cut the answer off; the product still
          // sees an abort the moment its own signal fires, as with the SDK.
          const own = new AbortController();
          const hard = setTimeout(() => own.abort(), 60_000);
          hard.unref?.();
          let s: any;
          try { s = await client.messages.create(params, { signal: own.signal }); } catch (e) { clearTimeout(hard); rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
          const queue: any[] = [];
          let done = false;
          let failure: unknown = null;
          const waker = { fn: null as null | (() => void) };
          rec.fullRead = (async () => {
            try {
              for await (const ev of s) { recordEvent(rec, ev); queue.push(ev); waker.fn?.(); }
            } catch (e) {
              failure = e;
              if (!own.signal.aborted) rec.error = (e as Error).message;
            } finally {
              done = true; clearTimeout(hard); rec.ms = Date.now() - t0; if (rec.outTokens == null) rec.aborted = true; waker.fn?.();
            }
          })();
          return (async function* () {
            const sig = opts?.signal;
            const onAbort = () => waker.fn?.();
            sig?.addEventListener("abort", onAbort, { once: true });
            let ended = false;
            try {
              for (;;) {
                if (sig?.aborted) throw abortError();
                if (queue.length) { yield queue.shift(); continue; }
                if (done) { if (failure) throw failure; ended = true; return; }
                await new Promise<void>((res) => { waker.fn = res; });
                waker.fn = null;
              }
            } finally { sig?.removeEventListener("abort", onAbort); if (!ended) rec.productStopped = true; }
          })();
        },
      },
    }),
    claraBusyStatus: () => null, CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.", ANTHROPIC_TIMEOUT_MS: 90_000, ANTHROPIC_MAX_RETRIES: 1,
  },
});

// The snapshot predates "Ground chicken" in the catalog. In production the
// catalog lookup inserts a missing name; the read-only snapshot refuses it,
// which would make the kept-foods load fail and silently serve every dish as
// if nothing were marked. Give it a synthetic row so the real path runs.
for (const cat of INGREDIENT_CATALOG) for (const name of cat.items) {
  if (!ingByName.has(name.toLowerCase())) {
    snap.ingredients.push({ id: `sim_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, name, allergenGroups: [], groceryCategory: null });
    console.log(`sim: catalog name missing from the snapshot, added synthetically: ${name}`);
  }
}
const store = createClaraStore(snap);
(globalThis as any).prisma = store.client;

// ── scenarios ────────────────────────────────────────────────────────────────
type Meal = "breakfast" | "lunch" | "dinner" | "snack";
type Ask = { meal: Meal; wants?: string; label?: string; day: number;
  /** A day plan (dish_plan_today) instead of one dish; `meal` is ignored. */
  plan?: "normal" | "little_time";
  /** Dinner after the lunch of the same day: avoid = [that lunch's name]. */
  afterLunch?: number };
type LoggedMeal = { meal: Meal; name: string; calories: number; protein: number; carbs: number; fat: number; fiber: number; sodium: number };
type Scenario = {
  id: string; title: string; rules: RuleKey[]; atHome: string[];
  /** Onboarding answers (PUT /api/onboarding), for a starting picture. */
  eating?: Record<string, number>;
  /** Logged on each ask's day before the asks. */
  logged?: LoggedMeal[];
  /** "How Clara cooks" as stored on the person (Patient.claraRules): their switches and their own rules. */
  claraRules?: { switches?: Record<string, boolean>; mine?: { id: string; text: string; on: boolean }[] };
  /** No dishes: the Grocery list for this person on `groceryDay`, then again after "Got it" on the first food of each group. No model call. */
  grocery?: true;
  groceryDay?: number;
  /** After each served dish, run the ingredients check on it: the offers for every ingredient, one like-for-like exchange, one protein exchange and one "nothing similar" (piece B). */
  swaps?: true;
  /** Which swap tries to run (default all three). */
  swapKinds?: ("plain" | "protein" | "without")[];
  /** The protein exchange takes the first offer matching this (default the first offer). */
  proteinTo?: RegExp;
  /** Every served dish is logged on its day, as when the person cooks it (the product's own memory of the week). */
  cooks?: true;
  /** Logged on each of the four days before every ask's day (a week of logs). */
  week?: LoggedMeal[];
  /** The rule switches for this scenario only (dishRulesNow), restored after. */
  rules2?: Partial<typeof DEFAULT_DISH_RULES>;
  /** Pick the day so the rotation alone would choose this protein (scenario I). */
  rotationPicks?: string;
  asks: Ask[];
};
const MARKS = ["Salmon fillets", "Ground beef", "Spinach", "Jasmine rice", "Large eggs"];
const rep = (n: number, a: Omit<Ask, "day">, day: (k: number) => number): Ask[] => Array.from({ length: n }, (_, k) => ({ ...a, day: day(k) }));
const SCENARIOS: Scenario[] = [
  { id: "A", title: "at home: salmon + ground beef, 7 days of lunch then dinner", rules: [], atHome: MARKS,
    asks: Array.from({ length: 7 }, (_, d) => [
      { meal: "lunch" as const, day: 9 + d },
      { meal: "dinner" as const, day: 9 + d, afterLunch: 2 * d + 1 },
    ]).flat() },
  { id: "B", title: "MARKS: breakfasts and a snack", rules: [], atHome: MARKS,
    asks: [...rep(2, { meal: "breakfast" }, (k) => 3 + k), ...rep(1, { meal: "snack" }, () => 5)] },
  { id: "C", title: "MARKS + requests", rules: [], atHome: MARKS,
    asks: [...rep(2, { meal: "dinner", wants: "a chicken dish", label: "chicken" }, (k) => 17 + k),
      ...rep(2, { meal: "dinner", wants: "a stir-fry", label: "stir-fry" }, (k) => 19 + k),
      ...rep(1, { meal: "dinner", label: "dinner" }, () => 21)] },
  { id: "D", title: "control: nothing marked", rules: [], atHome: [], asks: rep(3, { meal: "dinner" }, (k) => 22 + k) },
  { id: "E", title: "nothing marked; answers say little iron and potassium", rules: [], atHome: [],
    eating: { veg: 1, fruit: 1, beans: 0, grains: 2, fish: 2, meat: 1, dairy: 2, packaged: 0, sweet: 0 },
    asks: rep(3, { meal: "dinner" }, (k) => 23 + k) },
  { id: "F", title: "nothing marked; today's log already has 2000 mg sodium", rules: [], atHome: [],
    logged: [{ meal: "lunch", name: "Salted Ramen Bowl", calories: 650, protein: 22, carbs: 80, fat: 24, fiber: 4, sodium: 2000 }],
    asks: rep(2, { meal: "dinner" }, () => 24) },
  { id: "G", title: "nothing marked, vegan; protein rule off", rules: ["diet:Vegan"], atHome: [],
    rules2: { mainsOnProtein: false, onlyHomeProteins: false }, asks: rep(2, { meal: "dinner" }, (k) => 25 + k) },
  { id: "H", title: "fish allergy; at home salmon + ground beef", rules: ["allergy:Fish"], atHome: ["Salmon fillets", "Ground beef"],
    asks: rep(2, { meal: "dinner" }, (k) => 26 + k) },
  { id: "I", title: "MARKS; today's log has Beef and Rice Skillet; rotation alone would pick salmon", rules: [], atHome: MARKS,
    logged: [{ meal: "lunch", name: "Beef and Rice Skillet", calories: 620, protein: 38, carbs: 60, fat: 22, fiber: 3, sodium: 700 }],
    rotationPicks: "salmon", asks: rep(2, { meal: "dinner" }, () => 0) },
];
// Round 2 (2026-11-22): protein as a need of the day, weekly limits, day plans, a group-only allergy.
const wk3 = (name: string, protein: number, sodium: number): LoggedMeal[] => (["breakfast", "lunch", "dinner"] as const).map((meal) =>
  ({ meal, name: `${name} ${meal}`, calories: 600, protein, carbs: 70, fat: 18, fiber: 9, sodium }));
SCENARIOS.push(
  { id: "J", title: "MARKS: a day plan, three days", rules: [], atHome: MARKS,
    asks: [9, 10, 11].map((day) => ({ meal: "dinner" as const, plan: "normal" as const, day })) },
  { id: "K", title: "MARKS: a day plan with little time", rules: [], atHome: MARKS,
    asks: [{ meal: "dinner", plan: "little_time", day: 12 }] },
  { id: "L", title: "fish + tree nut allergy; answers say little omega-3", rules: ["allergy:Fish", "allergy:Tree nuts"], atHome: [],
    eating: { veg: 2, fruit: 2, beans: 2, grains: 2, fish: 0, meat: 1, dairy: 2, packaged: 0, sweet: 0 },
    asks: rep(2, { meal: "dinner" }, (k) => 13 + k) },
  { id: "M", title: "MARKS; a week of logs with protein on track", rules: [], atHome: MARKS, week: wk3("Logged", 45, 500),
    asks: [{ meal: "lunch", day: 15 }, { meal: "dinner", day: 15 }, { meal: "dinner", day: 21 }] },
  { id: "N", title: "eggs the only protein at home", rules: [], atHome: ["Large eggs", "Spinach", "Jasmine rice", "Russet potatoes"],
    asks: rep(3, { meal: "dinner" }, (k) => 17 + k) },
  { id: "O", title: "nothing marked; a salty week (3,000 mg a day)", rules: [], atHome: [], week: wk3("Salty", 30, 1000),
    asks: rep(2, { meal: "dinner" }, (k) => 20 + 6 * k) },
  { id: "Q", title: "MARKS + potatoes: five days of lunch and dinner, each dish cooked and logged", rules: [], atHome: [...MARKS, "Russet potatoes"], cooks: true,
    asks: Array.from({ length: 5 }, (_, d) => [{ meal: "lunch" as const, day: 3 + d }, { meal: "dinner" as const, day: 3 + d }]).flat() },
  // Round A3 (2026-11-22): with protein on track, one lunch in two goes without meat, fish or eggs.
  { id: "T", title: "MARKS + potatoes, lentils, feta; protein on track; four lunches", rules: [], atHome: [...MARKS, "Russet potatoes", "Green lentils", "Feta cheese"], week: wk3("Logged", 45, 500),
    asks: [15, 18, 21, 24].map((day) => ({ meal: "lunch" as const, day })) },
  // Piece D (2026-11-22): the person's own rules and switches reach the dishes.
  { id: "Y", title: "MARKS + potatoes, kale; own rules: no spinach, dinners under 25 minutes (one switched off); variety off", rules: [],
    atHome: [...MARKS, "Russet potatoes", "Kale"],
    claraRules: { switches: { keepWeekVaried: false }, mine: [
      { id: "r1", text: "Never put spinach in my dishes", on: true },
      { id: "r2", text: "Keep dinners under 25 minutes", on: true },
      { id: "r3", text: "No rice", on: false },
    ] },
    asks: rep(3, { meal: "dinner" }, (k) => 9 + k) },
  // Grocery list (2026-11-22): chosen in code, no model call.
  { id: "U", title: "grocery: eggs, spinach, rice at home; answers poor in everything", rules: [], grocery: true, groceryDay: 12,
    atHome: ["Large eggs", "Spinach", "Jasmine rice"], eating: { veg: 0, fruit: 0, beans: 0, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 2, sweet: 2 }, asks: [] },
  { id: "V", title: "grocery: MARKS; a week of logs with little fibre and little protein", rules: [], grocery: true, groceryDay: 12, atHome: MARKS,
    week: (["breakfast", "lunch", "dinner"] as const).map((meal) => ({ meal, name: `Plain ${meal}`, calories: 650, protein: 12, carbs: 90, fat: 22, fiber: 2, sodium: 500 })), asks: [] },
  { id: "W", title: "grocery: fish + dairy allergy, vegan; nothing at home; answers poor", rules: ["allergy:Fish", "allergy:Dairy", "diet:Vegan"], grocery: true, groceryDay: 12,
    atHome: [], eating: { veg: 0, fruit: 0, beans: 0, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 2, sweet: 2 }, asks: [] },
  { id: "X", title: "grocery: a full kitchen; answers fine", rules: [], grocery: true, groceryDay: 12,
    atHome: [...MARKS, "Russet potatoes", "Kale", "Mushrooms", "Rolled oats", "Green lentils", "Walnuts", "Plain Greek yogurt", "Brown rice", "Bananas"],
    eating: { veg: 2, fruit: 2, beans: 2, grains: 2, fish: 2, meat: 1, dairy: 2, packaged: 0, sweet: 0 }, asks: [] },
  // Round B (2026-11-22): the ingredients check before cooking.
  { id: "R", title: "swaps: MARKS + kale, potatoes, mushrooms at home", rules: [], swaps: true,
    atHome: [...MARKS, "Russet potatoes", "Kale", "Mushrooms"], asks: [{ meal: "dinner", day: 9 }, { meal: "lunch", day: 10 }] },
  { id: "S", title: "swaps: fish + dairy allergy; ground beef, spinach, rice at home", rules: ["allergy:Fish", "allergy:Dairy"], swaps: true,
    atHome: ["Ground beef", "Spinach", "Jasmine rice"], asks: [{ meal: "dinner", day: 9 }] },
  // Round 56de444 (2026-11-23): mains sized nearer their target; time rules checked by the app; dry pulses need time.
  { id: "Z1", title: "size: MARKS + potatoes, three days of lunch and dinner, each dish cooked and logged", rules: [], atHome: [...MARKS, "Russet potatoes"], cooks: true,
    asks: Array.from({ length: 3 }, (_, d) => [{ meal: "lunch" as const, day: 3 + d }, { meal: "dinner" as const, day: 3 + d }]).flat() },
  { id: "Z2", title: "time: own rules 'Dinners under 25 minutes' + 'No cooking over 30 minutes on weekdays'", rules: [],
    atHome: [...MARKS, "Russet potatoes"],
    claraRules: { mine: [
      { id: "t1", text: "Dinners under 25 minutes", on: true },
      { id: "t2", text: "No cooking over 30 minutes on weekdays", on: true },
    ] },
    // 2026-11-24 Tuesday, 2026-11-28 Saturday, 2026-11-29 Sunday.
    asks: [{ meal: "dinner", day: 24 }, { meal: "lunch", day: 24 }, { meal: "lunch", day: 28 }, { meal: "dinner", day: 29 }] },
  { id: "Z3", title: "pulses: ground beef + salmon at home; the protein swapped for beans / lentils", rules: [], swaps: true, swapKinds: ["protein"],
    atHome: ["Ground beef", "Salmon fillets", "Spinach", "Jasmine rice"], proteinTo: /\bbeans?\b/i,
    asks: [{ meal: "dinner", wants: "a quick 15-minute ground beef skillet", label: "quick beef", day: 10 }, { meal: "lunch", day: 11 }] },
  { id: "Z4", title: "pulses: ground beef at home; a quick dinner's protein swapped for lentils", rules: [], swaps: true, swapKinds: ["protein"],
    atHome: ["Ground beef", "Spinach", "Jasmine rice"], proteinTo: /\blentils?\b/i,
    asks: [{ meal: "dinner", wants: "a quick ground beef stir-fry", label: "quick beef", day: 12 }] },
);
const PLANNED_CALLS = SCENARIOS.reduce((n, s) => n + s.asks.reduce((m, a) => m + (a.plan ? 4 : s.swaps ? 4 : 1), 0), 0);
const dayStr = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

const done = new Map<string, any>(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return [`${r.scenario}|${r.n}`, r] as const; }) : []);
const only = process.env.SIM_ONLY?.split("|").map((x) => x.trim());

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const onboarding = await import("@/app/api/onboarding/route");
  const dishMod: any = await import("@/lib/clara/skills/dish");
  const keptDb = await import("@/lib/clara/kept-foods-db");
  const { loadBrainRows } = await import("@/lib/clara/dish-brain-db");
  const { brainFrom, steerForAsk, NO_BRAIN_ROWS } = await import("@/lib/clara/dish-brain");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");
  const { dailySodiumLimitMg } = await import("@/lib/sodium-limit");
  const { PATIENT_FOOD_MAP_INCLUDE } = await import("@/lib/food-map");

  // ── the sim's own checks on a served card (independent of the judge) ────────
  const { foodMatches } = await import("@/lib/clara/kept-foods");
  const { builtOn, proteinKind } = await import("@/lib/clara/dish-protein");
  const { chooseProtein, sameProteinKind } = await import("@/lib/clara/protein-rule");
  const { sizeProblem, proteinShareLow } = await import("@/lib/clara/meal-target");
  const { RICH_FOODS } = await import("@/lib/clara/level-steer");
  const judgeMod = await import("@/lib/clara/dish-judge");
  const catalogMod = await import("@/lib/ingredient-catalog");
  const groceryMod = await import("@/lib/clara/grocery");
  const levelNames = new Map<string, string>((await import("@/lib/level-catalogue")).LEVELS.map((l: any) => [l.key, l.name]));
  const { DishItemExtractor } = await import("@/lib/clara/dish-output");
  const { priceDish } = await import("@/lib/staple-density");
  const FISH = /\b(salmon|tuna|cod|haddock|tilapia|trout|mackerel|sardines?|anchov(y|ies)|halibut|bass|snapper|pollock|catfish|swordfish|fish)\b/i;
  /** Proteins on the card that are not at home: a meat/fish/seafood ingredient, or the protein the dish is built on. */
  function proteinsNotAtHome(ings: readonly DishIngredient[], steps: readonly string[], homeKeys: readonly string[]): string[] {
    const out = new Set<string>();
    for (const i of ings) { const k = proteinKind(i.name); if (k && k.cls === "meat" && !homeKeys.includes(k.key)) out.add(k.key); }
    const b = builtOn(ings, steps);
    if (b && !homeKeys.includes(b.key)) out.add(b.key);
    return [...out];
  }
  const richIn = (level: "iron" | "potassium", names: readonly string[]) =>
    RICH_FOODS[level].split(", ").filter((f) => names.some((n) => foodMatches(f, n)));



  // What the product hands its generator and what the judge said, per request (diagnostics only).
  let traces: { ms: number; name: string; stage: string; reasons?: string[] }[] = [];
  let verdicts: { id: string; name: string; source: "generated" | "library"; level: string; reasons: string[]; builtOn: string | null; onTodaysProtein: boolean }[] = [];
  let seenAsk: any = null;
  const keepVerdict = (source: "generated" | "library") => (j: any) =>
    verdicts.push({ id: j.recipe.id, name: j.recipe.name, source, level: j.verdict.level, reasons: j.verdict.reasons, builtOn: j.verdict.builtOn, onTodaysProtein: !!j.onTodaysProtein });
  const live = dishMod.liveDishDeps;
  const handlers = dishMod.makeDishHandlers({
    ...live,
    get budgetMs() { return live.budgetMs; },
    generate: (c: any, a: any, o: any = {}) => {
      seenAsk = a;
      return live.generate(c, a, { ...o, trace: (e: any) => traces.push(e), judged: (j: any) => { keepVerdict("generated")(j); o.judged?.(j); } });
    },
    library: (c: any, a: any, sig: any, judged: any) => live.library(c, a, sig, (j: any) => { keepVerdict("library")(j); judged?.(j); }),
  });
  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const ids = (kind: any, prefix: string, rules: RuleKey[]) => rules.filter((k) => k.startsWith(prefix)).map((k) => store.ref(kind, k.slice(prefix.length)).id);
  const idOf = (name: string) => { const i = snap.ingredients.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!i) throw new Error(`no ingredient ${name}`); return i.id; };

  /** The brain exactly as personFor builds it (same reads, same switches), with the read warnings it logged. */
  const brainOf = async (pid: string, today: string) => {
    const warns: string[] = [];
    const w = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
    try {
      const patient = await (globalThis as any).prisma.patient.findFirst({ where: { id: pid }, include: PATIENT_FOOD_MAP_INCLUDE });
      const matchers = buildDietMatchers(derivePatientBans(patient, new Date(`${today}T12:00:00`)));
      const kept = await keptDb.keptFoodsFrom(await keptDb.loadKeptMarks(pid), matchers);
      const rows = await loadBrainRows(pid, today);
      const sodiumLimitMg = dailySodiumLimitMg(patient.healthConditions.map((h: any) => h.condition.name));
      const brain = brainFrom({ kept, rules: dishMod.dishRulesNow.rules, rows, today, patient, matchers, sodiumLimitMg });
      return { brain, rows, warns };
    } finally { console.warn = w; }
  };

  let pi = 0;
  for (const s of SCENARIOS) {
    pi++;
    if (only && !only.includes(s.id)) continue;
    if (s.grocery ? done.has(`${s.id}|1`) : s.asks.every((_, n) => done.has(`${s.id}|${n + 1}`))) continue;
    const clerkId = `clerk_brain_${s.id}`;
    store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
    state.patient = { account: { clerkId } } as any;
    const pr = await profile.PATCH(req("PATCH", {
      firstName: "Sim", lastName: "Brain", birthday: "1988-03-14", sexAtBirth: pi % 2 ? "FEMALE" : "MALE", height: 168, heightUnit: "cm", weight: 150,
      physicalActivityId: snap.physicalActivities[1].id,
      healthConditionIds: ids("healthCondition", "condition:", s.rules), foodAllergyIds: ids("foodAllergy", "allergy:", s.rules),
      foodPreferenceIds: ids("foodPreference", "diet:", s.rules), foodToAvoidIds: ids("foodToAvoid", "avoid:", s.rules), motivationIds: [],
    }) as any);
    if (pr.status !== 200) throw new Error(`${s.id}: profile ${pr.status} ${JSON.stringify(await pr.json())}`);
    const accountId = store.tables.account.find((a: any) => a.clerkId === clerkId).id;
    const pid = store.tables.patient.find((x: any) => x.accountId === accountId).id;
    for (const n of s.atHome) await store.client.patientPantryItem.create({ data: { patientId: pid, ingredientId: idOf(n) } });
    if (s.claraRules) store.tables.patient.find((x: any) => x.id === pid).claraRules = s.claraRules;
    if (s.eating) {
      const or = await onboarding.PUT(req("PUT", { usualEating: s.eating, pills: [] }) as any);
      if (or.status !== 200) throw new Error(`${s.id}: onboarding ${or.status} ${JSON.stringify(await or.json())}`);
    }
    // Scenario I: the day on which the rotation alone (nothing used today) picks the wanted protein.
    if (s.rotationPicks) {
      const { brain } = await brainOf(pid, dayStr(1));
      const home: HomeProtein[] = brain.home;
      const day = Array.from({ length: 28 }, (_, k) => k + 1).find((d) =>
        chooseProtein({ mealType: "dinner", home, usedToday: [], patientId: pid, today: dayStr(d), rules: brain.rules })?.key === s.rotationPicks);
      if (!day) throw new Error(`${s.id}: no day in November on which the rotation picks ${s.rotationPicks}`);
      for (const a of s.asks) a.day = day;
      console.log(`   ${s.id}: the rotation alone picks ${s.rotationPicks} on ${dayStr(day)}`);
    }
    for (const day of [...new Set(s.asks.map((a) => a.day))]) {
      for (const m of s.logged ?? []) {
        await store.client.mealLog.create({ data: { patientId: pid, localDate: dayStr(day), mealType: m.meal, source: "MANUAL", name: m.name,
          calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber, sodium: m.sodium } });
      }
    }
    for (const day of [...new Set([...s.asks.map((a) => a.day), ...(s.groceryDay ? [s.groceryDay] : [])])]) {
      for (let back = 1; back <= 4 && s.week; back++) {
        if (store.tables.mealLog?.some((r: any) => r.patientId === pid && r.localDate === dayStr(day - back))) continue;
        for (const m of s.week) {
          await store.client.mealLog.create({ data: { patientId: pid, localDate: dayStr(day - back), mealType: m.meal, source: "MANUAL", name: m.name,
            calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber, sodium: m.sodium } });
        }
      }
    }
    if (s.grocery) {
      const today = dayStr(s.groceryDay ?? 12);
      const oracle = makeOracle(makePatient(snap, { id: `brain-${s.id}`, tier: "curated", rules: s.rules }) as any, s.rules);
      const judge = (groups: any[]) => {
        const items = groups.flatMap((g: any) => g.items.map((i: any) => ({ name: i.name, allergenGroups: ingByName.get(i.name.toLowerCase())?.allergenGroups ?? [] })));
        return oracle.judgeMany(items).map((v, j) => ({ v, n: items[j].name })).filter(({ v }) => v.engine.length || v.groups.length).map((b) => b.n);
      };
      const first = await dishMod.groceryListFor(pid, today);
      const { brain } = await brainOf(pid, today);
      const before = first?.groups ?? [];
      // "Got it" on the first food of every group, as the route's POST does.
      const bought = before.map((g: any) => g.items[0]).filter(Boolean);
      for (const b of bought) await store.client.patientPantryItem.create({ data: { patientId: pid, ingredientId: b.id } });
      const after = (await dishMod.groceryListFor(pid, today))?.groups ?? [];
      const row = {
        scenario: s.id, n: 1, title: s.title, meal: "grocery", today, dry: DRY, ok: true, ladder: "grocery", steer: [], oracle: judge(before).length ? `VIOLATION: ${judge(before).join(", ")}` : "pass",
        atHome: s.atHome, rules: s.rules,
        week: brain.week.filter((r: any) => r.word).map((r: any) => `${r.key}:${r.word}${r.wordTarget !== undefined ? ` (of ${r.wordTarget})` : ""}`),
        picture: brain.picture, before, bought: bought.map((b: any) => b.name), after,
      };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      done.set(`${s.id}|1`, row);
      console.log(`\n── ${s.id}: ${s.title}\n   at home [${s.atHome.join(", ")}] · week [${row.week.join(", ")}] · answers little [${brain.picture?.little.join(", ") ?? "-"}]` +
        before.map((g: any) => `\n   ${g.title} — ${g.reason}${g.also?.length ? ` Also covers ${g.also.map((x: any) => `${x.level} (${x.food})`).join(", ")}.` : ""}\n      ${g.items.map((i: any) => `${i.name}${i.favorite ? "♥" : ""}`).join(", ") || "(no foods)"}${g.note ? `\n      note: ${g.note}` : ""}`).join("") +
        `\n   after Got it on [${row.bought.join(", ")}]: ${after.map((g: any) => `${g.title} (${g.items.length})`).join("; ") || "nothing to buy"} · diet: ${row.oracle}`);
      continue;
    }
    const saved = { ...dishMod.dishRulesNow.rules };
    if (s.rules2) dishMod.dishRulesNow.rules = { ...DEFAULT_DISH_RULES, ...s.rules2 };
    try {
      // What the product sees for this person (its own reads, not the sim's expectation).
      const first = await brainOf(pid, dayStr(s.asks[0].day));
      const b0 = first.brain;
      console.log(`\n── ${s.id}: ${s.title}\n   product sees (${dayStr(s.asks[0].day)}): day calories ${b0.dayCalories ?? "NULL"}, home proteins [${b0.home.map((h: HomeProtein) => `${h.key}/${h.cls}`).join(", ")}], ` +
        `today ${b0.today ? `${b0.today.meals} meal(s) ${Math.round(b0.today.calories)} kcal sodium ${b0.today.sodium ?? "?"} mg` : "nothing logged"}, ` +
        `picture ${b0.picture ? `little [${b0.picture.little.join(", ")}] a lot [${b0.picture.aLot.join(", ")}]` : "none"}, used today [${b0.usedToday.join("; ")}], ` +
        `rules off [${Object.entries(b0.rules).filter(([, v]) => !v).map(([k]) => k).join(", ")}]` +
        (first.warns.length ? `\n   !! read warnings: ${first.warns.join(" | ")}` : ""));
      const oracle = makeOracle(makePatient(snap, { id: `brain-${s.id}`, tier: "curated", rules: s.rules }) as any, s.rules);

      for (const [k, ask] of s.asks.entries()) {
        const n = k + 1;
        if (done.has(`${s.id}|${n}`)) continue;
        const today = dayStr(ask.day);
        const lunchRow = ask.afterLunch ? done.get(`${s.id}|${ask.afterLunch}`) : null;
        const avoid: string[] = lunchRow?.dishName ? [lunchRow.dishName] : [];
        const notes: string[] = [];
        if (ask.afterLunch && !lunchRow?.dishName) notes.push("the same day's lunch has no dish: no avoid list");
        const pre = await brainOf(pid, today);
        const brain = pre.brain;
        for (const w of pre.warns) notes.push(`read: ${w}`);
        if (brain.dayCalories == null) notes.push("fixture gap: no day calorie target (calorie profile incomplete?): size not steered");
        if ((s.logged?.length ?? 0) > 0 && !brain.today) notes.push("fixture gap: today's seeded log not seen by the week read");
        if (s.eating && !brain.picture) notes.push("fixture gap: onboarding answers not seen (no picture)");

        const ctx = { patientId: pid, accountId, firstName: "Sim", isPremium: false, today, surface: "ios", disabledSkills: [] };
        if (ask.plan) {
          const before = calls.length;
          const warns: string[] = [];
          const quiet = { warn: console.warn, info: console.info };
          const t0 = Date.now();
          let res: any; let thrown: string | null = null;
          try {
            console.info = () => {};
            console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
            res = await handlers.planToday(ctx, { occasion: ask.plan });
          } catch (e) { thrown = (e as Error).message; }
          finally { Object.assign(console, quiet); }
          const latencyMs = Date.now() - t0;
          const mine = calls.slice(before);
          await Promise.race([Promise.all(mine.map((c) => c.fullRead ?? Promise.resolve())), new Promise((r) => setTimeout(r, 65_000).unref?.())]);
          const homeKeys: string[] = brain.home.map((h: HomeProtein) => h.key);
          const dishes = (res?.ok ? res.data.dishes : []).map((dm: any) => {
            const part = (res.parts ?? []).find((x: any) => x.kind === "dish" && x.dishId === dm.dishId);
            const ings: DishIngredient[] = part?.recipe?.ingredients?.map((x: any) => ({ name: String(x.name), quantity: x.quantity ?? null, unit: x.unit ?? "" })) ?? [];
            const steps: string[] = part?.recipe?.steps ?? [];
            const st = steerForAsk(brain, { mealType: dm.mealType, summary: { little: [], aLot: [] } }, { patientId: pid, today });
            const items = ings.map((i) => ({ name: i.name, allergenGroups: ingByName.get(i.name.toLowerCase())?.allergenGroups ?? [] }));
            const bad = oracle.judgeMany(items).map((v, j) => ({ v, n: items[j].name })).filter(({ v }) => v.engine.length || v.groups.length);
            return {
              meal: dm.mealType, name: part?.name ?? dm.name, source: dm.source, minutes: part?.minutes ?? null, calories: part?.calories ?? null,
              targetCalories: st.target.calories, sizeProblem: part ? sizeProblem(dm.mealType, part.calories, st.target.calories) : null,
              builtOn: builtOn(ings, steps)?.key ?? null, proteinsNotAtHome: proteinsNotAtHome(ings, steps, homeKeys),
              sodium: part?.recipe?.perServing?.sodium ?? null, sodiumCeiling: st.ceilings.sodium ?? null,
              oracle: bad.length ? `VIOLATION: ${bad.map((b) => b.n).join(", ")}` : "pass", ingredients: ings.map((i) => i.name),
            };
          });
          const row = {
            scenario: s.id, n, title: s.title, meal: "plan", plan: ask.plan, today, dry: DRY,
            ok: dishes.length > 0, failure: dishes.length ? null : (thrown ?? res?.message ?? "no dish"),
            dishName: dishes.map((x: any) => x.name).join(" / ") || null, dishes,
            couldNotFill: res?.data?.couldNotFill ?? [], ladder: "plan", steer: [], oracle: dishes.every((x: any) => x.oracle === "pass") ? "pass" : dishes.map((x: any) => x.oracle).join("; "),
            prompts: mine.map((c) => c.system), latencyMs, modelCalls: mine.length, notes,
            warnings: warns.filter((w) => w.includes("[clara-dish]")),
          };
          appendFileSync(OUT, JSON.stringify(row) + "\n");
          done.set(`${s.id}|${n}`, row);
          console.log(`${s.id}#${n} ${today} PLAN (${ask.plan}): ` + (dishes.length ? dishes.map((x: any) => `${x.meal}: "${x.name}" on ${x.builtOn ?? "nothing"} · ${x.calories} kcal/${x.targetCalories ?? "-"} · ${x.minutes} min · sodium ${x.sodium ?? "?"}/${Math.round(x.sodiumCeiling ?? 0)} · ${x.source}`).join("\n     ") : `NO DISH (${row.failure})`) +
            `\n     could not fill [${row.couldNotFill.join(", ")}] · ${latencyMs} ms · ${mine.length} call(s)` + (row.warnings.length ? `\n     warnings: ${row.warnings.join(" | ")}` : ""));
          continue;
        }
        const input: Record<string, unknown> = { mealType: ask.meal, ...(ask.wants ? { wants: ask.wants } : {}), ...(avoid.length ? { avoid } : {}) };
        const before = calls.length;
        traces = []; verdicts = []; seenAsk = null;
        const warns: string[] = [];
        const quiet = { warn: console.warn, info: console.info, log: console.log };
        const t0 = Date.now();
        let res: any;
        let thrown: string | null = null;
        try {
          console.info = () => {};
          console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
          res = await handlers.suggest(ctx, input);
        } catch (e) { thrown = (e as Error).message; }
        finally { Object.assign(console, quiet); }
        const latencyMs = Date.now() - t0;
        const mine = calls.slice(before);
        // The rest of the model's answer (READ_ALL), so every candidate is on the row.
        await Promise.race([Promise.all(mine.map((c) => c.fullRead ?? Promise.resolve())), new Promise((r) => setTimeout(r, 65_000).unref?.())]);

        // The steer the product computed for this ask (the ask it handed the generator).
        const askForSteer = seenAsk ?? { mealType: ask.meal, ...(ask.wants ? { wants: ask.wants } : {}), ...(avoid.length ? { avoid } : {}), summary: { little: [], aLot: [] } };
        if (!seenAsk) notes.push("the generator was not called: steer computed from an empty level summary");
        const steer = steerForAsk(brain, askForSteer, { patientId: pid, today });
        const steerKeys = steer.levels.map((l: any) => `${l.key}:${l.direction}:${l.why}`);

        const d = res?.ok ? res.data.dish : null;
        const part = d ? (res.parts ?? []).find((x: any) => x.kind === "dish" && x.dishId === d.dishId) : null;
        const recipe = part?.recipe ?? null;
        const ings: DishIngredient[] = recipe?.ingredients?.map((x: any) => ({ name: String(x.name), quantity: x.quantity ?? null, unit: x.unit ?? "" })) ?? [];
        const steps: string[] = recipe?.steps ?? [];
        const names = ings.map((i) => i.name);
        const homeKeys: string[] = brain.home.map((h: HomeProtein) => h.key);
        const built = d ? builtOn(ings, steps) : null;
        const calories: number | null = part?.calories ?? null;
        const proteinG: number | null = recipe?.perServing?.protein ?? null;
        const verdict = d ? verdicts.find((v) => v.id === d.dishId) ?? null : null;
        const ladder = !d ? "none" : d.source === "library" ? "stored recipe" : verdict ? verdict.level : "generated (no verdict seen)";
        let oracleVerdict: string | null = null;
        if (d) {
          const items = names.map((name) => ({ name, allergenGroups: ingByName.get(name.toLowerCase())?.allergenGroups ?? [] }));
          const bad = oracle.judgeMany(items).map((v, j) => ({ v, n: items[j].name })).filter(({ v }) => v.engine.length || v.groups.length);
          oracleVerdict = bad.length ? `VIOLATION: ${bad.map((b) => b.n).join(", ")}` : "pass";
        }

        // Every candidate the model wrote, and where each one ended in the product.
        const text = mine.map((c) => c.text).join("");
        const items = new DishItemExtractor().push(text) as any[];
        const productStopped = mine.some((c) => c.productStopped);
        const candidates = items.map((it, i) => {
          const cIngs: DishIngredient[] = (it?.ingredients ?? []).map((x: any) => ({ name: String(x?.name ?? ""), quantity: typeof x?.quantity === "number" ? x.quantity : null, unit: String(x?.unit ?? "") }));
          const cSteps: string[] = Array.isArray(it?.steps) ? it.steps.map(String) : [];
          const t = traces[i];
          const v = t ? verdicts.find((x) => x.source === "generated" && x.name === t.name) : undefined;
          const priced = priceDish(cIngs, cSteps);
          const cal = priced?.calories ?? it?.perServing?.calories ?? null;
          const prot = priced?.protein ?? it?.perServing?.protein ?? null;
          return {
            name: String(it?.name ?? "?"),
            product: t ? t.stage : productStopped ? "not read (the product stopped reading: a dish was accepted or the deadline passed)" : "not reached",
            productName: t?.name ?? null,
            served: !!(d && t && t.name === d.name && d.source !== "library"),
            judge: v ? { level: v.level, reasons: v.reasons, builtOn: v.builtOn, onTodaysProtein: v.onTodaysProtein } : t?.reasons ? { level: "fail", reasons: t.reasons, builtOn: null, onTodaysProtein: false } : null,
            // The sim's own estimate from the raw candidate (the judge's reasons for a failed candidate are not observable).
            est: {
              builtOn: builtOn(cIngs, cSteps)?.key ?? null,
              proteinsNotAtHome: ask.wants ? [] : proteinsNotAtHome(cIngs, cSteps, homeKeys),
              calories: cal == null ? null : Math.round(cal), declaredCalories: it?.perServing?.calories ?? null,
              sizeProblem: cal == null ? null : sizeProblem(ask.meal, cal, steer.target.calories),
              proteinShare: cal && prot != null ? Math.round((prot * 400) / cal) / 100 : null,
            },
            ingredients: cIngs.map((x) => x.name),
          };
        });
        if (!DRY && mine.length && items.length < 3 && !mine.some((c) => c.error)) notes.push(`the model's answer held ${items.length} candidate(s), not 3${READ_ALL ? "" : " (SIM_READ_ALL=0: the rest was not read)"}`);

        const sodium: number | null = recipe?.perServing?.sodium ?? null;
        const sodiumCeiling: number | null = steer.ceilings.sodium ?? null;
        const row = {
          scenario: s.id, n, title: s.title, meal: ask.meal, request: ask.wants ?? null, label: ask.label ?? null, today, avoid, dry: DRY,
          ok: !!d, failure: d ? null : (thrown ?? res?.message ?? res?.reason ?? "no dish"),
          dishName: d?.name ?? null, source: d ? (d.source === "library" ? "library" : "generated") : null,
          ladder, judgeLevel: verdict?.level ?? null, judgeReasons: verdict?.reasons ?? null, judgeBuiltOn: verdict?.builtOn ?? null,
          builtOn: built?.key ?? null, builtOnName: built?.name ?? null,
          chosen: steer.choice, ruleOn: steer.ruleOn, homeProteins: homeKeys,
          targetCalories: steer.target.calories, band: steer.target.band, calories, proteinG,
          proteinShare: calories && proteinG != null ? Math.round((proteinG * 400) / calories) / 100 : null,
          sizeProblem: d && calories != null ? sizeProblem(ask.meal, calories, steer.target.calories) : null,
          proteinShareLow: d && calories != null && proteinG != null ? proteinShareLow(ask.meal, calories, proteinG) : null,
          hasFromHomeKey: !!part && Object.prototype.hasOwnProperty.call(part, "fromHome"), fromHome: part?.fromHome ?? null,
          steer: steerKeys, sodium, sodiumCeiling,
          proteinsNotAtHome: d ? proteinsNotAtHome(ings, steps, homeKeys) : [],
          proteinKinds: [...new Set(names.map((x) => proteinKind(x)?.key).filter(Boolean))],
          fish: names.filter((x) => FISH.test(x)),
          richIron: richIn("iron", names), richPotassium: richIn("potassium", names),
          oracle: oracleVerdict, ingredients: names, minutes: part?.minutes ?? null, steps,
          prompts: mine.map((c) => c.system), need: steer.need,
          candidates, notes,
          latencyMs, modelCalls: mine.length,
          calls: mine.map((c) => ({ model: c.model, ms: c.ms, inTokens: c.inTokens, outTokens: c.outTokens, stop: c.stop, aborted: c.aborted, productStopped: c.productStopped, error: c.error ?? null })),
          warnings: warns.filter((w) => w.includes("[clara-dish]")),
        };
        if (s.swaps && d && recipe) {
          // The ingredients check on the dish just served, through the product's own handlers.
          const swapH = dishMod.makeSwapHandlers(live);
          const offers: Record<string, any> = {};
          for (const i of ings) {
            const o = await swapH.options({ ...ctx }, { recipe, ingredient: i.name });
            offers[i.name] = o.ok ? { protein: o.protein, options: o.options } : { error: o.message };
          }
          const { plainSwap } = await import("@/lib/clara/exchange");
          const firstWith = (pred: (name: string, o: any) => boolean) => ings.map((i) => i.name).find((nm) => offers[nm]?.options?.length > 0 && pred(nm, offers[nm]));
          const plainOf = firstWith((nm, o) => !o.protein && plainSwap(nm, o.options[0].name));
          const proteinOf = firstWith((_nm, o) => o.protein && (!s.proteinTo || o.options.some((x: any) => s.proteinTo!.test(x.name))));
          const proteinTo = proteinOf ? (s.proteinTo ? offers[proteinOf].options.find((x: any) => s.proteinTo!.test(x.name)) : offers[proteinOf].options[0]).name : undefined;
          const starchOf = ings.map((i) => i.name).find((nm) => /rice|potato|pasta|quinoa/i.test(nm)) ?? ings[ings.length - 1]?.name;
          const tries: { kind: string; ingredient: string; replacement?: string; run: () => Promise<any> }[] = [];
          if (plainOf) tries.push({ kind: "plain", ingredient: plainOf, replacement: offers[plainOf].options[0].name, run: () => swapH.apply({ ...ctx }, { mealType: ask.meal, recipe, ingredient: plainOf, replacement: offers[plainOf].options[0].name }) });
          if (proteinOf) tries.push({ kind: "protein", ingredient: proteinOf, replacement: proteinTo, run: () => swapH.apply({ ...ctx }, { mealType: ask.meal, recipe, ingredient: proteinOf, replacement: proteinTo! }) });
          if (s.swapKinds) for (let i = tries.length - 1; i >= 0; i--) if (!s.swapKinds.includes(tries[i].kind as any)) tries.splice(i, 1);
          if (starchOf && (!s.swapKinds || s.swapKinds.includes("without"))) tries.push({ kind: "without", ingredient: starchOf, run: () => swapH.without({ ...ctx }, { mealType: ask.meal, recipe, ingredient: starchOf }) });
          const results: any[] = [];
          for (const t of tries) {
            const b4 = calls.length;
            const t1 = Date.now();
            let r: any; let err: string | null = null;
            const q = { warn: console.warn, info: console.info };
            try { console.info = () => {}; console.warn = () => {}; r = await t.run(); } catch (e) { err = (e as Error).message; } finally { Object.assign(console, q); }
            const cs = calls.slice(b4);
            await Promise.race([Promise.all(cs.map((c) => c.fullRead ?? Promise.resolve())), new Promise((x) => setTimeout(x, 65_000).unref?.())]);
            const rIngs: DishIngredient[] = r?.ok ? r.dish.recipe.ingredients.map((x: any) => ({ name: String(x.name), quantity: x.quantity ?? null, unit: x.unit ?? "" })) : [];
            const items2 = rIngs.map((i) => ({ name: i.name, allergenGroups: ingByName.get(i.name.toLowerCase())?.allergenGroups ?? [] }));
            const bad2 = oracle.judgeMany(items2).map((v, j) => ({ v, n: items2[j].name })).filter(({ v }) => v.engine.length || v.groups.length);
            results.push({
              kind: t.kind, ingredient: t.ingredient, replacement: t.replacement ?? null, ok: !!r?.ok, how: r?.how ?? null, error: err ?? (r?.ok ? null : r?.message ?? null),
              name: r?.ok ? r.dish.name : null, ingredients: rIngs.map((i) => i.name), steps: r?.ok ? r.dish.recipe.steps : [],
              calories: r?.ok ? r.dish.calories : null, perServing: r?.ok ? r.dish.recipe.perServing : null, minutes: r?.ok ? r.dish.minutes : null,
              // The exact food: its own name among the ingredients, or written out in a step ("brown rice" for "jasmine rice" shares only the word rice).
              stillHasIt: rIngs.some((i) => i.name.trim().toLowerCase() === t.ingredient.trim().toLowerCase()) || (r?.ok ? r.dish.recipe.steps.some((st: string) => st.toLowerCase().includes(t.ingredient.trim().toLowerCase())) : false),
              hasReplacement: t.replacement ? rIngs.some((i) => foodMatches(t.replacement!, i.name)) : null,
              // The head noun in either number ("potato", "potatoes"), in the name or a step, unless the replacement shares it.
              headLeft: (() => {
                if (!r?.ok) return false;
                const head = (x: string) => x.trim().toLowerCase().split(/\s+/).pop()!.replace(/(oes|es|s)$/, "");
                const h = head(t.ingredient);
                if (t.replacement && head(t.replacement) === h) return false;
                const re = new RegExp(`\\b${h}(s|es|oes)?\\b`, "i");
                return re.test(r.dish.name) || r.dish.recipe.steps.some((st: string) => re.test(st));
              })(),
              // Any word of the replacement's name, in either number ("Salmon fillets" is "the salmon" in a step).
              replacementInSteps: t.replacement && r?.ok ? r.dish.recipe.steps.some((st: string) => t.replacement!.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => st.toLowerCase().includes(w.replace(/(es|s)$/, "")))) : null,
              vsOriginal: r?.ok && calories ? Math.round((r.dish.calories / calories) * 100) / 100 : null,
              notAtHome: rIngs.map((i) => i.name).filter((nm) => !brain.kept.atHome.some((h: string) => foodMatches(h, nm)) && !brain.kept.proteinNames.some((h: string) => foodMatches(h, nm)) && !brain.basics.some((h: string) => foodMatches(h, nm)) && !/onion|garlic|lemon|lime|herb|parsley|cilantro|basil|water|salt|pepper/i.test(nm)),
              keptShare: r?.ok ? (() => { const others = names.filter((nm) => nm !== t.ingredient && !/salt|pepper|water/i.test(nm)); return others.length ? others.filter((nm) => rIngs.some((i) => foodMatches(nm, i.name))).length / others.length : 1; })() : null,
              sizeProblem: r?.ok ? sizeProblem(ask.meal, r.dish.calories, steer.target.calories) : null,
              amounts: rIngs.map((i) => `${i.quantity ?? ""} ${i.unit} ${i.name}`.replace(/\s+/g, " ").trim()),
              oracle: bad2.length ? `VIOLATION: ${bad2.map((b) => b.n).join(", ")}` : "pass",
              modelCalls: cs.length, latencyMs: Date.now() - t1, prompts: cs.map((c) => c.system),
            });
          }
          const srow = { scenario: s.id, n: n + 0.5, title: s.title, meal: "swap", today, dry: DRY, ok: true, of: d.name, original: { name: d.name, ingredients: names, amounts: ings.map((i) => `${i.quantity ?? ""} ${i.unit} ${i.name}`.replace(/\s+/g, " ").trim()), steps, calories }, offers, results, ladder: "swap", steer: [], oracle: results.every((x) => !x.ok || x.oracle === "pass") ? "pass" : results.map((x) => x.oracle).join("; ") };
          appendFileSync(OUT, JSON.stringify(srow) + "\n");
          done.set(`${s.id}|${n + 0.5}`, srow);
          console.log(`${s.id}#${n}+swaps on "${d.name}": offers ${Object.entries(offers).map(([k, v]: any) => `${k} → ${v.options ? v.options.map((o: any) => `${o.name}${o.atHome ? "*" : ""}`).join("/") || "none" : v.error}`).join("; ")}` +
            results.map((x) => `\n     ${x.kind} ${x.ingredient}${x.replacement ? ` → ${x.replacement}` : ""}: ${x.ok ? `[${x.how}] "${x.name}" · ${x.calories} kcal · ${x.modelCalls} call(s) · ${x.latencyMs} ms · ${x.oracle}${x.stillHasIt ? " · STILL HAS IT" : ""}${x.hasReplacement === false ? " · REPLACEMENT MISSING" : ""}` : `FAILED (${x.error})`}`).join(""));
        }
        if (s.cooks && d && recipe?.perServing) {
          const ps = recipe.perServing;
          await store.client.mealLog.create({ data: { patientId: pid, localDate: today, mealType: ask.meal, source: "MANUAL", name: d.name,
            calories: ps.calories, protein: ps.protein, carbs: ps.carbs, fat: ps.fat, fiber: ps.fibre ?? null, sodium: ps.sodium ?? null } });
        }
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        done.set(`${s.id}|${n}`, row);
        console.log(`${s.id}#${n} ${today} ${ask.meal}${ask.wants ? ` "${ask.wants}"` : ""}${avoid.length ? ` avoid=[${avoid.join(", ")}]` : ""}: ` +
          (d ? `[${ladder}${verdict?.reasons.length ? `: ${verdict.reasons.join(", ")}` : ""}] "${d.name}" on ${built?.key ?? "nothing"} · ${calories} kcal / target ${steer.target.calories ?? "-"} · protein ${row.proteinShare ?? "?"} · ${oracleVerdict}` : `NO DISH (${row.failure})`) +
          ` · chosen ${steer.choice ? `${steer.choice.key} (${steer.choice.why})` : "-"} · steer [${steerKeys.join(", ")}] · sodium ceiling ${sodiumCeiling ?? "-"}` +
          ` · ${latencyMs} ms · ${mine.length} call(s)${mine.some((c) => c.error) ? ` ERROR ${mine.find((c) => c.error)!.error}` : ""}` +
          (candidates.length ? `\n     candidates: ${candidates.map((c) => `"${c.name}" → ${c.product.split(" (")[0]}${c.judge?.reasons.length ? ` (${c.judge.reasons.join(", ")})` : ""}`).join("; ")}` : "") +
          (notes.length ? `\n     notes: ${notes.join(" | ")}` : ""));
        if (mine.some((c) => c.error && /credit|quota|billing|authentication|permission|rate|ENOTFOUND|ECONN|network/i.test(c.error))) {
          console.log("sim: stopping on an account/quota/network error (no retry).");
          process.exit(2);
        }
      }
    } finally {
      dishMod.dishRulesNow.rules = saved;
    }
  }

  // ── summary from every row in OUT ──────────────────────────────────────────
  const rows: any[] = readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const id = (r: any) => `${r.scenario}#${r.n}`;
  const of = (sc: string, f: (r: any) => boolean = () => true) => rows.filter((r) => r.scenario === sc && f(r));
  const allDry = rows.length > 0 && rows.every((r) => r.dry);
  type Line = { line: string; verdict: string };
  const lines: Line[] = [];
  /** Every served dish in `rs` must pass `ok`; no rows → n/a. */
  const each = (line: string, rs: any[], ok: (r: any) => boolean, needsModel = false) => {
    if (needsModel && allDry) return lines.push({ line, verdict: "n/a (dry)" });
    if (rs.length === 0) return lines.push({ line, verdict: "n/a (no rows)" });
    const served = rs.filter((r) => r.ok);
    const bad = served.filter((r) => !ok(r));
    const tail = served.length < rs.length ? ` [${served.length} of ${rs.length} asks served]` : "";
    lines.push({ line, verdict: (bad.length ? `FAIL ${bad.map(id).join(", ")}` : served.length ? "PASS" : "n/a (no dish served)") + tail });
  };
  const whole = (line: string, rs: any[], ok: () => string | null, needsModel = false) => {
    if (needsModel && allDry) return lines.push({ line, verdict: "n/a (dry)" });
    if (rs.length === 0) return lines.push({ line, verdict: "n/a (no rows)" });
    const fail = ok();
    lines.push({ line, verdict: fail ? `FAIL ${fail}` : "PASS" });
  };
  const onSalmonOrBeef = (r: any) => !!r.builtOn && ["salmon", "ground beef"].some((k) => sameProteinKind(r.builtOn, k));

  const a = of("A");
  each("A1 every lunch and dinner is built on salmon or ground beef", a, onSalmonOrBeef);
  whole("A2 both salmon and ground beef appear; at least 3 different dish names", a, () => {
    const served = a.filter((r) => r.ok);
    const salmon = served.some((r) => r.builtOn && sameProteinKind(r.builtOn, "salmon"));
    const beef = served.some((r) => r.builtOn && sameProteinKind(r.builtOn, "ground beef"));
    const names = new Set(served.map((r) => r.dishName.trim().toLowerCase())).size;
    const why = [!salmon && "no salmon dish", !beef && "no ground beef dish", names < 3 && `${names} different name(s)`].filter(Boolean);
    return why.length ? `(${why.join(", ")})` : null;
  }, true);
  whole("A3 each day's lunch and dinner: same protein, different names", a, () => {
    const bad: string[] = [];
    for (const lunch of a.filter((r) => r.meal === "lunch")) {
      const dinner = a.find((r) => r.meal === "dinner" && r.today === lunch.today);
      if (!lunch.ok || !dinner?.ok) { bad.push(`${lunch.today} (a dish missing)`); continue; }
      if (!lunch.builtOn || !dinner.builtOn || !sameProteinKind(lunch.builtOn, dinner.builtOn)) bad.push(`${id(lunch)}/${id(dinner)} (${lunch.builtOn} vs ${dinner.builtOn})`);
      else if (lunch.dishName.trim().toLowerCase() === dinner.dishName.trim().toLowerCase()) bad.push(`${id(lunch)}/${id(dinner)} (same name)`);
    }
    return bad.length ? bad.join(", ") : null;
  }, true);
  each("A4 every lunch and dinner within 0.55-1.25 x target", a, (r) => r.targetCalories != null && r.sizeProblem === null);
  each("B  no dish has a protein that is not at home", of("B"), (r) => r.proteinsNotAtHome.length === 0);
  each("C1 chicken: built on chicken and fromHome.proteinNotAtHome is set", of("C", (r) => r.label === "chicken"), (r) => r.builtOn === "chicken" && !!r.fromHome?.proteinNotAtHome);
  each("C2 stir-fry and plain dinner: no protein that is not at home", of("C", (r) => r.label !== "chicken"), (r) => r.proteinsNotAtHome.length === 0);
  const dR = of("D");
  whole("D  nothing marked: a dish each time; no fromHome key", dR, () => {
    const bad = dR.filter((r) => !r.ok || r.hasFromHomeKey);
    return bad.length ? bad.map((r) => `${id(r)}${r.ok ? " (fromHome)" : " (no dish)"}`).join(", ") : null;
  });
  const eR = of("E");
  whole("E1 the product's steer names iron and potassium", eR, () => {
    const bad = eR.filter((r) => !(r.steer.some((k: string) => k.startsWith("iron:more")) && r.steer.some((k: string) => k.startsWith("potassium:more"))));
    return bad.length ? bad.map((r) => `${id(r)} [${r.steer.join(", ")}]`).join(", ") : null;
  });
  each("E2 each dish has a food rich in iron or potassium", eR, (r) => r.richIron.length + r.richPotassium.length > 0, true);
  const fR = of("F");
  whole("F1 one salty day is not a week: no sodium line from today's log", fR, () => {
    const bad = fR.filter((r) => r.steer.some((k: string) => k.startsWith("sodium:less")));
    return bad.length ? bad.map((r) => `${id(r)} [${r.steer.join(", ")}]`).join(", ") : null;
  });
  each("F2 each dish's sodium is unknown or at most the product's ceiling", fR, (r) => r.sodium === null || (r.sodiumCeiling != null && r.sodium <= r.sodiumCeiling));
  const gR = of("G");
  whole("G  protein rule off (vegan): a dish each time", gR, () => {
    const bad = gR.filter((r) => !r.ok);
    return bad.length ? bad.map(id).join(", ") : null;
  }, true);
  each("H  fish allergy: no fish; diet oracle passes; built on ground beef", of("H"), (r) => r.fish.length === 0 && r.oracle === "pass" && r.builtOn === "ground beef");
  each("I  beef logged today, rotation says salmon: built on ground beef", of("I"), (r) => r.builtOn === "ground beef");
  // Round 2.
  const plans = [...of("J"), ...of("K")];
  const planDishes = (r: any, meal?: string) => (r.dishes ?? []).filter((x: any) => !meal || x.meal === meal);
  whole("J1 every day plan fills breakfast, lunch and dinner", plans, () => {
    const bad = plans.filter((r) => !["breakfast", "lunch", "dinner"].every((m) => planDishes(r, m).length === 1));
    return bad.length ? bad.map((r) => `${id(r)} (missing ${["breakfast", "lunch", "dinner"].filter((m) => !planDishes(r, m).length).join(", ")})`).join(", ") : null;
  }, true);
  whole("J2 a plan's lunch and dinner: same protein, different dishes", plans, () => {
    const bad = plans.filter((r) => { const l = planDishes(r, "lunch")[0], d = planDishes(r, "dinner")[0];
      return l && d && (!l.builtOn || !d.builtOn || !sameProteinKind(l.builtOn, d.builtOn) || l.name.trim().toLowerCase() === d.name.trim().toLowerCase()); });
    return bad.length ? bad.map((r) => `${id(r)} (${planDishes(r, "lunch")[0].builtOn} vs ${planDishes(r, "dinner")[0].builtOn})`).join(", ") : null;
  }, true);
  whole("J3 no plan dish has a protein that is not at home; diet oracle passes", plans, () => {
    const bad = plans.flatMap((r) => planDishes(r).filter((x: any) => x.proteinsNotAtHome.length || x.oracle !== "pass").map((x: any) => `${id(r)} ${x.meal}`));
    return bad.length ? bad.join(", ") : null;
  });
  whole("J4 every plan lunch and dinner within 0.55-1.25 x target", plans, () => {
    const bad = plans.flatMap((r) => planDishes(r).filter((x: any) => x.sizeProblem).map((x: any) => `${id(r)} ${x.meal} ${x.sizeProblem}`));
    return bad.length ? bad.join(", ") : null;
  }, true);
  whole("K1 little time: every dish takes at most 20 minutes; the dinner line asks for nothing slow", of("K"), () => {
    const bad = of("K").flatMap((r) => [
      ...planDishes(r).filter((x: any) => x.minutes == null || x.minutes > 20).map((x: any) => `${id(r)} ${x.meal} ${x.minutes} min`),
      ...(r.prompts ?? []).filter((p: string) => /a bake, a roast, a braise/.test(p)).map(() => `${id(r)} slow dinner line`),
    ]);
    return bad.length ? bad.join(", ") : null;
  }, true);
  const promptsOf = (rs: any[]) => rs.flatMap((r) => (r.prompts ?? []).map((p: string) => ({ r, p })));
  const levelLines = (p: string) => p.split("\n").filter((l) => /^- (They have had|From their answers|So far today)/.test(l)).join("\n");
  whole("L1 group-only allergy: the instructions' level lines name no fish and no tree nut", of("L"), () => {
    const ps = promptsOf(of("L"));
    if (!ps.length) return "no prompt recorded";
    const bad = ps.filter(({ p }) => /salmon|sardine|mackerel|white fish|walnut|almond|cashew/i.test(levelLines(p)));
    const omega = ps.some(({ p }) => /omega-3/.test(levelLines(p)));
    return bad.length ? bad.map(({ r }) => id(r)).join(", ") : omega ? null : "the omega-3 line never appeared, so nothing was tested";
  }, true);
  each("L2 group-only allergy: no fish or nut in the dish; diet oracle passes", of("L"), (r) => r.fish.length === 0 && r.oracle === "pass" && !r.ingredients.some((n: string) => /walnut|almond|cashew|pecan|pistachio|hazelnut/i.test(n)));
  whole("M1 protein on track: the instructions say a dish needs no protein", of("M"), () => {
    const bad = of("M").filter((r) => r.need !== "free" || !(r.prompts ?? []).some((p: string) => /does not have to be built on a protein/.test(p)));
    return bad.length ? bad.map((r) => `${id(r)} (need ${r.need})`).join(", ") : null;
  }, true);
  each("M2 protein on track: a dish each time, with no protein that is not at home", of("M"), (r) => r.proteinsNotAtHome.length === 0);
  each("N  eggs-only kitchen: no meat or fish; diet oracle passes", of("N"), (r) => r.oracle === "pass" && !r.proteinKinds.some((k: string) => proteinKind(k)?.cls === "meat"));
  whole("N2 eggs-only kitchen: the three dinners are not one dish three times", of("N"), () => {
    const names = new Set(of("N").filter((r) => r.ok).map((r) => r.dishName.trim().toLowerCase()));
    return names.size >= 2 ? null : `(${names.size} different name(s): ${[...names].join("; ")})`;
  }, true);
  whole("O1 salty week: the steer has sodium:less:week and the ceiling is the plain share", of("O"), () => {
    const bad = of("O").filter((r) => !r.steer.includes("sodium:less:week") || !(r.sodiumCeiling > 600 && r.sodiumCeiling < 700));
    return bad.length ? bad.map((r) => `${id(r)} [${r.steer.join(", ")}] ceiling ${r.sodiumCeiling}`).join(", ") : null;
  });
  each("O2 salty week: each dish's sodium is unknown or at most the ceiling", of("O"), (r) => r.sodium === null || r.sodium <= r.sodiumCeiling);
  whole("O3 salty week: the instructions give one sodium figure (no 350 mg, no quarter teaspoon)", of("O"), () => {
    const bad = promptsOf(of("O")).filter(({ p }) => /350 mg|quarter teaspoon|four of these dishes/.test(p));
    return bad.length ? bad.map(({ r }) => id(r)).join(", ") : promptsOf(of("O")).length ? null : "no prompt recorded";
  }, true);
  const q = of("Q");
  each("Q1 cooked week: no protein that is not at home; diet oracle passes", q, (r) => r.proteinsNotAtHome.length === 0 && r.oracle === "pass");
  whole("Q2 cooked week: no dish name is served twice in the five days", q, () => {
    const seen = new Map<string, string[]>();
    for (const r of q.filter((x) => x.ok)) { const k = r.dishName.trim().toLowerCase(); seen.set(k, [...(seen.get(k) ?? []), id(r)]); }
    const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
    return dup.length ? dup.map(([k, v]) => `"${k}" ${v.join(", ")}`).join("; ") : null;
  }, true);
  whole("Q3 cooked week: later prompts carry the earlier days' dishes", q, () => {
    const late = q.filter((r) => r.today >= "2026-11-04");
    const bad = late.filter((r) => !(r.prompts ?? []).some((p: string) => /in the last few days/.test(p)));
    return bad.length ? bad.map(id).join(", ") : late.length ? null : "no rows";
  }, true);
  each("all every lunch and dinner is inside the size band or was served as 'relaxed'", rows.filter((r) => r.meal !== "plan" && r.meal !== "swap" && r.meal !== "grocery"), (r) => r.sizeProblem === null || r.ladder === "relaxed" || r.ladder === "stored recipe");
  each("all each single dish's sodium is unknown or at most its ceiling", rows.filter((r) => r.meal !== "plan" && r.meal !== "swap" && r.meal !== "grocery"), (r) => r.sodium === null || r.sodiumCeiling == null || r.sodium <= r.sodiumCeiling);
  const tR = of("T");
  const noMeatFishEgg = (r: any) => !r.proteinKinds.some((k: string) => ["meat", "egg"].includes(proteinKind(k)?.cls ?? ""));
  whole("T1 protein on track: the lunches asked to go without (need skip) have no meat, fish or eggs", tR, () => {
    const asked = tR.filter((r) => r.need === "skip");
    if (!asked.length) return "no lunch was asked to go without";
    const bad = asked.filter((r) => r.ok && !noMeatFishEgg(r));
    return bad.length ? bad.map((r) => `${id(r)} [${r.proteinKinds.join(", ")}]`).join(", ") : null;
  }, true);
  whole("T2 protein on track: some lunches go without and some do not", tR, () => {
    const n = tR.filter((r) => r.need === "skip").length;
    return n > 0 && n < tR.length ? null : `${n} of ${tR.length} asked to go without`;
  });
  const mains = rows.filter((r) => r.meal === "lunch" || r.meal === "dinner");
  whole("all a meat or fish main has no eggs added (unless served as relaxed)", mains, () => {
    const bad = mains.filter((r) => r.ok && !r.request && r.ladder === "pass" && r.proteinKinds.some((k: string) => proteinKind(k)?.cls === "meat") && r.proteinKinds.some((k: string) => proteinKind(k)?.cls === "egg"));
    return bad.length ? bad.map(id).join(", ") : null;
  }, true);
  whole("J5 a plan's lunch and dinner are not the same starch cooked the same way", plans, () => {
    const { dishShape, starchesIn } = judgeMod;
    const bad = plans.filter((r) => { const l = planDishes(r, "lunch")[0], d = planDishes(r, "dinner")[0];
      return l && d && dishShape(l.name).way === dishShape(d.name).way && (starchesIn(l.ingredients)[0] ?? null) === (starchesIn(d.ingredients)[0] ?? null); });
    return bad.length ? bad.map((r) => `${id(r)} (${planDishes(r, "lunch")[0].name} / ${planDishes(r, "dinner")[0].name})`).join(", ") : null;
  }, true);
  const yR = of("Y");
  each("Y1 own rule 'never put spinach': no dish has spinach (held in code)", yR, (r) => !r.ingredients.some((n: string) => /spinach/i.test(n)));
  whole("Y2 own rules are in the instructions in their words; a switched-off one is not", yR, () => {
    const ps = promptsOf(yR);
    if (!ps.length) return "no prompt recorded";
    const bad = ps.filter(({ p }) => !/Their own rules for their dishes.*Never put spinach in my dishes; Keep dinners under 25 minutes\./.test(p) || /No rice/.test(p));
    return bad.length ? bad.map(({ r }) => id(r)).join(", ") : null;
  }, true);
  whole("Y3 'Keep my week varied' off: no kind-of-dish line and no last-days line", yR, () => {
    const bad = promptsOf(yR).filter(({ p }) => /To keep their week varied|in the last few days/.test(p));
    return bad.length ? bad.map(({ r }) => id(r)).join(", ") : null;
  }, true);
  each("Y4 own rule 'dinners under 25 minutes' (an instruction only): minutes on the card", yR, (r) => r.minutes == null || r.minutes <= 25, true);
  const gRows = rows.filter((r) => r.meal === "grocery");
  whole("G1 grocery: no listed food is already at home, banned by the diet, or listed twice", gRows, () => {
    const bad: string[] = [];
    for (const r of gRows) {
      const all = r.before.flatMap((g: any) => g.items.map((i: any) => i.name));
      if (r.oracle !== "pass") bad.push(`${id(r)} ${r.oracle}`);
      if (new Set(all).size !== all.length) bad.push(`${id(r)} (a food twice)`);
      if (all.some((n: string) => r.atHome.includes(n))) bad.push(`${id(r)} (already at home)`);
    }
    return bad.length ? bad.join(", ") : null;
  });
  whole("G2 grocery: a family with fewer than two foods at home has its variety group", gRows, () => {
    const bad: string[] = [];
    const { INGREDIENT_CATALOG: CAT } = catalogMod;
    for (const r of gRows) for (const [key, groupKey] of [["variety:produce", "produce"], ["variety:grains", "grains"]] as const) {
      const have = r.atHome.filter((n: string) => CAT.find((c: any) => c.key === groupKey)?.items.includes(n)).length;
      const has = r.before.some((g: any) => g.key === key);
      if ((have < 2) !== has) bad.push(`${id(r)} ${key} (have ${have}, group ${has})`);
    }
    return bad.length ? bad.join(", ") : null;
  });
  whole("G4 grocery: every nutrient they are low on is a group, named in one, or has a real source at home; no group is empty without a note", gRows, () => {
    const bad: string[] = [];
    for (const r of gRows) {
      const lows = new Set<string>([...((r.picture?.little ?? []) as string[]), ...(r.week as string[]).filter((w) => w.includes(":little")).map((w) => w.split(":")[0])]);
      const lowerName = (k: string) => { const n = levelNames.get(k) ?? k; return n.charAt(0).toLowerCase() + n.slice(1); };
      const levelGroups = r.before.filter((g: any) => g.kind === "level");
      for (const k of lows) {
        const src = groceryMod.SOURCES[k as keyof typeof groceryMod.SOURCES];
        const strong = src ? src.foods.slice(0, src.strong) : [];
        const atHome = k === "protein" ? r.atHome.some((n: string) => proteinKind(n) !== null) : strong.some((n: string) => r.atHome.includes(n));
        const group = levelGroups.some((g: any) => g.key === `level:${k}`);
        const named = levelGroups.some((g: any) => (g.also ?? []).some((x: any) => x.level === lowerName(k)));
        const capped = levelGroups.filter((g: any) => g.items.length && !g.note).length >= groceryMod.MAX_LEVEL_GROUPS;
        if (!group && !named && !atHome && !capped) bad.push(`${id(r)} ${k}`);
      }
      for (const g of r.before) if (g.items.length === 0 && !g.note) bad.push(`${id(r)} ${g.key} (empty, no note)`);
    }
    return bad.length ? bad.join(", ") : null;
  });
  whole("G5 grocery: at most 29 foods, 4 to a nutrient group and 3 to a variety group", gRows, () => {
    const bad = gRows.filter((r) => r.before.flatMap((g: any) => g.items).length > 29 || r.before.some((g: any) => g.items.length > (g.kind === "level" ? 4 : 3)));
    return bad.length ? bad.map(id).join(", ") : null;
  });
  whole("G3 grocery: 'Got it' takes the food off the list, and no variety group appears that was not there", gRows, () => {
    const bad = gRows.filter((r) => r.bought.some((n: string) => r.after.some((g: any) => g.items.some((i: any) => i.name === n)))
      || r.after.some((g: any) => g.kind === "variety" && !r.before.some((b: any) => b.key === g.key)));
    return bad.length ? bad.map(id).join(", ") : null;
  });
  const swapRows = rows.filter((r) => r.meal === "swap");
  const swapResults = swapRows.flatMap((r) => r.results.map((x: any) => ({ r, x })));
  const swapLine = (line: string, bad: (a: { r: any; x: any }) => boolean, pick: (a: { r: any; x: any }) => boolean = () => true) => whole(line, swapRows, () => {
    const rs = swapResults.filter(pick);
    if (!rs.length) return "no such exchange was tried";
    const b = rs.filter(bad);
    return b.length ? b.map(({ r, x }) => `${id(r)} ${x.kind} ${x.ingredient}`).join(", ") : null;
  }, true);
  swapLine("B1 every exchange and every 'nothing similar' returns a dish", ({ x }) => !x.ok);
  swapLine("B2 the food they do not have is gone from the ingredients, the steps and the name", ({ x }) => x.ok && (x.stillHasIt || x.headLeft));
  swapLine("B3 an exchange puts the replacement in the ingredients and in a step", ({ x }) => x.ok && (x.hasReplacement === false || x.replacementInSteps === false), ({ x }) => x.kind !== "without");
  swapLine("B7 a rewritten dish keeps at least two thirds of the other ingredients", ({ x }) => x.ok && x.keptShare < 2 / 3, ({ x }) => x.how === "rewritten");
  swapLine("B8 an exchanged or rewritten dish stays within 0.8-1.25 x the original's calories", ({ x }) => x.ok && (x.vsOriginal < 0.8 || x.vsOriginal > 1.25), ({ x }) => x.kind !== "without");
  swapLine("B9 a 'nothing similar' dish is inside the meal's size band", ({ x }) => x.ok && x.sizeProblem !== null, ({ x }) => x.kind === "without");
  swapLine("B4 a like-for-like exchange is made in code: no model call", ({ x }) => x.ok && x.modelCalls !== 0, ({ x }) => x.kind === "plain");
  swapLine("B5 every changed dish passes the diet oracle", ({ x }) => x.ok && x.oracle !== "pass");
  whole("B6 no offer names a food already in the dish; at-home foods are offered first", swapRows, () => {
    const bad: string[] = [];
    for (const r of swapRows) for (const [ingName, o] of Object.entries(r.offers) as [string, any][]) {
      const os: any[] = o.options ?? [];
      if (os.some((x) => r.original.ingredients.some((n: string) => n.toLowerCase() === x.name.toLowerCase()))) bad.push(`${id(r)} ${ingName} (in the dish)`);
      const firstNotHome = os.findIndex((x) => !x.atHome);
      if (firstNotHome >= 0 && os.slice(firstNotHome).some((x) => x.atHome)) bad.push(`${id(r)} ${ingName} (order)`);
    }
    return bad.length ? bad.join(", ") : null;
  });
  const noDish = rows.filter((r) => !r.ok);
  lines.push({ line: "all every request returned a dish", verdict: noDish.length ? `FAIL ${noDish.map(id).join(", ")}` : "PASS" });
  const dietBreaks = rows.filter((r) => r.ok && r.oracle !== "pass");

  console.log(`\n${"scenario".padEnd(9)}${"asks".padEnd(6)}${"dishes".padEnd(8)}ladder (pass/relaxed/stored/none) · dishes [built on]`);
  for (const s of SCENARIOS) {
    const rs = of(s.id);
    if (!rs.length) continue;
    const count = (l: string) => rs.filter((r) => r.ladder === l).length;
    console.log(`${s.id.padEnd(9)}${String(rs.length).padEnd(6)}${String(rs.filter((r) => r.ok).length).padEnd(8)}${count("pass")}/${count("relaxed")}/${count("stored recipe")}/${count("none")} · ${rs.map((r) => (r.ok ? `${r.dishName} [${r.builtOn ?? "-"}]` : "NO DISH")).join("; ")}`);
  }
  console.log(`\nacceptance (${allDry ? "DRY run: no model" : "live run"}; ${rows.length} rows in ${OUT.split("/").slice(-2).join("/")})`);
  for (const l of lines) console.log(`  ${l.line.padEnd(72)} ${l.verdict}`);
  console.log(`\nrequests with no dish: ${noDish.length} of ${rows.length}`);
  console.log(`diet oracle breaks: ${dietBreaks.length}${dietBreaks.length ? " — " + dietBreaks.map((r) => `${id(r)} ${r.oracle}`).join("; ") : ""}`);
  console.log(`planned live calls: ${PLANNED_CALLS} (cap ${CAP})`);
  console.log(`ledger: ${ledger.calls} live calls in total (${JSON.stringify(ledger.models)}); this run: ${calls.filter((c) => !c.model.endsWith("(dry)")).length}`);
})().catch((e) => { console.error(e); process.exit(1); });
