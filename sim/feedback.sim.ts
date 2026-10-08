// Feedback reports, end to end: the real user and admin routes run against the
// fake database (feedback tables live in its in-memory store; everything else
// stays read-only) with the triage model stubbed. Plan:
// docs/superpowers/plans/2026-10-07-feedback-reports.md, Task 9.
import "./setup"; // mocks + snapshot + fake Prisma — must load before any service
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { snap, state } from "./setup";
import { feedback, resetFeedbackStore } from "./fake-db";
import { makePatient, type Profile } from "./profiles";

const user = (name: string) => makePatient(snap, { id: `fb-${name}`, tier: "curated", rules: [] } as Profile);
const as = (u: ReturnType<typeof user>, admin = false) => {
  state.patient = u;
  state.isAdmin = admin;
};
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return new Request("http://localhost/api/feedback", { method: "POST", body: f, headers: { "user-agent": "sim" } });
};
const quietly = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const { error, warn, log } = console;
  console.error = console.warn = console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, { error, warn, log }); }
};
const routes = async () => ({
  user: await import("@/app/api/feedback/route"),
  admin: await import("@/app/api/admin/feedback/route"),
  issue: await import("@/app/api/admin/feedback/issues/[id]/route"),
  report: await import("@/app/api/admin/feedback/reports/[id]/route"),
  triage: await import("@/lib/feedback/triage"),
});
const post = async (u: ReturnType<typeof user>, text: string, extra: Record<string, string | File> = {}) => {
  const { user: r } = await routes();
  as(u);
  return quietly(() => r.POST(form({ text, ...extra }) as any));
};
const myReports = async (u: ReturnType<typeof user>) => {
  const { user: r } = await routes();
  as(u);
  return (await (await r.GET()).json()).reports as { id: string; status: string; text: string }[];
};
const adminView = async () => {
  const { admin } = await routes();
  as(user("admin"), true);
  const res = await quietly(() => admin.GET());
  assert.equal(res.status, 200);
  return res.json();
};
const stub = async (fn: (msg: string) => Promise<unknown>) => (await routes()).triage.setTriageCallerForTests(fn);

beforeEach(async () => {
  resetFeedbackStore();
  await stub(async () => ({ category: "UI", severity: "LOW", title: "Default stub issue", duplicateOf: null, reasoning: "stub" }));
});

test("1 · a report is saved, triaged into a new issue, and its author sees it as New", async () => {
  const u = user("one");
  const res = await post(u, "The save button on the journal does nothing", { area: "journal", from: "/journal" });
  assert.equal(res.status, 201);
  assert.equal(feedback.issues.length, 1);
  const rep = feedback.reports[0];
  assert.equal(rep.triage, "DONE");
  assert.equal(rep.area, "journal");
  assert.equal(rep.context.from, "/journal");
  assert.deepEqual((await myReports(u)).map((r) => r.status), ["NEW"]);
});

test("2 · the same problem from a second user joins the first issue; reporters count people", async () => {
  await post(user("a"), "Shopping list shows bacon although I chose vegetarian");
  const first = feedback.issues[0].id;
  await stub(async () => ({ category: "WRONG_FOOD", severity: "HIGH", title: "x", duplicateOf: first, reasoning: "same" }));
  await post(user("b"), "Bacon on my What to buy list, I'm vegetarian");
  await post(user("b"), "Again: bacon in what to buy for a vegetarian");
  assert.equal(feedback.issues.length, 1);
  const view = await adminView();
  assert.equal(view.open[0].reporters, 2);
  assert.equal(view.open[0].reportCount, 3);
});

test("3 · a failed triage keeps the report; the admin page retries it", async () => {
  const u = user("fail");
  await stub(async () => { throw new Error("model down"); });
  const res = await post(u, "The meal plan page shows a blank screen");
  assert.equal(res.status, 201);
  assert.equal(feedback.reports[0].triage, "FAILED");
  assert.equal(feedback.issues.length, 0);
  assert.deepEqual((await myReports(u)).map((r) => r.status), ["NEW"]);
  await stub(async () => ({ category: "MEAL_PLAN", severity: "HIGH", title: "Meal plan blank", duplicateOf: null, reasoning: "" }));
  const view = await adminView();
  assert.equal(feedback.reports[0].triage, "DONE");
  assert.equal(view.counts.untriaged, 0);
  assert.equal(view.open[0].title, "Meal plan blank");
});

test("4 · a safety report the model calls LOW is CRITICAL and outranks a 6-reporter HIGH issue", async () => {
  await stub(async () => ({ category: "MEAL_PLAN", severity: "HIGH", title: "Plan slow", duplicateOf: null, reasoning: "" }));
  await post(user("h0"), "The meal plan takes a minute to load");
  const busy = feedback.issues[0].id;
  await stub(async () => ({ category: "MEAL_PLAN", severity: "HIGH", title: "x", duplicateOf: busy, reasoning: "" }));
  for (let i = 1; i < 6; i++) await post(user(`h${i}`), "Meal plan is really slow to open today");
  await stub(async () => ({ category: "UI", severity: "LOW", title: "Chicken shown", duplicateOf: null, reasoning: "minor" }));
  await post(user("vegan"), "I'm vegan and the plan gave me chicken, minor");
  const view = await adminView();
  assert.deepEqual([view.open[0].category, view.open[0].severity], ["SAFETY_FOOD", "CRITICAL"]);
  assert.equal(view.open[1].reporters, 6);
  assert.equal(view.counts.openCritical, 1);
});

test("5 · a hallucinated duplicateOf starts a new issue instead of joining a random one", async () => {
  await post(user("p"), "Calories look wrong on Tuesday");
  await stub(async () => ({ category: "UI", severity: "LOW", title: "Other thing", duplicateOf: "iss-does-not-exist", reasoning: "" }));
  await post(user("q"), "The Trials page button overlaps the text");
  assert.equal(feedback.issues.length, 2);
  assert.notEqual(feedback.reports[0].issueId, feedback.reports[1].issueId);
});

test("6 · users only see their own reports; non-admins are refused by every admin route", async () => {
  const a = user("iso-a"), b = user("iso-b");
  await post(a, "My journal entry disappeared after saving");
  await post(b, "Clara answered in the wrong language");
  assert.deepEqual((await myReports(a)).map((r) => r.text), ["My journal entry disappeared after saving"]);
  assert.deepEqual((await myReports(b)).map((r) => r.text), ["Clara answered in the wrong language"]);
  const { admin, issue, report } = await routes();
  as(a, false);
  assert.equal((await quietly(() => admin.GET())).status, 403);
  const req = new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "FIXED" }) });
  assert.equal((await quietly(() => issue.PATCH(req as any, { params: { id: feedback.issues[0].id } }))).status, 403);
  assert.equal((await quietly(() => report.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ retry: true }) }) as any, { params: { id: feedback.reports[0].id } }))).status, 403);
});

test("7 · limits: 10 a day, text too short, a non-image disguised as PNG", async () => {
  const u = user("limits");
  for (let i = 0; i < 10; i++) assert.equal((await post(u, `Report number ${i} about something broken`)).status, 201);
  const eleventh = await post(u, "Report number 11 about something broken");
  assert.equal(eleventh.status, 429);
  const v = user("limits-2");
  assert.equal((await post(v, "short")).status, 422);
  const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"], "shot.png", { type: "image/png" });
  const bad = await post(v, "Here is a screenshot of the problem", { screenshot: svg });
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).field, "screenshot");
});

test("8 · admin status reaches the reporter; a report can be split into its own issue", async () => {
  const u = user("status"), w = user("status-2");
  await post(u, "Shopping list total is wrong");
  const iss = feedback.issues[0].id;
  await stub(async () => ({ category: "SHOPPING", severity: "MEDIUM", title: "x", duplicateOf: iss, reasoning: "" }));
  await post(w, "Actually my problem is the dark mode colours");
  const { issue, report } = await routes();
  as(user("admin"), true);
  const res = await issue.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "FIXED" }) }) as any, { params: { id: iss } });
  assert.equal(res.status, 200);
  assert.deepEqual((await myReports(u)).map((r) => r.status), ["FIXED"]);
  as(user("admin"), true);
  const wrong = feedback.reports.find((r) => r.patientId === w.id)!;
  const split = await report.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ moveTo: "new" }) }) as any, { params: { id: wrong.id } });
  assert.equal(split.status, 200);
  assert.equal(feedback.issues.length, 2);
  assert.deepEqual((await myReports(w)).map((r) => r.status), ["NEW"]);
});

test("5b · the model naming a CLOSED issue starts a new one — a regression must not hide under 'Fixed'", async () => {
  await post(user("closed-a"), "The shopping list total was wrong last week");
  const fixed = feedback.issues[0];
  fixed.status = "FIXED";
  await stub(async () => ({ category: "SHOPPING", severity: "MEDIUM", title: "Total wrong again", duplicateOf: fixed.id, reasoning: "same" }));
  await post(user("closed-b"), "Shopping list total is wrong again today");
  assert.equal(feedback.issues.length, 2, "report was filed under the fixed issue");
  const view = await adminView();
  assert.equal(view.open.length, 1);
  assert.equal(view.open[0].title, "Total wrong again");
});

test("9 · a safety report is CRITICAL even when the triage model is down — counted, ranked first, not left untriaged", async () => {
  await stub(async () => ({ category: "MEAL_PLAN", severity: "HIGH", title: "Plan slow", duplicateOf: null, reasoning: "" }));
  await post(user("busy"), "The meal plan takes a minute to load");
  await stub(async () => { throw new Error("model down"); });
  const res = await post(user("allergic"), "I'm allergic to peanuts and my lunch has peanut sauce");
  assert.equal(res.status, 201);
  const view = await adminView();
  assert.deepEqual([view.open[0].category, view.open[0].severity], ["SAFETY_FOOD", "CRITICAL"]);
  assert.equal(view.counts.openCritical, 1);
  assert.equal(view.counts.untriaged, 0);
});

test("10 · the admin page never hangs on a dead model: retries run in parallel within a budget, and each attempt is counted", async () => {
  await stub(async () => { throw new Error("down"); });
  for (let i = 0; i < 3; i++) await post(user(`dead${i}`), `The journal page is blank, attempt ${i}`);
  await stub(() => new Promise(() => {})); // never answers
  process.env.FEEDBACK_RETRY_BUDGET_MS = "300";
  const t0 = Date.now();
  await adminView();
  const took = Date.now() - t0;
  delete process.env.FEEDBACK_RETRY_BUDGET_MS;
  assert.ok(took < 1500, `admin page took ${took} ms`);
  // Each retry claimed its attempt before calling the model: 1 (submit) + 1 (retry).
  assert.deepEqual(feedback.reports.map((r) => r.triageTries), [2, 2, 2]);
});

// ── Deferred minors (2026-10-07) ─────────────────────────────────────────────

test("11 · a database error after the report is saved still answers 201 — no 500, no duplicate on resend", async () => {
  feedback.failNext = "feedbackIssue.findMany"; // triage's first read
  const res = await post(user("dbfail"), "The trials page shows an error banner");
  assert.equal(res.status, 201);
  assert.equal(feedback.reports.length, 1);
  assert.equal(feedback.reports[0].triage, "FAILED");
});

test("12 · two triages of the same report at once create ONE issue (atomic claim)", async () => {
  const { triage } = await routes();
  await stub(async () => { throw new Error("down"); });
  await post(user("race"), "Clara keeps answering in Spanish");
  const id = feedback.reports[0].id;
  let calls = 0;
  const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { category: "CLARA", severity: "MEDIUM", title: "Clara wrong language", duplicateOf: null, reasoning: "" }; };
  await Promise.all([triage.triageReport(id, slow), triage.triageReport(id, slow)]);
  assert.equal(feedback.issues.length, 1, `${feedback.issues.length} issues`);
  assert.equal(calls, 1, "the model was called twice for one report");
});

test("13 · an issue left with no reports (moved away) disappears instead of listing '0 people'", async () => {
  await post(user("move-a"), "The shopping list total is wrong");
  const { report } = await routes();
  as(user("admin"), true);
  const res = await report.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ moveTo: "new" }) }) as any, { params: { id: feedback.reports[0].id } });
  assert.equal(res.status, 200);
  assert.equal(feedback.issues.length, 1, "the emptied issue was left behind");
  const view = await adminView();
  assert.ok(view.open.every((i: any) => i.reporters > 0));
});

test("14 · rejected submissions don't use up the daily allowance", async () => {
  const u = user("invalid-first");
  for (let i = 0; i < 10; i++) assert.equal((await post(u, "short")).status, 422);
  assert.equal((await post(u, "Now a real report about the meal plan")).status, 201);
});

test("15 · the admin view carries the Sentry org so event ids become links", async () => {
  process.env.SENTRY_ORG = "wondish";
  const view = await adminView();
  delete process.env.SENTRY_ORG;
  assert.equal(view.sentryOrg, "wondish");
});
