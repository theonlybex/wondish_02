// Clara-first LIVE sample — the REAL dish generator (one model call per person)
// for at most 8 hard profiles, against the in-memory store (no database), with
// every served dish judged by sim/oracle.ts. Opt-in and capped:
//
//   SIM_LIVE=1 npm run sim:clara-live     # report → docs/qa/clara-live-sample.md
//
// Hard cap: 8 people, one dish_suggest each; the product code's own retry
// policy (createAnthropic({ maxRetries: 0 }) in the dish skill) is unchanged.
// The only thing between the product and the API is a spy that records token
// usage and the raw candidates the model returned.
import "./clara-live-key"; // keeps the API key, drops database URLs — before setup
import "./setup";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { snap, state, ingByName } from "./setup";
import { createClaraStore } from "./fake-db";
import { makePatient, type RuleKey } from "./profiles";
import { makeOracle } from "./oracle";

if (process.env.SIM_LIVE !== "1") {
  console.log("sim:clara-live is opt-in: run with SIM_LIVE=1 (it calls the real model, at most 8 times).");
  process.exit(0);
}
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key) { console.log("No ANTHROPIC_API_KEY in .env.local — live sample skipped."); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key;

type Spy = { usage: { input_tokens: number; output_tokens: number }; candidates: unknown; stop: string | null; ms: number; rawInput: unknown; system: string };
const spies: Spy[] = [];
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    createAnthropic: (o: { timeout?: number; maxRetries?: number } = {}) => {
      const real = new Anthropic({ apiKey: key, timeout: o.timeout ?? 90_000, maxRetries: o.maxRetries ?? 1 });
      return { messages: { create: async (params: any, opts?: any) => {
        const t0 = Date.now();
        if (params.stream) {
          // The dish generator streams a schema-constrained answer: record it as it passes.
          const s: any = await real.messages.create(params, opts);
          const spy: Spy = { usage: { input_tokens: 0, output_tokens: 0 }, candidates: null, stop: null, ms: 0, rawInput: null, system: String(params.system ?? "") };
          spies.push(spy);
          return (async function* () {
            let text = "";
            try {
              for await (const ev of s) {
                if (ev.type === "message_start") spy.usage.input_tokens = ev.message.usage.input_tokens;
                if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") text += ev.delta.text;
                if (ev.type === "message_delta") { spy.usage.output_tokens = ev.usage.output_tokens; spy.stop = ev.delta.stop_reason; }
                yield ev;
              }
            } finally {
              spy.ms = Date.now() - t0;
              spy.rawInput = text;
              try { spy.candidates = JSON.parse(text).dishes; } catch { spy.candidates = null; }
            }
          })();
        }
        const msg = await real.messages.create(params);
        const tool = msg.content.find((b) => b.type === "tool_use") as any;
        spies.push({ usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }, candidates: tool?.input?.recipes ?? null, stop: msg.stop_reason, ms: Date.now() - t0, rawInput: tool?.input ?? msg.content, system: String(params.system ?? "") });
        return msg;
      } } };
    },
    HAIKU_MODEL: "claude-haiku-5-5",
    claraBusyStatus: () => null, CLARA_BUSY_MESSAGE: "Clara is busy — try again in a moment.", ANTHROPIC_TIMEOUT_MS: 90_000, ANTHROPIC_MAX_RETRIES: 1,
  },
});
const store = createClaraStore(snap);
(globalThis as any).prisma = store.client;

import { LIVE_PEOPLE as PEOPLE } from "./clara-live-people";

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const onboarding = await import("@/app/api/onboarding/route");
  const mealLog = await import("@/app/api/meal-log/route");
  const { dishSkill } = await import("@/lib/clara/skills/dish");
  const suggest = dishSkill.tools.find((t) => t.def.name === "dish_suggest")!.handler;
  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const ids = (kind: any, prefix: string, rules: RuleKey[]) => rules.filter((k) => k.startsWith(prefix)).map((k) => store.ref(kind, k.slice(prefix.length)).id);
  const today = "2026-11-12";
  const rows: string[] = [];
  let violations = 0, served = 0;
  // SIM_LIVE_ONLY="vegan+celiac,…" runs just those people (still at most 8 calls).
  const only = process.env.SIM_LIVE_ONLY?.split(",").map((x) => x.trim());
  const raw: { person: string; servings: number; system: string; stop: string | null; output: unknown }[] = [];
  for (const [i, p] of PEOPLE.slice(0, 8).entries()) {
    if (only && !only.includes(p.id)) continue;
    const clerkId = `clerk_live_${i}`;
    store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
    state.patient = { account: { clerkId } };
    const pr = await profile.PATCH(req("PATCH", {
      firstName: "Sim", lastName: "Live", birthday: "1990-04-02", sexAtBirth: i % 2 ? "MALE" : "FEMALE", height: 170, heightUnit: "cm", weight: 160,
      physicalActivityId: snap.physicalActivities[1].id, healthConditionIds: ids("healthCondition", "condition:", p.rules), foodAllergyIds: ids("foodAllergy", "allergy:", p.rules),
      foodPreferenceIds: ids("foodPreference", "diet:", p.rules),
    }) as any);
    if (pr.status !== 200) throw new Error(`${p.id}: profile ${pr.status}`);
    if (p.eating) await onboarding.PUT(req("PUT", { usualEating: p.eating, pills: [] }) as any);
    if (p.logs) {
      // Three days of two library meals: Clara works from logged levels.
      const lib = snap.recipes.filter((r) => r.fiber != null && r.fiber < 2).slice(i * 6, i * 6 + 6);
      for (const [j, r] of lib.entries()) await mealLog.POST(req("POST", { localDate: `2026-11-${String(9 + Math.floor(j / 2)).padStart(2, "0")}`, mealType: j % 2 ? "dinner" : "lunch", source: "RECIPE", recipeId: r.id }) as any);
    }
    const pid = store.tables.patient.find((x) => x.accountId === store.tables.account.find((a) => a.clerkId === clerkId).id).id;
    const ctx = { patientId: pid, accountId: "x", firstName: "Sim", isPremium: false, today, surface: "ios", disabledSkills: [] };
    const before = spies.length;
    const res: any = await suggest(ctx as any, { mealType: "dinner", ...(p.servings ? { servings: p.servings } : {}) });
    const spy = spies[before];
    if (spy) raw.push({ person: p.id, servings: p.servings ?? 1, system: spy.system, stop: spy.stop, output: spy.rawInput });
    const oracle = makeOracle(makePatient(snap, { id: p.id, tier: "curated", rules: p.rules }) as any, p.rules);
    const offered = Array.isArray(spy?.candidates) ? (spy!.candidates as any[]) : [];
    const offeredBad = offered.filter((d) => oracle.judgeMany((d.usesIngredients ?? d.ingredients?.map((x: any) => x.name) ?? []).map((n: string) => ({ name: n, allergenGroups: ingByName.get(n.toLowerCase())?.allergenGroups ?? [] }))).some((v) => v.engine.length || v.groups.length));
    if (!res.ok) {
      rows.push(`| ${p.id} | — (${res.reason}: couldn't make one that fits) | — | ${offered.map((d) => d.name).join("; ")} (${offeredBad.length} broke a rule) | ${spy?.usage.input_tokens ?? 0}/${spy?.usage.output_tokens ?? 0} |`);
      continue;
    }
    const dish = res.parts.find((x: any) => x.kind === "dish");
    served++;
    const items = dish.recipe.ingredients.map((x: any) => ({ name: x.name, allergenGroups: ingByName.get(String(x.name).toLowerCase())?.allergenGroups ?? [] }));
    const bad = oracle.judgeMany(items).map((v, k) => ({ v, n: items[k].name })).filter(({ v }) => v.engine.length || v.groups.length);
    if (bad.length) violations++;
    const wording = [JSON.stringify(res.data.levels), ...(dish.reasons ?? []).map((r: any) => r.text), res.data.note ?? ""].join(" · ").replace(/\|/g, "/");
    rows.push(`| ${p.id} | ${dish.name} (${dish.minutes} min, ${dish.calories} kcal, serves ${dish.recipe.servings}) ${bad.length ? `**VIOLATION: ${bad.map((b) => b.n).join(", ")}**` : "— passes the oracle"}; ingredients: ${dish.recipe.ingredients.map((x: any) => x.name).join(", ")} | ${wording.slice(0, 400)} | ${offered.map((d) => d.name).join("; ")} (${offeredBad.length} broke a rule) | ${spy?.usage.input_tokens ?? 0}/${spy?.usage.output_tokens ?? 0} |`);
  }
  const tin = spies.reduce((a, s) => a + s.usage.input_tokens, 0), tout = spies.reduce((a, s) => a + s.usage.output_tokens, 0);
  const lines = [
    `# Clara live sample — the real dish generator`, ``,
    `Run ${new Date().toISOString()} · ${PEOPLE.length} people · ${spies.length} model calls (claude-haiku-5-5, the product's CLARA_MODEL) · ${tin} input / ${tout} output tokens · ${served} dishes served, ${violations} breaking a rule (oracle).`, ``,
    `In-memory store, no database. One dish_suggest per person; the product's own gates decide what is served.`, ``,
    `| Person | Served dish | What Clara is handed (levels, reasons, note) | Model's raw candidates | Tokens in/out |`, `|---|---|---|---|---|`, ...rows, ``,
  ];
  // The model's raw tool input per person, for offline replay through the gates (sim/clara-gate-replay.ts).
  writeFileSync(join(__dirname, ".snapshot", "clara-live-raw.json"), JSON.stringify(raw, null, 1));
  if (!only) writeFileSync(join(__dirname, "..", "docs", "qa", "clara-live-sample.md"), lines.join("\n"));
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
