"use client";

// Admin → Feedback: user bug reports grouped into issues by the triage bot,
// ranked by severity × distinct reporters × recency (lib/feedback/rank).
// Spec: docs/superpowers/specs/2026-10-07-feedback-reports-design.md
import { useCallback, useEffect, useState } from "react";

type Report = {
  id: string;
  text: string;
  area: string | null;
  createdAt: string;
  context: Record<string, unknown> | null;
  hasScreenshot: boolean;
  triage: "PENDING" | "DONE" | "FAILED";
  triageNote: string | null;
};
type Issue = {
  id: string;
  title: string;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "NEW" | "INVESTIGATING" | "FIXED" | "WONT_FIX";
  score: number;
  reporters: number;
  reportCount: number;
  lastSeen: string | null;
  reports: Report[];
};
type View = { counts: { openCritical: number; open: number; untriaged: number }; open: Issue[]; closed: Issue[]; untriaged: Report[] };

const SEVERITY: Record<Issue["severity"], { bg: string; fg: string }> = {
  CRITICAL: { bg: "#FBE4E4", fg: "#9B1C1C" },
  HIGH: { bg: "#FDF0E3", fg: "#8A4B12" },
  MEDIUM: { bg: "#F5F1DD", fg: "#5F5A5A" },
  LOW: { bg: "#F0EFF5", fg: "#4A4646" },
};
const STATUS_LABEL: Record<Issue["status"], string> = { NEW: "New", INVESTIGATING: "Investigating", FIXED: "Fixed", WONT_FIX: "Won't fix" };
const CATEGORY_LABEL: Record<string, string> = {
  SAFETY_FOOD: "Food safety", WRONG_FOOD: "Wrong food", MEAL_PLAN: "Meal plan", SHOPPING: "Shopping", CLARA: "Clara",
  JOURNAL: "Journal", TRIALS: "Trials", PROFILE: "Profile", BILLING: "Billing", PERFORMANCE: "Performance", UI: "UI", IDEA: "Idea", OTHER: "Other",
};
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

async function patch(url: string, body: unknown) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

function Badge({ severity }: { severity: Issue["severity"] }) {
  const s = SEVERITY[severity];
  return <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>{severity.toLowerCase()}</span>;
}

function ReportItem({ r, openIssues, onChanged }: { r: Report; openIssues: Issue[]; onChanged: () => void }) {
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ctx = r.context ?? {};
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try { await fn(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };
  return (
    <li className="border-t border-[#EAE4CA] py-3">
      <p className="text-sm text-[#1E1A1A] whitespace-pre-wrap break-words">{r.text}</p>
      <p className="text-xs mt-1" style={{ color: "#6B6767" }}>
        {fmt(r.createdAt)} · {r.area ?? "no area"} · from {String(ctx.from ?? "—")} · {String(ctx.viewport ?? "—")} · {String(ctx.tier ?? "—")} · v{String(ctx.appVersion ?? "—")}
        {ctx.sentryEventId ? ` · Sentry ${String(ctx.sentryEventId)}` : ""}
        {ctx.screenshot ? ` · ${String(ctx.screenshot)}` : ""}
      </p>
      {r.triage !== "DONE" && <p className="text-xs mt-1" style={{ color: "#8A4B12" }}>Triage {r.triage.toLowerCase()}{r.triageNote ? `: ${r.triageNote}` : ""}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {r.hasScreenshot && !shot && (
          <button type="button" disabled={busy} className="min-h-[36px] px-3 rounded-lg border border-[#EAE4CA] text-xs font-semibold text-[#4A4646] hover:bg-[#FBFAF5]"
            onClick={() => run(async () => { const res = await fetch(`/api/admin/feedback/reports/${r.id}/screenshot`); if (!res.ok) throw new Error("Screenshot unavailable"); setShot((await res.json()).url); })}>
            Show screenshot
          </button>
        )}
        <label className="text-xs" style={{ color: "#6B6767" }}>
          <span className="sr-only">Move report to</span>
          <select disabled={busy} defaultValue="" className="min-h-[36px] rounded-lg border border-[#EAE4CA] bg-white px-2 text-xs"
            onChange={(e) => { const v = e.target.value; if (v) void run(() => patch(`/api/admin/feedback/reports/${r.id}`, { moveTo: v })); }}>
            <option value="">Move to…</option>
            <option value="new">New issue</option>
            {openIssues.map((i) => <option key={i.id} value={i.id}>{i.title.slice(0, 60)}</option>)}
          </select>
        </label>
        {r.triage !== "DONE" && (
          <button type="button" disabled={busy} className="min-h-[36px] px-3 rounded-lg border border-[#EAE4CA] text-xs font-semibold text-primary hover:bg-[#FBFAF5]"
            onClick={() => run(() => patch(`/api/admin/feedback/reports/${r.id}`, { retry: true }))}>
            Retry triage
          </button>
        )}
      </div>
      {err && <p className="text-error text-xs mt-1" role="alert">{err}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shot && <img src={shot} alt="Screenshot attached by the user" className="mt-2 max-h-96 rounded-lg border border-[#EAE4CA]" />}
    </li>
  );
}

function IssueRow({ issue, openIssues, onChanged }: { issue: Issue; openIssues: Issue[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [err, setErr] = useState("");
  const save = async (body: Record<string, unknown>) => {
    setErr("");
    try { await patch(`/api/admin/feedback/issues/${issue.id}`, body); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <li className="bg-white rounded-2xl border border-[#EAE4CA]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex-1 min-w-[14rem] text-left min-h-[44px]">
          <span className="flex items-center gap-2 flex-wrap">
            <Badge severity={issue.severity} />
            <span className="text-[11px] font-semibold" style={{ color: "#6B6767" }}>{CATEGORY_LABEL[issue.category] ?? issue.category}</span>
            <span className="text-[11px] tabular-nums" style={{ color: "#6B6767" }}>score {Math.round(issue.score)}</span>
          </span>
          <span className="block text-sm font-semibold text-[#1E1A1A] mt-1">{issue.title}</span>
          <span className="block text-xs mt-0.5" style={{ color: "#6B6767" }}>
            {issue.reporters} {issue.reporters === 1 ? "person" : "people"} · {issue.reportCount} report{issue.reportCount === 1 ? "" : "s"} · last {fmt(issue.lastSeen)}
          </span>
        </button>
        <label className="text-xs">
          <span className="sr-only">Status</span>
          <select value={issue.status} onChange={(e) => void save({ status: e.target.value })} className="min-h-[44px] rounded-lg border border-[#EAE4CA] bg-white px-2 text-sm">
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="text-error text-xs px-4 pb-2" role="alert">{err}</p>}
      {open && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <label className="flex-1 min-w-[12rem] text-xs" style={{ color: "#6B6767" }}>
              Title
              <input value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} className="block w-full mt-1 min-h-[40px] rounded-lg border border-[#EAE4CA] px-3 text-sm text-[#1E1A1A]" />
            </label>
            <button type="button" onClick={() => void save({ title })} disabled={!title.trim() || title === issue.title} className="min-h-[40px] px-3 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-40">Save title</button>
            <label className="text-xs" style={{ color: "#6B6767" }}>
              Severity
              <select value={issue.severity} onChange={(e) => void save({ severity: e.target.value })} className="block mt-1 min-h-[40px] rounded-lg border border-[#EAE4CA] bg-white px-2 text-sm">
                {Object.keys(SEVERITY).map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
            </label>
          </div>
          <ul>{issue.reports.map((r) => <ReportItem key={r.id} r={r} openIssues={openIssues.filter((i) => i.id !== issue.id)} onChanged={onChanged} />)}</ul>
        </div>
      )}
    </li>
  );
}

export default function AdminFeedbackPage() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setView(await res.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load feedback");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>Admin</p>
      <h1 className="text-3xl font-bold text-[#1E1A1A]">Feedback</h1>
      <p className="text-sm mt-2 mb-6" style={{ color: "#6B6767" }}>
        User reports, grouped by the triage bot and ranked by severity × people affected × recency. Food-safety reports are always critical.
      </p>
      {error && <p role="alert" className="text-error text-sm mb-4">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
      {!view ? (
        !error && <p className="text-sm" style={{ color: "#6B6767" }}>Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[["Open critical", view.counts.openCritical], ["Open", view.counts.open], ["Untriaged", view.counts.untriaged]].map(([l, n]) => (
              <div key={l as string} className="bg-white rounded-2xl border border-[#EAE4CA] px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "#6B6767" }}>{l}</p>
                <p className="text-2xl font-bold tabular-nums text-[#1E1A1A]">{n}</p>
              </div>
            ))}
          </div>
          {view.open.length === 0 ? (
            <p className="text-sm mb-6" style={{ color: "#6B6767" }}>No open issues.</p>
          ) : (
            <ol className="space-y-3 mb-8">{view.open.map((i) => <IssueRow key={i.id} issue={i} openIssues={view.open} onChanged={load} />)}</ol>
          )}
          {view.untriaged.length > 0 && (
            <section className="mb-8" aria-labelledby="fb-untriaged">
              <h2 id="fb-untriaged" className="text-base font-semibold text-[#1E1A1A] mb-2">Untriaged</h2>
              <ul className="bg-white rounded-2xl border border-[#EAE4CA] px-4 [&>li:first-child]:border-t-0">{view.untriaged.map((r) => <ReportItem key={r.id} r={r} openIssues={view.open} onChanged={load} />)}</ul>
            </section>
          )}
          <section aria-labelledby="fb-closed">
            <button type="button" id="fb-closed" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed} className="text-sm font-semibold text-primary min-h-[44px]">
              {showClosed ? "Hide" : "Show"} closed ({view.closed.length})
            </button>
            {showClosed && <ol className="space-y-3 mt-2">{view.closed.map((i) => <IssueRow key={i.id} issue={i} openIssues={view.open} onChanged={load} />)}</ol>}
          </section>
        </>
      )}
    </div>
  );
}
