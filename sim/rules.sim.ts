// Rule-compliance simulation — does every service respect every rule, alone
// and combined? Runs the REAL route handlers and planner in-process against a
// fake database built from the read-only snapshot (sim/snapshot.ts). No
// browser, no network, no writes, no model calls.
//
//   npm run sim:snapshot     # read-only export from the shared DB (once)
//   npm run sim:rules        # this file; SIM_PAIRS=0 skips the ~3k pair profiles
//
// Each service's output is reduced to the ingredients it puts in front of the
// diner and judged by sim/oracle.ts. Any violation fails the run; the report
// lands in docs/qa/rule-compliance-sim.md.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createFakePrisma, type Snapshot, type SimState } from "./fake-db";
import { buildProfiles, makePatient, ruleUniverse, type Profile } from "./profiles";
import { makeOracle, type Verdict } from "./oracle";

// ── isolation: mocks and env BEFORE any service module loads ─────────────────
const req = createRequire(__filename);
const state: SimState = { patient: null, pantryIds: [] };
mock.module(pathToFileURL(req.resolve("server-only")).href, { namedExports: {} });
mock.module(pathToFileURL(req.resolve("@clerk/nextjs/server")).href, {
  namedExports: { auth: async () => ({ userId: state.patient?.account.clerkId ?? null }) },
});
delete process.env.ANTHROPIC_API_KEY; // planner's Clara top-up returns [] without a key
delete process.env.UPSTASH_REDIS_REST_URL; // in-memory rate limiter
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RATE_LIMIT_ENFORCE_BACKEND;

const snapFile = join(__dirname, ".snapshot", "snapshot.json");
const snap: Snapshot = JSON.parse(readFileSync(snapFile, "utf8"));
(globalThis as any).prisma = createFakePrisma(snap, state);

const ingById = new Map(snap.ingredients.map((i) => [i.id, i]));
const ingByName = new Map(snap.ingredients.map((i) => [i.name.trim().toLowerCase(), i]));
const recipeById = new Map(snap.recipes.map((r) => [r.id, r]));
const recipeItems = (id: string) =>
  (recipeById.get(id)?.ingredients ?? []).map((ri) => ingById.get(ri.ingredientId)).filter(Boolean).map((i) => ({ name: i!.name, allergenGroups: i!.allergenGroups }));

type Served = { name: string; allergenGroups?: readonly string[]; via: string };
type ServiceResult = { served: Served[]; note?: string };
type Service = { key: string; label: string; heavy: boolean; run(p: Profile, patient: any): Promise<ServiceResult> };

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(await res.json()).slice(0, 200)}`);
  return res.json();
};

async function loadServices(): Promise<Service[]> {
  const toBuy = await import("@/app/api/pantry/to-buy/route");
  const catalog = await import("@/app/api/pantry/catalog/route");
  const cookable = await import("@/app/api/pantry/cookable/route");
  const tasteIng = await import("@/app/api/taste/ingredients/route");
  const tasteDishes = await import("@/app/api/taste/dishes/route");
  const mealPlan = await import("@/lib/meal-plan");
  const { buildCuisineChecklists } = await import("@/lib/cuisine-ingredients");
  const { applyAllergenFilter } = await import("@/lib/fridge");
  const { loadIngredientGroups } = await import("@/lib/ingredient-catalog-db");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");

  const ingredientServed = (ids: string[], via: string): Served[] =>
    ids.map((id) => ingById.get(id)).filter(Boolean).map((i) => ({ name: i!.name, allergenGroups: i!.allergenGroups, via }));
  const dishServed = (ids: string[], via: string): Served[] =>
    ids.flatMap((id) => recipeItems(id).map((i) => ({ ...i, via: `${via} · ${recipeById.get(id)?.name}` })));

  return [
    {
      key: "buy-value", label: "What to buy · Unlocks most", heavy: false,
      run: async () => {
        state.pantryIds = [];
        const { items } = await json(await toBuy.GET());
        return { served: ingredientServed(items.map((i: any) => i.ingredientId), "to-buy") };
      },
    },
    {
      key: "buy-category", label: "What to buy · By category", heavy: false,
      run: async () => {
        const { categories } = await json(await catalog.GET());
        // Exactly what the client renders on the buy tab: items without bannedBy.
        const ids = categories.flatMap((c: any) => c.items.filter((it: any) => !it.bannedBy).map((it: any) => it.id));
        return { served: ingredientServed(ids, "catalog") };
      },
    },
    {
      key: "buy-cuisine", label: "What to buy · By cuisine", heavy: false,
      run: async () => {
        const { bans } = await json(await catalog.GET());
        const lists = buildCuisineChecklists([], new Set(Object.keys(bans?.cuisineStaples ?? {})));
        const served = lists.flatMap((c) =>
          c.staples.map((s) => ({ name: s.name, allergenGroups: ingByName.get(s.name.toLowerCase())?.allergenGroups ?? [], via: `cuisine ${c.cuisine}` }))
        );
        return { served };
      },
    },
    {
      key: "taste-ingredients", label: "Taste · ingredient picker", heavy: false,
      run: async () => {
        const { levels } = await json(await tasteIng.GET());
        return { served: ingredientServed(levels.flatMap((l: any) => l.items.map((it: any) => it.id)), "taste") };
      },
    },
    {
      key: "ai-postfilter", label: "Clara post-filter (cook-day · swap · fridge)", heavy: false,
      run: async (p, patient) => {
        // The model is not called: we hand the deterministic guard the worst
        // output it could get — one dish per banned name, and one per library
        // ingredient tagged with a group this diner cannot eat — and see what
        // survives. Groups come from the ingredient row the name resolves to,
        // as persistence would link it.
        const matchers = buildDietMatchers(derivePatientBans(patient));
        const oracle = makeOracle(patient, p.rules);
        const names = new Set<string>();
        for (const a of patient.foodAllergies) [a.food.name, ...a.food.bannedIngredients.map((b: any) => b.name)].forEach((n: string) => names.add(n));
        for (const f of patient.foodToAvoid) [f.food.name, ...f.food.bannedIngredients.map((b: any) => b.name)].forEach((n: string) => names.add(n));
        for (const c of patient.healthConditions) c.condition.bannedIngredients.forEach((b: any) => names.add(b.name));
        for (const d of patient.foodPreferences) d.food.bannedIngredients.forEach((b: any) => names.add(b.name));
        for (const m of patient.motivations) m.motivation.bannedIngredients.forEach((b: any) => names.add(b.name));
        const verdicts = oracle.judgeMany(snap.ingredients);
        snap.ingredients.forEach((ing, i) => { if (verdicts[i].groups.length || verdicts[i].engine.length) names.add(ing.name); });
        const dishes = Array.from(names).map((n, i) => ({
          id: `adv${i}`, name: `Chef's bowl ${i}`, description: "A simple bowl.", emoji: "🍲",
          usesIngredients: [n], missingIngredients: [], steps: ["Cook and serve."], mealType: "Lunch", servings: 1,
          perServing: { calories: 400, protein: 20, carbs: 40, fat: 15 }, fitsPlan: true, conflicts: [],
        }));
        // The same group loader the AI routes call, answered by the fake DB.
        const groupsOf = await loadIngredientGroups(dishes.flatMap((d) => d.usesIngredients));
        const survivors = applyAllergenFilter(dishes as any, matchers, groupsOf);
        return {
          served: survivors.map((d: any) => ({ name: d.usesIngredients[0], allergenGroups: ingByName.get(d.usesIngredients[0].toLowerCase())?.allergenGroups ?? [], via: "clara post-filter" })),
          note: `${dishes.length} adversarial dishes, ${survivors.length} survived`,
        };
      },
    },
    {
      key: "cookable", label: "Ingredients · dishes you can cook", heavy: true,
      run: async () => {
        state.pantryIds = snap.ingredients.map((i) => i.id); // owns everything: maximum exposure
        const data = await json(await cookable.GET());
        state.pantryIds = [];
        return { served: dishServed([...data.ready, ...data.almost].map((d: any) => d.id), "cookable"), note: `${data.readyTotal} ready` };
      },
    },
    {
      key: "taste-dishes", label: "Taste · dish swiper", heavy: true,
      run: async () => {
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) ids.push(...(await json(await tasteDishes.GET())).dishes.map((d: any) => d.id));
        return { served: dishServed(Array.from(new Set(ids)), "taste dishes") };
      },
    },
    {
      key: "meal-plan", label: "Meal plan · week generation", heavy: true,
      run: async (_p, patient) => {
        const out = await mealPlan.buildMealPlanMenus(patient.id, new Date("2026-10-05T00:00:00"), 1, { windowDays: 7 });
        const ids = Array.from(new Set(out.rows.map((r: any) => r.recipeId)));
        return { served: dishServed(ids, "meal plan"), note: `${out.rows.length} rows, core coverage ${(out.coreCoverage * 100).toFixed(0)}%` };
      },
    },
    {
      key: "alternatives", label: "Meal plan · alternatives", heavy: true,
      run: async (_p, patient) => {
        const ids: string[] = [];
        for (const mt of snap.mealTypes) {
          for (const currentCalories of [0, 450]) ids.push(...(await mealPlan.findAlternatives(patient, { mealTypeId: mt.id, currentCalories })).map((r: any) => r.id));
        }
        return { served: dishServed(Array.from(new Set(ids)), "alternatives") };
      },
    },
    {
      key: "swap-gate", label: "Meal plan · swap gate (whole library)", heavy: true,
      run: async (_p, patient) => {
        const fake = (globalThis as any).prisma;
        const all = await fake.recipe.findMany({ where: { isPublic: true } });
        const ok = all.filter((r: any) => mealPlan.validateSwapCandidate(patient, { mealTypeId: r.mealTypeId }, r, []).ok);
        return { served: dishServed(ok.map((r: any) => r.id), "swap accepted"), note: `${ok.length}/${all.length} accepted` };
      },
    },
  ];
}

// ── run ──────────────────────────────────────────────────────────────────────
type Violation = { profile: string; tier: string; service: string; item: string; via: string; why: string };
type Row = { service: string; profiles: number; items: number; violations: number; errors: number; suspects: number };

test("every service respects every rule, alone and combined", { timeout: 6 * 60 * 60 * 1000 }, async () => {
  const pairs = process.env.SIM_PAIRS !== "0";
  const profiles = buildProfiles(snap, { pairs });
  const services = await loadServices();
  const violations: Violation[] = [];
  const errors: { profile: string; service: string; message: string }[] = [];
  const suspects = new Map<string, { rule: string; term: string; item: string; services: Set<string>; profiles: number }>();
  const rows = new Map<string, Row>(services.map((s) => [s.key, { service: s.label, profiles: 0, items: 0, violations: 0, errors: 0, suspects: 0 }]));
  const notes: { profile: string; service: string; note: string }[] = [];

  const quiet = { log: console.log, warn: console.warn, info: console.info };
  const t0 = Date.now();
  let done = 0;
  for (const profile of profiles) {
    const patient = makePatient(snap, profile);
    state.patient = patient;
    const oracle = makeOracle(patient as any, profile.rules);
    for (const svc of services) {
      if (svc.heavy && profile.tier === "pair") continue;
      const row = rows.get(svc.key)!;
      row.profiles++;
      let result: ServiceResult;
      console.log = console.warn = console.info = () => {};
      try {
        result = await svc.run(profile, patient);
      } catch (e) {
        row.errors++;
        errors.push({ profile: profile.id, service: svc.label, message: e instanceof Error ? e.message : String(e) });
        continue;
      } finally {
        Object.assign(console, quiet);
      }
      if (result.note && profile.tier !== "pair") notes.push({ profile: profile.id, service: svc.key, note: result.note });
      row.items += result.served.length;
      const verdicts: Verdict[] = oracle.judgeMany(result.served);
      result.served.forEach((item, i) => {
        const v = verdicts[i];
        const why = [
          ...(v.engine.length ? [`engine bans: ${v.engine.join(", ")}`] : []),
          ...v.groups.map((g) => `${g.rule} forbids ${g.group}`),
        ];
        if (why.length) {
          row.violations++;
          violations.push({ profile: profile.id, tier: profile.tier, service: svc.label, item: item.name, via: item.via, why: why.join("; ") });
        }
        for (const s of v.suspects) {
          row.suspects++;
          const k = `${s.rule}|${s.term}|${item.name}`;
          const cur = suspects.get(k) ?? { ...s, item: item.name, services: new Set<string>(), profiles: 0 };
          cur.services.add(svc.key);
          cur.profiles++;
          suspects.set(k, cur);
        }
      });
    }
    if (++done % 250 === 0) quiet.log(`  … ${done}/${profiles.length} profiles (${Math.round((Date.now() - t0) / 1000)}s)`);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const universe = ruleUniverse(snap);
  const tierCount = (t: string) => profiles.filter((p) => p.tier === t).length;
  const lines: string[] = [];
  lines.push(`# Rule-compliance simulation`, ``);
  lines.push(`Run ${new Date().toISOString()} · snapshot ${snap.takenAt} · ${Math.round((Date.now() - t0) / 1000)}s`, ``);
  lines.push(`Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).`, ``);
  lines.push(`**Profiles:** ${profiles.length} — ${tierCount("single")} single rules, ${tierCount("pair")} rule pairs, ${tierCount("real")} real-user combinations, ${tierCount("curated")} hand-built heavy combinations, 1 with every rule at once.`);
  lines.push(`Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).`, ``);
  lines.push(`**Result: ${violations.length === 0 && errors.length === 0 ? "PASS" : "FAIL"}** — ${violations.length} violations, ${errors.length} service errors, ${suspects.size} distinct suspects for review.`, ``);
  lines.push(`| Service | Profiles | Items checked | Violations | Errors | Suspect hits |`, `|---|---:|---:|---:|---:|---:|`);
  for (const r of rows.values()) lines.push(`| ${r.service} | ${r.profiles} | ${r.items} | ${r.violations} | ${r.errors} | ${r.suspects} |`);
  lines.push(``);

  if (violations.length) {
    lines.push(`## Violations`, ``);
    const byKey = new Map<string, { v: Violation; n: number }>();
    for (const v of violations) {
      const k = `${v.service}|${v.item}|${v.why}`;
      const cur = byKey.get(k);
      if (cur) cur.n++;
      else byKey.set(k, { v, n: 1 });
    }
    lines.push(`| Service | Served item | Why it is banned | Profiles | e.g. profile · via |`, `|---|---|---|---:|---|`);
    for (const { v, n } of Array.from(byKey.values()).sort((a, b) => b.n - a.n).slice(0, 200))
      lines.push(`| ${v.service} | ${v.item} | ${v.why} | ${n} | ${v.profile} · ${v.via} |`);
    lines.push(``);
  }
  if (errors.length) {
    lines.push(`## Service errors`, ``);
    for (const e of errors.slice(0, 50)) lines.push(`- ${e.service} · ${e.profile}: ${e.message}`);
    lines.push(``);
  }
  lines.push(`## Suspects (engine allowed, name contains a banned term) — for review`, ``);
  lines.push(`Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.`, ``);
  lines.push(`| Rule | Banned term | Served item | Services | Hits |`, `|---|---|---|---|---:|`);
  for (const s of Array.from(suspects.values()).sort((a, b) => b.profiles - a.profiles).slice(0, 150))
    lines.push(`| ${s.rule} | ${s.term} | ${s.item} | ${Array.from(s.services).join(", ")} | ${s.profiles} |`);
  lines.push(``);
  lines.push(`## Rules that ban no ingredient`, ``);
  lines.push(`These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: ${universe.empty.map((k) => k.replace(/^\w+:/, "")).join(", ")}.`, ``);
  lines.push(`## Coverage notes (non-pair profiles)`, ``);
  const thin = notes.filter((n) => n.service === "meal-plan" && /core coverage (\d+)%/.test(n.note) && Number(n.note.match(/core coverage (\d+)%/)![1]) < 100);
  lines.push(`Meal plans that could not fill every core slot from the library: ${thin.length}.`);
  for (const n of thin.slice(0, 40)) lines.push(`- ${n.profile}: ${n.note}`);
  lines.push(``);

  const outDir = join(__dirname, "..", "docs", "qa");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "rule-compliance-sim.md"), lines.join("\n"));
  writeFileSync(join(__dirname, ".snapshot", "last-run.json"), JSON.stringify({ violations, errors, notes, suspects: Array.from(suspects.values()).map((s) => ({ ...s, services: Array.from(s.services) })) }, null, 1));
  quiet.log(`\n${lines.slice(0, 22).join("\n")}\n\nfull report: docs/qa/rule-compliance-sim.md`);

  assert.equal(errors.length, 0, `${errors.length} service errors — see report`);
  assert.equal(violations.length, 0, `${violations.length} rule violations — see report`);
});
