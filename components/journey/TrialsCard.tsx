"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TrialView } from "@/lib/trials/view";

// Journey summary of the trigger trial: active phase, or a nudge to start.
export default function TrialsCard() {
  const [state, setState] = useState<{ active: TrialView | null; eligible: number; stale: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/trials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setState(d ? { active: d.active, eligible: d.eligible.length, stale: d.mealPlanStale } : { active: null, eligible: 0, stale: false }))
      .catch(() => setState({ active: null, eligible: 0, stale: false }));
  }, []);

  const a = state?.active ?? null;
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#1E1A1A]">Trigger trials</h3>
        <Link href="/trials" className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color: "#812549" }}>Open →</Link>
      </div>
      {state === null ? (
        <p className="text-sm" style={{ color: "#848181" }}>Loading…</p>
      ) : a ? (
        <div>
          <p className="text-base font-bold text-[#1E1A1A]">{a.title}</p>
          <p className="text-xs mt-0.5" style={{ color: "#4A4646" }}>
            {a.phase.phase.charAt(0) + a.phase.phase.slice(1).toLowerCase()}
            {a.phase.phaseLength > 0 ? ` · day ${a.phase.dayInPhase} of ${a.phase.phaseLength}` : ""}
            {a.phase.nextPhaseOn ? ` · next phase ${a.phase.nextPhaseOn}` : ""}
          </p>
          <p className="text-[11px] mt-2" style={{ color: a.phase.enforced ? "#812549" : "#2E7D5B" }}>
            {a.phase.enforced ? "Removed from your plan right now" : "Allowed right now — log how you feel"}
          </p>
          {state.stale && <p className="text-[11px] mt-1 text-amber-700">Generate a new week to apply the change.</p>}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "#848181" }}>
          {state.eligible > 0 ? `${state.eligible} trigger${state.eligible === 1 ? "" : "s"} you could test, one at a time.` : "No triggers to test for your conditions."}
        </p>
      )}
    </div>
  );
}
