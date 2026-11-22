// LIVE check for one question: does Clara follow the person's at-home and
// favourite foods when she suggests dishes? (docs/superpowers/specs/2026-11-21-clara-ingredients-design.md)
// The REAL dish model through the product's own dish_suggest handler
// (makeDishHandlers with liveDishDeps), the in-memory store only (no database:
// sim/clara-live-key.ts drops every database URL). The marks are written to the
// store's PatientPantryItem / PatientIngredientPreference tables, so the dish
// skill reads them the way it does in production (loadKeptMarks, keptFoodsFrom).
//
//   SIM_LIVE=1 npm run sim:clara-kept-foods      (real model, at most SIM_CALL_CAP calls)
//   SIM_DRY=1  npm run sim:clara-kept-foods      (no model: library fallback only, free)
//
// Env: SIM_OUT (default sim/.snapshot/kept-foods-live.jsonl, or kept-foods-dry.jsonl when dry),
// SIM_CALL_CAP (default 40, across all runs: sim/.snapshot/kept-foods-live-ledger.json),
// SIM_ONLY="A|C" runs only those scenarios. Rows are appended as they finish; a
// request already in SIM_OUT is skipped, so a stopped run resumes without
// spending a call twice. The summary is printed from every row in SIM_OUT.
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
import { breaksProteinRule, foodMatches, proteinKey, proteinRuleOn, splitKeptFoods, type KeptFoods } from "@/lib/clara/kept-foods";

const DRY = process.env.SIM_DRY === "1";
if (process.env.SIM_LIVE !== "1" && !DRY) {
  console.log("sim:clara-kept-foods is opt-in: SIM_LIVE=1 (real model, counted against SIM_CALL_CAP) or SIM_DRY=1 (no model).");
  process.exit(0);
}
const key = (globalThis as any).__simLiveKey as string | undefined;
if (!key && !DRY) { console.log("No ANTHROPIC_API_KEY in .env.local — skipped."); process.exit(0); }
process.env.ANTHROPIC_API_KEY = key ?? "sim-dry-never-sent";

const OUT = process.env.SIM_OUT ?? join(__dirname, ".snapshot", DRY ? "kept-foods-dry.jsonl" : "kept-foods-live.jsonl");
const CAP = Number(process.env.SIM_CALL_CAP ?? 40);
const LEDGER = join(__dirname, ".snapshot", "kept-foods-live-ledger.json");
const ledger: { calls: number; models: Record<string, number> } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { calls: 0, models: {} };
const spend = (model: string) => {
  if (existsSync(LEDGER)) Object.assign(ledger, JSON.parse(readFileSync(LEDGER, "utf8")));
  if (ledger.calls >= CAP) throw new Error(`sim: live call cap ${CAP} reached`);
  ledger.calls++;
  ledger.models[model] = (ledger.models[model] ?? 0) + 1;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
};

// ── the spy between the product and the API (same shape as clara-fast-live) ──
type CallRec = { model: string; ms: number; inTokens: number; outTokens: number | null; stop: string | null; aborted: boolean; error?: string };
const calls: CallRec[] = [];
const realClient = key ? new Anthropic({ apiKey: key }) : null;
mock.module(pathToFileURL(join(__dirname, "..", "lib", "anthropic.ts")).href, {
  namedExports: {
    HAIKU_MODEL: "claude-haiku-5-5",
    createAnthropic: (o: { timeout?: number; maxRetries?: number } = {}) => ({
      messages: {
        create: async (params: any, opts?: { signal?: AbortSignal }) => {
          const rec: CallRec = { model: params.model, ms: 0, inTokens: 0, outTokens: null, stop: null, aborted: false };
          calls.push(rec);
          const t0 = Date.now();
          if (DRY) {
            rec.model = `${params.model} (dry)`;
            if (!params.stream) return { content: [{ type: "tool_use", id: "t", name: "suggest_recipes", input: { recipes: [] } }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "tool_use" };
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
          let s: any;
          try { s = await client.messages.create(params, opts); } catch (e) { rec.ms = Date.now() - t0; rec.error = (e as Error).message; throw e; }
          return (async function* () {
            try {
              for await (const ev of s) {
                if (ev.type === "message_start") rec.inTokens = ev.message.usage.input_tokens + (ev.message.usage.cache_read_input_tokens ?? 0) + (ev.message.usage.cache_creation_input_tokens ?? 0);
                if (ev.type === "message_delta") { rec.outTokens = ev.usage.output_tokens; rec.stop = ev.delta.stop_reason; }
                yield ev;
              }
            } catch (e) { rec.aborted = true; throw e; }
            finally { rec.ms = Date.now() - t0; if (rec.outTokens == null) rec.aborted = true; }
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
type Ask = { meal: "breakfast" | "lunch" | "dinner" | "snack"; wants?: string; label?: string };
type Scenario = {
  id: string; title: string; rules: RuleKey[]; atHome: string[]; favourites: string[];
  /** At-home foods the person's diet hides (the dish skill drops them before the rule). */
  hiddenByDiet?: string[];
  asks: Ask[];
  /** Asks (by label, or all when absent) where a rule break is a failure. */
  mustKeepRule: (a: Ask) => boolean;
};
const MARKS_A = ["Salmon fillets", "Ground beef", "Spinach", "Jasmine rice", "Large eggs"];
const rep = (n: number, a: Ask): Ask[] => Array.from({ length: n }, () => ({ ...a }));
const SCENARIOS: Scenario[] = [
  { id: "A", title: "at home: salmon + ground beef", rules: [], atHome: MARKS_A, favourites: [],
    asks: [...rep(4, { meal: "dinner" }), ...rep(3, { meal: "lunch" }), ...rep(2, { meal: "breakfast" }), ...rep(1, { meal: "snack" })], mustKeepRule: () => true },
  { id: "B", title: "A + favourite salmon", rules: [], atHome: MARKS_A, favourites: ["Salmon fillets"], asks: rep(4, { meal: "dinner" }), mustKeepRule: () => true },
  { id: "C", title: "A + requests", rules: [], atHome: MARKS_A, favourites: [],
    asks: [...rep(2, { meal: "dinner", wants: "a chicken dish", label: "chicken" }), ...rep(2, { meal: "dinner", wants: "a stir-fry", label: "stir-fry" })],
    mustKeepRule: (a) => a.label === "stir-fry" },
  { id: "D", title: "control: nothing marked", rules: [], atHome: [], favourites: [], asks: rep(3, { meal: "dinner" }), mustKeepRule: () => false },
  { id: "E", title: "at home salmon; favourite chicken (not at home)", rules: [], atHome: ["Salmon fillets"], favourites: ["Boneless chicken breasts"], asks: rep(2, { meal: "dinner" }), mustKeepRule: () => true },
  { id: "F", title: "fish allergy; at home salmon + ground beef", rules: ["allergy:Fish"], atHome: ["Salmon fillets", "Ground beef"], favourites: [],
    hiddenByDiet: ["Salmon fillets"], asks: rep(2, { meal: "dinner" }), mustKeepRule: () => true },
];

const groupOf = new Map(INGREDIENT_CATALOG.flatMap((c) => c.items.map((n) => [n, c.key] as const)));
/** The sim's own view of the marks, built from the scenario (not from what the product loaded). */
function expectedKept(s: Scenario): KeptFoods {
  const names = new Set([...s.atHome, ...s.favourites].filter((n) => !(s.hiddenByDiet ?? []).includes(n)));
  return splitKeptFoods([...names].map((name) => ({ name, groupKey: groupOf.get(name) ?? "?", atHome: s.atHome.includes(name), favorite: s.favourites.includes(name) })));
}

const done = new Set<string>(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.scenario}|${r.n}`; }) : []);
const only = process.env.SIM_ONLY?.split("|").map((x) => x.trim());

(async () => {
  const { NextRequest } = await import("next/server");
  const profile = await import("@/app/api/patient/profile/route");
  const dishMod: any = await import("@/lib/clara/skills/dish");
  const keptDb = await import("@/lib/clara/kept-foods-db");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");
  const { PATIENT_FOOD_MAP_INCLUDE } = await import("@/lib/food-map");
  // Every candidate the model wrote and where it ended (diagnostics only; same wrap as clara-fast-live).
  let traces: { meal: string; ms: number; name: string; stage: string }[] = [];
  const handlers = dishMod.makeDishHandlers({ ...dishMod.liveDishDeps, generate: (c: any, a: any, o: any) => dishMod.liveDishDeps.generate(c, a, { ...o, trace: (e: any) => traces.push({ meal: a.mealType, ...e }) }) });
  const req = (method: string, body: unknown) => new NextRequest(new URL("http://sim.local/api"), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const ids = (kind: any, prefix: string, rules: RuleKey[]) => rules.filter((k) => k.startsWith(prefix)).map((k) => store.ref(kind, k.slice(prefix.length)).id);
  const idOf = (name: string) => { const i = snap.ingredients.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!i) throw new Error(`no ingredient ${name}`); return i.id; };

  let pi = 0;
  for (const s of SCENARIOS) {
    pi++;
    if (only && !only.includes(s.id)) continue;
    if (s.asks.every((_, n) => done.has(`${s.id}|${n + 1}`))) continue;
    const clerkId = `clerk_kept_${s.id}`;
    store.seedAccount(clerkId, `${clerkId}@sim.invalid`);
    state.patient = { account: { clerkId } } as any;
    const pr = await profile.PATCH(req("PATCH", {
      firstName: "Sim", lastName: "Kept", birthday: "1988-03-14", sexAtBirth: pi % 2 ? "FEMALE" : "MALE", height: 168, heightUnit: "cm", weight: 150,
      physicalActivityId: snap.physicalActivities[1].id,
      healthConditionIds: ids("healthCondition", "condition:", s.rules), foodAllergyIds: ids("foodAllergy", "allergy:", s.rules),
      foodPreferenceIds: ids("foodPreference", "diet:", s.rules), foodToAvoidIds: ids("foodToAvoid", "avoid:", s.rules), motivationIds: [],
    }) as any);
    if (pr.status !== 200) throw new Error(`${s.id}: profile ${pr.status} ${JSON.stringify(await pr.json())}`);
    const accountId = store.tables.account.find((a: any) => a.clerkId === clerkId).id;
    const pid = store.tables.patient.find((x: any) => x.accountId === accountId).id;
    for (const n of s.atHome) await store.client.patientPantryItem.create({ data: { patientId: pid, ingredientId: idOf(n) } });
    for (const n of s.favourites) await store.client.patientIngredientPreference.create({ data: { patientId: pid, ingredientId: idOf(n), liked: true } });

    // Wiring check: what the product's own loader sees for this person (not the sim's expectation).
    const dietPatient = await (globalThis as any).prisma.patient.findFirst({ where: { id: pid }, include: PATIENT_FOOD_MAP_INCLUDE });
    const matchers = buildDietMatchers(derivePatientBans(dietPatient, new Date("2026-11-21T12:00:00")));
    const productKept = await keptDb.keptFoodsFrom(await keptDb.loadKeptMarks(pid), matchers);
    const kept = expectedKept(s);
    console.log(`\n── ${s.id}: ${s.title}\n   product sees: ${JSON.stringify(productKept)}\n   sim expects proteinKeys ${JSON.stringify(kept.proteinKeys)}, favourites ${JSON.stringify(kept.favorites)}`);
    if (JSON.stringify([...productKept.proteinKeys].sort()) !== JSON.stringify([...kept.proteinKeys].sort()))
      console.log(`   !! the product's protein keys differ from the sim's expectation`);
    const oracle = makeOracle(makePatient(snap, { id: `kept-${s.id}`, tier: "curated", rules: s.rules }) as any, s.rules);

    for (const [k, ask] of s.asks.entries()) {
      const n = k + 1;
      if (done.has(`${s.id}|${n}`)) continue;
      // A different day per request: the library seed and the model's context both change.
      const today = `2026-11-${String(1 + ((pi * 7 + n * 3) % 28)).padStart(2, "0")}`;
      const ctx = { patientId: pid, accountId, firstName: "Sim", isPremium: false, today, surface: "ios", disabledSkills: [] };
      const input: Record<string, unknown> = { mealType: ask.meal, ...(ask.wants ? { wants: ask.wants } : {}) };
      const before = calls.length;
      traces = [];
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
      const d = res?.ok ? res.data.dish : null;
      const part = d ? (res.parts ?? []).find((x: any) => x.kind === "dish" && x.dishId === d.dishId) : null;
      const steps = d ? (res.parts ?? []).find((x: any) => x.kind === "steps" && x.dishId === d.dishId) : null;
      const ingredients: string[] = part?.recipe?.ingredients?.map((x: any) => String(x.name)) ?? [];
      const meats = [...new Set(ingredients.map(proteinKey).filter((x): x is string => x !== null))];
      const ruleOn = proteinRuleOn(kept, ask.wants);
      const breaks = d ? breaksProteinRule(ingredients, kept) : null;
      const nameMeat = d ? proteinKey(d.name) : null;
      const stepMeats = [...new Set((steps?.steps ?? []).map((x: any) => proteinKey(String(x.text))).filter((x: string | null): x is string => x !== null))];
      const favouriteIn = kept.favorites.filter((f) => ingredients.some((i) => foodMatches(f, i)));
      let oracleVerdict: string | null = null;
      if (d) {
        const items = ingredients.map((name) => ({ name, allergenGroups: ingByName.get(name.toLowerCase())?.allergenGroups ?? [] }));
        const bad = oracle.judgeMany(items).map((v, j) => ({ v, n: items[j].name })).filter(({ v }) => v.engine.length || v.groups.length);
        oracleVerdict = bad.length ? `VIOLATION: ${bad.map((b) => b.n).join(", ")}` : "pass";
      }
      const row = {
        scenario: s.id, n, title: s.title, meal: ask.meal, request: ask.wants ?? null, today, dry: DRY,
        ok: !!d, failure: d ? null : (thrown ?? res?.message ?? res?.reason ?? "no dish"),
        dishName: d?.name ?? null, source: d ? (d.source === "library" ? "library" : "generated") : null,
        ingredients, meats, nameMeat, stepMeats,
        ruleApplies: ruleOn, mustKeepRule: s.mustKeepRule(ask), breaksProteinRule: breaks,
        favouriteIn, oracle: oracleVerdict,
        keptProteinKeys: kept.proteinKeys, productProteinKeys: productKept.proteinKeys,
        candidates: traces.map((t) => ({ name: t.name, stage: t.stage, meats: [...new Set(t.name ? [proteinKey(t.name)].filter(Boolean) : [])] })),
        latencyMs, modelCalls: mine.length,
        calls: mine.map((c) => ({ model: c.model, ms: c.ms, inTokens: c.inTokens, outTokens: c.outTokens, stop: c.stop, aborted: c.aborted, error: c.error ?? null })),
        warnings: warns.filter((w) => w.includes("[clara-dish]")),
      };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      const flag = row.mustKeepRule && breaks ? "  << BREAKS THE RULE" : "";
      console.log(`${s.id}#${n} ${ask.meal}${ask.wants ? ` "${ask.wants}"` : ""}: ${d ? `${row.source} "${d.name}" meats=[${meats.join(", ")}]${favouriteIn.length ? ` fav=${favouriteIn.join(",")}` : ""} · ${oracleVerdict}` : `NO DISH (${row.failure})`} · ${latencyMs} ms · ${mine.length} call(s)${mine.some((c) => c.error) ? ` ERROR ${mine.find((c) => c.error)!.error}` : ""}${flag}`);
      if (mine.some((c) => c.error && /credit|quota|billing|authentication|permission|rate|ENOTFOUND|ECONN|network/i.test(c.error))) {
        console.log("sim: stopping on an account/quota/network error (no retry).");
        process.exit(2);
      }
    }
  }

  // ── summary from every row in OUT ──────────────────────────────────────────
  const rows: any[] = readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const main = (r: any) => (r.meats.length ? r.meats.join("+") : "no meat/fish");
  const groups: [string, any[]][] = [];
  for (const s of SCENARIOS) {
    const rs = rows.filter((r) => r.scenario === s.id);
    if (s.id === "C") {
      groups.push(["C-chicken", rs.filter((r) => r.request === "a chicken dish")], ["C-stir-fry", rs.filter((r) => r.request === "a stir-fry")]);
    } else groups.push([s.id, rs]);
  }
  console.log(`\n${"scenario".padEnd(11)}${"asks".padEnd(6)}${"dishes".padEnd(8)}${"breaks".padEnd(8)}${"must=0".padEnd(8)}${"diet".padEnd(6)}dishes (main protein)`);
  for (const [id, rs] of groups) {
    if (!rs.length) continue;
    const dishes = rs.filter((r) => r.ok);
    const breaks = dishes.filter((r) => r.breaksProteinRule).length;
    const must = rs.some((r) => r.mustKeepRule) ? "yes" : "no";
    const diet = dishes.filter((r) => r.oracle !== "pass").length;
    console.log(`${id.padEnd(11)}${String(rs.length).padEnd(6)}${String(dishes.length).padEnd(8)}${String(breaks).padEnd(8)}${must.padEnd(8)}${String(diet).padEnd(6)}${rs.map((r) => r.ok ? `${r.dishName} [${r.source[0]}] (${main(r)})` : `NO DISH`).join("; ")}`);
  }
  const b = rows.filter((r) => r.scenario === "B" && r.ok);
  if (b.length) {
    const salmon = b.filter((r) => r.meats.includes("salmon")).length;
    const beef = b.filter((r) => r.meats.some((m: string) => m.includes("beef"))).length;
    console.log(`\nB salmon share: ${salmon}/${b.length} dishes have salmon, ${beef}/${b.length} have beef, ${b.filter((r) => !r.meats.includes("salmon") && !r.meats.some((m: string) => m.includes("beef"))).length}/${b.length} neither`);
  }
  const dRows = rows.filter((r) => r.scenario === "D" && r.ok);
  if (dRows.length) console.log(`D proteins seen: ${[...new Set(dRows.flatMap((r) => r.meats))].join(", ") || "none"}`);
  const failing = rows.filter((r) => r.mustKeepRule && r.breaksProteinRule);
  console.log(`\nrule breaks where the rule must hold: ${failing.length}${failing.length ? " — " + failing.map((r) => `${r.scenario}#${r.n} ${r.dishName}`).join("; ") : ""}`);
  console.log(`ledger: ${ledger.calls} live calls in total (${JSON.stringify(ledger.models)}); this run: ${calls.filter((c) => !c.model.endsWith("(dry)")).length}`);
})().catch((e) => { console.error(e); process.exit(1); });
