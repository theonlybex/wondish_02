# Feedback Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users report bugs from a "Feedback" screen; a Claude bot categorises, severity-rates and groups them; admins see one list ranked by importance.

**Architecture:** Two new Prisma models (`FeedbackIssue` ← many `FeedbackReport`). Pure modules in `lib/feedback/` (validate, safety, rank, triage-parse) are unit-tested; `lib/feedback/triage.ts` runs the model with an injectable caller and applies the result in a transaction. User routes under `/api/feedback`, admin routes under `/api/admin/feedback`, pages `/feedback` and `/admin/feedback`.

**Tech Stack:** Next.js 14 App Router, Prisma 5 (Postgres/Neon), Tailwind, `@anthropic-ai/sdk` via `lib/anthropic.ts`, S3 via `lib/s3.ts`, `node:test` + tsx.

**Spec:** `docs/superpowers/specs/2026-10-07-feedback-reports-design.md`

## Global Constraints

- Local dev talks to the SHARED PRODUCTION database: never run `prisma migrate dev`/`db push`. Generate migration SQL offline with `npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script`; it is applied only on the user's explicit "run migration" (together with pending `20261007120000_custom_plans`).
- Model: `claude-haiku-4-5`, created with `createAnthropic({ timeout: 8000, maxRetries: 0 })` from `lib/anthropic.ts`; triage runs inline, capped at 8 seconds.
- Text 10–2,000 characters; screenshot optional, PNG/JPEG/WebP by magic bytes, ≤ 5 MB.
- Rate limit: `rateLimit("feedback-submit", userId, 10, 86400)`.
- Areas (exact strings): `meal-plan`, `ingredients`, `clara`, `journal`, `trials`, `profile`, `other`.
- Severity weights: CRITICAL 100, HIGH 20, MEDIUM 5, LOW 1; recency 1.0 (≤ 7 days), 0.5 (≤ 30), 0.25; CRITICAL always sorts first.
- The bot receives the report text, area, context and ≤ 30 open issues (`id`, `title`, `category`) — never profile, diet or journal data.
- Screenshots: store the S3 key only (`feedback/<uuid>.<ext>`); admins get `getPresignedUrl(key, 600)`; no URL is ever stored or sent to users.
- Admin guard: `requireAdmin()` + `adminErrorResponse(err)` from `lib/admin.ts`.
- User statuses shown: NEW → "New", INVESTIGATING → "Looking into it", FIXED → "Fixed", WONT_FIX → "Won't fix".
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A report whose triage fails or times out must still be saved and visible to its author as "New" — test: model caller throws → report row exists with `triage = FAILED`.
- The model naming a `duplicateOf` that is not one of the open issues sent (hallucinated or a closed issue) must create a new issue, not attach to an arbitrary row — test in Task 4.
- A user must never see another user's reports, and a non-admin must get 403 from every admin route — test in Task 9 (sim).
- A screenshot whose bytes are not an image (renamed .exe, SVG with script) must be rejected even if the declared type says image/png — test in Task 2.
- A safety report the model rates LOW ("I'm vegan and got chicken, minor") must still be CRITICAL — test in Task 3.

---

### Task 1: Data model and migration

**Files:**
- Modify: `prisma/schema.prisma` (new enums + models after `ClaraCapabilityRequest`; `Patient.feedbackReports`)
- Create: `prisma/migrations/20261007130000_feedback_reports/migration.sql`

**Interfaces:**
- Produces: Prisma models `FeedbackIssue`, `FeedbackReport`; enums `FeedbackCategory`, `FeedbackSeverity`, `FeedbackStatus`, `TriageState` (values exactly as below).

- [ ] **Step 1: Add to `prisma/schema.prisma`**

```prisma
enum FeedbackCategory {
  SAFETY_FOOD
  WRONG_FOOD
  MEAL_PLAN
  SHOPPING
  CLARA
  JOURNAL
  TRIALS
  PROFILE
  BILLING
  PERFORMANCE
  UI
  IDEA
  OTHER
}

enum FeedbackSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum FeedbackStatus {
  NEW
  INVESTIGATING
  FIXED
  WONT_FIX
}

enum TriageState {
  PENDING
  DONE
  FAILED
}

/// One problem; many user reports grouped into it by the triage bot.
model FeedbackIssue {
  id        String           @id @default(cuid())
  title     String
  category  FeedbackCategory
  severity  FeedbackSeverity
  status    FeedbackStatus   @default(NEW)
  reports   FeedbackReport[]
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  @@index([status, severity])
}

/// What one user sent from the Feedback screen.
model FeedbackReport {
  id            String         @id @default(cuid())
  patientId     String
  patient       Patient        @relation(fields: [patientId], references: [id], onDelete: Cascade)
  issueId       String?
  issue         FeedbackIssue? @relation(fields: [issueId], references: [id], onDelete: SetNull)
  text          String
  area          String?
  context       Json
  screenshotKey String?
  triage        TriageState    @default(PENDING)
  triageNote    String?
  triageTries   Int            @default(0)
  createdAt     DateTime       @default(now())

  @@index([patientId, createdAt])
  @@index([triage])
  @@index([issueId])
}
```

and in `model Patient` next to `claraCapabilityRequests`: `feedbackReports   FeedbackReport[]`

- [ ] **Step 2: Generate the migration offline**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema.old.prisma
npx prisma migrate diff --from-schema-datamodel /tmp/schema.old.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/feedback.sql
```
Copy `/tmp/feedback.sql` into `prisma/migrations/20261007130000_feedback_reports/migration.sql` with a header comment `-- Feedback reports: user bug reports grouped into issues by the triage bot. Additive.` Expected: only CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD FOREIGN KEY statements (no DROP).

- [ ] **Step 3: Regenerate the client and typecheck**

Run: `npx prisma generate && npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261007130000_feedback_reports
git commit -m "feat(feedback): data model — issues and reports (migration, not applied)"
```

### Task 2: Report validation

**Files:**
- Create: `lib/feedback/validate.ts`, `lib/feedback/validate.test.ts`

**Interfaces:**
- Produces: `FEEDBACK_AREAS: readonly ["meal-plan","ingredients","clara","journal","trials","profile","other"]`; `validateFeedbackText(raw: unknown): { ok: true; text: string } | { ok: false; error: string }`; `validateArea(raw: unknown): string | null`; `sniffImage(buf: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null`; `FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024`.

- [ ] **Step 1: Write the failing tests** (`lib/feedback/validate.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedbackText, validateArea, sniffImage, FEEDBACK_AREAS } from "./validate";

test("text: trimmed, 10–2000 chars", () => {
  assert.deepEqual(validateFeedbackText("  The plan shows chicken  "), { ok: true, text: "The plan shows chicken" });
  assert.equal(validateFeedbackText("too short").ok, false);
  assert.equal(validateFeedbackText("x".repeat(2001)).ok, false);
  assert.equal(validateFeedbackText(42).ok, false);
});

test("area: one of the listed areas or null", () => {
  assert.equal(validateArea("clara"), "clara");
  assert.equal(validateArea("CLARA"), "clara");
  assert.equal(validateArea("admin"), null);
  assert.equal(validateArea(undefined), null);
  assert.equal(FEEDBACK_AREAS.length, 7);
});

test("image: decided by magic bytes, not the declared type", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new Uint8Array([0x4d, 0x5a, 0x90, 0])), null); // MZ executable
});
```

- [ ] **Step 2: Run to verify it fails** — `node --import tsx --test lib/feedback/validate.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`lib/feedback/validate.ts`)

```ts
// Pure validation for user feedback reports (spec 2026-10-07-feedback-reports-design).
export const FEEDBACK_AREAS = ["meal-plan", "ingredients", "clara", "journal", "trials", "profile", "other"] as const;
export const FEEDBACK_TEXT_MIN = 10;
export const FEEDBACK_TEXT_MAX = 2000;
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateFeedbackText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Tell us what went wrong." };
  const text = raw.trim();
  if (text.length < FEEDBACK_TEXT_MIN) return { ok: false, error: `Please add a little more detail (at least ${FEEDBACK_TEXT_MIN} characters).` };
  if (text.length > FEEDBACK_TEXT_MAX) return { ok: false, error: `Please keep it under ${FEEDBACK_TEXT_MAX} characters.` };
  return { ok: true, text };
}

export function validateArea(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase();
  return (FEEDBACK_AREAS as readonly string[]).includes(a) ? a : null;
}

// The declared content type is the client's claim; the bytes decide.
export function sniffImage(buf: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** `feat(feedback): report validation (text, area, image by magic bytes)`.

### Task 3: Safety override

**Files:**
- Create: `lib/feedback/safety.ts`, `lib/feedback/safety.test.ts`

**Interfaces:**
- Produces: `isSafetyReport(text: string): boolean`

- [ ] **Step 1: Failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafetyReport } from "./safety";

test("allergy / banned-food reports are safety reports", () => {
  for (const t of [
    "I'm allergic to peanuts and the plan has peanut butter",
    "I chose vegetarian but the shopping list has bacon",
    "I'm vegan and got chicken, minor",
    "Clara suggested shrimp even though shellfish is banned for me",
    "this dish made me sick, I think it had gluten and I have celiac",
    "anaphylaxis risk: sesame in my lunch",
  ]) assert.ok(isSafetyReport(t), t);
});

test("ordinary bugs are not", () => {
  for (const t of ["The save button does nothing", "Calories look too high on Monday", "I'd love a dark mode", "The page is slow to load"]) {
    assert.ok(!isSafetyReport(t), t);
  }
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
// Reports about being offered food the diner cannot eat are always CRITICAL,
// whatever the model says (spec: "Safety override").
const ALLERGY = /\b(allerg\w*|anaphyla\w*|epipen|celiac|coeliac|intoleran\w*)\b/i;
const RULE_BREAK = /\b(banned|not allowed|i (?:can'?t|cannot|don'?t) eat|made me (?:sick|ill)|reaction)\b/i;
const DIET_CLASH = /\b(vegan|vegetarian|pescatarian|halal|kosher|gluten[- ]free|dairy[- ]free)\b[^.!?]{0,80}\b(meat|chicken|beef|pork|bacon|fish|shrimp|egg|eggs|cheese|milk|gelatin|ham|turkey|gluten|wheat)\b/i;

export function isSafetyReport(text: string): boolean {
  return ALLERGY.test(text) || RULE_BREAK.test(text) || DIET_CLASH.test(text);
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(feedback): safety override for allergy/diet reports`.

### Task 4: Triage — prompt input and output parsing (pure)

**Files:**
- Create: `lib/feedback/triage-parse.ts`, `lib/feedback/triage-parse.test.ts`

**Interfaces:**
- Consumes: `isSafetyReport` (Task 3).
- Produces: `TRIAGE_TOOL` (Anthropic tool definition `triage_report`); `type OpenIssueBrief = { id: string; title: string; category: string }`; `type TriageResult = { category: FeedbackCategory; severity: FeedbackSeverity; title: string; duplicateOf: string | null; reasoning: string }`; `buildTriageMessage(report: { text: string; area: string | null; context: Record<string, unknown> }, open: OpenIssueBrief[]): string`; `parseTriage(raw: unknown, text: string, open: OpenIssueBrief[]): TriageResult`; `maxSeverity(a, b)`.

- [ ] **Step 1: Failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTriage, buildTriageMessage, maxSeverity } from "./triage-parse";

const open = [{ id: "iss1", title: "Shopping list shows meat to vegetarians", category: "WRONG_FOOD" }];

test("valid output passes through; title trimmed to 90", () => {
  const r = parseTriage({ category: "UI", severity: "LOW", title: "x".repeat(120), duplicateOf: null, reasoning: "cosmetic" }, "The button is misaligned on mobile", open);
  assert.equal(r.category, "UI");
  assert.equal(r.severity, "LOW");
  assert.equal(r.title.length, 90);
});

test("unknown enums fall back to OTHER / MEDIUM", () => {
  const r = parseTriage({ category: "COSMIC", severity: "URGENT", title: "t", duplicateOf: null }, "Something odd happened here", open);
  assert.deepEqual([r.category, r.severity], ["OTHER", "MEDIUM"]);
});

test("duplicateOf must be one of the open issues sent", () => {
  assert.equal(parseTriage({ category: "UI", severity: "LOW", title: "t", duplicateOf: "iss1" }, "dup of the vegetarian thing", open).duplicateOf, "iss1");
  assert.equal(parseTriage({ category: "UI", severity: "LOW", title: "t", duplicateOf: "made-up" }, "something else entirely", open).duplicateOf, null);
});

test("safety text forces SAFETY_FOOD / CRITICAL even if the model said LOW", () => {
  const r = parseTriage({ category: "UI", severity: "LOW", title: "minor", duplicateOf: null }, "I'm vegan and got chicken, minor", open);
  assert.deepEqual([r.category, r.severity], ["SAFETY_FOOD", "CRITICAL"]);
});

test("model choosing SAFETY_FOOD is CRITICAL", () => {
  assert.equal(parseTriage({ category: "SAFETY_FOOD", severity: "MEDIUM", title: "t", duplicateOf: null }, "The dish had something I avoid", open).severity, "CRITICAL");
});

test("garbage input never throws", () => {
  const r = parseTriage(null, "The page froze when I saved", open);
  assert.deepEqual([r.category, r.severity, r.duplicateOf], ["OTHER", "MEDIUM", null]);
  assert.ok(r.title.length > 0);
});

test("prompt carries the report and open issue titles, no profile data", () => {
  const m = buildTriageMessage({ text: "Plan shows bacon", area: "meal-plan", context: { from: "/meal-plan", tier: "free" } }, open);
  assert.match(m, /Plan shows bacon/);
  assert.match(m, /iss1 · WRONG_FOOD · Shopping list shows meat to vegetarians/);
});

test("maxSeverity never lowers", () => {
  assert.equal(maxSeverity("CRITICAL", "LOW"), "CRITICAL");
  assert.equal(maxSeverity("LOW", "HIGH"), "HIGH");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (`lib/feedback/triage-parse.ts`)

```ts
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
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(feedback): triage prompt and guarded output parsing`.

### Task 5: Ranking

**Files:**
- Create: `lib/feedback/rank.ts`, `lib/feedback/rank.test.ts`

**Interfaces:**
- Produces: `type RankableIssue = { id: string; severity: FeedbackSeverity; status: FeedbackStatus; reports: { patientId: string; createdAt: Date }[] }`; `issueScore(issue: RankableIssue, now: Date): number`; `rankIssues<T extends RankableIssue>(issues: T[], now: Date): { open: (T & { score: number; reporters: number; lastSeen: Date | null })[]; closed: (T & { score: number; reporters: number; lastSeen: Date | null })[] }`.

- [ ] **Step 1: Failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankIssues, issueScore } from "./rank";

const now = new Date("2026-10-07T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86400000);
const issue = (id: string, severity: any, status: any, reports: [string, number][]) => ({ id, severity, status, reports: reports.map(([patientId, d]) => ({ patientId, createdAt: day(d) })) });

test("score = weight × distinct reporters × recency", () => {
  assert.equal(issueScore(issue("a", "HIGH", "NEW", [["u1", 1], ["u1", 2], ["u2", 3]]), now), 20 * 2 * 1);
  assert.equal(issueScore(issue("b", "MEDIUM", "NEW", [["u1", 20]]), now), 5 * 1 * 0.5);
  assert.equal(issueScore(issue("c", "LOW", "NEW", [["u1", 90]]), now), 1 * 1 * 0.25);
});

test("CRITICAL first even with fewer reporters; closed go to their own list", () => {
  const r = rankIssues([
    issue("many", "HIGH", "NEW", [["u1", 1], ["u2", 1], ["u3", 1], ["u4", 1], ["u5", 1], ["u6", 1]]),
    issue("crit", "CRITICAL", "INVESTIGATING", [["u9", 40]]),
    issue("done", "CRITICAL", "FIXED", [["u1", 1]]),
  ], now);
  assert.deepEqual(r.open.map((i) => i.id), ["crit", "many"]);
  assert.deepEqual(r.closed.map((i) => i.id), ["done"]);
  assert.equal(r.open[1].reporters, 6);
});

test("an issue with no reports scores 0 and does not crash", () => {
  assert.equal(issueScore(issue("e", "HIGH", "NEW", []), now), 0);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { FeedbackSeverity, FeedbackStatus } from "@prisma/client";

const WEIGHT: Record<FeedbackSeverity, number> = { CRITICAL: 100, HIGH: 20, MEDIUM: 5, LOW: 1 };
export type RankableIssue = { id: string; severity: FeedbackSeverity; status: FeedbackStatus; reports: { patientId: string; createdAt: Date }[] };

const lastSeenOf = (i: RankableIssue) => (i.reports.length ? new Date(Math.max(...i.reports.map((r) => r.createdAt.getTime()))) : null);

export function issueScore(i: RankableIssue, now: Date): number {
  const reporters = new Set(i.reports.map((r) => r.patientId)).size; // people, not volume
  const last = lastSeenOf(i);
  if (!last || reporters === 0) return 0;
  const age = (now.getTime() - last.getTime()) / 86400000;
  const recency = age <= 7 ? 1 : age <= 30 ? 0.5 : 0.25;
  return WEIGHT[i.severity] * reporters * recency;
}

export function rankIssues<T extends RankableIssue>(issues: T[], now: Date) {
  const scored = issues.map((i) => ({ ...i, score: issueScore(i, now), reporters: new Set(i.reports.map((r) => r.patientId)).size, lastSeen: lastSeenOf(i) }));
  const byRank = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    Number(b.severity === "CRITICAL") - Number(a.severity === "CRITICAL") || b.score - a.score || (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0);
  return {
    open: scored.filter((i) => i.status === "NEW" || i.status === "INVESTIGATING").sort(byRank),
    closed: scored.filter((i) => i.status === "FIXED" || i.status === "WONT_FIX").sort(byRank),
  };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(feedback): ranking by severity × distinct reporters × recency`.

### Task 6: Triage runner (model call + apply)

**Files:**
- Create: `lib/feedback/triage.ts`

**Interfaces:**
- Consumes: Task 4 (`TRIAGE_TOOL`, `buildTriageMessage`, `parseTriage`, `maxSeverity`, `OpenIssueBrief`).
- Produces: `type TriageCaller = (message: string) => Promise<unknown>` (returns the tool input object); `defaultTriageCaller: TriageCaller`; `setTriageCallerForTests(fn: TriageCaller | null): void`; `triageReport(reportId: string, call?: TriageCaller): Promise<"DONE" | "FAILED">`; `retryPendingTriage(limit?: number, call?: TriageCaller): Promise<number>`. Caller precedence: explicit `call` → test override → `defaultTriageCaller`.

- [ ] **Step 1: Implement**

```ts
import { prisma } from "@/lib/db";
import { createAnthropic } from "@/lib/anthropic";
import { TRIAGE_TOOL, buildTriageMessage, parseTriage, maxSeverity, type OpenIssueBrief } from "./triage-parse";

export type TriageCaller = (message: string) => Promise<unknown>;
const TRIAGE_TIMEOUT_MS = 8000;
const MAX_TRIES = 3;

export const defaultTriageCaller: TriageCaller = async (message) => {
  const client = createAnthropic({ timeout: TRIAGE_TIMEOUT_MS, maxRetries: 0 });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: "You triage bug reports for Wondish, a nutrition and meal-planning app. Be terse and factual.",
    tools: [TRIAGE_TOOL as any],
    tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
    messages: [{ role: "user", content: message }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no tool_use in triage response");
  return block.input;
};

let callerOverride: TriageCaller | null = null;
/** Simulation/tests only: replace the model call (routes call triageReport without a caller). */
export function setTriageCallerForTests(fn: TriageCaller | null) {
  callerOverride = fn;
}
const pickCaller = (call?: TriageCaller) => call ?? callerOverride ?? defaultTriageCaller;

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`triage timed out after ${ms} ms`)), ms))]);

/** Categorise one saved report and attach it to an issue. Never throws. */
export async function triageReport(reportId: string, call?: TriageCaller): Promise<"DONE" | "FAILED"> {
  const report = await prisma.feedbackReport.findUnique({ where: { id: reportId } });
  if (!report || report.triage === "DONE") return "DONE";
  const openRows = await prisma.feedbackIssue.findMany({
    where: { status: { in: ["NEW", "INVESTIGATING"] } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, category: true },
  });
  const open: OpenIssueBrief[] = openRows.map((o) => ({ id: o.id, title: o.title, category: o.category }));
  try {
    const raw = await withTimeout(pickCaller(call)(buildTriageMessage({ text: report.text, area: report.area, context: (report.context ?? {}) as Record<string, unknown> }, open)), TRIAGE_TIMEOUT_MS);
    const t = parseTriage(raw, report.text, open);
    await prisma.$transaction(async (tx) => {
      let issueId = t.duplicateOf;
      if (issueId) {
        const issue = await tx.feedbackIssue.findUnique({ where: { id: issueId }, select: { severity: true } });
        if (issue) await tx.feedbackIssue.update({ where: { id: issueId }, data: { severity: maxSeverity(issue.severity, t.severity) } });
        else issueId = null;
      }
      if (!issueId) {
        issueId = (await tx.feedbackIssue.create({ data: { title: t.title, category: t.category, severity: t.severity }, select: { id: true } })).id;
      }
      await tx.feedbackReport.update({ where: { id: report.id }, data: { issueId, triage: "DONE", triageNote: t.reasoning || null, triageTries: { increment: 1 } } });
    });
    return "DONE";
  } catch (e) {
    await prisma.feedbackReport.update({
      where: { id: report.id },
      data: { triage: "FAILED", triageNote: (e instanceof Error ? e.message : String(e)).slice(0, 300), triageTries: { increment: 1 } },
    });
    return "FAILED";
  }
}

/** Retry untriaged reports (admin page load / "Retry triage"). */
export async function retryPendingTriage(limit = 5, call?: TriageCaller): Promise<number> {
  const rows = await prisma.feedbackReport.findMany({
    where: { triage: { in: ["PENDING", "FAILED"] }, triageTries: { lt: MAX_TRIES } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const r of rows) if ((await triageReport(r.id, call)) === "DONE") done++;
  return done;
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p .` → no errors. (Behaviour is tested end to end in Task 9.)
- [ ] **Step 3: Commit** `feat(feedback): triage runner — model call, issue join/create, never throws`.

### Task 7: User API and screenshot storage

**Files:**
- Modify: `lib/s3.ts` (add `"feedback"` folder + `uploadPrivateFile`)
- Create: `app/api/feedback/route.ts`, `lib/feedback/status.ts`

**Interfaces:**
- Consumes: Tasks 2, 6; `rateLimit`, `resolveAiTier`, `patientForClerk` (`lib/custom-conditions-server.ts`).
- Produces: `uploadPrivateFile(buffer: Buffer, mimeType: string, folder: "feedback"): Promise<string>` (returns the S3 KEY); `USER_STATUS_LABEL: Record<FeedbackStatus | "PENDING", string>`; `POST /api/feedback` (multipart: `text`, `area?`, `from?`, `viewport?`, `sentryEventId?`, `screenshot?`) → 201 `{ report: { id, status } }`; `GET /api/feedback` → `{ reports: { id, text, createdAt, status }[] }`.

- [ ] **Step 1: `lib/s3.ts`** — widen the folder union to include `"feedback"` and add:

```ts
/** Upload and return the object KEY (never a URL): for private objects read via getPresignedUrl. */
export async function uploadPrivateFile(buffer: Buffer, mimeType: string, folder: "feedback"): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  await getClient().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
  return key;
}
```

- [ ] **Step 2: `lib/feedback/status.ts`**

```ts
export const USER_STATUS_LABEL = { PENDING: "New", NEW: "New", INVESTIGATING: "Looking into it", FIXED: "Fixed", WONT_FIX: "Won't fix" } as const;
export type UserStatus = keyof typeof USER_STATUS_LABEL;
```

- [ ] **Step 3: `app/api/feedback/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAiTier } from "@/lib/ai-budget";
import { patientForClerk } from "@/lib/custom-conditions-server";
import { uploadPrivateFile } from "@/lib/s3";
import { validateFeedbackText, validateArea, sniffImage, FEEDBACK_MAX_IMAGE_BYTES } from "@/lib/feedback/validate";
import { triageReport } from "@/lib/feedback/triage";

// POST /api/feedback — a user's bug report (multipart). GET — the caller's own reports.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("feedback-submit", userId, 10, 86400);
  if (!success) return NextResponse.json({ error: "You've sent 10 reports today — thank you! Please try again tomorrow." }, { status: 429 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid form" }, { status: 400 }); }
  const t = validateFeedbackText(form.get("text"));
  if (!t.ok) return NextResponse.json({ error: t.error, field: "text" }, { status: 422 });

  const context: Record<string, unknown> = {
    from: String(form.get("from") ?? "").slice(0, 200) || null,
    viewport: String(form.get("viewport") ?? "").slice(0, 20) || null,
    sentryEventId: String(form.get("sentryEventId") ?? "").slice(0, 64) || null,
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    tier: await resolveAiTier(userId),
    appVersion: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  };

  let screenshotKey: string | null = null;
  const file = form.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) return NextResponse.json({ error: "Screenshots can be up to 5 MB.", field: "screenshot" }, { status: 422 });
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniffImage(buf);
    if (!type) return NextResponse.json({ error: "Please attach a PNG, JPEG or WebP image.", field: "screenshot" }, { status: 422 });
    try {
      screenshotKey = await uploadPrivateFile(buf, type, "feedback");
    } catch {
      context.screenshot = "not stored: storage not configured";
    }
  }

  const report = await prisma.feedbackReport.create({
    data: { patientId: patient.id, text: t.text, area: validateArea(form.get("area")), context: context as any, screenshotKey },
    select: { id: true },
  });
  const triage = await triageReport(report.id);
  const row = await prisma.feedbackReport.findUnique({ where: { id: report.id }, select: { issue: { select: { status: true } } } });
  return NextResponse.json({ report: { id: report.id, status: row?.issue?.status ?? "NEW", triaged: triage === "DONE" } }, { status: 201 });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const rows = await prisma.feedbackReport.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, text: true, createdAt: true, issue: { select: { status: true } } },
  });
  return NextResponse.json({ reports: rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, status: r.issue?.status ?? "NEW" })) });
}
```

- [ ] **Step 4: Typecheck** → no errors. **Step 5: Commit** `feat(feedback): user report API with private screenshot upload`.

### Task 8: Admin API

**Files:**
- Create: `app/api/admin/feedback/route.ts`, `app/api/admin/feedback/issues/[id]/route.ts`, `app/api/admin/feedback/reports/[id]/route.ts`, `app/api/admin/feedback/reports/[id]/screenshot/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `adminErrorResponse`, `rankIssues` (Task 5), `retryPendingTriage`, `triageReport` (Task 6), `getPresignedUrl`.
- Produces: `GET /api/admin/feedback` → `{ counts: { openCritical, open, untriaged }, open: IssueRow[], closed: IssueRow[], untriaged: ReportRow[] }` where `IssueRow = { id, title, category, severity, status, score, reporters, reportCount, lastSeen, reports: ReportRow[] }`, `ReportRow = { id, text, area, createdAt, context, hasScreenshot, triage, triageNote }`; `PATCH issues/[id]` body `{ status?, title?, severity? }`; `PATCH reports/[id]` body `{ moveTo: issueId | "new" } | { retry: true }`; `GET reports/[id]/screenshot` → `{ url }`.

- [ ] **Step 1: `app/api/admin/feedback/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { rankIssues } from "@/lib/feedback/rank";
import { retryPendingTriage } from "@/lib/feedback/triage";

const reportSelect = { id: true, patientId: true, text: true, area: true, createdAt: true, context: true, screenshotKey: true, triage: true, triageNote: true } as const;
const toReportRow = (r: any) => ({ id: r.id, text: r.text, area: r.area, createdAt: r.createdAt, context: r.context, hasScreenshot: Boolean(r.screenshotKey), triage: r.triage, triageNote: r.triageNote });

export async function GET() {
  try {
    await requireAdmin();
    await retryPendingTriage(5).catch(() => 0); // best effort; never blocks the page
    const issues = await prisma.feedbackIssue.findMany({ include: { reports: { select: reportSelect, orderBy: { createdAt: "desc" } } } });
    const ranked = rankIssues(issues, new Date());
    const row = (i: (typeof ranked.open)[number]) => ({
      id: i.id, title: i.title, category: i.category, severity: i.severity, status: i.status,
      score: i.score, reporters: i.reporters, reportCount: i.reports.length, lastSeen: i.lastSeen, reports: i.reports.map(toReportRow),
    });
    const untriaged = await prisma.feedbackReport.findMany({ where: { issueId: null }, select: reportSelect, orderBy: { createdAt: "desc" } });
    return NextResponse.json({
      counts: { openCritical: ranked.open.filter((i) => i.severity === "CRITICAL").length, open: ranked.open.length, untriaged: untriaged.length },
      open: ranked.open.map(row),
      closed: ranked.closed.map(row),
      untriaged: untriaged.map(toReportRow),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 2: `issues/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { SEVERITIES } from "@/lib/feedback/triage-parse";

const STATUSES = ["NEW", "INVESTIGATING", "FIXED", "WONT_FIX"] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (STATUSES.includes(b.status)) data.status = b.status;
    if ((SEVERITIES as string[]).includes(b.severity)) data.severity = b.severity;
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 90);
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
    const issue = await prisma.feedbackIssue.update({ where: { id: params.id }, data, select: { id: true, status: true, severity: true, title: true } });
    return NextResponse.json({ issue });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 3: `reports/[id]/route.ts`** — move to issue / new issue, or retry

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { triageReport } from "@/lib/feedback/triage";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const report = await prisma.feedbackReport.findUnique({ where: { id: params.id }, select: { id: true, text: true, issue: { select: { category: true, severity: true } } } });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (b.retry === true) {
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { triage: "PENDING", triageTries: 0, issueId: null } });
      return NextResponse.json({ triage: await triageReport(report.id) });
    }
    if (b.moveTo === "new") {
      const issue = await prisma.feedbackIssue.create({
        data: { title: report.text.split("\n")[0].slice(0, 90), category: report.issue?.category ?? "OTHER", severity: report.issue?.severity ?? "MEDIUM" },
        select: { id: true },
      });
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { issueId: issue.id, triage: "DONE" } });
      return NextResponse.json({ issueId: issue.id });
    }
    if (typeof b.moveTo === "string") {
      const target = await prisma.feedbackIssue.findUnique({ where: { id: b.moveTo }, select: { id: true } });
      if (!target) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { issueId: target.id, triage: "DONE" } });
      return NextResponse.json({ issueId: target.id });
    }
    return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 4: `reports/[id]/screenshot/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { getPresignedUrl } from "@/lib/s3";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const r = await prisma.feedbackReport.findUnique({ where: { id: params.id }, select: { screenshotKey: true } });
    if (!r?.screenshotKey) return NextResponse.json({ error: "No screenshot" }, { status: 404 });
    return NextResponse.json({ url: await getPresignedUrl(r.screenshotKey, 600) });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 5: Typecheck; commit** `feat(feedback): admin API — ranked issues, status, regroup, retry, screenshot links`.

### Task 9: Simulation tests (routes end to end, model stubbed)

**Files:**
- Modify: `sim/fake-db.ts` — opt-in in-memory store for `feedbackIssue` / `feedbackReport` (create/update/findMany/findUnique with the filters used above) and `$transaction(fn)` for those models only; `account` lookup for `requireAdmin` via `state.isAdmin`.
- Create: `sim/feedback.sim.ts`; add it to `npm run sim:rules`.

**Interfaces:**
- Consumes: Tasks 6–8 routes; `setTriageCallerForTests(fn)` from Task 6 to stub the model (routes call `triageReport(report.id)` with no caller).

- [ ] **Step 1:** In the sim, `setTriageCallerForTests(async (msg) => stubResult)` before each case; reset to `null` after.

- [ ] **Step 2: Write `sim/feedback.sim.ts`** with these tests (each against the real routes):
  1. submit → saved, triaged by stub into a new issue, author sees it in GET with status NEW;
  2. second user's similar report with stub `duplicateOf` = first issue → joined; admin GET shows 2 reporters;
  3. stub throws → POST still 201, report `triage = FAILED`, author sees "NEW"; admin GET retries with a working stub → DONE;
  4. stub returns LOW/UI for "I'm vegan and the plan gave me chicken" → issue SAFETY_FOOD/CRITICAL, ranked first in admin GET above a 6-reporter HIGH issue;
  5. hallucinated `duplicateOf` → new issue;
  6. user A cannot see user B's reports; non-admin GET/PATCH admin routes → 403;
  7. 11th report in a day → 429; text of 5 chars → 422; a `.png`-named SVG → 422;
  8. admin PATCH status FIXED → author's GET shows FIXED; PATCH moveTo "new" splits a report into its own issue.
- [ ] **Step 3: Run** `node --experimental-test-module-mocks --import tsx --test sim/feedback.sim.ts` → all pass. Mutation-check: comment out the safety override in `parseTriage` → test 4 fails; restore.
- [ ] **Step 4: Commit** `test(sim): feedback routes end to end with a stubbed triage model`.

### Task 10: User page and sidebar entry

**Files:**
- Create: `app/(dashboard)/feedback/page.tsx`, `components/feedback/FeedbackForm.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx` (last user item after Taste), `messages/en.json`, `messages/es.json`, `messages/ru.json` (`"feedback": "Feedback" | "Comentarios" | "Обратная связь"`)

**Interfaces:**
- Consumes: `POST/GET /api/feedback`, `FEEDBACK_AREAS`, `USER_STATUS_LABEL`.

- [ ] **Step 1:** Load the `ui-ux-pro-max:ui-ux-pro-max` skill (user rule for frontend work).
- [ ] **Step 2:** Sidebar: `{ href: \`/feedback?from=${encodeURIComponent(pathname)}\`, label: t("feedback") }` as the last item of the user list (active when `pathname.startsWith("/feedback")`).
- [ ] **Step 3:** `page.tsx` (server): auth guard like other dashboard pages; renders `<FeedbackForm from={searchParams.from ?? ""} />` under an "Feedback" heading with one line of intro: "Found something broken or wrong? Tell us — it goes straight to the team."
- [ ] **Step 4:** `FeedbackForm.tsx` (client): textarea (label "What went wrong?", 10–2,000 counter), area chips (pre-selected from `from`: `/meal-plan`→meal-plan, `/pantry`→ingredients, `/clara`|`/ai`→clara, `/journal`→journal, `/trials`→trials, `/profile`→profile, else none), file input (accept `image/png,image/jpeg,image/webp`, shows file name + remove), Send button with spinner (disabled while sending or text < 10). Posts `FormData` incl. `viewport` (`${innerWidth}x${innerHeight}`) and `sentryEventId` (`Sentry.lastEventId()` from `@sentry/nextjs`, guarded by try/catch). On 201: clear form, show `role="status"` "Thanks — we've got it. You'll see its status below.", reload "Your reports". On error: show the API's `error` near the field (`field`) or above the button. "Your reports" list: first line of text (truncate with ellipsis, full text in `title`), date, status badge with `USER_STATUS_LABEL` (text, not colour alone). Empty state: "No reports yet."
- [ ] **Step 5:** Browser check (desktop + 375 px) on the dev server: sidebar item last, chips pre-selected, validation messages, no horizontal scroll. Submitting writes a DB row — only after the migration is applied, then delete the QA row.
- [ ] **Step 6: Commit** `feat(feedback): Feedback screen and sidebar entry`.

### Task 11: Admin page

**Files:**
- Create: `app/(dashboard)/admin/feedback/page.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx` (admin list after Clara gaps), `messages/*.json` (`"feedbackAdmin": "Feedback" | "Comentarios" | "Отзывы"`)

**Interfaces:**
- Consumes: `GET /api/admin/feedback`, `PATCH /api/admin/feedback/issues/[id]`, `PATCH /api/admin/feedback/reports/[id]`, `GET .../screenshot`.

- [ ] **Step 1:** Client page modelled on `app/(dashboard)/admin/clara-gaps/page.tsx`: counters (open critical, open, untriaged), ranked table (score, severity badge with text, category, title, reporters, reports, last seen, status `<select>` that PATCHes immediately), row expands to reports (text, area, date, context: from / device / tier / version / Sentry id, screenshot button → fetches signed URL → `<img>` with alt "User screenshot", "Move to…" select of open issues + "New issue", "Retry triage" for FAILED). Inline title/severity edit. "Untriaged" section and a collapsed "Closed" section.
- [ ] **Step 2:** Browser check desktop + 375 px with seeded data (after migration).
- [ ] **Step 3: Commit** `feat(feedback): admin feedback page`.

### Task 12: Full verification and rollout

- [ ] `npx tsc --noEmit -p .`, `npm test`, `npm run sim:rules` (incl. `sim/feedback.sim.ts`) — all pass.
- [ ] Ask the user for "run migration"; then `npx prisma migrate status` → `npx prisma migrate deploy` (applies `20261007120000_custom_plans` and `20261007130000_feedback_reports`).
- [ ] Push to `main`; browser check on the QA account: send one report end to end, see it in admin, set FIXED, see it on the user page; delete the QA report and issue.
