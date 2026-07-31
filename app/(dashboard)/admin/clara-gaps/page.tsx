"use client";

import { useCallback, useEffect, useState } from "react";

interface GapRow {
  category: string;
  distinctUsers: number;
  rows: number;
  trend: number | null;
  samples: string[];
}

interface GapReport {
  from: string;
  to: string;
  windowDays: number;
  buildable: GapRow[];
  outOfScope: GapRow[];
  flaggedOff: GapRow[];
  totalRows: number;
  sampleReady: boolean;
  thresholds: { minUsers: number; minDays: number; distinctUsers: number };
}

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
  @media (prefers-reduced-motion: reduce) { .ov { animation: none; } }
`;

const fieldClass =
  "bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-3 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";

const labelClass = "block text-[9px] tracking-[0.22em] uppercase font-bold mb-2";

const CATEGORY_LABEL: Record<string, string> = {
  LOGS: "Logs",
  NUTRITION: "Nutrition & targets",
  MEAL_PLAN: "Meal plan",
  JOURNAL: "Journal",
  SUPPLEMENTS: "Supplements",
  FILTERS: "Dietary filters",
  GROCERY: "Grocery",
  RESTAURANTS: "Restaurants",
  FRIDGE: "Fridge & cook",
  EXCHANGES: "Plan exchanges",
  PROGRESS: "Progress & journey",
  TASTE: "Taste",
  CUSTOM_INGREDIENTS: "Custom ingredients",
  BODY_GOALS: "Body & goals",
  OTHER: "Other",
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Trend never relies on colour alone — the sign and the word carry the meaning. */
function Trend({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-xs text-[#ABA6A6]" title="No requests in the previous window">
        new
      </span>
    );
  }
  if (value === 0) return <span className="text-xs text-[#ABA6A6]">no change</span>;
  const up = value > 0;
  return (
    <span
      className="text-xs font-medium tabular-nums"
      style={{ color: up ? "#B75E78" : "#5F8A6A" }}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value} {up ? "more" : "fewer"}
    </span>
  );
}

function GapTable({
  rows,
  emptyMessage,
  muted = false,
}: {
  rows: GapRow[];
  emptyMessage: string;
  muted?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-6 py-8 text-sm text-[#ABA6A6]">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-[#EAE4CA]">
            <th scope="col" className={`${labelClass} px-6 py-3`} style={{ color: "#ABA6A6" }}>
              Capability
            </th>
            <th scope="col" className={`${labelClass} px-6 py-3`} style={{ color: "#ABA6A6" }}>
              People asking
            </th>
            <th scope="col" className={`${labelClass} px-6 py-3`} style={{ color: "#ABA6A6" }}>
              Requests
            </th>
            <th scope="col" className={`${labelClass} px-6 py-3`} style={{ color: "#ABA6A6" }}>
              vs previous
            </th>
            <th scope="col" className={`${labelClass} px-6 py-3`} style={{ color: "#ABA6A6" }}>
              What they asked for
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.category} className="border-b border-[#F1ECDC] last:border-0 align-top">
              <td className="px-6 py-4">
                <span
                  className={`text-sm ${muted ? "text-[#6E6868]" : "font-semibold text-[#1E1A1A]"}`}
                >
                  {!muted && i === 0 && rows[0].distinctUsers > 0 && (
                    <span
                      className="mr-2 text-[9px] tracking-[0.18em] uppercase font-bold"
                      style={{ color: "#B75E78" }}
                    >
                      Top
                    </span>
                  )}
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
              </td>
              <td className="px-6 py-4 text-sm tabular-nums font-semibold text-[#1E1A1A]">
                {r.distinctUsers}
              </td>
              <td className="px-6 py-4 text-sm tabular-nums text-[#6E6868]">{r.rows}</td>
              <td className="px-6 py-4">
                <Trend value={r.trend} />
              </td>
              <td className="px-6 py-4 max-w-md">
                <ul className="space-y-1">
                  {r.samples.map((s, j) => (
                    <li key={j} className="text-sm text-[#6E6868] leading-relaxed">
                      &ldquo;{s}&rdquo;
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminClaraGapsPage() {
  const [report, setReport] = useState<GapReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/clara-gaps?from=${from}&to=${to}`);
    if (res.ok) {
      setReport(await res.json());
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "Could not load the report.");
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <style>{ANIM}</style>

      <div className="ov mb-8">
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
          style={{ color: "#B75E78" }}
        >
          Clara · demand
        </p>
        <h1 className="text-2xl font-semibold text-[#1E1A1A] mb-2">What Clara couldn&rsquo;t do</h1>
        <p className="text-sm text-[#6E6868] max-w-2xl leading-relaxed">
          Every time someone asks Clara for something none of her skills cover, she records it.
          The top row is the skill cycle to build next. Ranking counts people, not requests, so
          one heavy user can&rsquo;t set the roadmap.
        </p>
      </div>

      <div className="ov bg-white rounded-2xl p-6 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass} style={{ color: "#ABA6A6" }} htmlFor="gap-from">
            From
          </label>
          <input
            id="gap-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass} style={{ color: "#ABA6A6" }} htmlFor="gap-to">
            To
          </label>
          <input
            id="gap-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className={fieldClass}
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-5 py-3 text-sm rounded-xl border border-[#EAE4CA] hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {report && (
          <p className="text-xs text-[#ABA6A6] ml-auto tabular-nums">
            {report.totalRows} request{report.totalRows === 1 ? "" : "s"} over{" "}
            {report.windowDays} days
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="ov bg-white rounded-2xl p-6 mb-6 border border-[#E8C4CE] text-sm text-[#B75E78]"
        >
          {error}
        </div>
      )}

      {report && !report.sampleReady && (
        <div className="ov bg-[#FBF6E9] border border-[#EAE4CA] rounded-2xl p-5 mb-6">
          <p className="text-sm text-[#6E6868] leading-relaxed">
            <span className="font-semibold text-[#1E1A1A]">Not enough data to re-rank yet.</span>{" "}
            The planned wave order still stands. Needs{" "}
            <span className="tabular-nums">{report.thresholds.minUsers}</span> distinct users over{" "}
            <span className="tabular-nums">{report.thresholds.minDays}</span> days — currently{" "}
            <span className="tabular-nums">{report.thresholds.distinctUsers}</span> over{" "}
            <span className="tabular-nums">{report.windowDays}</span>.
          </p>
        </div>
      )}

      <section className="ov bg-white rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
          <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
            Build next — ranked demand
          </h2>
        </div>
        <GapTable
          rows={report?.buildable ?? []}
          emptyMessage={
            loading ? "Loading…" : "No unmet requests in this window. Clara handled everything asked of her."
          }
        />
      </section>

      <section className="ov bg-white/60 rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[#EAE4CA]" style={{ background: "#F5F1E2" }}>
          <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
            Out of scope — not backlog
          </h2>
          <p className="text-xs text-[#6E6868] mt-1">
            Orders, payments, subscription and account settings are deliberately excluded. Tracked as
            policy pressure; never ranked for building.
          </p>
        </div>
        <GapTable
          rows={report?.outOfScope ?? []}
          muted
          emptyMessage="Nobody asked Clara for anything out of scope."
        />
      </section>

      <section className="ov bg-white/60 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EAE4CA]" style={{ background: "#F5F1E2" }}>
          <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
            Flagged off — an ops problem
          </h2>
          <p className="text-xs text-[#6E6868] mt-1">
            These skills exist but are switched off by the <code>CLARA_SKILLS</code> environment
            variable — a global setting, not a per-account one. Anything here means a user hit a wall
            we built and then disabled. The server decides this verdict, not Clara.
          </p>
        </div>
        <GapTable
          rows={report?.flaggedOff ?? []}
          muted
          emptyMessage="No requests hit a disabled skill."
        />
      </section>
    </div>
  );
}
