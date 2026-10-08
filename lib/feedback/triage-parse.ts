// The triage bot's prompt and its guarded output (pure). The model is never
// trusted alone: enums are checked, duplicateOf must be an issue we sent,
// and the safety override forces allergy/diet reports to CRITICAL.
import type { FeedbackCategory, FeedbackSeverity } from "@prisma/client";
import { isSafetyReport } from "./safety";

export const CATEGORIES: FeedbackCategory[] = ["SAFETY_FOOD", "WRONG_FOOD", "MEAL_PLAN", "SHOPPING", "CLARA", "JOURNAL", "TRIALS", "PROFILE", "BILLING", "PERFORMANCE", "UI", "IDEA", "OTHER"];
export const SEVERITIES: FeedbackSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const RANK: Record<FeedbackSeverity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export type OpenIssueBrief = { id: string; title: string; category: string };
export type TriageResult = { category: FeedbackCategory; severity: FeedbackSeverity; title: string; duplicateOf: string | null; reasoning: string };

export const maxSeverity = (a: FeedbackSeverity, b: FeedbackSeverity): FeedbackSeverity => (RANK[a] >= RANK[b] ? a : b);

export const TRIAGE_TOOL = {
  name: "triage_report",
  description: "Categorise one user bug report for the Wondish nutrition app.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: { type: "string", enum: CATEGORIES },
      severity: { type: "string", enum: SEVERITIES, description: "CRITICAL: food the user cannot eat was offered, data loss, cannot use the app. HIGH: a core feature is broken. MEDIUM: wrong but workable. LOW: cosmetic or an idea." },
      title: { type: "string", description: "One line, under 90 characters, describing the PROBLEM (not the user)." },
      duplicateOf: { type: ["string", "null"], description: "The id of an open issue this is the same problem as, or null." },
      reasoning: { type: "string" },
    },
    required: ["category", "severity", "title", "duplicateOf", "reasoning"],
  },
};

export function buildTriageMessage(report: { text: string; area: string | null; context: Record<string, unknown> }, open: OpenIssueBrief[]): string {
  const ctx = Object.entries(report.context).filter(([k]) => k !== "userAgent").map(([k, v]) => `${k}: ${String(v)}`).join("; ");
  return [
    `User report (area: ${report.area ?? "not given"}):`,
    `"""${report.text}"""`,
    `Context: ${ctx || "none"}`,
    "",
    open.length ? "Open issues (id · category · title) — set duplicateOf only if this is clearly the SAME problem:" : "There are no open issues yet.",
    ...open.map((o) => `${o.id} · ${o.category} · ${o.title}`),
  ].join("\n");
}

export function parseTriage(raw: unknown, text: string, open: OpenIssueBrief[]): TriageResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  let category = (CATEGORIES as string[]).includes(String(r.category)) ? (r.category as FeedbackCategory) : "OTHER";
  let severity = (SEVERITIES as string[]).includes(String(r.severity)) ? (r.severity as FeedbackSeverity) : "MEDIUM";
  const rawTitle = typeof r.title === "string" && r.title.trim() ? r.title.trim() : text.trim().split("\n")[0];
  const title = rawTitle.slice(0, 90);
  const duplicateOf = typeof r.duplicateOf === "string" && open.some((o) => o.id === r.duplicateOf) ? r.duplicateOf : null;
  if (category === "SAFETY_FOOD" || isSafetyReport(text)) {
    category = "SAFETY_FOOD";
    severity = "CRITICAL";
  }
  return { category, severity, title, duplicateOf, reasoning: typeof r.reasoning === "string" ? r.reasoning.slice(0, 500) : "" };
}
