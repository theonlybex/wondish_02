// LIVE before/after simulation for fast, always-a-dish Clara
// (docs/qa/clara-fast-dishes.md). The REAL dish model, the in-memory store (no
// database: sim/clara-live-key.ts drops every database URL), 40 people
// (sim/clara-fast-people.ts), one dish_suggest each plus 8 dish_plan_today.
//
//   SIM_LIVE=1 SIM_ARM=after-5.5 SIM_OUT=sim/.snapshot/fast-after-5.5.jsonl \
//     node --env-file=.env.local --experimental-test-module-mocks --import tsx sim/clara-fast-live.sim.ts
//
// It runs against whatever checkout it sits in: on `main` (the "before" arm)
// the dish tool makes one non-streamed forced-tool call; on this branch it
// streams a schema-constrained answer with the library fallback beside it.
// Env:
//   SIM_ARM      label written on every row
//   SIM_MODEL    model id to send instead of the code's own (an experiment arm)
//   SIM_BUDGET_MS the dish time budget (this branch only; default: the code's)
//   SIM_ONLY     "|"-separated person ids;  SIM_HARD=1 hard profiles only
//   SIM_NO_PLANS=1 skip the 8 day plans;       SIM_DRY=1 no model at all (free)
// Every real model call is counted in sim/.snapshot/fast-live-ledger.json and
// refused past SIM_CALL_CAP (default 140) across all runs. Rows are appended
// to SIM_OUT as they finish, and a person already in SIM_OUT is skipped, so a
// stopped run resumes without spending a call twice.
import "./clara-live-key";
import "./setup";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { snap, state, ingByName, ingById } from "./setup";
import { createClaraStore } from "./fake-db";
import { makePatient, type RuleKey } from "./profiles";
import { makeOracle } from "./oracle";
import { FAST_PEOPLE } from "./clara-fast-people";

const DRY = process.env.SIM_DRY === "1";
if (process.env.SIM_LIVE !== "1" && !DRY) {
  console.log("sim:clara-fast-live is opt-in: SIM_LIVE=1 (real model, counted against SIM_CALL_CAP) or SIM_DRY=1 (no model).");
  process.exit(0);
}
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key && !DRY) { console.log("No ANTHROPIC_API_KEY in .env.local — skipped."); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key ?? "sim-dry-never-sent";

const ARM = process.env.SIM_ARM ?? "unlabelled";
const OUT = process.env.SIM_OUT ?? join(__dirname, ".snapshot", `fast-${ARM}.jsonl`);
const CAP = Number(process.env.SIM_CALL_CAP ?? 140);
const LEDGER = join(__dirname, ".snapshot", "fast-live-ledger.json");
const ledger: { calls: number; byArm: Record<string, number> } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { calls: 0, byArm: {} };
const spend = () => {
  // Re-read first: two runs at once must not lose each other's calls.
  if (existsSync(LEDGER)) Object.assign(ledger, JSON.parse(readFileSync(LEDGER, "utf8")));
  if (ledger.calls >= CAP) throw new Error(`sim: live call cap ${CAP} reached`);
  ledger.calls++;
  ledger.byArm[ARM] = (ledger.byArm[ARM] ?? 0) + 1;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
};

// ── the spy between the product and the API ─────────────────────────────────
type CallRec = {
  meal: string; model: string; streamed: boolean; ms: number; ttftMs: number | null;
  inTokens: number; outTokens: number | null; chars: number; stop: string | null; aborted: boolean;
  /** Raw candidates: tool input recipes (old) or the streamed JSON text (new). */
  raw: unknown; text: string; error?: string;
};
const calls: CallRec[] = [];
const realClient = key ? new Anthropic({ apiKey: key }) : null;
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    HAIKU_MODEL: process.env.SIM_MODEL ?? "claude-haiku-5-5",
    createAnthropic: (o: { timeout?: number; maxRetries?: number } = {}) => ({
      messages: {
        create: async (params: any, opts?: { signal?: AbortSignal }) => {
          const meal = String(params.messages?.[0]?.content ?? "").match(/Suggest the \d+ (\w+) dishes/)?.[1] ?? "?";
          if (process.env.SIM_MODEL) params = { ...params, model: process.env.SIM_MODEL };
          const rec: CallRec = { meal, model: params.model, streamed: !!params.stream, ms: 0, ttftMs: null, inTokens: 0, outTokens: null, chars: 0, stop: null, aborted: false, raw: null, text: "" };
          calls.push(rec);
          const t0 = Date.now();
          if (DRY) {
            rec.model = `${params.model} (dry)`;
            if (!params.stream) return { content: [{ type: "tool_use", id: "t", name: "suggest_recipes", input: { recipes: [] } }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "tool_use" };
            return (async function* () { yield { type: "content_block_delta", delta: { type: "text_delta", text: '{"dishes":[]}' } }; })();
          }
          spend();
          const client = realClient!.withOptions({ timeout: o.timeout ?? 90_000, maxRetries: o.maxRetries ?? 1 });
          if (!params.stream) {
            try {
              const msg = await client.messages.create(params, opts);
              const tool = msg.content.find((b) => b.type === "tool_use") as any;
              Object.assign(rec, { ms: Date.now() - t0, inTokens: msg.usage.input_tokens, outTokens: msg.usage.output_tokens, stop: msg.stop_reason, raw: tool?.input?.recipes ?? null });
              return msg;
            } catch (e) { rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
          }
          let s: any;
          try { s = await client.messages.create(params, opts); } catch (e) { rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
          return (async function* () {
            try {
              for await (const ev of s) {
                if (ev.type === "message_start") rec.inTokens = ev.message.usage.input_tokens + (ev.message.usage.cache_read_input_tokens ?? 0) + (ev.message.usage.cache_creation_input_tokens ?? 0);
                if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
                  rec.ttftMs ??= Date.now() - t0;
                  rec.chars += ev.delta.text.length;
                  rec.text += ev.delta.text;
                }
                if (ev.type === "message_delta") { rec.outTokens = ev.usage.output_tokens; rec.stop = ev.delta.stop_reason; }
                yield ev;
              }
            } catch (e) {
              rec.aborted = true;
              throw e;
            } finally {
              rec.ms = Date.now() - t0;
              if (rec.outTokens == null) rec.aborted = true;
            }
          })();
        },
      },
    }),
    claraBusyStatus: () => null, CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.", ANTHROPIC_TIMEOUT_MS: 90_000, ANTHROPIC_MAX_RETRIES: 1,
  },
});
const store = createClaraStore(snap);
(globalThis as any).prisma = store.client;

const done = new Set<string>(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.person}|${r.tool}`; }) : []);

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const onboarding = await import("@/app/api/onboarding/route");
  const mealLog = await import("@/app/api/meal-log/route");
  const dishMod: any = await import("@/lib/clara/skills/dish");
  const fridge = await import("@/lib/fridge");
  const { specifyCookingOil, oilAllowedBy } = await import("@/lib/clara/oil");
  const { loadIngredientGroups } = await import("@/lib/ingredient-catalog-db");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");
  const { dailySodiumLimitMg } = await import("@/lib/sodium-limit");
  const pl = await import("@/lib/dish-plausibility");
  const gen = await import("@/lib/clara/recipe-generation");
  const newCode = typeof dishMod.makeDishHandlers === "function" && !!dishMod.liveDishDeps;
  const output: any = newCode ? await import("@/lib/clara/dish-output") : null;
  if (newCode && process.env.SIM_BUDGET_MS) dishMod.dishTiming.budgetMs = Number(process.env.SIM_BUDGET_MS);
  const budgetMs = newCode ? dishMod.dishTiming.budgetMs : null;

  type Trace = { meal: string; ms: number; name: string; stage: string };
  let traces: Trace[] = [];
  const handlers = newCode
    ? dishMod.makeDishHandlers({ ...dishMod.liveDishDeps, generate: (c: any, a: any, o: any) => dishMod.liveDishDeps.generate(c, a, { ...o, trace: (e: any) => traces.push({ meal: a.mealType, ...e }) }) })
    : { suggest: dishMod.dishSkill.tools.find((t: any) => t.def.name === "dish_suggest").handler, planToday: dishMod.dishSkill.tools.find((t: any) => t.def.name === "dish_plan_today").handler };
  // What the library alone would serve for the same ask (no model call): for the report's budget analysis.
  const libraryOnly = newCode ? dishMod.makeDishHandlers({ ...dishMod.liveDishDeps, generate: async () => [] }) : null;

  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const ids = (kind: any, prefix: string, rules: RuleKey[]) => rules.filter((k) => k.startsWith(prefix)).map((k) => store.ref(kind, k.slice(prefix.length)).id);
  const today = "2026-11-12";
  const mealName = new Map(snap.mealTypes.map((m) => [m.id, m.name]));
  const tokens = pl.catalogFoodVocabulary(snap.ingredients.map((i) => i.name));

  // Old code: where each raw candidate ended, replayed through the same gates.
  const classifyOld = async (raw: unknown, mealType: string, servings: number, maxMinutes: number | undefined, matchers: any, sodiumLimitMg: number) => {
    const meal = mealType[0].toUpperCase() + mealType.slice(1);
    const stages = { produced: 0, parse: 0, safety: 0, gates: 0, card: 0, accepted: 0 };
    const arr = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!Array.isArray(arr)) { stages.produced = raw == null ? 0 : 1; stages.parse = stages.produced; return stages; }
    stages.produced = Math.min(arr.length, 3);
    const parsed = fridge.parseFridgeRecipes(arr, 3, meal) ?? [];
    stages.parse = stages.produced - parsed.length;
    for (const p of parsed) {
      const r0 = specifyCookingOil(p, oilAllowedBy(matchers));
      const groupsOf = await loadIngredientGroups([...r0.usesIngredients, ...r0.missingIngredients]);
      if (fridge.applyAllergenFilter([r0], matchers, groupsOf).length === 0) { stages.safety++; continue; }
      const g = dishMod.gateGeneratedDishes([r0], { mealTypeName: meal, matchers, groupsOf, catalogFoodTokens: tokens, sodiumLimitMg });
      if (g.length === 0) { stages.gates++; continue; }
      const mins = pl.statedOrImpliedMinutes(gen.toPlausibleDish(g[0], meal));
      if (mins <= 0 || (maxMinutes !== undefined && Math.max(1, Math.round(mins)) > maxMinutes) || (servings > 1 && g[0].steps.some(dishMod.stepStatesAmount))) { stages.card++; continue; }
      stages.accepted++;
    }
    return stages;
  };
  const stagesFromTrace = (ts: Trace[], rec: CallRec | undefined) => {
    const stages = { produced: 0, parse: 0, safety: 0, gates: 0, card: 0, accepted: 0 };
    for (const t of ts) (stages as any)[t.stage]++;
    stages.produced = ts.length;
    void rec;
    return stages;
  };

  let i = 0;
  for (const p of FAST_PEOPLE) {
    i++;
    // Ids hold commas ("NAFLD+T2D, no added sugar/fried"): separate them with "|".
    if (process.env.SIM_ONLY && !process.env.SIM_ONLY.split("|").map((x) => x.trim()).includes(p.id)) continue;
    if (process.env.SIM_HARD === "1" && !p.hard) continue;
    const tools: ("suggest" | "plan")[] = ["suggest", ...(p.plan && process.env.SIM_NO_PLANS !== "1" ? ["plan" as const] : [])];
    if (tools.every((t) => done.has(`${p.id}|${t}`))) continue;

    const clerkId = `clerk_fast_${i}`;
    store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
    state.patient = { account: { clerkId } };
    const pr = await profile.PATCH(req("PATCH", {
      firstName: "Sim", lastName: "Fast", birthday: "1990-04-02", sexAtBirth: i % 2 ? "MALE" : "FEMALE", height: 170, heightUnit: "cm", weight: 160,
      physicalActivityId: snap.physicalActivities[1].id,
      healthConditionIds: ids("healthCondition", "condition:", p.rules), foodAllergyIds: ids("foodAllergy", "allergy:", p.rules),
      foodPreferenceIds: ids("foodPreference", "diet:", p.rules), foodToAvoidIds: ids("foodToAvoid", "avoid:", p.rules), motivationIds: ids("motivation", "goal:", p.rules),
    }) as any);
    if (pr.status !== 200) throw new Error(`${p.id}: profile ${pr.status} ${JSON.stringify(await pr.json())}`);
    if (p.eating) await onboarding.PUT(req("PUT", { usualEating: p.eating, pills: [] }) as any);
    if (p.logs) {
      const lib = snap.recipes.filter((r) => r.fiber != null && r.fiber < 2).slice(i * 6, i * 6 + 6);
      for (const [j, r] of lib.entries()) await mealLog.POST(req("POST", { localDate: `2026-11-${String(9 + Math.floor(j / 2)).padStart(2, "0")}`, mealType: j % 2 ? "dinner" : "lunch", source: "RECIPE", recipeId: r.id }) as any);
    }
    const oracle = makeOracle(makePatient(snap, { id: p.id, tier: "curated", rules: p.rules }) as any, p.rules);
    const patientRow = store.tables.patient.find((x: any) => x.accountId === store.tables.account.find((a: any) => a.clerkId === clerkId).id);
    const pid = patientRow.id;
    const { PATIENT_FOOD_MAP_INCLUDE } = await import("@/lib/food-map");
    const dietPatient = await (globalThis as any).prisma.patient.findFirst({ where: { id: pid }, include: PATIENT_FOOD_MAP_INCLUDE });
    const matchers = buildDietMatchers(derivePatientBans(dietPatient, new Date(`${today}T12:00:00`)));
    const sodiumLimitMg = dailySodiumLimitMg((dietPatient.healthConditions ?? []).map((h: any) => h.condition.name));
    const ctx = { patientId: pid, accountId: "x", firstName: "Sim", isPremium: false, today, surface: "ios", disabledSkills: [] };
    const judge = (part: any) => {
      const items = part.recipe.ingredients.map((x: any) => ({ name: x.name, allergenGroups: ingByName.get(String(x.name).toLowerCase())?.allergenGroups ?? [] }));
      const bad = oracle.judgeMany(items).map((v, k) => ({ v, n: items[k].name })).filter(({ v }) => v.engine.length || v.groups.length);
      return bad.length ? `VIOLATION: ${bad.map((b) => b.n).join(", ")}` : "pass";
    };

    for (const tool of tools) {
      if (done.has(`${p.id}|${tool}`)) continue;
      if (tool === "plan" && p.plan !== "eating_out") {
        // Breakfast already logged today: the plan asks for lunch and dinner.
        const bf = snap.recipes.find((r) => mealName.get(r.mealTypeId ?? "") === "Breakfast" && r.ingredients.length > 0 &&
          oracle.judgeMany(r.ingredients.map((ri) => ingById.get(ri.ingredientId)).filter(Boolean).map((x) => ({ name: x!.name, allergenGroups: x!.allergenGroups }))).every((v) => !v.engine.length && !v.groups.length));
        if (bf) await mealLog.POST(req("POST", { localDate: today, mealType: "breakfast", source: "RECIPE", recipeId: bf.id }) as any);
      }
      const input: Record<string, unknown> = tool === "suggest"
        ? { mealType: p.mealType, ...(p.servings ? { servings: p.servings } : {}), ...(p.maxMinutes ? { maxMinutes: p.maxMinutes } : {}) }
        : { occasion: p.plan };
      const before = calls.length;
      traces = [];
      const t0 = Date.now();
      const quiet = { log: console.log, warn: console.warn, info: console.info };
      let res: any;
      try {
        console.info = () => {};
        res = tool === "suggest" ? await handlers.suggest(ctx, input) : await handlers.planToday(ctx, input);
      } finally { Object.assign(console, quiet); }
      const wallMs = Date.now() - t0;
      const mine = calls.slice(before);
      // One row per dish asked for (a plan asks for two).
      const asks: { meal: string; servings: number; maxMinutes?: number }[] = tool === "suggest"
        ? [{ meal: p.mealType, servings: p.servings ?? 1, maxMinutes: p.maxMinutes }]
        : (res.ok ? [...(res.data.dishes ?? []).map((d: any) => d.mealType), ...(res.data.couldNotFill ?? [])] : mine.map((c) => c.meal.toLowerCase()))
            .map((meal: string) => ({ meal, servings: p.plan === "guests" && meal === "dinner" ? 6 : 1, maxMinutes: p.plan === "little_time" ? 20 : undefined }));
      for (const ask of asks) {
        const rec = mine.find((c) => c.meal.toLowerCase() === ask.meal);
        let served: "generated" | "library" | "none" = "none";
        let dishName: string | null = null;
        let verdict: string | null = null;
        if (res.ok) {
          const d = tool === "suggest" ? res.data.dish : (res.data.dishes ?? []).find((x: any) => x.mealType === ask.meal);
          if (d) {
            served = d.source === "library" ? "library" : "generated";
            dishName = d.name;
            const part = (res.parts ?? []).find((x: any) => x.kind === "dish" && x.dishId === d.dishId);
            verdict = part?.recipe ? judge(part) : "no recipe";
          }
        }
        const ts = traces.filter((t) => t.meal === ask.meal);
        const stages = newCode ? stagesFromTrace(ts, rec) : await classifyOld(rec?.raw ?? null, ask.meal, ask.servings, ask.maxMinutes, matchers, sodiumLimitMg);
        let library: string | null = null;
        if (libraryOnly) {
          const lr: any = tool === "suggest"
            ? await libraryOnly.suggest(ctx, input)
            : await libraryOnly.planToday(ctx, input);
          const ld = !lr.ok ? null : tool === "suggest" ? lr.data.dish : (lr.data.dishes ?? []).find((x: any) => x.mealType === ask.meal);
          library = ld?.name ?? null;
        }
        const row = {
          arm: ARM, codeline: newCode ? "new" : "old", budgetMs, person: p.id, hard: p.hard, tool, meal: ask.meal, servings: ask.servings, maxMinutes: ask.maxMinutes ?? null,
          wallMs, served, dishName, oracle: verdict, libraryWouldServe: library,
          acceptedAtMs: ts.find((t) => t.stage === "accepted")?.ms ?? null,
          stages,
          call: rec ? { model: rec.model, ms: rec.ms, ttftMs: rec.ttftMs, inTokens: rec.inTokens, outTokens: rec.outTokens, chars: rec.chars, stop: rec.stop, aborted: rec.aborted, error: rec.error ?? null } : null,
          rawText: rec?.streamed ? rec.text : undefined,
          raw: rec && !rec.streamed ? rec.raw : undefined,
        };
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        console.log(`${ARM} · ${p.id} · ${tool} ${ask.meal}: ${served}${dishName ? ` "${dishName}"` : ""} · ${verdict ?? "-"} · wall ${wallMs} ms · model ${rec ? `${rec.ms} ms ${rec.outTokens ?? "~" + Math.round(rec.chars / 3.6)} out${rec.aborted ? " (stopped)" : ""}` : "no call"} · stages ${JSON.stringify(stages)}${library !== null ? ` · library: ${library}` : ""}`);
      }
      void output;
    }
  }
  console.log(`ledger: ${ledger.calls} live calls in total (${JSON.stringify(ledger.byArm)})`);
})().catch((e) => { console.error(e); process.exit(1); });
