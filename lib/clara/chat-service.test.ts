import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  startClaraAppTurn,
  parseClaraChatBody,
  claraAppSkills,
  TOOL_TRACE_MAX_CALLS,
  TOOL_TRACE_MAX_CHARS,
  type ChatServiceDeps,
  type ClaraAppPatient,
} from "./chat-service";
import { makeConversationStore, type ConversationDeps, type HistoryRow, type StoredMessage, type ToolTraceEntry } from "./conversations";
import { makeMemorySkill, type MemoryDeps, type MemoryRow } from "./skills/memory";
import { askChoicesSkill, ASK_CHOICES_TOOL } from "./ask-choices";
import { MID_STREAM_FALLBACK } from "./loop";
import type { ClaraEvent } from "./ndjson";
import type {
  ClaraChoices,
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
  Skill,
  ToolResult,
} from "./types";

// ─── Fakes (no DB, no network) ──────────────────────────────────────────────

interface ScriptedRound {
  deltas?: string[];
  content?: ModelContentBlock[];
  stopReason?: string | null;
  /** Throw from the stream after the deltas (a mid-stream failure). */
  throwAfterDeltas?: Error;
  /** Throw from openRound itself (a connect failure). */
  connectError?: Error;
}

/** The scripted stub from loop.test.ts, plus a shared call log. */
function stubClient(rounds: ScriptedRound[], log: string[] = []) {
  const seen: ModelRoundRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async openRound(req) {
      log.push("openRound");
      seen.push(structuredClone(req));
      const round = rounds[i++] ?? {};
      if (round.connectError) throw round.connectError;
      const deltas = round.deltas ?? [];
      const content =
        round.content ??
        (deltas.length > 0 ? [{ type: "text" as const, text: deltas.join("") }] : []);
      return (async function* () {
        for (const d of deltas) yield { type: "text", text: d } as ModelRoundEvent;
        if (round.throwAfterDeltas) throw round.throwAfterDeltas;
        yield { type: "end", content, stopReason: round.stopReason ?? null } as ModelRoundEvent;
      })();
    },
  };
  return { client, seen };
}

interface Row {
  id: string;
  patientId: string;
  title: string;
  messages: HistoryRow[];
}

function fakeConversations(rows: Row[], log: string[]) {
  let seq = 100;
  const deps: ConversationDeps = {
    createConversation: async ({ patientId, title, firstMessage }) => {
      log.push(`create:${firstMessage}`);
      const id = `c${++seq}`;
      rows.push({
        id,
        patientId,
        title,
        messages: [{ id: `m${++seq}`, role: "user", content: firstMessage, choices: null, createdAt: new Date() }],
      });
      return { id };
    },
    isOwned: async (id, patientId) => {
      log.push(`owned:${id}`);
      return rows.some((r) => r.id === id && r.patientId === patientId);
    },
    recentMessages: async (id, limit) => {
      log.push(`history:${id}`);
      const r = rows.find((x) => x.id === id);
      return r ? [...r.messages].reverse().slice(0, limit) : [];
    },
    insertMessage: async ({ conversationId, role, content, choices, toolTrace }) => {
      log.push(`insert:${role}`);
      const r = rows.find((x) => x.id === conversationId)!;
      const id = `m${++seq}`;
      r.messages.push({ id, role, content, choices, toolTrace: toolTrace ?? null, createdAt: new Date() });
      return { id };
    },
    listPage: async () => [],
    getOwned: async () => null,
    deleteOwned: async () => false,
  };
  return makeConversationStore(deps);
}

function fakeMemory(rows: MemoryRow[], log: string[]): MemoryDeps {
  return {
    list: async () => {
      log.push("memory:list");
      return rows;
    },
    create: async (_p, text) => ({ id: "new", text, createdAt: new Date() }),
    remove: async () => false,
    clear: async () => 0,
  };
}

const patient: ClaraAppPatient = {
  id: "p1",
  mealType: null,
  foodAllergies: [],
  foodToAvoid: [],
  foodPreferences: [],
  healthConditions: [],
  motivations: [],
};
const account = { id: "a1", firstName: "Sam" };
const options = { clientDate: "2026-10-28", tzOffsetMinutes: 0, surface: "web" as const };

/** A write tool that records whether it actually ran. */
function writeSkill() {
  const ran: Record<string, unknown>[] = [];
  const skill: Skill = {
    name: "plan",
    promptFragment: "PLAN-FRAGMENT",
    tools: [
      {
        def: {
          name: "plan_swap",
          description: "swap",
          isWrite: true,
          input_schema: { type: "object", properties: {} },
        },
        handler: async (_ctx, input): Promise<ToolResult> => {
          ran.push(input);
          return { ok: true, data: { swapped: true } };
        },
      },
    ],
  };
  return { skill, ran };
}

const msg = (i: number, role: "user" | "assistant", content: string, choices: ClaraChoices | null = null): StoredMessage => ({
  id: `m${i}`,
  role,
  content,
  choices,
  createdAt: new Date(2026, 9, 1, 0, i),
});

function setup(opts: {
  rounds: ScriptedRound[];
  rows?: Row[];
  memories?: MemoryRow[];
  extraSkills?: Skill[];
}) {
  const log: string[] = [];
  const rows = opts.rows ?? [];
  const memDeps = fakeMemory(opts.memories ?? [], log);
  const { client, seen } = stubClient(opts.rounds, log);
  const deps: ChatServiceDeps = {
    store: fakeConversations(rows, log),
    memory: memDeps,
    client,
    skills: [...(opts.extraSkills ?? []), makeMemorySkill(memDeps), askChoicesSkill],
    todaysPlan: async () => "\n\nTODAY'S MEAL PLAN — FAKE",
  };
  return { deps, log, rows, seen };
}

async function collect(events: AsyncGenerator<ClaraEvent>): Promise<ClaraEvent[]> {
  const out: ClaraEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const textOf = (events: ClaraEvent[]) =>
  events.map((e) => (e.type === "text" ? e.text : "")).join("");

const turn = (deps: ChatServiceDeps, message: string, conversationId?: string) =>
  startClaraAppTurn(deps, { patient, account, isPremium: false, conversationId, message, options });

/** The tool_result the model was handed in the round after a tool call. */
function toolResultIn(req: ModelRoundRequest): ToolResult {
  const last = req.messages.at(-1)!;
  const block = (last.content as ModelContentBlock[]).find((b) => b.type === "tool_result");
  assert.ok(block && block.type === "tool_result");
  return JSON.parse(block.content) as ToolResult;
}

// ─── Before any spend ───────────────────────────────────────────────────────

test("no patient → 409 PROFILE_INCOMPLETE and the model is never called", async () => {
  const { deps, log } = setup({ rounds: [{ deltas: ["hi"] }] });
  const res = await startClaraAppTurn(deps, {
    patient: null,
    account,
    isPremium: false,
    message: "hello",
    options,
  });
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.equal(res.status, 409);
  assert.equal((res.body as { code?: string }).code, "PROFILE_INCOMPLETE");
  assert.deepEqual(log, []);
});

// Review Focus 2.
test("someone else's conversation id → 404, nothing loaded, nothing written", async () => {
  const rows: Row[] = [{ id: "theirs", patientId: "p2", title: "t", messages: [msg(1, "user", "secret")] }];
  const { deps, log } = setup({ rows, rounds: [{ deltas: ["hi"] }] });
  const res = await turn(deps, "hello", "theirs");
  assert.ok(!res.ok);
  assert.equal(res.status, 404);
  assert.deepEqual(log, ["owned:theirs"]);
  assert.equal(rows[0].messages.length, 1);
});

test("an unknown conversation id → 404, nothing written", async () => {
  const { deps, log, rows } = setup({ rounds: [{ deltas: ["hi"] }] });
  const res = await turn(deps, "hello", "nope");
  assert.ok(!res.ok);
  assert.equal(res.status, 404);
  assert.deepEqual(log, ["owned:nope"]);
  assert.equal(rows.length, 0);
});

// ─── Ordering and the event stream ──────────────────────────────────────────

test("an existing conversation: history loads before the user message is appended, and both before openRound", async () => {
  const rows: Row[] = [
    { id: "mine", patientId: "p1", title: "t", messages: [msg(1, "user", "hi"), msg(2, "assistant", "hello")] },
  ];
  const { deps, log, seen } = setup({ rows, rounds: [{ deltas: ["Sure."] }] });
  const res = await turn(deps, "  what's for dinner?  ", "mine");
  assert.ok(res.ok);
  const order = log.filter((l) => l !== "memory:list");
  assert.deepEqual(order.slice(0, 4), ["owned:mine", "history:mine", "insert:user", "openRound"]);
  // The model sees the saved history plus the new (trimmed) message.
  assert.deepEqual(
    seen[0].messages.map((m) => [m.role, m.content]),
    [["user", "hi"], ["assistant", "hello"], ["user", "what's for dinner?"]]
  );
  assert.equal(rows[0].messages[2].content, "what's for dinner?");
});

test("a new conversation is created (with the user message) before openRound", async () => {
  const { deps, log, rows } = setup({ rounds: [{ deltas: ["Hi Sam."] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  assert.ok(log.indexOf("create:hello") < log.indexOf("openRound"));
  assert.equal(rows.length, 1);
  assert.equal(res.conversationId, rows[0].id);
});

test("events: meta first, text deltas, done last with the saved assistant row's id", async () => {
  const { deps, rows } = setup({ rounds: [{ deltas: ["Hello ", "Sam."] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  const events = await collect(res.events);
  assert.deepEqual(events[0], { type: "meta", conversationId: res.conversationId });
  assert.equal(textOf(events), "Hello Sam.");
  const last = events.at(-1)!;
  assert.equal(last.type, "done");
  const saved = rows[0].messages.at(-1)!;
  assert.equal(saved.role, "assistant");
  assert.equal(saved.content, "Hello Sam.");
  assert.equal(saved.choices, null);
  assert.deepEqual(last, { type: "done", messageId: saved.id });
});

test("the assistant row is saved only after the loop is fully drained", async () => {
  const { deps, rows } = setup({ rounds: [{ deltas: ["one ", "two"] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  const it = res.events[Symbol.asyncIterator]();
  await it.next(); // meta
  await it.next(); // "one "
  assert.equal(rows[0].messages.length, 1, "no assistant row mid-stream");
  for (let r = await it.next(); !r.done; r = await it.next()) {
    /* drain */
  }
  assert.equal(rows[0].messages.length, 2);
});

// ─── The confirm rule (spec §3a, Review Focus 3) ────────────────────────────

const swapRounds = (): ScriptedRound[] => [
  { deltas: ["Swapping it now."], content: [{ type: "text", text: "Swapping it now." }, { type: "tool_use", id: "t1", name: "plan_swap", input: { day: "today" } }] },
  { deltas: ["Done."] },
];

test("a plain 'yes' after a prose-only proposal → the write is refused with CONFIRM_REQUIRED", async () => {
  const { skill, ran } = writeSkill();
  const rows: Row[] = [
    {
      id: "mine",
      patientId: "p1",
      title: "t",
      messages: [msg(1, "user", "swap tonight's dinner"), msg(2, "assistant", "I could swap it for salmon. Want me to?")],
    },
  ];
  const { deps, seen } = setup({ rows, rounds: swapRounds(), extraSkills: [skill] });
  const res = await turn(deps, "yes", "mine");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 0, "the write must not run");
  const result = toolResultIn(seen[1]);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "CONFIRM_REQUIRED");
});

test("the turn directly after a saved ask_choices message may write", async () => {
  const { skill, ran } = writeSkill();
  const rows: Row[] = [
    {
      id: "mine",
      patientId: "p1",
      title: "t",
      messages: [
        msg(1, "user", "swap tonight's dinner"),
        msg(2, "assistant", "I could swap it for salmon. Swap it?", { question: "Swap it?", options: ["Yes, swap it", "No, keep it"] }),
      ],
    },
  ];
  const { deps, seen } = setup({ rows, rounds: swapRounds(), extraSkills: [skill] });
  const res = await turn(deps, "Yes, swap it", "mine");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 1);
  assert.equal(toolResultIn(seen[1]).ok, true);
});

// A dropped stream after the member tapped "Yes" leaves an unanswered user row
// after the boxes. Their retry is NOT "directly after" the boxes any more.
test("a trailing unanswered user row after the boxes → writes refused", async () => {
  const { skill, ran } = writeSkill();
  const rows: Row[] = [
    {
      id: "mine",
      patientId: "p1",
      title: "t",
      messages: [
        msg(1, "user", "swap tonight's dinner"),
        msg(2, "assistant", "Swap it?", { question: "Swap it?", options: ["Yes, swap it", "No, keep it"] }),
        msg(3, "user", "Yes, swap it"),
      ],
    },
  ];
  const { deps, seen } = setup({ rows, rounds: swapRounds(), extraSkills: [skill] });
  const res = await turn(deps, "Yes, swap it", "mine");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 0);
  const result = toolResultIn(seen[1]);
  assert.equal(!result.ok && result.reason, "CONFIRM_REQUIRED");
});

test("a brand-new conversation → writes refused", async () => {
  const { skill, ran } = writeSkill();
  const { deps, seen } = setup({ rounds: swapRounds(), extraSkills: [skill] });
  const res = await turn(deps, "swap tonight's dinner for salmon, yes I'm sure");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 0);
  const result = toolResultIn(seen[1]);
  assert.equal(!result.ok && result.reason, "CONFIRM_REQUIRED");
});

// ─── Answer boxes ───────────────────────────────────────────────────────────

test("an ask_choices round → a choices event and appendAssistant(..., choices)", async () => {
  const choices = { question: "Swap it?", options: ["Yes, swap it", "No, keep it"] };
  const { deps, rows, seen } = setup({
    rounds: [
      {
        deltas: ["I can swap it for salmon."],
        content: [
          { type: "text", text: "I can swap it for salmon." },
          { type: "tool_use", id: "t1", name: ASK_CHOICES_TOOL, input: choices },
        ],
      },
    ],
  });
  const res = await turn(deps, "swap tonight's dinner");
  assert.ok(res.ok);
  const events = await collect(res.events);
  assert.equal(seen.length, 1, "ask_choices is terminal");
  const types = events.map((e) => e.type);
  assert.equal(types[0], "meta");
  assert.equal(types.at(-1), "done");
  assert.equal(types.at(-2), "choices");
  assert.deepEqual(events.at(-2), { type: "choices", ...choices });
  assert.equal(textOf(events), "I can swap it for salmon.\n\nSwap it?");
  const saved = rows[0].messages.at(-1)!;
  assert.equal(saved.role, "assistant");
  assert.equal(saved.content, "I can swap it for salmon.\n\nSwap it?");
  assert.deepEqual(saved.choices, choices);
});

// ─── Failures (Review Focus 4) ──────────────────────────────────────────────

test("mid-stream failure after partial text → saves the text plus the loop's fallback", async () => {
  const { deps, rows } = setup({ rounds: [{ deltas: ["Your dinner is "], throwAfterDeltas: new Error("socket hang up") }] });
  const res = await turn(deps, "what's for dinner?");
  assert.ok(res.ok);
  const events = await collect(res.events);
  assert.equal(textOf(events), "Your dinner is " + MID_STREAM_FALLBACK);
  assert.equal(events.at(-1)!.type, "done");
  const saved = rows[0].messages.at(-1)!;
  assert.equal(saved.role, "assistant");
  assert.equal(saved.content, "Your dinner is " + MID_STREAM_FALLBACK);
  assert.equal(rows[0].messages[0].content, "what's for dinner?", "the user message is kept");
});

test("round-1 connect failure → 500, user message kept, no assistant row", async () => {
  const rows: Row[] = [
    { id: "mine", patientId: "p1", title: "t", messages: [msg(1, "user", "hi"), msg(2, "assistant", "hello")] },
  ];
  const { deps } = setup({ rows, rounds: [{ connectError: new Error("boom") }] });
  const res = await turn(deps, "what's for dinner?", "mine");
  assert.ok(!res.ok);
  assert.equal(res.status, 500);
  assert.deepEqual(
    rows[0].messages.map((m) => m.role),
    ["user", "assistant", "user"]
  );
});

test("round-1 busy failure (connection error) → 503 and no assistant row", async () => {
  const { deps, rows } = setup({ rounds: [{ connectError: new Anthropic.APIConnectionError({ message: "down" }) }] });
  const res = await turn(deps, "hello");
  assert.ok(!res.ok);
  assert.equal(res.status, 503);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].messages.map((m) => m.role), ["user"]);
  // The client can retry into the same conversation instead of starting a new one.
  assert.equal((res.body as { conversationId?: string }).conversationId, rows[0].id);
});

// ─── Prompt ─────────────────────────────────────────────────────────────────

test("the system prompt carries the assistant persona, today's plan, then the memory block before the fragments", async () => {
  const memories: MemoryRow[] = [{ id: "mem1", text: "Cooks for three on weeknights", createdAt: new Date(2026, 9, 1) }];
  const { deps, seen } = setup({ rounds: [{ deltas: ["Hi."] }], memories });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  await collect(res.events);
  const system = seen[0].system;
  assert.ok(
    system.includes(
      "you can read and change their meal logs and meal plan with your tools, always proposing a change with answer boxes first"
    )
  );
  assert.ok(!system.includes("you do NOT log meals or change their meal plan yourself"));
  assert.ok(system.includes("use the plan tools for any other day"));
  const plan = system.indexOf("TODAY'S MEAL PLAN — FAKE");
  const block = system.indexOf("What you remember about Sam\n[mem1] Cooks for three on weeknights");
  const fragment = system.indexOf("About your memory_ tools");
  assert.ok(plan > 0 && block > plan && fragment > block, `plan=${plan} block=${block} fragment=${fragment}`);
  // The date the client sent is asserted.
  assert.ok(system.includes("Today's date for Sam is 2026-10-28"));
});

test("tools: memory and ask_choices are offered", async () => {
  const { deps, seen } = setup({ rounds: [{ deltas: ["Hi."] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  await collect(res.events);
  const names = seen[0].tools.map((t) => t.name);
  assert.ok(names.includes("memory_save"));
  assert.ok(names.includes(ASK_CHOICES_TOOL));
});

test("five tool rounds for everyone: the sixth round is forced tool-less", async () => {
  const call = (i: number): ScriptedRound => ({
    deltas: [`Checking ${i}. `],
    content: [{ type: "text", text: `Checking ${i}. ` }, { type: "tool_use", id: `t${i}`, name: "memory_save", input: { text: `note ${i}` } }],
  });
  const { deps, seen } = setup({ rounds: [call(1), call(2), call(3), call(4), call(5), { deltas: ["Done."] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(seen.length, 6);
  assert.ok(seen[4].tools.length > 0);
  assert.equal(seen[5].tools.length, 0);
});

// ─── Body validation and the skill set ──────────────────────────────────────

test("parseClaraChatBody: message is trimmed, 1–4,000 chars; conversationId optional non-empty string", () => {
  assert.deepEqual(parseClaraChatBody({ message: "  hi  " }), { ok: true, message: "hi", conversationId: undefined });
  assert.deepEqual(parseClaraChatBody({ message: "hi", conversationId: "c1" }), { ok: true, message: "hi", conversationId: "c1" });
  assert.equal(parseClaraChatBody({ message: "x".repeat(4000) }).ok, true);
  for (const bad of [
    null,
    "hi",
    {},
    { message: "" },
    { message: "   \n " },
    { message: 42 },
    { message: "x".repeat(4001) },
    { message: "hi", conversationId: "" },
    { message: "hi", conversationId: 7 },
  ]) {
    assert.equal(parseClaraChatBody(bad).ok, false, JSON.stringify(bad)?.slice(0, 40));
  }
});

test("claraAppSkills: CLARA_SKILLS filters product skills; gap_report, memory and ask_choices are always on", () => {
  const names = (env: string | undefined) => claraAppSkills(env).flatMap((s) => s.tools.map((t) => t.def.name));
  for (const env of [undefined, "", "profile", "ghost"]) {
    const n = names(env);
    for (const always of ["gap_report", "memory_save", "memory_forget", ASK_CHOICES_TOOL]) {
      assert.ok(n.includes(always), `${always} with env=${String(env)}`);
    }
  }
  const full = claraAppSkills(undefined).map((s) => s.name);
  assert.ok(full.includes("logs") && full.includes("plan"));
  assert.deepEqual(claraAppSkills("").map((s) => s.name), ["gap", "memory", "choices"]);
});

// ─── Fix round 1: no model text ⇒ no assistant row; retry de-duplication ───

test("a stream that fails before any model text → fallback streamed, no assistant row, messageId null", async () => {
  const { deps, rows } = setup({ rounds: [{ deltas: [], throwAfterDeltas: new Error("overloaded_error") }] });
  const res = await turn(deps, "what's for dinner?");
  assert.ok(res.ok);
  const events = await collect(res.events);
  assert.equal(textOf(events), MID_STREAM_FALLBACK);
  assert.deepEqual(events.at(-1), { type: "done", messageId: null });
  assert.deepEqual(rows[0].messages.map((m) => m.role), ["user"]);
});

test("a tool-only round 1 then a round-2 connect failure → no assistant row, messageId null", async () => {
  const { deps, rows } = setup({
    rounds: [
      { content: [{ type: "tool_use", id: "t1", name: "memory_save", input: { text: "Cooks for three" } }] },
      { connectError: new Error("boom") },
    ],
  });
  const res = await turn(deps, "remember I cook for three");
  assert.ok(res.ok);
  const events = await collect(res.events);
  assert.equal(textOf(events), MID_STREAM_FALLBACK);
  assert.deepEqual(events.at(-1), { type: "done", messageId: null });
  assert.deepEqual(rows[0].messages.map((m) => m.role), ["user"]);
});

test("retry after a round-1 failure: re-sending the same text reuses the saved user row", async () => {
  const rows: Row[] = [
    { id: "mine", patientId: "p1", title: "t", messages: [msg(1, "user", "hi"), msg(2, "assistant", "hello")] },
  ];
  const { deps, seen } = setup({ rows, rounds: [{ connectError: new Error("boom") }, { deltas: ["Salmon."] }] });
  const failed = await turn(deps, "what's for dinner?", "mine");
  assert.ok(!failed.ok);
  const retry = await turn(deps, "  what's for dinner?  ", "mine");
  assert.ok(retry.ok);
  await collect(retry.events);
  assert.deepEqual(
    rows[0].messages.map((m) => [m.role, m.content]),
    [["user", "hi"], ["assistant", "hello"], ["user", "what's for dinner?"], ["assistant", "Salmon."]]
  );
  // The model sees the message once, not twice.
  assert.deepEqual(
    seen[1].messages.map((m) => [m.role, m.content]),
    [["user", "hi"], ["assistant", "hello"], ["user", "what's for dinner?"]]
  );
});

test("after a round-1 failure, a different text appends normally", async () => {
  const rows: Row[] = [
    { id: "mine", patientId: "p1", title: "t", messages: [msg(1, "user", "hi"), msg(2, "assistant", "hello")] },
  ];
  const { deps } = setup({ rows, rounds: [{ connectError: new Error("boom") }, { deltas: ["Sure."] }] });
  assert.ok(!(await turn(deps, "what's for dinner?", "mine")).ok);
  const next = await turn(deps, "what about lunch?", "mine");
  assert.ok(next.ok);
  await collect(next.events);
  assert.deepEqual(
    rows[0].messages.map((m) => m.role + ":" + m.content),
    ["user:hi", "assistant:hello", "user:what's for dinner?", "user:what about lunch?", "assistant:Sure."]
  );
});

test("a reused trailing user row after boxes still refuses writes (ruling 1)", async () => {
  const { skill, ran } = writeSkill();
  const rows: Row[] = [
    {
      id: "mine",
      patientId: "p1",
      title: "t",
      messages: [
        msg(1, "user", "swap tonight's dinner"),
        msg(2, "assistant", "Swap it?", { question: "Swap it?", options: ["Yes, swap it", "No, keep it"] }),
        msg(3, "user", "Yes, swap it"),
      ],
    },
  ];
  const { deps } = setup({ rows, rounds: swapRounds(), extraSkills: [skill] });
  const res = await turn(deps, "Yes, swap it", "mine");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 0);
  assert.equal(rows[0].messages.filter((m) => m.role === "user").length, 2, "no duplicate user row");
});

// ─── Tool traces: the saved row records what this turn actually did ─────────

/** A read tool that returns whatever it is given, for trace-shape tests. */
function echoSkill(data: unknown = { ok: 1 }) {
  const skill: Skill = {
    name: "echo",
    promptFragment: "ECHO",
    tools: [
      {
        def: { name: "echo_read", description: "echo", input_schema: { type: "object", properties: {} } },
        handler: async (): Promise<ToolResult> => ({ ok: true, data }),
      },
    ],
  };
  return skill;
}

const savedTrace = (rows: Row[]) => rows[0].messages.at(-1)!.toolTrace as ToolTraceEntry[] | null | undefined;

test("a turn that calls memory_save then answers saves the row with that call and its result", async () => {
  const { deps, rows, seen } = setup({
    rounds: [
      {
        deltas: [],
        content: [{ type: "tool_use", id: "toolu_save1", name: "memory_save", input: { text: "Cooks for two" } }],
      },
      { deltas: ["Got it, I'll remember you cook for two."] },
    ],
  });
  const res = await turn(deps, "I cook for two");
  assert.ok(res.ok);
  await collect(res.events);
  const saved = rows[0].messages.at(-1)!;
  assert.equal(saved.role, "assistant");
  assert.equal(saved.content, "Got it, I'll remember you cook for two.");
  const modelSaw = (seen[1].messages.at(-1)!.content as ModelContentBlock[])[0];
  assert.ok(modelSaw.type === "tool_result");
  assert.deepEqual(savedTrace(rows), [
    { id: "toolu_save1", name: "memory_save", input: JSON.stringify({ text: "Cooks for two" }), result: modelSaw.content },
  ]);
});

test("a turn with no tool calls saves no trace", async () => {
  const { deps, rows } = setup({ rounds: [{ deltas: ["Hello Sam."] }] });
  const res = await turn(deps, "hello");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(savedTrace(rows) ?? null, null);
});

test("trace input and result are each cut to 600 characters (by code point)", async () => {
  const big = "\u{1F600}".repeat(700);
  const { deps, rows } = setup({
    extraSkills: [echoSkill({ blob: big })],
    rounds: [
      { content: [{ type: "tool_use", id: "toolu_e1", name: "echo_read", input: { q: big } }] },
      { deltas: ["Done."] },
    ],
  });
  const res = await turn(deps, "go");
  assert.ok(res.ok);
  await collect(res.events);
  const [entry] = savedTrace(rows)!;
  assert.equal(TOOL_TRACE_MAX_CHARS, 600);
  assert.equal(Array.from(entry.input).length, 600);
  assert.equal(Array.from(entry.result).length, 600);
  assert.ok(JSON.stringify({ q: big }).startsWith(entry.input));
  assert.ok(JSON.stringify({ ok: true, data: { blob: big } }).startsWith(entry.result));
  // No lone surrogates: the row must be storable as JSONB.
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.equal(lone.test(entry.input) || lone.test(entry.result), false);
});

test("the trace keeps only the first 8 calls of a turn", async () => {
  const calls: ModelContentBlock[] = Array.from({ length: 10 }, (_, i) => ({
    type: "tool_use" as const,
    id: `toolu_${i}`,
    name: "echo_read",
    input: { i },
  }));
  const { deps, rows } = setup({
    extraSkills: [echoSkill()],
    rounds: [{ content: calls.slice(0, 6) }, { content: calls.slice(6) }, { deltas: ["All done."] }],
  });
  const res = await turn(deps, "go");
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(TOOL_TRACE_MAX_CALLS, 8);
  assert.deepEqual(savedTrace(rows)!.map((e) => e.id), calls.slice(0, 8).map((c) => c.type === "tool_use" && c.id));
});

test("ask_choices and refused writes never reach execute, so they are not in the trace", async () => {
  const { skill, ran } = writeSkill();
  const choices = { question: "Anything else?", options: ["Yes", "No"] };
  const { deps, rows } = setup({
    extraSkills: [skill],
    rounds: [
      {
        deltas: ["Saved."],
        content: [
          { type: "text", text: "Saved." },
          { type: "tool_use", id: "toolu_m", name: "memory_save", input: { text: "Cooks for two" } },
          { type: "tool_use", id: "toolu_w", name: "plan_swap", input: {} },
          { type: "tool_use", id: "toolu_c", name: ASK_CHOICES_TOOL, input: choices },
        ],
      },
    ],
  });
  const res = await turn(deps, "I cook for two"); // new conversation → writes refused
  assert.ok(res.ok);
  await collect(res.events);
  assert.equal(ran.length, 0);
  assert.deepEqual(rows[0].messages.at(-1)!.choices, choices);
  assert.deepEqual(savedTrace(rows)!.map((e) => e.name), ["memory_save"]);
});

test("the next turn replays the saved trace to the model as real tool blocks", async () => {
  const { deps, rows, seen } = setup({
    rounds: [
      { content: [{ type: "tool_use", id: "toolu_save1", name: "memory_save", input: { text: "Cooks for two" } }] },
      { deltas: ["Got it, I'll remember you cook for two."] },
      { deltas: ["Sure."] },
    ],
  });
  const first = await turn(deps, "I cook for two");
  assert.ok(first.ok);
  await collect(first.events);
  const second = await turn(deps, "what's for dinner?", rows[0].id);
  assert.ok(second.ok);
  await collect(second.events);
  const replay = seen[2].messages;
  assert.deepEqual(replay.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(replay[1].content, [
    { type: "tool_use", id: "toolu_save1", name: "memory_save", input: { text: "Cooks for two" } },
  ]);
  const result = (replay[2].content as ModelContentBlock[])[0];
  assert.ok(result.type === "tool_result" && result.tool_use_id === "toolu_save1");
  assert.equal(replay[3].content, "Got it, I'll remember you cook for two.");
  assert.equal(replay[4].content, "what's for dinner?");
});

test("a handler that throws is recorded with the FAILED result the model was given", async () => {
  const boom: Skill = {
    name: "boom",
    promptFragment: "BOOM",
    tools: [
      {
        def: { name: "boom_read", description: "boom", input_schema: { type: "object", properties: {} } },
        handler: async () => {
          throw new Error("kaput");
        },
      },
    ],
  };
  const { deps, rows, seen } = setup({
    extraSkills: [boom],
    rounds: [{ content: [{ type: "tool_use", id: "toolu_b", name: "boom_read", input: {} }] }, { deltas: ["Sorry."] }],
  });
  deps.onError = () => {};
  const res = await turn(deps, "go");
  assert.ok(res.ok);
  await collect(res.events);
  const modelSaw = (seen[1].messages.at(-1)!.content as ModelContentBlock[])[0];
  assert.ok(modelSaw.type === "tool_result");
  assert.deepEqual(savedTrace(rows), [{ id: "toolu_b", name: "boom_read", input: "{}", result: modelSaw.content }]);
});
