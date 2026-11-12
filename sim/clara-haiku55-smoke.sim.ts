// Haiku 5.5 smoke checks for the call sites the dish simulation never ran
// (docs/qa/clara-fast-dishes.md, "Haiku 5.5 smoke checks"). Real model, the
// in-memory store only (sim/clara-live-key.ts drops every database URL), at
// most SMOKE_CAP live calls.
//
//   SIM_LIVE=1 TZ=UTC node --env-file=.env.local --experimental-test-module-mocks --import tsx sim/clara-haiku55-smoke.sim.ts
import "./clara-live-key";
import "./setup";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { snap, state } from "./setup";
import { createClaraStore } from "./fake-db";

if (process.env.SIM_LIVE !== "1") { console.log("opt-in: SIM_LIVE=1"); process.exit(0); }
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key) { console.log("no key"); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key;
const CAP = Number(process.env.SMOKE_CAP ?? 24);
let calls = 0;
const spend = () => { if (++calls > CAP) throw new Error(`smoke: cap ${CAP} reached`); };

type Rec = { site: string; ms: number; ttftMs: number | null; stop: string | null; error: string | null; outTokens: number | null; note?: string };
const recs: Rec[] = [];
let site = "?";
const real = new Anthropic({ apiKey: key });
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    HAIKU_MODEL: "claude-haiku-5-5",
    createAnthropic: (o: { timeout?: number; maxRetries?: number } = {}) => ({
      messages: {
        create: async (params: any, opts?: any) => {
          spend();
          const rec: Rec = { site, ms: 0, ttftMs: null, stop: null, error: null, outTokens: null };
          recs.push(rec);
          const t0 = Date.now();
          // maxRetries 0 whatever the caller asked: every call is counted against the cap.
          void o.maxRetries;
          const client = real.withOptions({ timeout: o.timeout ?? 90_000, maxRetries: 0 });
          try {
            if (!params.stream) {
              const msg: any = await client.messages.create(params, opts);
              Object.assign(rec, { ms: Date.now() - t0, stop: msg.stop_reason, outTokens: msg.usage.output_tokens, note: `model ${msg.model}` });
              return msg;
            }
            const s: any = await client.messages.create(params, opts);
            return (async function* () {
              try {
                for await (const ev of s) {
                  if (ev.type === "content_block_delta") rec.ttftMs ??= Date.now() - t0;
                  if (ev.type === "message_delta") { rec.stop = ev.delta.stop_reason; rec.outTokens = ev.usage.output_tokens; }
                  yield ev;
                }
              } finally { rec.ms = Date.now() - t0; rec.stop ??= "stopped early by the caller"; }
            })();
          } catch (e: any) { rec.ms = Date.now() - t0; rec.error = `${e?.status ?? ""} ${e?.message ?? e}`.slice(0, 200); throw e; }
        },
      },
    }),
    claraBusyStatus: (err: any) => (err?.status === 429 ? 429 : err?.status === 529 ? 503 : null),
    CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.", ANTHROPIC_TIMEOUT_MS: 90_000, ANTHROPIC_MAX_RETRIES: 1,
  },
});
const store = createClaraStore(snap);
(globalThis as any).prisma = store.client;

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const { ALL_SKILLS, RUNTIME_SKILLS, buildToolDefs, buildSystemPrompt } = await import("@/lib/clara/registry");
  const { memorySkill } = await import("@/lib/clara/skills/memory");
  const { askChoicesSkill } = await import("@/lib/clara/ask-choices");
  const { createAnthropicClient, CLARA_MODEL } = await import("@/lib/clara/anthropic-client");
  const { startClaraLoop } = await import("@/lib/clara/loop");
  const dish: any = await import("@/lib/clara/skills/dish");
  const { buildFoodMapText, PATIENT_FOOD_MAP_INCLUDE } = await import("@/lib/food-map");
  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  // One person: vegetarian, egg and dairy allergies (a hard profile from the dish runs).
  const clerkId = "clerk_smoke_1";
  store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
  state.patient = { account: { clerkId } };
  const pr = await profile.PATCH(req("PATCH", {
    firstName: "Sam", lastName: "Smoke", birthday: "1990-04-02", sexAtBirth: "FEMALE", height: 170, heightUnit: "cm", weight: 150,
    physicalActivityId: snap.physicalActivities[1].id,
    foodPreferenceIds: [store.ref("foodPreference", "Vegetarian").id], foodAllergyIds: [store.ref("foodAllergy", "Eggs").id, store.ref("foodAllergy", "Dairy").id],
  }) as any);
  if (pr.status !== 200) throw new Error(`profile ${pr.status}`);
  const acc = store.tables.account.find((a: any) => a.clerkId === clerkId);
  const pid = store.tables.patient.find((x: any) => x.accountId === acc.id).id;
  const patient = await (globalThis as any).prisma.patient.findFirst({ where: { id: pid }, include: PATIENT_FOOD_MAP_INCLUDE });
  const today = "2026-11-12";
  const ctx = { patientId: pid, accountId: acc.id, firstName: "Sam", isPremium: true, today, surface: "ios", disabledSkills: [] };

  // ── Clara chat through the real loop ──
  const active = [...ALL_SKILLS, memorySkill, askChoicesSkill, ...RUNTIME_SKILLS];
  const tools = buildToolDefs(active);
  const system = buildSystemPrompt("Sam", buildFoodMapText(patient), active, today);
  const handlerOf = (name: string) => active.flatMap((s) => s.tools).find((t) => t.def.name === name)?.handler;
  const libraryOnly = dish.makeDishHandlers({ ...dish.liveDishDeps, generate: async () => [] });
  const chatRows: any[] = [];
  const chat = async (label: string, user: string, maxToolRounds: number, opts: { libraryDish?: boolean } = {}) => {
    site = `chat · ${label}`;
    const rounds: { ttftMs: number | null; ms: number; stop: string | null; tools: string[] }[] = [];
    const base = createAnthropicClient(real.withOptions({ timeout: 55_000, maxRetries: 0 }) as any);
    const client = {
      openRound: async (r: any) => {
        spend();
        const t0 = Date.now();
        const row = { ttftMs: null as number | null, ms: 0, stop: null as string | null, tools: [] as string[] };
        rounds.push(row);
        const it = await base.openRound(r);
        return (async function* () {
          for await (const ev of it) {
            if (ev.type === "text") row.ttftMs ??= Date.now() - t0;
            if (ev.type === "end") { row.stop = ev.stopReason; row.tools = ev.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.name); row.ms = Date.now() - t0; }
            yield ev;
          }
        })();
      },
    };
    const errors: string[] = [];
    const executed: string[] = [];
    const t0 = Date.now();
    let reply = "";
    let dishSource: string | null = null;
    try {
      const stream = await startClaraLoop({
        client, system, tools, messages: [{ role: "user", content: user }], maxToolRounds, writesAllowed: false, partsEnabled: true,
        onError: (e) => errors.push(String((e as Error)?.message ?? e).slice(0, 160)),
        execute: async (name, input) => {
          executed.push(name);
          site = `chat · ${label} · ${name}`;
          if (name === "dish_suggest" && opts.libraryDish) { const r = await libraryOnly.suggest(ctx, input); dishSource = r.ok ? r.data.dish.source : "none"; return r; }
          const h = handlerOf(name);
          if (!h) return { ok: false, reason: "NOT_FOUND", message: `no tool ${name}` };
          const r: any = await h(ctx as any, input);
          if (name === "dish_suggest") dishSource = r.ok ? r.data.dish.source : "none";
          return r;
        },
      });
      for await (const chunk of stream) reply += chunk;
    } catch (e: any) { errors.push(`${e?.status ?? ""} ${e?.message ?? e}`.slice(0, 200)); }
    chatRows.push({ label, totalMs: Date.now() - t0, rounds, executed, dishSource, errors, reply });
    console.log(`\n### chat · ${label} (maxToolRounds ${maxToolRounds})\nrounds: ${JSON.stringify(rounds)}\nexecuted: ${executed.join(", ") || "none"} · dish source: ${dishSource ?? "-"} · total ${Date.now() - t0} ms\nerrors: ${errors.join(" | ") || "none"}\nreply: ${reply.replace(/\s+/g, " ").slice(0, 700)}`);
  };

  console.log(`model ${CLARA_MODEL}`);
  await chat("plain turn", "Hi Clara! In one or two sentences, what can you help me with?", 5);
  await chat("dish_suggest (generated)", "What should I cook for dinner tonight?", 5);
  await chat("dish_suggest (library dish forced)", "Can you suggest a lunch for me?", 5, { libraryDish: true });
  await chat("tool-round limit (1)", "Please look up my numbers for this week, what I logged today, AND plan today's dishes for a normal day — use your tools for each.", 1);

  // ── feedback triage ──
  site = "feedback triage";
  try {
    const { defaultTriageCaller } = await import("@/lib/feedback/triage");
    const out: any = await defaultTriageCaller("The dish card for a lentil stew said 180 g of fibre per serving, which can't be right.");
    console.log(`\n### triage\n${JSON.stringify(out).slice(0, 400)}`);
  } catch (e: any) { console.log(`\n### triage FAILED ${e?.message}`); }

  // ── fridge (same call style as cook-day and clara-swap: forced tool, thinking disabled, 5376 tokens) ──
  site = "fridge route";
  try {
    const fridge = await import("@/app/api/fridge/route");
    const res: any = await fridge.POST(req("POST", { ingredients: ["chickpeas", "spinach", "brown rice", "tomatoes", "onion"], mealType: "Dinner" }) as any);
    const body = await res.json();
    console.log(`\n### fridge ${res.status}: ${(body.recipes ?? []).map((r: any) => r.name).join("; ") || JSON.stringify(body).slice(0, 300)}`);
  } catch (e: any) { console.log(`\n### fridge FAILED ${e?.message}`); }

  // ── recipe-generation top-up: the model call; persistence is refused by the read-only store ──
  site = "recipe top-up (8 lunches)";
  try {
    const rg = await import("@/lib/clara/recipe-generation");
    const { buildDietMatchers, derivePatientBans } = await import("@/lib/diet-match");
    const lunch = snap.mealTypes.find((m) => m.name === "Lunch")!;
    const ids = await rg.generateAndPersistRecipes({
      requests: [{ mealTypeId: lunch.id, mealTypeName: "Lunch", count: 8, targetCalories: 550 }],
      bannedNames: [], matchers: buildDietMatchers(derivePatientBans(patient)), existingNames: new Set(),
    } as any);
    console.log(`\n### top-up: ${ids.length} ids (persistence expected to fail on the read-only store)`);
  } catch (e: any) { console.log(`\n### top-up threw after the model call (read-only store): ${String(e?.message).slice(0, 160)}`); }

  console.log(`\n### model calls through createAnthropic\n${recs.map((r) => `- ${r.site}: ${r.ms} ms, ttft ${r.ttftMs ?? "-"}, stop ${r.stop}, out ${r.outTokens}, error ${r.error ?? "none"} ${r.note ?? ""}`).join("\n")}`);
  console.log(`\nlive calls: ${calls} (cap ${CAP})`);
  (globalThis as any).__chatRows = chatRows;
})().catch((e) => { console.error(e); console.log(`live calls: ${calls}`); process.exit(1); });
