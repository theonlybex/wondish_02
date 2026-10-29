import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeConversationStore,
  replayText,
  titleFrom,
  type ConversationDeps,
  type HistoryRow,
  type StoredMessage,
  type ToolTraceEntry,
} from "./conversations";

interface Row {
  id: string;
  patientId: string;
  title: string;
  surface: string;
  updatedAt: Date;
  messages: HistoryRow[];
}

/** In-memory fake of the persistence port. No database, no network. */
function fakeDeps(rows: Row[] = []) {
  let seq = 0;
  const calls: string[] = [];
  const deps: ConversationDeps = {
    createConversation: async ({ patientId, title, surface, firstMessage }) => {
      calls.push("createConversation");
      const id = `c${++seq}`;
      rows.push({
        id,
        patientId,
        title,
        surface,
        updatedAt: new Date(),
        messages: [
          { id: `m${++seq}`, role: "user", content: firstMessage, choices: null, createdAt: new Date() },
        ],
      });
      return { id };
    },
    isOwned: async (id, patientId) => rows.some((r) => r.id === id && r.patientId === patientId),
    recentMessages: async (id, limit) => {
      const r = rows.find((x) => x.id === id);
      return r ? [...r.messages].reverse().slice(0, limit) : [];
    },
    insertMessage: async ({ conversationId, role, content, choices, toolTrace }) => {
      calls.push(`insert:${role}`);
      const r = rows.find((x) => x.id === conversationId)!;
      const id = `m${++seq}`;
      r.messages.push({ id, role, content, choices, toolTrace: toolTrace ?? null, createdAt: new Date() });
      r.updatedAt = new Date();
      return { id };
    },
    listPage: async (patientId, cursor, take) => {
      const sorted = rows
        .filter((r) => r.patientId === patientId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const start = cursor ? sorted.findIndex((r) => r.id === cursor) + 1 : 0;
      return sorted.slice(start, start + take).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }));
    },
    getOwned: async (id, patientId) => {
      const r = rows.find((x) => x.id === id && x.patientId === patientId);
      return r ? { id: r.id, title: r.title, messages: r.messages } : null;
    },
    deleteOwned: async (id, patientId) => {
      const i = rows.findIndex((x) => x.id === id && x.patientId === patientId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
  return { deps, rows, calls };
}

const msg = (
  i: number,
  role: "user" | "assistant",
  content = `${role} ${i}`,
  choices: StoredMessage["choices"] = null
): StoredMessage => ({ id: `m${i}`, role, content, choices, createdAt: new Date(2026, 0, 1, 0, i) });

const rowWith = (messages: HistoryRow[], over: Partial<Row> = {}): Row => ({
  id: "c1",
  patientId: "p1",
  title: "t",
  surface: "web",
  updatedAt: new Date(),
  messages,
  ...over,
});

test("titleFrom collapses whitespace and newlines", () => {
  assert.equal(titleFrom("  hello\n\n  world \t again "), "hello world again");
});

test("titleFrom keeps 60 chars as-is and cuts longer text to 60 with an ellipsis", () => {
  const sixty = "a".repeat(60);
  assert.equal(titleFrom(sixty), sixty);
  const cut = titleFrom("b".repeat(61));
  assert.equal(cut.length, 60);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut, "b".repeat(59) + "…");
});

test("titleFrom cuts by code points, so an emoji straddling the cut is never split", () => {
  // 58 ASCII chars put the emoji's surrogate pair at UTF-16 units 58-59, exactly
  // where a code-unit slice(0, 59) would leave a lone high surrogate.
  const text = "a".repeat(58) + "\u{1F600}" + "b".repeat(10);
  const cut = titleFrom(text);
  assert.equal(cut, "a".repeat(58) + "\u{1F600}" + "…");
  assert.equal(Array.from(cut).length, 60);
  // No lone surrogates anywhere in the title.
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), false);
});

test("titleFrom keeps a 60-code-point title with emoji as-is", () => {
  const sixty = "\u{1F600}".repeat(60);
  assert.equal(titleFrom(sixty), sixty);
});

test("replayText appends options as '- option' lines, or returns content alone", () => {
  assert.equal(replayText("Pick one", null), "Pick one");
  assert.equal(
    replayText("Which?", { question: "Which?", options: ["Yes", "No"] }),
    "Which?\n- Yes\n- No"
  );
});

test("create saves the conversation with a derived title and the first user message", async () => {
  const { deps, rows } = fakeDeps();
  const store = makeConversationStore(deps);
  const { id } = await store.create("p1", "What should\nI eat tonight?", "ios");
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].title, "What should I eat tonight?");
  assert.equal(rows[0].surface, "ios");
  assert.equal(rows[0].messages[0].role, "user");
  assert.equal(rows[0].messages[0].content, "What should\nI eat tonight?");
});

test("history returns at most 20 messages and starts with a user message", async () => {
  // 25 alternating messages u,a,u,a,... ; last 20 start at index 5 (an assistant) -> dropped.
  const messages = Array.from({ length: 25 }, (_, i) => msg(i, i % 2 === 0 ? "user" : "assistant"));
  const store = makeConversationStore(fakeDeps([rowWith(messages)]).deps);
  const { messages: h } = await store.history("c1");
  assert.ok(h.length <= 20);
  assert.equal(h[0].role, "user");
  assert.equal(h[h.length - 1].content, "user 24");
  assert.deepEqual(
    h.map((m) => m.content).slice(0, 2),
    ["user 6", "assistant 7"]
  );
});

test("history honours an explicit limit", async () => {
  const messages = Array.from({ length: 10 }, (_, i) => msg(i, i % 2 === 0 ? "user" : "assistant"));
  const store = makeConversationStore(fakeDeps([rowWith(messages)]).deps);
  const { messages: h } = await store.history("c1", 4);
  assert.deepEqual(h.map((m) => m.content), ["user 6", "assistant 7", "user 8", "assistant 9"]);
});

test("history returns plain-text content and renders choices through replayText", async () => {
  const choices = { question: "Which?", options: ["A", "B"] };
  const messages = [msg(0, "user", "hi"), msg(1, "assistant", "Which?", choices)];
  const store = makeConversationStore(fakeDeps([rowWith(messages)]).deps);
  const { messages: h } = await store.history("c1");
  assert.deepEqual(h, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Which?\n- A\n- B" },
  ]);
});

test("lastAssistantHadChoices is true only when the newest assistant message has choices", async () => {
  const choices = { question: "Q", options: ["A", "B"] };
  const withBoxes = rowWith([msg(0, "user"), msg(1, "assistant", "Q", choices)]);
  assert.equal((await makeConversationStore(fakeDeps([withBoxes]).deps).history("c1")).lastAssistantHadChoices, true);

  const answered = rowWith([
    msg(0, "user"),
    msg(1, "assistant", "Q", choices),
    msg(2, "user", "A"),
    msg(3, "assistant", "Done"),
  ]);
  assert.equal((await makeConversationStore(fakeDeps([answered]).deps).history("c1")).lastAssistantHadChoices, false);

  const none = rowWith([msg(0, "user")]);
  assert.equal((await makeConversationStore(fakeDeps([none]).deps).history("c1")).lastAssistantHadChoices, false);
});

test("appendUser and appendAssistant save the turn and return the new id", async () => {
  const { deps, rows } = fakeDeps([rowWith([msg(0, "user")])]);
  const store = makeConversationStore(deps);
  const u = await store.appendUser("c1", "more please", "web");
  const choices = { question: "Q", options: ["A", "B"] };
  const a = await store.appendAssistant("c1", "Q", choices, "web");
  assert.ok(u.id && a.id && u.id !== a.id);
  assert.equal(rows[0].messages[1].role, "user");
  assert.equal(rows[0].messages[2].role, "assistant");
  assert.deepEqual(rows[0].messages[2].choices, choices);
});

test("appendAssistant bumps the conversation's updatedAt", async () => {
  const old = new Date("2026-01-01T00:00:00Z");
  const { deps, rows } = fakeDeps([rowWith([msg(0, "user")], { updatedAt: old })]);
  await makeConversationStore(deps).appendAssistant("c1", "hi", null, "web");
  assert.ok(rows[0].updatedAt.getTime() > old.getTime());
});

test("owned, get and remove refuse another patient's conversation", async () => {
  const { deps, rows } = fakeDeps([rowWith([msg(0, "user")], { patientId: "owner" })]);
  const store = makeConversationStore(deps);
  assert.equal(await store.owned("c1", "intruder"), false);
  assert.equal(await store.get("c1", "intruder"), null);
  assert.equal(await store.remove("c1", "intruder"), false);
  assert.equal(rows.length, 1, "nothing was deleted");
  assert.equal(await store.owned("c1", "owner"), true);
  assert.equal((await store.get("c1", "owner"))?.id, "c1");
  assert.equal(await store.remove("c1", "owner"), true);
  assert.equal(rows.length, 0);
});

test("get returns the title and every saved message with parsed choices", async () => {
  const choices = { question: "Q", options: ["A", "B"] };
  const r = rowWith([msg(0, "user", "hi"), msg(1, "assistant", "Q", choices)], { title: "Greeting" });
  const got = await makeConversationStore(fakeDeps([r]).deps).get("c1", "p1");
  assert.equal(got?.title, "Greeting");
  assert.equal(got?.messages.length, 2);
  assert.deepEqual(got?.messages[1].choices, choices);
});

test("list pages at 30, newest updatedAt first, with a nextCursor", async () => {
  const rows: Row[] = Array.from({ length: 35 }, (_, i) =>
    rowWith([], { id: `c${i}`, title: `T${i}`, updatedAt: new Date(2026, 0, 1, 0, i) })
  );
  const store = makeConversationStore(fakeDeps(rows).deps);
  const page1 = await store.list("p1");
  assert.equal(page1.items.length, 30);
  assert.equal(page1.items[0].id, "c34");
  assert.equal(page1.nextCursor, page1.items[29].id);
  const page2 = await store.list("p1", page1.nextCursor!);
  assert.equal(page2.items.length, 5);
  assert.equal(page2.nextCursor, null);
  assert.equal(page2.items[0].id, "c4");
});

test("list with exactly 30 conversations has no nextCursor, and never shows other patients' rows", async () => {
  const rows: Row[] = [
    ...Array.from({ length: 30 }, (_, i) => rowWith([], { id: `c${i}`, updatedAt: new Date(2026, 0, 1, 0, i) })),
    rowWith([], { id: "other", patientId: "p2" }),
  ];
  const page = await makeConversationStore(fakeDeps(rows).deps).list("p1");
  assert.equal(page.items.length, 30);
  assert.equal(page.nextCursor, null);
  assert.ok(!page.items.some((i) => i.id === "other"));
});

// ─── Tool traces: each assistant turn's executed tool calls are replayed ─────

const trace = (id: string, name = "memory_save", input = '{"text":"Cooks for two"}', result = '{"ok":true,"data":{"saved":true}}'): ToolTraceEntry => ({
  id,
  name,
  input,
  result,
});
const traced = (i: number, content: string, entries: unknown, choices: StoredMessage["choices"] = null): HistoryRow => ({
  ...msg(i, "assistant", content, choices),
  toolTrace: entries,
});

test("history expands a traced assistant row into assistant(tool_use) → user(tool_result) → assistant(text)", async () => {
  const choices = { question: "Anything else?", options: ["Yes", "No"] };
  const messages: HistoryRow[] = [
    msg(0, "user", "I cook for two"),
    traced(1, "Got it, I'll remember you cook for two. Anything else?", [trace("toolu_1"), trace("toolu_2", "plan_today", "{}", '{"ok":true,"data":{"meals":[]}}')], choices),
    msg(2, "user", "no thanks"),
  ];
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1");
  assert.deepEqual(h, [
    { role: "user", content: "I cook for two" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "memory_save", input: { text: "Cooks for two" } },
        { type: "tool_use", id: "toolu_2", name: "plan_today", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true,"data":{"saved":true}}' },
        { type: "tool_result", tool_use_id: "toolu_2", content: '{"ok":true,"data":{"meals":[]}}' },
      ],
    },
    { role: "assistant", content: "Got it, I'll remember you cook for two. Anything else?\n- Yes\n- No" },
    { role: "user", content: "no thanks" },
  ]);
});

test("history leaves untraced rows (null, empty or absent trace) exactly as today", async () => {
  const messages: HistoryRow[] = [
    msg(0, "user", "hi"),
    traced(1, "hello", null),
    msg(2, "user", "and?"),
    traced(3, "nothing", []),
    msg(4, "user", "ok"),
    msg(5, "assistant", "bye"),
  ];
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1");
  assert.deepEqual(h, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "and?" },
    { role: "assistant", content: "nothing" },
    { role: "user", content: "ok" },
    { role: "assistant", content: "bye" },
  ]);
});

test("history applies the window and the leading-user rule to ROWS, before expansion", async () => {
  const messages: HistoryRow[] = [
    msg(0, "user", "u0"),
    traced(1, "a1", [trace("toolu_a")]),
    msg(2, "user", "u2"),
    traced(3, "a3", [trace("toolu_b")]),
  ];
  // Newest 3 rows = a1, u2, a3. a1 leads, so it is dropped; a3 expands to 3 messages.
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1", 3);
  assert.equal(h.length, 4);
  assert.deepEqual(h[0], { role: "user", content: "u2" });
  assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual(h[3], { role: "assistant", content: "a3" });
  assert.ok(!JSON.stringify(h).includes("toolu_a"), "the dropped leading row's trace is not replayed");
});

test("history replays an unparsable stored input as {} and skips malformed trace entries", async () => {
  const messages: HistoryRow[] = [
    msg(0, "user", "hi"),
    traced(1, "done", [
      trace("toolu_1", "memory_save", '{"text":"Cooks for tw'), // truncated at 600 → unparsable
      trace("toolu_2", "memory_save", '["not","an","object"]'),
      { id: 7, name: "memory_save", input: "{}", result: "{}" },
      "garbage",
    ]),
  ];
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1");
  assert.deepEqual(h[1].content, [
    { type: "tool_use", id: "toolu_1", name: "memory_save", input: {} },
    { type: "tool_use", id: "toolu_2", name: "memory_save", input: {} },
  ]);
  assert.equal((h[2].content as unknown[]).length, 2);
});

test("history treats a trace that is not an array as no trace", async () => {
  const messages: HistoryRow[] = [msg(0, "user", "hi"), traced(1, "hello", { id: "x" })];
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1");
  assert.deepEqual(h, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
});

test("history keeps tool_use ids unique: a repeated id is prefixed with its row id", async () => {
  const messages: HistoryRow[] = [
    msg(0, "user", "hi"),
    traced(1, "one", [trace("toolu_dup")]),
    msg(2, "user", "again"),
    traced(3, "two", [trace("toolu_dup")]),
  ];
  const { messages: h } = await makeConversationStore(fakeDeps([rowWith(messages)]).deps).history("c1");
  const uses = h.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use");
  const results = h.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
  assert.deepEqual(uses.map((b) => b.type === "tool_use" && b.id), ["toolu_dup", "m3_toolu_dup"]);
  assert.deepEqual(results.map((b) => b.type === "tool_result" && b.tool_use_id), ["toolu_dup", "m3_toolu_dup"]);
});

test("lastAssistantHadChoices still reads the newest assistant ROW when it is traced", async () => {
  const choices = { question: "Q", options: ["A", "B"] };
  const r = rowWith([msg(0, "user"), traced(1, "Q", [trace("toolu_1")], choices)]);
  const h = await makeConversationStore(fakeDeps([r]).deps).history("c1");
  assert.equal(h.lastAssistantHadChoices, true);
  assert.deepEqual(h.messages.at(-1), { role: "assistant", content: "Q\n- A\n- B" });
});

test("appendAssistant passes the tool trace through; appendUser and an untraced reply store none", async () => {
  const { deps, rows } = fakeDeps([rowWith([msg(0, "user")])]);
  const store = makeConversationStore(deps);
  await store.appendUser("c1", "more", "web");
  await store.appendAssistant("c1", "plain", null, "web");
  await store.appendAssistant("c1", "saved it", null, "web", [trace("toolu_9")]);
  assert.equal(rows[0].messages[1].toolTrace, null);
  assert.equal(rows[0].messages[2].toolTrace, null);
  assert.deepEqual(rows[0].messages[3].toolTrace, [trace("toolu_9")]);
});

test("get never exposes toolTrace, even when the stored row carries one", async () => {
  const r = rowWith([msg(0, "user", "hi"), traced(1, "saved", [trace("toolu_1")])]);
  const got = await makeConversationStore(fakeDeps([r]).deps).get("c1", "p1");
  assert.equal(got?.messages.length, 2);
  for (const m of got!.messages) assert.equal("toolTrace" in m, false);
  assert.ok(!JSON.stringify(got).includes("toolu_1"));
});
