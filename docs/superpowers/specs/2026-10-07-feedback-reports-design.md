# Feedback reports: user bug reports, AI triage, ranked admin view

Date: 2026-10-07 · Status: approved in chat, awaiting spec review

## Goal

Users can report a bug in under 30 seconds from a "Feedback" screen. Each
report is categorised and severity-rated by a bot, duplicates are grouped into
one problem, and the team sees one list ranked by importance.

**Success:** a report takes one text box and a Send; the team opens
`/admin/feedback` and the top rows are the problems hurting the most people,
with every allergy/diet-safety report at the top.

## Non-goals (v1)

- No Slack, email or GitHub integration (can be added on top of the admin page).
- No iOS screen (the API is reusable later).
- No two-way chat with the reporter; the only reply channel is the status.
- No automatic fixing or auto-closing.

## User experience

**Sidebar.** New last item "Feedback", after "My taste", for every signed-in
user (i18n key `feedback` in `messages/en|es|ru.json`).

**`/feedback` page** (`app/(dashboard)/feedback/page.tsx`, client form):
1. "What went wrong?" — required textarea, 10–2,000 characters.
2. "Where were you?" — optional chips: Meal plan, Ingredients / What to buy,
   Clara, Journal, Trials, Profile, Something else. Pre-selected from the page
   the user came from (`?from=` set by the sidebar link from the current path).
3. "Add a screenshot" — optional, one image (PNG/JPEG/WebP, ≤ 5 MB).
4. Send. Button shows a spinner; on success the form clears and a
   confirmation appears: "Thanks — we've got it. You'll see its status below."
5. "Your reports" — the user's own reports, newest first: their text (first
   line), date, and status badge (New · Looking into it · Fixed · Won't fix).

**Captured automatically, no user effort:** the `from` path, user agent,
viewport size, plan tier (from `resolveAiTier`), app version
(`VERCEL_GIT_COMMIT_SHA`, short), and the Sentry last event id if one exists
in the session (`Sentry.lastEventId()`), so a report links to its error.

**Limits:** 10 reports per user per day (`lib/rate-limit`, key
`feedback-submit`); a friendly message when hit. Text is stored as typed;
rendering escapes it.

## Data model (new Prisma models + migration)

```prisma
enum FeedbackCategory { SAFETY_FOOD WRONG_FOOD MEAL_PLAN SHOPPING CLARA JOURNAL TRIALS PROFILE BILLING PERFORMANCE UI IDEA OTHER }
enum FeedbackSeverity { CRITICAL HIGH MEDIUM LOW }
enum FeedbackStatus   { NEW INVESTIGATING FIXED WONT_FIX }
enum TriageState      { PENDING DONE FAILED }

model FeedbackIssue {          // one problem; many reports
  id         String           @id @default(cuid())
  title      String           // one-line summary (bot, editable by admin)
  category   FeedbackCategory
  severity   FeedbackSeverity
  status     FeedbackStatus   @default(NEW)
  reports    FeedbackReport[]
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  @@index([status, severity])
}

model FeedbackReport {         // what one user sent
  id            String        @id @default(cuid())
  patientId     String
  patient       Patient       @relation(fields: [patientId], references: [id], onDelete: Cascade)
  issueId       String?
  issue         FeedbackIssue? @relation(fields: [issueId], references: [id], onDelete: SetNull)
  text          String
  area          String?       // chip the user picked
  context       Json          // from, userAgent, viewport, tier, appVersion, sentryEventId
  screenshotKey String?       // S3 key under feedback/ (private)
  triage        TriageState   @default(PENDING)
  triageNote    String?       // bot's reasoning / failure message
  createdAt     DateTime      @default(now())
  @@index([patientId, createdAt])
  @@index([triage])
}
```

A report's visible status is its issue's status (`NEW` while untriaged).

## The bot (triage)

`lib/feedback/triage.ts`, called inline right after the report is saved,
capped at 8 seconds. The app is on Next 14 (no `after()`) and
`@vercel/functions` (`waitUntil`) is not installed, so a fire-and-forget call
could be killed when the function returns. Haiku answers in ~1–3 s behind the
Send spinner; on timeout the report stays `PENDING` and the retry path below
picks it up — the user never waits longer than the cap and nothing is lost.

**Model:** `claude-haiku-4-5` via `createAnthropic()` (`lib/anthropic.ts`),
one tool call `triage_report` with a strict JSON schema:
`{ category, severity, title (≤ 90 chars), duplicateOf: issueId | null, reasoning }`.

**Input:** the report text, area, context (minus user agent noise), and the
30 most recently updated open issues (`id`, `title`, `category`) so the bot
can name a duplicate. No profile or health data beyond what the user typed.

**Deterministic rules after the model (the model is never trusted alone):**
- **Safety override:** if the text mentions being served/offered food the user
  is allergic to or their rules ban (pattern list in
  `lib/feedback/safety.ts`: allerg*, anaphyla*, "I'm vegan/vegetarian … meat",
  "banned", "not allowed", "made me sick", reaction words) OR the model chose
  `SAFETY_FOOD` → category `SAFETY_FOOD`, severity `CRITICAL`.
- `duplicateOf` must be one of the issue ids sent; otherwise a new issue.
- Unknown enum values → `OTHER` / `MEDIUM`.
- On join, the issue's severity is raised to the max of its reports'
  severities (never lowered by a new report).

**Failure:** any error or timeout → `triage = FAILED`, `triageNote` set, the
report stays saved and shows to the user as "New". Pending/failed reports are
retried (max 3 attempts, recorded in `triageNote`) when an admin opens
`/admin/feedback`, and a "Retry triage" button forces it.

**Cost:** triage is the platform's cost, not the user's AI allowance; it is
bounded by the 10/day submit limit.

## Ranking

`lib/feedback/rank.ts` (pure):

```
score = severityWeight × distinctReporters × recency
severityWeight: CRITICAL 100, HIGH 20, MEDIUM 5, LOW 1
distinctReporters: unique patientIds on the issue (people, not volume —
                   same rule as the Clara gaps ledger)
recency: 1.0 if the latest report is ≤ 7 days old, 0.5 if ≤ 30, else 0.25
```

Open issues (`NEW`, `INVESTIGATING`) sort by score; `FIXED`/`WONT_FIX` are in a
collapsed "Closed" section. CRITICAL always sorts above non-critical
regardless of reporter count.

## Admin view

`/admin/feedback` (admin-only, same guard as `/admin/clara-gaps`), sidebar
entry in the admin section.

- Header counters: open critical, open total, untriaged.
- Ranked table: score, severity badge, category, title, reporters (distinct),
  reports, last seen, status dropdown (saves immediately).
- Row expands to its reports: text, area, date, context (from-path, device,
  tier, version, Sentry link), screenshot thumbnail (signed URL, 10-minute
  expiry, fetched on expand), and a "Move to issue…" control to fix a wrong
  grouping (pick another open issue or "new issue").
- Admin can edit an issue's title and severity (overrides the bot).

## API

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/api/feedback` | POST (multipart) | user | validate, rate-limit, upload screenshot, save, schedule triage |
| `/api/feedback` | GET | user | the user's own reports + status |
| `/api/admin/feedback` | GET | admin | ranked issues with reports (runs pending retries) |
| `/api/admin/feedback/issues/[id]` | PATCH | admin | status, title, severity |
| `/api/admin/feedback/reports/[id]` | PATCH | admin | move to another issue / new issue; retry triage |
| `/api/admin/feedback/reports/[id]/screenshot` | GET | admin | signed URL |

Validation in `lib/feedback/validate.ts` (pure): text length, area in the
chip list, file type/size by magic bytes (not just the header).

## Privacy and safety

- Screenshots go to S3 under `feedback/` via `lib/s3.ts` (adds a `"feedback"`
  folder); the key is stored, never a public URL; admins get 10-minute signed
  URLs. Where AWS credentials are not configured (local dev has none in
  `.env.local`), the upload is skipped, the report is still saved, and
  `context.screenshot = "not stored: storage not configured"` says so.
- Users only ever read their own reports. Reports are deleted with the
  account (cascade on Patient).
- The bot sees the report and the issue titles only — no profile, diet or
  journal data is sent.

## Testing

- Unit (`lib/feedback/*.test.ts`, in `npm test`): validation; safety override
  (allergy/vegan phrasings force CRITICAL, unrelated text does not); triage
  output parsing incl. invalid duplicate ids and unknown enums; ranking order
  incl. CRITICAL-first and distinct-reporter counting; severity only rises on
  join.
- Route level: POST/GET run in-process against the simulation harness's fake
  Prisma (`sim/`), with the model call stubbed — covers rate limit, own-reports
  isolation, and triage failure leaving the report saved.
- Browser: the user form and the admin page checked at desktop and 375 px
  widths with the QA account (submitting writes a row: done only on approval,
  then deleted).

## Rollout

1. Code + migration file committed.
2. **Production migration runs only on the user's "run migration".**
3. Deploy; verify one report end to end on the QA account, then delete it.

## Open questions

None at approval time.
