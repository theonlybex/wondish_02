import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateQuickLog,
  parseQuickLogBody,
  parseQuickLogEstimate,
  quickLogSystemPrompt,
  quickLogTotals,
  quickLogUpsertArgs,
  type QuickLogModel,
} from "./quick-log";

const food = (name: string, grams: number, own = { calories: 0, protein: 0, carbs: 0, fat: 0 }) => ({ name, grams, asServed: true, ...own });

test("the body needs a meal, a date and a request id; the note is trimmed and capped", () => {
  const ok = parseQuickLogBody({ meal: "lunch", today: "2026-11-20", requestId: "abcd1234-ef", note: "  chicken wrap  " });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.value.note, "chicken wrap");
  assert.equal(parseQuickLogBody({ meal: "brunch", today: "2026-11-20", requestId: "abcd1234" }).ok, false);
  assert.equal(parseQuickLogBody({ meal: "lunch", today: "20 Nov", requestId: "abcd1234" }).ok, false);
  assert.equal(parseQuickLogBody({ meal: "lunch", today: "2026-11-20", requestId: "x" }).ok, false);
  assert.equal(parseQuickLogBody({ meal: "lunch", today: "2026-11-20", requestId: "abcd1234", note: "n".repeat(501) }).ok, false);
});

test("the prompt tells the model it cannot ask and must split the meal into foods with grams", () => {
  const p = quickLogSystemPrompt("dinner");
  assert.match(p, /reminder about their dinner/);
  assert.match(p, /You cannot ask them anything/);
  assert.match(p, /Oil, butter, dressing and sauce are their own rows/);
  assert.match(p, /isMeal: false/);
});

test("the model's answer is read strictly: bad rows are dropped, the name is capped", () => {
  const e = parseQuickLogEstimate({
    isMeal: true,
    name: "x".repeat(100),
    foods: [food("white rice", 180), { name: "", grams: 10 }, { name: "air", grams: -1 }, food("giant", 99999)],
  });
  assert.equal(e?.name.length, 60);
  assert.deepEqual(e?.foods.map((f) => f.name), ["white rice"]);
  assert.equal(parseQuickLogEstimate({ isMeal: "yes", name: "a", foods: [] }), null);
  assert.equal(parseQuickLogEstimate(null), null);
});

test("numbers come from the food table; a food it does not know keeps the model's own figure", () => {
  const totals = quickLogTotals([
    food("white rice", 180, { calories: 9999, protein: 0, carbs: 0, fat: 0 }),
    food("zzyzx fruit paste", 50, { calories: 120, protein: 1, carbs: 28, fat: 0.5 }),
  ]);
  assert.deepEqual(totals.modelEstimated, ["zzyzx fruit paste"]);
  assert.ok(totals.calories > 250 && totals.calories < 450, `rice from the table plus 120, got ${totals.calories}`);
  assert.ok(totals.carbs > 28);
});

test("the row is CLARA, an estimate, one serving, tied to the photo, and keyed by the request id", () => {
  const body = { meal: "lunch" as const, today: "2026-11-20", requestId: "abcd1234-ef", note: "chicken wrap" };
  const estimate = { isMeal: true, name: "Chicken wrap", foods: [food("chicken breast", 120)] };
  const out = quickLogUpsertArgs("p1", body, estimate, { calories: 520, protein: 30, carbs: 50, fat: 18, modelEstimated: [] }, "photo-1234abcd");
  assert.ok(out.ok);
  const create = (out.ok ? out.args.create : {}) as Record<string, unknown>;
  assert.equal(create.patientId, "p1");
  assert.equal(create.source, "CLARA");
  assert.equal(create.estimated, true);
  assert.equal(create.servings, 1);
  assert.equal(create.calories, 520);
  assert.equal(create.name, "Chicken wrap");
  assert.equal(create.mealType, "lunch");
  assert.equal(create.localDate, "2026-11-20");
  assert.equal(create.pictureResultId, "photo-1234abcd");
  assert.equal(create.clientRequestId, "quick:abcd1234-ef");
  assert.equal(create.note, "chicken wrap");
});

test("one model call with the photo first, structured output, and no thinking", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (req: Record<string, unknown>) => {
        calls.push(req);
        return { content: [{ type: "text", text: JSON.stringify({ isMeal: true, name: "Soup", foods: [food("lentils", 200)] }) }] };
      },
    },
  } as unknown as QuickLogModel;
  const e = await estimateQuickLog(client, { meal: "lunch", photo: { id: "photo-1234abcd", mediaType: "image/jpeg", data: "AAAA" } });
  assert.equal(e?.name, "Soup");
  assert.equal(calls.length, 1);
  const content = (calls[0].messages as { content: { type: string; text?: string }[] }[])[0].content;
  assert.equal(content[0].type, "image");
  assert.equal(content[1].text, "This photo is my lunch.");
  assert.deepEqual(calls[0].thinking, { type: "disabled" });
  assert.ok((calls[0].output_config as { format: { type: string } }).format.type === "json_schema");

  await estimateQuickLog(client, { meal: "dinner", note: "pasta with pesto" });
  const words = (calls[1].messages as { content: { text?: string }[] }[])[0].content;
  assert.equal(words[0].text, "What I had for dinner: pasta with pesto");
});

test("an answer that is not JSON gives no estimate", async () => {
  const client = { messages: { create: async () => ({ content: [{ type: "text", text: "sorry" }] }) } } as unknown as QuickLogModel;
  assert.equal(await estimateQuickLog(client, { meal: "lunch", note: "x y" }), null);
});

const route = readFileSync("app/api/clara/quick-log/route.ts", "utf8");

test("the route: sign-in only, rate limited, spend guarded, no meal for a non-meal, and a retry returns the same row", () => {
  assert.match(route, /resolveClaraCaller\(\)/);
  assert.match(route, /rateLimit\("clara-quick-log", caller\.userId, 10, 60\)/);
  assert.match(route, /guardClaraAppSpend\(caller\.userId\)/);
  assert.match(route, /code: "NOT_A_MEAL"/);
  const existing = route.indexOf("clientRequestId: `quick:${body.value.requestId}`");
  const model = route.indexOf("estimateQuickLog(anthropic");
  assert.ok(existing > 0 && model > existing, "the retry check comes before the model call");
});
