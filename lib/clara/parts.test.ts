import { test } from "node:test";
import assert from "node:assert/strict";
import { partAsText, type ClaraPart } from "./parts";
import { startClaraLoop } from "./loop";
import { parseClaraChatBody, startClaraAppTurn, type ChatServiceDeps } from "./chat-service";
import { makeConversationStore, type ConversationDeps, type HistoryRow } from "./conversations";
import type { ClaraEvent } from "./ndjson";
import type { MemoryDeps } from "./skills/memory";
import type { ModelClient, ModelContentBlock, ModelRoundEvent, Skill, ToolDef, ToolResult } from "./types";

const DISH: ClaraPart = {
  kind: "dish",
  dishId: "d1",
  name: "Lentil curry",
  minutes: 25,
  calories: 480,
  reasons: [
    { level: "fibre", direction: "up", text: "Lentils are high in fibre." },
    { level: "sodium", direction: "down", text: "No stock cube needed." },
  ],
};
const LEVELS: ClaraPart = {
  kind: "levels",
  little: [{ key: "fibre", name: "fibre" }],
  aLot: [{ key: "sodium", name: "sodium" }],
};
const STEPS: ClaraPart = {
  kind: "steps",
  dishId: "d1",
  steps: [
    { n: 1, text: "Chop the onion.", timerMinutes: null },
    { n: 2, text: "Simmer the lentils.", timerMinutes: 15 },
  ],
};

// ─── partAsText ─────────────────────────────────────────────────────────────

test("partAsText: a dish names the dish, the minutes and every reason", () => {
  const t = partAsText(DISH);
  assert.ok(t.includes("Lentil curry"));
  assert.ok(t.includes("25 min"));
  assert.ok(t.includes("Lentils are high in fibre."));
  assert.ok(t.includes("No stock cube needed."));
  assert.ok(t.length > 0);
});

test("partAsText: levels read 'little: fibre; a lot: sodium'", () => {
  assert.equal(partAsText(LEVELS), "little: fibre; a lot: sodium");
});

test("partAsText: steps are a numbered list", () => {
  const lines = partAsText(STEPS).split("\n");
  assert.equal(lines[0], "1. Chop the onion.");
  assert.ok(lines[1].startsWith("2. Simmer the lentils."));
  assert.ok(lines[1].includes("15 min"));
});

// ─── loop ───────────────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [{ name: "dish_show", description: "d", input_schema: { type: "object", properties: {} } }];
const call = (id: string): ModelContentBlock => ({ type: "tool_use", id, name: "dish_show", input: {} });

function stub(rounds: { deltas?: string[]; content?: ModelContentBlock[] }[]): ModelClient {
  let i = 0;
  return {
    async openRound() {
      const r = rounds[i++] ?? {};
      const deltas = r.deltas ?? [];
      const content = r.content ?? (deltas.length ? [{ type: "text" as const, text: deltas.join("") }] : []);
      return (async function* () {
        for (const d of deltas) yield { type: "text", text: d } as ModelRoundEvent;
        yield { type: "end", content, stopReason: null } as ModelRoundEvent;
      })();
    },
  };
}
async function drain(g: AsyncGenerator<string>) {
  let s = "";
  for await (const c of g) s += c;
  return s;
}
const withPart = async (): Promise<ToolResult> => ({ ok: true, data: { shown: true }, parts: [DISH] });

test("loop: parts not requested → no onPart events' text goes missing; the fallback is in the text", async () => {
  const client = stub([{ content: [call("t1")] }, { deltas: ["Here is a dish."] }]);
  const seenParts: ClaraPart[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: withPart, onPart: (p) => seenParts.push(p), partsEnabled: false,
    })
  );
  assert.ok(out.startsWith("Here is a dish."));
  assert.ok(out.includes("Lentil curry") && out.includes("No stock cube needed."));
  assert.deepEqual(seenParts, [DISH], "parts are still handed over for storage");
});

test("loop: parts omitted behaves like false", async () => {
  const client = stub([{ content: [call("t1")] }, { deltas: ["Done."] }]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2, execute: withPart })
  );
  assert.ok(out.includes("Lentil curry"));
});

test("loop: parts requested → text has no fallback and onPart receives the part", async () => {
  const client = stub([{ content: [call("t1")] }, { deltas: ["Here is a dish."] }]);
  const seenParts: ClaraPart[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: withPart, onPart: (p) => seenParts.push(p), partsEnabled: true,
    })
  );
  assert.equal(out, "Here is a dish.");
  assert.deepEqual(seenParts, [DISH]);
});

test("loop: a part-only reply with parts requested is not replaced by the 'couldn't answer' fallback", async () => {
  const client = stub([{ content: [call("t1")] }, {}]);
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: withPart, onPart: () => {}, partsEnabled: true,
    })
  );
  assert.equal(out, "");
});

// ─── body parser ────────────────────────────────────────────────────────────

test("parseClaraChatBody: parts omitted → not true; boolean accepted; anything else → 400", () => {
  const omitted = parseClaraChatBody({ message: "hi" });
  assert.ok(omitted.ok && !omitted.parts);
  const on = parseClaraChatBody({ message: "hi", parts: true });
  assert.ok(on.ok && on.parts === true);
  const off = parseClaraChatBody({ message: "hi", parts: false });
  assert.ok(off.ok && off.parts === false);
  for (const bad of ["yes", 1, null, {}]) {
    assert.equal(parseClaraChatBody({ message: "hi", parts: bad }).ok, false, JSON.stringify(bad));
  }
});

// ─── service: wire + storage ────────────────────────────────────────────────

function serviceSetup(rounds: { deltas?: string[]; content?: ModelContentBlock[] }[]) {
  const saved: HistoryRow[] = [];
  const deps: ConversationDeps = {
    createConversation: async () => ({ id: "c1" }),
    isOwned: async () => true,
    recentMessages: async () => [],
    insertMessage: async ({ role, content, choices, toolTrace }) => {
      saved.push({ id: `m${saved.length}`, role, content, choices, toolTrace: toolTrace ?? null, createdAt: new Date() });
      return { id: `m${saved.length}` };
    },
    listPage: async () => [],
    getOwned: async () => null,
    deleteOwned: async () => false,
  };
  const memory: MemoryDeps = {
    list: async () => [],
    create: async (_p, text) => ({ id: "n", text, createdAt: new Date() }),
    remove: async () => false,
    clear: async () => 0,
  };
  const dishSkill: Skill = { name: "dish", promptFragment: "", tools: [{ def: TOOLS[0], handler: withPart }] };
  const svc: ChatServiceDeps = {
    store: makeConversationStore(deps),
    memory,
    client: stub(rounds),
    skills: [dishSkill],
    todaysPlan: async () => "",
  };
  return { svc, saved };
}
const patient = {
  id: "p1", mealType: null, foodAllergies: [], foodToAvoid: [], foodPreferences: [], healthConditions: [], motivations: [],
};
async function run(svc: ChatServiceDeps, parts: boolean) {
  const res = await startClaraAppTurn(svc, {
    patient, account: { id: "a1", firstName: "Sam" }, isPremium: false, message: "dish?",
    options: { clientDate: "2026-10-28", tzOffsetMinutes: 0, surface: "web" }, parts,
  });
  assert.ok(res.ok);
  const events: ClaraEvent[] = [];
  for await (const e of res.events) events.push(e);
  return events;
}
const rounds = () => [{ content: [call("t1")] }, { deltas: ["Here is a dish."] }];

test("service: parts:true → a part event before done, text without fallback, parts stored", async () => {
  const { svc, saved } = serviceSetup(rounds());
  const events = await run(svc, true);
  const types = events.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t !== "text"), ["meta", "part", "done"]);
  assert.ok(types.indexOf("part") < types.indexOf("done"));
  assert.equal(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(""), "Here is a dish.");
  const trace = saved.at(-1)!.toolTrace as { parts?: ClaraPart[] }[];
  assert.deepEqual(trace[0].parts, [DISH]);
});

test("service: no parts flag → no part event, the dish and reasons are in the plain text", async () => {
  const { svc, saved } = serviceSetup(rounds());
  const events = await run(svc, false);
  assert.ok(!events.some((e) => e.type === "part"));
  const text = events.map((e) => (e.type === "text" ? e.text : "")).join("");
  assert.ok(text.includes("Lentil curry") && text.includes("Lentils are high in fibre."));
  assert.equal(saved.at(-1)!.content, text);
});

test("service: a part-only reply is never saved blank", async () => {
  const { svc, saved } = serviceSetup([{ content: [call("t1")] }, {}]);
  await run(svc, true);
  assert.ok(saved.at(-1)!.content.includes("Lentil curry"));
  const { svc: svc2, saved: saved2 } = serviceSetup([{ content: [call("t1")] }, {}]);
  const events = await run(svc2, false);
  assert.ok(events.map((e) => (e.type === "text" ? e.text : "")).join("").includes("Lentil curry"));
  assert.ok(saved2.at(-1)!.content.includes("Lentil curry"));
});

test("partAsText: fromHome never reaches the text an old client reads", () => {
  const withHome: ClaraPart = { ...(DISH as Extract<ClaraPart, { kind: "dish" }>), fromHome: { text: "From your kitchen: Salmon fillets.", foods: ["Salmon fillets"] } };
  assert.equal(partAsText(withHome), partAsText(DISH));
});
