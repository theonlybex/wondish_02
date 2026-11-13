// Live check for "help me cook eggs" (dish_suggest's `wants`): does Clara call
// dish_suggest with wants, does a dish card come back, how long does it take,
// and does the served dish keep every rule. Real model through the real chat
// loop and the real dish handler; the in-memory store only
// (sim/clara-live-key.ts drops every database URL). At most COOK_CAP live
// calls (default and maximum 12), no retries: every call is counted.
//
//   SIM_LIVE=1 TZ=UTC node --env-file=.env.local --experimental-test-module-mocks --import tsx sim/clara-cook-request-live.sim.ts
//
// COOK_ONLY="2,5" runs only those cases (1-based). COOK_STOP_AFTER_TOOL=1 ends
// a chat once its tool has run (no closing round: one call fewer, no reply).
// COOK_DIRECT=1 skips the chat and calls the dish generator once per chosen
// case with a trace, printing what the model wrote and where each candidate
// ended (one live call per case).
import "./clara-live-key";
import "./setup";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { snap, state, ingByName } from "./setup";
import { createClaraStore } from "./fake-db";
import { makeOracle } from "./oracle";
import type { RuleKey } from "./profiles";

if (process.env.SIM_LIVE !== "1") { console.log("opt-in: SIM_LIVE=1"); process.exit(0); }
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key) { console.log("no key"); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key;
const CAP = Math.min(16, Number(process.env.COOK_CAP ?? 12));
let calls = 0;
const spend = () => { if (++calls > CAP) throw new Error(`cook-request: cap ${CAP} reached`); };

// Haiku 5.5 list prices (lib/anthropic.ts): $0.10 / $0.50 per 1M input / output tokens.
const usd = (inTok: number, outTok: number) => (inTok * 0.1 + outTok * 0.5) / 1_000_000;
let cost = 0;
let costIsEstimate = false;

type DishCall = { ms: number; inTokens: number; outTokens: number | null; chars: number; stop: string | null; system: string; text: string };
let dishCalls: DishCall[] = [];
const real = new Anthropic({ apiKey: key });
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    HAIKU_MODEL: "claude-haiku-5-5",
    createAnthropic: (o: { timeout?: number } = {}) => ({
      messages: {
        create: async (params: any, opts?: any) => {
          spend();
          const rec: DishCall = { ms: 0, inTokens: 0, outTokens: null, chars: 0, stop: null, system: String(params.system ?? ""), text: "" };
          dishCalls.push(rec);
          const t0 = Date.now();
          const s: any = await real.withOptions({ timeout: o.timeout ?? 90_000, maxRetries: 0 }).messages.create(params, opts);
          return (async function* () {
            try {
              for await (const ev of s) {
                if (ev.type === "message_start") rec.inTokens = ev.message.usage.input_tokens + (ev.message.usage.cache_read_input_tokens ?? 0) + (ev.message.usage.cache_creation_input_tokens ?? 0);
                if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { rec.chars += ev.delta.text.length; rec.text += ev.delta.text; }
                if (ev.type === "message_delta") { rec.stop = ev.delta.stop_reason; rec.outTokens = ev.usage.output_tokens; }
                yield ev;
              }
            } finally {
              rec.ms = Date.now() - t0;
              rec.stop ??= "stopped early by the caller";
              // A stream stopped at the first fitting dish reports no output count: estimate it from the text.
              if (rec.outTokens == null) costIsEstimate = true;
              cost += usd(rec.inTokens, rec.outTokens ?? Math.round(rec.chars / 3));
            }
          })();
        },
      },
    }),
    claraBusyStatus: (err: any) => (err?.status === 429 ? 429 : err?.status === 529 ? 503 : null),
    CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.", ANTHROPIC_TIMEOUT_MS: 90_000, ANTHROPIC_MAX_RETRIES: 1,
  },
});
const store = createClaraStore(snap);
(globalThis as any).prisma = store.client;

type Case = {
  label: string; says: string; rules: RuleKey[]; expectWants: boolean; direct?: Record<string, unknown>;
  /** Ends the chat once its tool has run (no closing round, no reply). */
  stopAfterTool?: boolean;
  /** Runs as the next turn of that case's chat (its saved history comes first). */
  after?: number;
};
// COOK_SET picks the list: "wants" (the first check, 2026-11-12), "router" (the intent router).
const SET = process.env.COOK_SET ?? "wants";
const ONLY = process.env.COOK_ONLY ? new Set(process.env.COOK_ONLY.split(",").map((x) => Number(x.trim()))) : null;
const STOP_AFTER_TOOL = process.env.COOK_STOP_AFTER_TOOL === "1";
const DIRECT = process.env.COOK_DIRECT === "1";
const ROUTER_CASES: Case[] = [
  { label: "cook eggs", says: "help me cook eggs", rules: [], expectWants: true },
  { label: "pancakes, coeliac", says: "how do I make pancakes", rules: ["condition:Celiac Disease"], expectWants: true, stopAfterTool: true },
  { label: "bare what should I eat", says: "What should I eat?", rules: [], expectWants: false },
  { label: "something else, after a dish", says: "something else", rules: [], expectWants: false, stopAfterTool: true, after: 3 },
  { label: "plan today's dishes", says: "plan today's dishes", rules: [], expectWants: false },
  { label: "boil an egg (no card)", says: "how long do I boil an egg?", rules: [], expectWants: false, stopAfterTool: true },
  { label: "is salmon ok (no card)", says: "is salmon ok for me?", rules: [], expectWants: false, stopAfterTool: true },
  { label: "I cooked eggs (no card)", says: "I cooked eggs this morning", rules: [], expectWants: false, stopAfterTool: true },
  { label: "cook eggs, egg allergy", says: "help me cook eggs", rules: ["allergy:Eggs"], expectWants: true },
];
const WANTS_CASES: Case[] = [
  { label: "cook eggs, no restrictions", says: "help me cook eggs", rules: [], expectWants: true },
  { label: "cook eggs, egg allergy", says: "help me cook eggs", rules: ["allergy:Eggs"], expectWants: true },
  { label: "pancakes, coeliac", says: "how do I make pancakes", rules: ["condition:Celiac Disease"], expectWants: true, direct: { mealType: "breakfast", wants: "pancakes" } },
  { label: "control: what should I eat", says: "What should I eat?", rules: [], expectWants: false },
  { label: "control: what should I eat for dinner", says: "What should I eat for dinner?", rules: [], expectWants: false },
];

const CASES = SET === "router" ? ROUTER_CASES : WANTS_CASES;

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const { ALL_SKILLS, RUNTIME_SKILLS, buildToolDefs, buildSystemPrompt } = await import("@/lib/clara/registry");
  const { memorySkill } = await import("@/lib/clara/skills/memory");
  const { askChoicesSkill } = await import("@/lib/clara/ask-choices");
  const { createAnthropicClient, CLARA_MODEL } = await import("@/lib/clara/anthropic-client");
  const { startClaraLoop } = await import("@/lib/clara/loop");
  const { buildFoodMapText, PATIENT_FOOD_MAP_INCLUDE } = await import("@/lib/food-map");
  const { buildDietMatchers, derivePatientBans } = await import("@/lib/diet-match");
  const { routeIntent, mealForNowLine } = await import("@/lib/clara/chat-service");
  // 18:30 for the person (offset 0): the meal for now is dinner.
  const NOW = new Date("2026-11-12T18:30:00Z");
  const saved = new Map<number, { messages: any[]; ctx: any; system: string; oracle: any; matchers: any }>();
  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const ids = (kind: any, prefix: string, rules: RuleKey[]) => rules.filter((k) => k.startsWith(prefix)).map((k) => store.ref(kind, k.slice(prefix.length)).id);
  const today = "2026-11-12";
  const active = [...ALL_SKILLS, memorySkill, askChoicesSkill, ...RUNTIME_SKILLS];
  const tools = buildToolDefs(active);
  const handlerOf = (name: string) => active.flatMap((s) => s.tools).find((t) => t.def.name === name)?.handler;

  console.log(`model ${CLARA_MODEL} · cap ${CAP} live calls`);
  const rows: string[] = [];
  let n = 0;
  const dishMod: any = await import("@/lib/clara/skills/dish");
  const { summarizeLevels } = await import("@/lib/levels");
  for (const c of CASES) {
    n++;
    if (ONLY && !ONLY.has(n)) continue;
    const clerkId = `clerk_cook_${n}`;
    store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
    state.patient = { account: { clerkId } };
    const pr = await profile.PATCH(req("PATCH", {
      firstName: "Sam", lastName: "Cook", birthday: "1990-04-02", sexAtBirth: "FEMALE", height: 170, heightUnit: "cm", weight: 150,
      physicalActivityId: snap.physicalActivities[1].id,
      healthConditionIds: ids("healthCondition", "condition:", c.rules), foodAllergyIds: ids("foodAllergy", "allergy:", c.rules),
    }) as any);
    if (pr.status !== 200) throw new Error(`${c.label}: profile ${pr.status}`);
    const acc = store.tables.account.find((a: any) => a.clerkId === clerkId);
    const pid = store.tables.patient.find((x: any) => x.accountId === acc.id).id;
    const patient = await (globalThis as any).prisma.patient.findFirst({ where: { id: pid }, include: PATIENT_FOOD_MAP_INCLUDE });
    const oracle = makeOracle(patient, c.rules);
    const matchers = buildDietMatchers(derivePatientBans(patient, new Date(`${today}T12:00:00`)));
    const ctx = { patientId: pid, accountId: acc.id, firstName: "Sam", isPremium: true, today, surface: "ios", disabledSkills: [] };
    let system = buildSystemPrompt("Sam", buildFoodMapText(patient), active, today, "assistant", SET === "router" ? mealForNowLine("Sam", 0, NOW) : "");
    const prior = c.after !== undefined ? saved.get(c.after) : undefined;
    if (c.after !== undefined && !prior) { console.log(`\n### ${c.label}: NOT RUN (case ${c.after} did not leave a chat to continue)`); continue; }
    let turnCtx: any = ctx, turnOracle = oracle, turnMatchers = matchers;
    if (prior) { system = prior.system; turnCtx = prior.ctx; turnOracle = prior.oracle; turnMatchers = prior.matchers; }
    const history: any[] = prior ? prior.messages : [];
    const forceFirst = SET === "router" ? routeIntent(c.says, history, active) : undefined;
    let choices: any = null;
    let lastRequest: any = null;

    dishCalls = [];
    if (DIRECT) {
      // The generator alone, with its trace: what the model wrote, and where each candidate ended.
      const input = c.direct ?? { mealType: "dinner" };
      const trace: string[] = [];
      const ask = { ...input, summary: summarizeLevels([], null, { fromDate: "2026-11-06", toDate: today }) };
      const quiet = console.info;
      console.info = () => {};
      let got: any[] = [];
      try { got = await dishMod.liveDishDeps.generate({ ...ctx }, ask, { accept: () => false, trace: (e: any) => trace.push(`${e.name} → ${e.stage} (${e.ms} ms)`) }); } finally { console.info = quiet; }
      const written = [...(dishCalls[0]?.text ?? "").matchAll(/"name":\s*"([^"]+)",\s*"description"/g)].map((m) => m[1]);
      console.log(`\n### DIRECT ${c.label} ${JSON.stringify(input)}\nthe model named its dishes: ${written.join(" | ") || "?"}\ntrace: ${trace.join(" ; ") || "none"}\nafter the gates: ${got.map((r) => r.name).join(" | ") || "none"}\nmodel call ${dishCalls[0]?.ms} ms, stop ${dishCalls[0]?.stop}`);
      continue;
    }
    const toolCalls: { name: string; input: any; ms: number; result: any }[] = [];
    const errors: string[] = [];
    let reply = "";
    const base = createAnthropicClient(real.withOptions({ timeout: 55_000, maxRetries: 0 }) as any, (u) => {
      cost += usd(u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens);
    });
    const client = {
      openRound: async (r: any) => {
        if ((STOP_AFTER_TOOL || c.stopAfterTool) && toolCalls.length > 0) throw new Error("stopped after the tool");
        spend();
        lastRequest = r;
        return base.openRound(r);
      },
    };
    const before = calls;
    const t0 = Date.now();
    try {
      const stream = await startClaraLoop({
        client, system, tools, messages: [...history, { role: "user", content: c.says }], maxToolRounds: 1, writesAllowed: false, partsEnabled: true,
        ...(forceFirst ? { forceFirst } : {}),
        onChoices: (ch: any) => { choices = ch; },
        onError: (e) => errors.push(String((e as Error)?.message ?? e).slice(0, 160)),
        execute: async (name, input) => {
          const h = handlerOf(name);
          const t = Date.now();
          const quiet = console.info;
          console.info = () => {};
          let result: any;
          try { result = h ? await h(turnCtx as any, input) : { ok: false, reason: "NOT_FOUND", message: `no tool ${name}` }; } finally { console.info = quiet; }
          toolCalls.push({ name, input, ms: Date.now() - t, result });
          return result;
        },
      });
      for await (const chunk of stream) reply += typeof chunk === "string" ? chunk : "";
    } catch (e: any) { errors.push(`${e?.status ?? ""} ${e?.message ?? e}`.slice(0, 200)); }
    const totalMs = Date.now() - t0;

    const suggest = toolCalls.find((t) => t.name === "dish_suggest");
    const part = suggest?.result?.ok ? (suggest.result.parts ?? []).find((p: any) => p.kind === "dish") : null;
    const stepsPart = suggest?.result?.ok ? (suggest.result.parts ?? []).find((p: any) => p.kind === "steps") : null;
    let verdict = "-";
    if (part) {
      const items = part.recipe.ingredients.map((x: any) => ({ name: x.name, allergenGroups: ingByName.get(String(x.name).toLowerCase())?.allergenGroups ?? [] }));
      const bad = turnOracle.judgeMany(items).map((v, k) => ({ v, name: items[k].name })).filter(({ v }) => v.engine.length || v.groups.length);
      // Allergies are judged on every word shown: the name and each step too.
      const prose = [part.name, ...part.recipe.steps].join(" \n ");
      const proseHit = turnMatchers.allergyMatchers.filter((m: RegExp) => m.test(prose)).map((m: any) => m.term);
      verdict = bad.length || proseHit.length ? `VIOLATION: ${[...bad.map((b) => b.name), ...proseHit].join(", ")}` : "pass";
    }
    // The chat as the next turn would get it from the store: tool calls and results, no thinking blocks.
    if (lastRequest && errors.length === 0) {
      const replay = lastRequest.messages.map((m: any) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((b: any) => b.type !== "thinking" && b.type !== "redacted_thinking" && !(b.type === "text" && /No more tool calls/.test(b.text))) } : m));
      saved.set(n, { messages: [...replay, { role: "assistant", content: reply }], ctx: turnCtx, system, oracle: turnOracle, matchers: turnMatchers });
    }
    const wants = suggest ? (suggest.input.wants ?? null) : null;
    const wantsOk = suggest ? (c.expectWants ? typeof wants === "string" : wants === null) : false;
    const gen = dishCalls[0];
    console.log([
      ``,
      `### ${c.label} — "${c.says}" (rules: ${c.rules.join(", ") || "none"})`,
      SET === "router" ? `router: ${forceFirst ? `forced ${forceFirst.tool}${forceFirst.fill ? ` (fill ${JSON.stringify(forceFirst.fill)})` : ""}` : "null (left to the model)"} · forced tool called: ${forceFirst ? (forceFirst.tool === "ask_choices" ? (choices ? "yes" : "NO") : toolCalls[0]?.name === forceFirst.tool ? "yes" : "NO") : "-"}` : ``,
      choices ? `answer boxes: "${choices.question}" → ${JSON.stringify(choices.options)}` : ``,
      `card: ${toolCalls.some((t) => t.result?.ok && (t.result.parts ?? []).some((p: any) => p.kind === "dish")) ? "yes" : "no"}`,
      `tools called: ${toolCalls.map((t) => `${t.name} ${JSON.stringify(t.input)} (${t.ms} ms)`).join("; ") || "none"}`,
      `dish_suggest with wants: ${suggest ? (wants !== null ? `yes ("${wants}")` : "no wants") : "not called"} · as expected: ${wantsOk ? "yes" : "NO"}`,
      suggest ? `tool result: ${suggest.result.ok ? `dish "${suggest.result.data.dish.name}" · source ${suggest.result.data.dish.source} · answersRequest ${suggest.result.data.dish.answersRequest ?? "-"} · ${part?.minutes} min · steps ${stepsPart?.steps.length ?? 0} (timers on ${stepsPart?.steps.filter((s: any) => s.timerMinutes != null).length ?? 0})` : `no dish — ${suggest.result.message}`}` : `tool result: -`,
      part ? `ingredients: ${part.recipe.ingredients.map((x: any) => x.name).join(", ")}` : ``,
      `request line in the generator prompt: ${gen ? (/THE REQUEST: they asked to cook/.test(gen.system) ? "yes" : "no") : "no model call for a dish"}`,
      `rule check on the served dish: ${verdict}`,
      `time: whole turn ${totalMs} ms · dish tool ${suggest?.ms ?? "-"} ms · dish model call ${gen ? `${gen.ms} ms (${gen.stop})` : "-"}`,
      `live calls this case: ${calls - before} · errors: ${errors.join(" | ") || "none"}`,
      `reply: ${reply.replace(/\s+/g, " ").slice(0, 600)}`,
    ].filter((l) => l !== ``).join("\n"));
    rows.push(`| ${c.label} | ${suggest ? (wants !== null ? `yes, wants "${wants}"` : "yes, no wants") : "no tool call"} | ${part ? `yes: ${part.name} (${suggest!.result.data.dish.source})` : "no"} | ${(totalMs / 1000).toFixed(1)} s (dish tool ${suggest ? (suggest.ms / 1000).toFixed(1) : "-"} s) | ${verdict === "-" ? "no dish served" : verdict} |`);
  }
  console.log(`\n| Case | dish_suggest called | Dish came back | Time | Rule check |\n|---|---|---|---|---|\n${rows.join("\n")}`);
  console.log(`\nlive calls: ${calls} (cap ${CAP}) · cost ${costIsEstimate ? "about " : ""}$${cost.toFixed(4)} at $0.10 / $0.50 per 1M tokens (cache writes counted at the plain input price)`);
})().catch((e) => { console.error(e); console.log(`live calls: ${calls}`); process.exit(1); });
