"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import type { TrialView } from "@/lib/trials/view";

// Trigger trials (workbook 04). The app suggests, the user decides — every
// screen carries the workbook's safety note and "Not medical advice".

interface EligibleRule {
  id: string;
  category: string;
  title: string;
  conditionName: string;
  examples: string;
  safetyNote: string | null;
  sourceUrl: string | null;
  baselineDays: number;
  trialDays: number;
  terms: string[];
}
interface TrialsPayload {
  eligible: EligibleRule[];
  active: TrialView | null;
  history: TrialView[];
  mealPlanStale: boolean;
  conditionNames: string[];
}

const PHASES: { key: TrialView["phase"]["phase"]; label: string; hint: string }[] = [
  { key: "BASELINE", label: "Baseline", hint: "Eat as usual and log symptoms daily." },
  { key: "ELIMINATION", label: "Elimination", hint: "The trigger is removed from your plan. Keep logging symptoms." },
  { key: "EVALUATION", label: "Evaluation", hint: "Compare with baseline. If nothing improved, stop the unnecessary restriction." },
  { key: "REINTRODUCTION", label: "Reintroduction", hint: "Include one normal portion a day and note how you feel." },
  { key: "WASHOUT", label: "Washout", hint: "The trigger is removed again. Watch whether symptoms settle." },
  { key: "FINAL", label: "Classify", hint: "Decide: tolerated, dose-dependent or likely trigger." },
];
const CLASS_LABEL: Record<string, string> = { TOLERATED: "Tolerated", DOSE_DEPENDENT: "Dose-dependent", LIKELY_TRIGGER: "Likely trigger" };
const SHADOW = "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)";

function Score({ label, value, days }: { label: string; value: number | null; days: number }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "#FAFAFA" }}>
      <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "#ABA6A6" }}>{label}</p>
      <p className="text-lg font-bold tabular-nums text-[#1E1A1A]">{value === null ? "—" : value.toFixed(1)}<span className="text-[10px] font-medium ml-1" style={{ color: "#848181" }}>/ 3</span></p>
      <p className="text-[10px]" style={{ color: "#848181" }}>{days} day{days === 1 ? "" : "s"} logged</p>
    </div>
  );
}

function Disclaimer({ note }: { note: string | null }) {
  return (
    <p className="text-[11px] mt-4 leading-relaxed" style={{ color: "#848181" }}>
      {note ? `${note} ` : ""}Not medical advice — talk to your clinician before restricting food groups.
    </p>
  );
}

export default function TrialsClient() {
  const [data, setData] = useState<TrialsPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipBaseline, setSkipBaseline] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [regenState, setRegenState] = useState<"idle" | "running" | "done" | "error">("idle");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch("/api/trials");
      if (!res.ok) throw new Error();
      const d = (await res.json()) as TrialsPayload;
      setData(d);
      if (d.active?.suggestedClassification && !chosen) setChosen(d.active.suggestedClassification);
    } catch {
      setError("Couldn't load your trials. Check your connection and try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const start = (ruleId: string) => act(() => apiFetch("/api/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleId, skipBaseline: !!skipBaseline[ruleId] }) }));
  const patch = (id: string, payload: Record<string, unknown>) => act(() => apiFetch(`/api/trials/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  const regenerate = async () => {
    setRegenState("running");
    try {
      const res = await apiFetch("/api/meal-plan/new-week", { method: "POST" });
      setRegenState(res.ok ? "done" : "error");
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? "Couldn't generate your week."); }
      await load();
    } catch { setRegenState("error"); }
  };

  if (!data && !error) return <p className="text-sm py-12 text-center" style={{ color: "#848181" }}>Loading your trials…</p>;

  const active = data?.active ?? null;
  const phaseIdx = active ? PHASES.findIndex((p) => p.key === active.phase.phase) : -1;

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {data?.mealPlanStale && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm">
          <span className="flex-1 text-amber-800 min-w-[200px]">Your trial changed what you can eat — generate a new week to apply it.</span>
          <button type="button" disabled={regenState === "running"} onClick={() => void regenerate()} className="min-h-[44px] px-4 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-60">
            {regenState === "running" ? "Generating…" : "Generate a new week"}
          </button>
        </div>
      )}
      {regenState === "done" && <p role="status" className="text-xs" style={{ color: "#2E7D5B" }}>New week generated. Open the meal plan to see it.</p>}

      {/* Active trial */}
      {active && (
        <section className="bg-white rounded-2xl p-5 sm:p-6" style={{ boxShadow: SHADOW }}>
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div>
              <p className="text-[9px] tracking-[0.2em] uppercase font-bold" style={{ color: "#B75E78" }}>Active trial · {active.conditionName}</p>
              <h2 className="text-xl font-bold text-[#1E1A1A]">{active.title}</h2>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: active.phase.enforced ? "rgba(129,37,73,0.12)" : "rgba(46,125,91,0.12)", color: active.phase.enforced ? "#812549" : "#2E7D5B" }}>
              {active.phase.enforced ? "removed from your plan" : "allowed right now"}
            </span>
          </div>

          {/* Timeline */}
          <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4" aria-label="Trial phases">
            {PHASES.map((p, i) => {
              const state = i < phaseIdx ? "done" : i === phaseIdx ? "now" : "todo";
              return (
                <li key={p.key} className="rounded-xl px-2.5 py-2 text-center" style={{ background: state === "now" ? "#812549" : state === "done" ? "rgba(129,37,73,0.10)" : "#F5F1DD", color: state === "now" ? "#fff" : state === "done" ? "#812549" : "#848181" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide">{p.label}</p>
                  <p className="text-[10px] tabular-nums">{active.windows[p.key].from.slice(5).replace("-", "/")}{active.windows[p.key].to && active.windows[p.key].to !== active.windows[p.key].from ? `–${active.windows[p.key].to!.slice(5).replace("-", "/")}` : ""}</p>
                </li>
              );
            })}
          </ol>
          <p className="text-sm font-semibold text-[#1E1A1A]">
            {PHASES[phaseIdx]?.label}{active.phase.phaseLength > 0 ? ` · day ${active.phase.dayInPhase} of ${active.phase.phaseLength}` : ""}
            {active.phase.nextPhaseOn ? <span className="font-normal" style={{ color: "#848181" }}> · next phase {active.phase.nextPhaseOn}</span> : null}
          </p>
          <p className="text-sm mt-1" style={{ color: "#4A4646" }}>{PHASES[phaseIdx]?.hint}</p>

          <div className="mt-4">
            <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: "#ABA6A6" }}>{active.phase.enforced ? "Removed from your plan" : "Being tested"}</p>
            <div className="flex flex-wrap gap-1.5">
              {active.terms.map((t) => (
                <span key={t} className="text-[11px] px-2 py-1 rounded-full" style={{ background: "#F3F2FF", color: "#4A4646" }}>{t}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <Score label="Baseline" value={active.scores.baseline} days={active.scores.loggedDays.baseline} />
            <Score label="Elimination" value={active.scores.elimination} days={active.scores.loggedDays.elimination} />
            <Score label="Challenge" value={active.scores.challenge} days={active.scores.loggedDays.challenge} />
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "#848181" }}>Symptom score = mean severity of the trial&apos;s monitored symptoms (0 none · 3 severe). Log symptoms in your daily journal.</p>

          {phaseIdx >= 2 && (
            <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "#FBFAF5" }}>
              <p className="text-sm font-semibold text-[#1E1A1A]">
                {active.evaluation.suggestion === "INSUFFICIENT_DATA" && "Not enough logged days to compare yet — keep logging symptoms."}
                {active.evaluation.suggestion === "STOP_RESTRICTION" && `Symptoms improved ${active.evaluation.improvementPct}% — below the 30% the protocol looks for. Consider stopping this restriction.`}
                {active.evaluation.suggestion === "PROCEED" && `Symptoms improved ${active.evaluation.improvementPct}% against baseline — the protocol suggests testing the trigger.`}
              </p>
              {active.suggestedClassification && (
                <p className="text-xs mt-1" style={{ color: "#4A4646" }}>After the challenge the suggestion is: <strong>{CLASS_LABEL[active.suggestedClassification]}</strong>. You decide.</p>
              )}
            </div>
          )}

          {active.canClassify && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-[#1E1A1A] mb-2">Your classification</p>
              <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Classification">
                {(["TOLERATED", "DOSE_DEPENDENT", "LIKELY_TRIGGER"] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={chosen === c} onClick={() => setChosen(c)} className="min-h-[44px] rounded-xl border-2 px-3 py-2 text-sm font-semibold text-left" style={{ borderColor: chosen === c ? "#812549" : "#EAE4CA", background: chosen === c ? "rgba(129,37,73,0.06)" : "#fff", color: "#1E1A1A" }}>
                    {CLASS_LABEL[c]}
                    <span className="block text-[10px] font-normal" style={{ color: "#848181" }}>
                      {c === "TOLERATED" ? "No change when reintroduced" : c === "DOSE_DEPENDENT" ? "Only larger portions caused symptoms" : "Symptoms came back — keep it out"}
                    </span>
                  </button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="mt-2 w-full px-3 py-2 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm outline-none focus:border-primary" />
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            {active.canClassify && (
              <button type="button" disabled={busy || !chosen} onClick={() => void patch(active.id, { action: "classify", classification: chosen, notes })} className="min-h-[44px] px-4 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50">
                Confirm classification
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void patch(active.id, { action: "stop" })} className="min-h-[44px] px-4 rounded-xl border-2 border-[#EAE4CA] text-sm font-semibold" style={{ color: "#848181" }}>
              Stop trial
            </button>
          </div>
          <Disclaimer note={active.safetyNote} />
        </section>
      )}

      {/* Eligible triggers */}
      <section>
        <h2 className="text-base font-bold text-[#1E1A1A] mb-1">{active ? "Other triggers you could test later" : "Triggers you can test"}</h2>
        <p className="text-xs mb-3" style={{ color: "#848181" }}>
          One trial at a time: 7 days as usual, 28 days without the trigger, then a 3-day challenge and 3-day washout. Your daily symptom log does the measuring.
        </p>
        {data?.eligible.length === 0 ? (
          <p className="text-sm" style={{ color: "#848181" }}>{data.conditionNames.length === 0 ? "Add a health condition in Settings to see trials for it." : "No triggers left to test for your conditions."}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data?.eligible.map((r) => (
              <article key={r.id} className="bg-white rounded-2xl p-4" style={{ boxShadow: SHADOW }}>
                <p className="text-[9px] tracking-[0.2em] uppercase font-bold" style={{ color: "#B75E78" }}>{r.conditionName}</p>
                <h3 className="text-base font-bold text-[#1E1A1A]">{r.title}</h3>
                <p className="text-xs mt-1" style={{ color: "#4A4646" }}>{r.examples}</p>
                {r.safetyNote && <p className="text-[11px] mt-1.5" style={{ color: "#848181" }}>{r.safetyNote}</p>}
                {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] underline" style={{ color: "#812549" }}>Source</a>}
                {!active && (
                  <>
                    <label className="flex items-center gap-2 mt-3 text-xs" style={{ color: "#4A4646" }}>
                      <input type="checkbox" checked={!!skipBaseline[r.id]} onChange={(e) => setSkipBaseline((s) => ({ ...s, [r.id]: e.target.checked }))} />
                      Skip the {r.baselineDays}-day baseline (I already know my usual symptoms)
                    </label>
                    <button type="button" disabled={busy} onClick={() => void start(r.id)} className="mt-2 min-h-[44px] w-full rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50">
                      Start this trial
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
        {!active && <Disclaimer note={null} />}
      </section>

      {/* History */}
      {data && data.history.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-[#1E1A1A] mb-3">Past trials</h2>
          <ul className="space-y-2">
            {data.history.map((h) => (
              <li key={h.id} className="bg-white rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3" style={{ boxShadow: SHADOW }}>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-semibold text-[#1E1A1A]">{h.title} <span className="font-normal" style={{ color: "#848181" }}>· {h.conditionName}</span></p>
                  <p className="text-[11px]" style={{ color: "#848181" }}>started {h.startDate}{h.notes ? ` · ${h.notes}` : ""}</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: h.classification === "LIKELY_TRIGGER" ? "rgba(129,37,73,0.12)" : "#F0EFF5", color: h.classification === "LIKELY_TRIGGER" ? "#812549" : "#848181" }}>
                  {h.status === "STOPPED" && !h.classification ? "Stopped" : CLASS_LABEL[h.classification ?? ""] ?? h.status}
                  {h.status === "STOPPED" && h.classification ? " · cleared" : ""}
                </span>
                {h.status === "COMPLETED" && h.classification === "LIKELY_TRIGGER" && (
                  <button type="button" disabled={busy} onClick={() => void patch(h.id, { action: "clear" })} className="min-h-[44px] px-3 rounded-xl border-2 border-[#EAE4CA] text-xs font-semibold" style={{ color: "#848181" }}>
                    Clear ban
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
