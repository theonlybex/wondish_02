// Summarises the live before/after rows (sim/clara-fast-live.sim.ts) for
// docs/qa/clara-fast-dishes.md. No model, no database.
//
//   node --import tsx sim/clara-fast-report.ts <rows.jsonl>... [--budget=9000]
//
// --budget replays a run recorded WITHOUT a deadline at a given budget: the
// generated dish is served when the generator accepted it within the budget,
// else the library dish the same ask got, else nothing. Only exact for rows
// that recorded acceptedAtMs and libraryWouldServe (the new code line).
import { readFileSync } from "node:fs";

type Row = {
  arm: string; codeline: "old" | "new"; budgetMs: number | null; person: string; hard: boolean; tool: string; meal: string;
  servings: number; maxMinutes: number | null; wallMs: number; served: "generated" | "library" | "none"; dishName: string | null;
  oracle: string | null; libraryWouldServe: string | null; acceptedAtMs: number | null;
  stages: { produced: number; parse: number; safety: number; gates: number; card: number; accepted: number };
  call: null | { model: string; ms: number; ttftMs: number | null; inTokens: number; outTokens: number | null; chars: number; stop: string | null; aborted: boolean; error: string | null };
};

// $ per 1M tokens (claude-api skill, cached 2026-11-03; Haiku 5.5 at prompts ≤ 100K).
const PRICE: Record<string, [number, number]> = { "claude-haiku-4-5": [1, 5], "claude-haiku-5-5": [0.1, 0.5] };

const args = process.argv.slice(2);
const budget = Number(args.find((a) => a.startsWith("--budget="))?.slice(9) ?? NaN);
const files = args.filter((a) => !a.startsWith("--"));
// --match=<rows.jsonl>: keep only the asks (person, tool, meal) that file also has — a like-for-like subset.
const matchFile = args.find((a) => a.startsWith("--match="))?.slice(8);
const matchKeys = matchFile
  ? new Set(readFileSync(matchFile, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.person}|${r.tool}|${r.meal}`; }))
  : null;
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—");
const share = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;

for (const file of files) {
  let rows: Row[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (matchKeys) rows = rows.filter((r) => matchKeys.has(`${r.person}|${r.tool}|${r.meal}`));
  const replay = Number.isFinite(budget) && rows.every((r) => r.codeline === "new");
  if (replay) {
    rows = rows.map((r) => {
      const genInTime = r.acceptedAtMs != null && r.acceptedAtMs <= budget;
      const served: Row["served"] = genInTime ? "generated" : r.libraryWouldServe ? "library" : "none";
      // Wall time under the budget: as recorded when the dish came in time, else the budget (the library is ready by then).
      const wallMs = genInTime ? r.wallMs : Math.min(r.wallMs, budget);
      return { ...r, served, wallMs, dishName: served === "library" ? r.libraryWouldServe : r.dishName };
    });
  }
  const callRows = rows.filter((r) => r.call);
  // Output tokens of a call stopped early are not reported by the API stream: estimated from its characters,
  // at the chars-per-token ratio of this run's completed calls.
  const done = callRows.filter((r) => r.call!.outTokens != null && r.call!.chars > 0);
  // With no completed call in the run (every call stopped early), 2.8 chars/token: this JSON measured 2.18 on
  // Haiku 5.5, whose tokenizer counts ~30% more tokens than Haiku 4.5's for the same text (2.18 × 1.3).
  const charsPerToken = done.length ? done.reduce((a, r) => a + r.call!.chars, 0) / done.reduce((a, r) => a + r.call!.outTokens!, 0) : 2.8;
  const outOf = (r: Row) => r.call!.outTokens ?? Math.round(r.call!.chars / charsPerToken);
  const models = [...new Set(callRows.map((r) => r.call!.model))];
  const cost = callRows.reduce((a, r) => {
    const [pin, pout] = PRICE[r.call!.model] ?? [NaN, NaN];
    return a + (r.call!.inTokens * pin + outOf(r) * pout) / 1e6;
  }, 0);
  const n = rows.length;
  const got = rows.filter((r) => r.served !== "none").length;
  const gen = rows.filter((r) => r.served === "generated").length;
  const lib = rows.filter((r) => r.served === "library").length;
  const viol = rows.filter((r) => r.oracle && r.oracle !== "pass").length;
  const walls = rows.map((r) => r.wallMs);
  const modelMs = callRows.map((r) => r.call!.ms);
  const accepted = rows.map((r) => r.acceptedAtMs).filter((x): x is number => x != null);
  const sum = (k: keyof Row["stages"]) => rows.reduce((a, r) => a + r.stages[k], 0);
  const hard = rows.filter((r) => r.hard);
  console.log(`\n## ${rows[0]?.arm ?? file}${replay ? ` — replayed at a ${budget} ms budget` : ""}${matchFile ? ` — only the asks in ${matchFile}` : ""}`);
  console.log(`file ${file} · models ${models.join(", ")} · ${callRows.length} model calls · recorded budget ${rows[0]?.budgetMs ?? "none (old code)"}`);
  console.log(`| dishes asked | got a dish | generated | library | none | hard profiles got a dish | p50 / p95 / max until the dish | model call p50 / p95 / max | first fitting dish p50 / p95 / max | cost / call | violations |`);
  console.log(`|---|---|---|---|---|---|---|---|---|---|---|`);
  console.log(`| ${n} | ${share(got, n)} | ${share(gen, n)} | ${share(lib, n)} | ${n - got} | ${share(hard.filter((r) => r.served !== "none").length, hard.length)} | ${sec(pct(walls, 50))} / ${sec(pct(walls, 95))} / ${sec(Math.max(...walls))} | ${sec(pct(modelMs, 50))} / ${sec(pct(modelMs, 95))} / ${sec(Math.max(...modelMs))} | ${accepted.length ? `${sec(pct(accepted, 50))} / ${sec(pct(accepted, 95))} / ${sec(Math.max(...accepted))}` : "—"} | $${(cost / Math.max(1, callRows.length)).toFixed(4)} | ${viol} |`);
  const tin = callRows.reduce((a, r) => a + r.call!.inTokens, 0), tout = callRows.reduce((a, r) => a + outOf(r), 0);
  console.log(`tokens: ${tin} in / ${tout} out (${callRows.filter((r) => r.call!.outTokens == null).length} calls stopped early, their output estimated at ${charsPerToken.toFixed(2)} chars/token) · total $${cost.toFixed(3)}`);
  console.log(`candidates: produced ${sum("produced")}, unparseable ${sum("parse")}, refused by the safety filter ${sum("safety")}, dropped by other gates ${sum("gates")}, failed the card (time/servings) ${sum("card")}, accepted ${sum("accepted")}`);
  const errs = callRows.filter((r) => r.call!.error);
  if (errs.length) console.log(`call errors: ${errs.map((r) => `${r.person}: ${r.call!.error}`).join("; ")}`);
  const stops = callRows.reduce<Record<string, number>>((a, r) => ((a[String(r.call!.stop)] = (a[String(r.call!.stop)] ?? 0) + 1), a), {});
  console.log(`stop reasons: ${JSON.stringify(stops)}`);
  console.log(`no dish:`);
  for (const r of rows.filter((x) => x.served === "none")) {
    console.log(`  - ${r.person} · ${r.tool} ${r.meal}${r.servings > 1 ? ` ×${r.servings}` : ""}${r.maxMinutes ? ` ≤${r.maxMinutes} min` : ""} · stages ${JSON.stringify(r.stages)} · library ${r.libraryWouldServe === null && r.codeline === "new" ? "had nothing" : r.codeline === "old" ? "n/a (old code)" : r.libraryWouldServe}${r.call?.error ? ` · error ${r.call.error}` : ""}`);
  }
  if (viol) for (const r of rows.filter((x) => x.oracle && x.oracle !== "pass")) console.log(`  VIOLATION ${r.person}: ${r.dishName} ${r.oracle}`);
}
