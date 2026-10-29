import { test } from "node:test";
import assert from "node:assert/strict";
import { startClaraLoop, EMPTY_ANSWER_FALLBACK } from "./loop";
import { ASK_CHOICES_TOOL, askChoicesSkill } from "./ask-choices";
import type {
  ClaraChoices,
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
  ToolResult,
} from "./types";

/**
 * A scripted round: text arrives as DELTAS (deliberately split, so the suite
 * models real streaming granularity), and the terminal `end` event carries the
 * authoritative block list — exactly as the Anthropic adapter behaves.
 */
interface ScriptedRound {
  deltas?: string[];
  content?: ModelContentBlock[];
  stopReason?: string | null;
}

function stubClient(rounds: ScriptedRound[]) {
  const seen: ModelRoundRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async openRound(req) {
      seen.push(structuredClone(req));
      const round = rounds[i++] ?? {};
      const deltas = round.deltas ?? [];
      const content =
        round.content ??
        (deltas.length > 0 ? [{ type: "text" as const, text: deltas.join("") }] : []);
      return (async function* () {
        for (const d of deltas) yield { type: "text", text: d } as ModelRoundEvent;
        yield { type: "end", content, stopReason: round.stopReason ?? null } as ModelRoundEvent;
      })();
    },
  };
  return { client, seen };
}

const toolUse = (
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): ModelContentBlock => ({ type: "tool_use", id, name, input });

const textBlock = (text: string): ModelContentBlock => ({ type: "text", text });

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

const okTool = async (): Promise<ToolResult> => ({ ok: true, data: { hits: 1 } });
const TOOLS = [
  { name: "x_get", description: "d", input_schema: { type: "object" as const, properties: {} } },
];

test("a text-only round streams and stops after one model call", async () => {
  const { client, seen } = stubClient([{ deltas: ["Hello ", "there."] }]);
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  assert.equal(out, "Hello there.");
  assert.equal(seen.length, 1);
});

test("narration text from a tool round reaches the user before the answer", async () => {
  const { client } = stubClient([
    { deltas: ["Let me check. "], content: [textBlock("Let me check. "), toolUse("t1", "x_get")] },
    { deltas: ["You had ramen."] },
  ]);
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  assert.equal(out, "Let me check. You had ramen.");
});

// Regression: the loop used to rebuild the assistant turn from deltas, so a
// sentence became one content block PER DELTA — including empty ones, which the
// API rejects on the next round — and text/tool_use order was not preserved.
test("the replayed assistant turn is the round's real blocks, not one per delta", async () => {
  const { client, seen } = stubClient([
    {
      deltas: ["Let ", "me ", "", "check."],
      content: [textBlock("Let me check."), toolUse("t1", "x_get")],
    },
    { deltas: ["done"] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  const assistant = seen[1].messages.at(-2)!;
  assert.equal(assistant.role, "assistant");
  const blocks = assistant.content as ModelContentBlock[];
  assert.equal(blocks.length, 2, "one coalesced text block plus the tool_use");
  assert.deepEqual(blocks[0], { type: "text", text: "Let me check." });
  assert.equal(blocks[1].type, "tool_use");
  assert.ok(
    !blocks.some((b) => b.type === "text" && b.text.trim() === ""),
    "no empty or whitespace-only text blocks may be replayed"
  );
});

test("block order is preserved when text follows a tool call", async () => {
  const { client, seen } = stubClient([
    {
      deltas: ["before ", "after"],
      content: [textBlock("before "), toolUse("t1", "x_get"), textBlock("after")],
    },
    { deltas: ["done"] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  const blocks = seen[1].messages.at(-2)!.content as ModelContentBlock[];
  assert.deepEqual(blocks.map((b) => b.type), ["text", "tool_use", "text"]);
});

test("tool results are appended as a user tool_result block for the next round", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("t1", "x_get", { a: 1 })] },
    { deltas: ["done"] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  const second = seen[1].messages;
  assert.equal(second.at(-2)?.role, "assistant");
  assert.equal(second.at(-1)?.role, "user");
  const block = (second.at(-1)!.content as { type: string; tool_use_id: string }[])[0];
  assert.equal(block.type, "tool_result");
  assert.equal(block.tool_use_id, "t1");
});

test("the budget is spent on tool rounds, and the final round is offered no tools", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("t1", "x_get")] },
    { content: [toolUse("t2", "x_get")] },
    { deltas: ["final answer"] },
  ]);
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  assert.equal(out, "final answer");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[1].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[2].tools, []); // budget spent ⇒ forced final answer
});

// Regression: `tools: []` only ASKS the model not to call tools. A client that
// ignores it used to spin the loop — measured at 51 model calls on a 2-round
// budget — because nothing broke out. The budget is now enforced locally.
test("a rogue client that keeps calling tools is stopped at the budget", async () => {
  let calls = 0;
  const client: ModelClient = {
    async openRound() {
      calls += 1;
      if (calls > 20) throw new Error("loop did not terminate");
      return (async function* () {
        yield { type: "end", content: [toolUse(`t${calls}`, "x_get")], stopReason: null } as ModelRoundEvent;
      })();
    },
  };
  const errors: unknown[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: okTool, onError: (e) => errors.push(e),
    })
  );
  assert.equal(calls, 3, "2 tool rounds + 1 forced final, then a hard stop");
  assert.match(out, /couldn't put an answer together/i);
  assert.equal(errors.length, 1);
});

// A max_tokens-truncated round has partially-parsed tool inputs: the SDK
// accumulates input_json_delta without throwing, so a truncated call looks
// valid. Executing it would act on half-read arguments.
test("a round truncated by max_tokens does not execute its tool calls", async () => {
  const { client, seen } = stubClient([
    {
      deltas: ["Let me look that up"],
      content: [textBlock("Let me look that up"), toolUse("t1", "x_get", { partial: "tru" })],
      stopReason: "max_tokens",
    },
  ]);
  let executed = 0;
  const errors: unknown[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: async () => {
        executed += 1;
        return { ok: true, data: null };
      },
      onError: (e) => errors.push(e),
    })
  );
  assert.equal(executed, 0, "a truncated tool call must never run");
  assert.equal(seen.length, 1, "and the loop must not open another round");
  assert.equal(out, "Let me look that up");
  assert.equal(errors.length, 1);
});

test("a turn that produces no text at all still returns something to render", async () => {
  const { client } = stubClient([{ deltas: [], content: [] }]);
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  assert.equal(out, EMPTY_ANSWER_FALLBACK);
});

test("duplicate tool_use ids yield one tool_result, not a 400 on the next round", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("dup", "x_get"), toolUse("dup", "x_get")] },
    { deltas: ["done"] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    })
  );
  const blocks = seen[1].messages.at(-1)!.content as { tool_use_id: string }[];
  assert.equal(blocks.length, 1);
});

test("a handler failure is narrated as a typed result, not thrown", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("t1", "x_get")] },
    { deltas: ["I could not find that."] },
  ]);
  const failing = async (): Promise<ToolResult> => ({
    ok: false,
    reason: "NOT_FOUND",
    message: "nothing there",
  });
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: failing,
    })
  );
  assert.equal(out, "I could not find that.");
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /NOT_FOUND/);
});

test("a handler that throws becomes a FAILED result instead of killing the turn", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("t1", "x_get")] },
    { deltas: ["something went wrong on my end"] },
  ]);
  const thrower = async (): Promise<ToolResult> => {
    throw new Error("prisma exploded");
  };
  const errors: unknown[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2,
      execute: thrower, onError: (e) => errors.push(e),
    })
  );
  assert.equal(out, "something went wrong on my end");
  assert.equal(errors.length, 1);
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /FAILED/);
});

test("parallel tool calls in one round all execute and answer in order", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("t1", "a_get"), toolUse("t2", "b_get")] },
    { deltas: ["both done"] },
  ]);
  const called: string[] = [];
  const execute = async (name: string): Promise<ToolResult> => {
    called.push(name);
    return { ok: true, data: name };
  };
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute,
    })
  );
  assert.deepEqual(called, ["a_get", "b_get"]);
  const blocks = seen[1].messages.at(-1)!.content as { tool_use_id: string }[];
  assert.deepEqual(blocks.map((b) => b.tool_use_id), ["t1", "t2"]);
});

test("the caller's conversation history is never mutated", async () => {
  const history = [{ role: "user" as const, content: "hi" }];
  const { client } = stubClient([
    { content: [toolUse("t1", "x_get")] },
    { deltas: ["done"] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: history, maxToolRounds: 2, execute: okTool,
    })
  );
  assert.deepEqual(history, [{ role: "user", content: "hi" }]);
});

test("abandoning the generator tears the round's stream down", async () => {
  let cleanedUp = false;
  const client: ModelClient = {
    async openRound() {
      return (async function* () {
        try {
          yield { type: "text", text: "first " } as ModelRoundEvent;
          yield { type: "text", text: "second" } as ModelRoundEvent;
          yield { type: "end", content: [textBlock("first second")], stopReason: null } as ModelRoundEvent;
        } finally {
          cleanedUp = true;
        }
      })();
    },
  };
  const gen = await startClaraLoop({
    client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
  });
  for await (const chunk of gen) {
    assert.equal(chunk, "first ");
    break; // client disconnects mid-stream
  }
  assert.equal(cleanedUp, true, "the round's stream must be closed when the consumer leaves");
});

test("a round-1 connect failure rejects before any text is produced", async () => {
  const client: ModelClient = {
    async openRound() {
      throw new Error("connect failed");
    },
  };
  await assert.rejects(
    startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
    }),
    /connect failed/
  );
});

test("a mid-stream failure after text degrades to prose instead of throwing", async () => {
  let i = 0;
  const client: ModelClient = {
    async openRound() {
      if (i++ === 0) {
        return (async function* () {
          yield { type: "text", text: "Checking. " } as ModelRoundEvent;
          yield { type: "end", content: [toolUse("t1", "x_get")], stopReason: null } as ModelRoundEvent;
        })();
      }
      throw new Error("round 2 exploded");
    },
  };
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
      onError: () => {},
    })
  );
  assert.match(out, /^Checking\. /);
  assert.match(out, /lost my train of thought/i);
});

test("a failure mid-way through the first round's own stream also degrades to prose", async () => {
  const client: ModelClient = {
    async openRound() {
      return (async function* () {
        yield { type: "text", text: "Half a sen" } as ModelRoundEvent;
        throw new Error("socket died");
      })();
    },
  };
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
      onError: () => {},
    })
  );
  assert.match(out, /^Half a sen/);
  assert.match(out, /lost my train of thought/i);
});

test("the tool call id reaches execute — write skills derive idempotency from it", async () => {
  const { client } = stubClient([
    { content: [toolUse("toolu_42", "x_get")] },
    { deltas: ["done"] },
  ]);
  const seenIds: string[] = [];
  await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2,
      execute: async (_n, _i, id) => {
        seenIds.push(id);
        return { ok: true, data: null };
      },
    })
  );
  assert.deepEqual(seenIds, ["toolu_42"]);
});

// ─── S3 E2: structural confirm guard ─────────────────────────────────────────

const WRITE_TOOLS = [
  { name: "x_write", description: "d", input_schema: { type: "object" as const, properties: {} }, isWrite: true },
  { name: "x_get", description: "d", input_schema: { type: "object" as const, properties: {} } },
];

test("guard: a write tool on the first turn is refused, not executed", async () => {
  let executed = 0;
  const { client, seen } = stubClient([
    { deltas: ["Logging it. "], content: [textBlock("Logging it. "), toolUse("t1", "x_write")] },
    { deltas: ["Actually — shall I log it?"] },
  ]);
  const out = await drain(
    await startClaraLoop({
      client,
      system: "s",
      tools: WRITE_TOOLS,
      messages: [{ role: "user", content: "log that ramen" }], // no assistant turn
      maxToolRounds: 2,
      execute: async () => {
        executed += 1;
        return { ok: true, data: null };
      },
    })
  );
  assert.equal(executed, 0);
  const replay = JSON.stringify(seen[1].messages);
  assert.match(replay, /CONFIRM_REQUIRED/);
  assert.match(out, /shall I log it/i);
});

test("guard: the same write executes once the history has an assistant turn", async () => {
  let executed = 0;
  const { client } = stubClient([
    { deltas: ["On it. "], content: [textBlock("On it. "), toolUse("t1", "x_write")] },
    { deltas: ["Logged."] },
  ]);
  await drain(
    await startClaraLoop({
      client,
      system: "s",
      tools: WRITE_TOOLS,
      messages: [
        { role: "user", content: "log that ramen" },
        { role: "assistant", content: "About 550 kcal — want me to log it?" },
        { role: "user", content: "yes" },
      ],
      maxToolRounds: 2,
      execute: async () => {
        executed += 1;
        return { ok: true, data: null };
      },
    })
  );
  assert.equal(executed, 1);
});

test("guard: read tools are untouched on the first turn", async () => {
  let executed = 0;
  const { client } = stubClient([
    { deltas: ["Checking. "], content: [textBlock("Checking. "), toolUse("t1", "x_get")] },
    { deltas: ["Here."] },
  ]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: WRITE_TOOLS,
      messages: [{ role: "user", content: "what did I eat?" }],
      maxToolRounds: 2,
      execute: async () => { executed += 1; return { ok: true, data: null }; },
    })
  );
  assert.equal(executed, 1);
});

test("narration and the post-tool answer are separated when the narration has no trailing space", async () => {
  const { client } = stubClient([
    { deltas: ["Let me check your dinner plan."], content: [textBlock("Let me check your dinner plan."), toolUse("t1", "x_get")] },
    { deltas: ["No — peanut butter", " is off-limits."] },
  ]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Let me check your dinner plan.\n\nNo — peanut butter is off-limits.");
});

// ─── ask_choices (answer boxes) ──────────────────────────────────────────────

const ASK_DEF = askChoicesSkill.tools[0].def;
const CHOICE_TOOLS = [
  ASK_DEF,
  { name: "plan_get", description: "d", input_schema: { type: "object" as const, properties: {} } },
  { name: "x_write", description: "d", input_schema: { type: "object" as const, properties: {} }, isWrite: true },
];
const SWAP = { question: "Swap tonight's dinner?", options: ["Yes, swap it", "No, keep it"] };
const askCall = (id: string, input: Record<string, unknown> = SWAP) => toolUse(id, ASK_CHOICES_TOOL, input);

function recorder() {
  const executed: string[] = [];
  const choices: ClaraChoices[] = [];
  return {
    executed,
    choices,
    execute: async (name: string): Promise<ToolResult> => {
      executed.push(name);
      return { ok: true, data: null };
    },
    onChoices: (c: ClaraChoices) => choices.push(c),
  };
}

test("ask_choices: streams the question, emits the choices once, and opens no further round", async () => {
  const { client, seen } = stubClient([{ content: [askCall("c1")] }]);
  const r = recorder();
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.equal(out, "Swap tonight's dinner?");
  assert.deepEqual(r.choices, [SWAP]);
  assert.equal(seen.length, 1, "ask_choices is terminal");
  assert.deepEqual(r.executed, [], "the ask_choices handler is never executed");
});

test("ask_choices: the question follows the \\n\\n separator rule after prose", async () => {
  const { client } = stubClient([
    { deltas: ["Tonight is the curry."], content: [textBlock("Tonight is the curry."), askCall("c1")] },
  ]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Tonight is the curry.\n\nSwap tonight's dinner?");
});

test("ask_choices: no separator is added when the prose already ends in whitespace", async () => {
  const { client } = stubClient([
    { deltas: ["Tonight is the curry. "], content: [textBlock("Tonight is the curry. "), askCall("c1")] },
  ]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Tonight is the curry. Swap tonight's dinner?");
});

test("ask_choices: the question is separated from narration streamed in an EARLIER round", async () => {
  const { client, seen } = stubClient([
    { deltas: ["Let me look."], content: [textBlock("Let me look."), toolUse("t1", "plan_get")] },
    { content: [askCall("c1")] },
  ]);
  const r = recorder();
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.equal(out, "Let me look.\n\nSwap tonight's dinner?");
  assert.equal(seen.length, 2);
  assert.equal(r.choices.length, 1);
});

test("ask_choices: other calls in the same round execute first, then the turn ends with choices", async () => {
  // ask_choices listed FIRST: the other call must still run before the turn ends.
  const { client, seen } = stubClient([{ content: [askCall("c1"), toolUse("p1", "plan_get")] }]);
  const order: string[] = [];
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: async (name) => {
        order.push(`exec:${name}`);
        return { ok: true, data: null };
      },
      onChoices: () => order.push("choices"),
    })
  );
  assert.deepEqual(order, ["exec:plan_get", "choices"]);
  assert.equal(out, "Swap tonight's dinner?");
  assert.equal(seen.length, 1);
});

test("ask_choices: a write in the same round still goes through the confirm guard", async () => {
  const { client } = stubClient([{ content: [toolUse("w1", "x_write"), askCall("c1")] }]);
  const r = recorder();
  await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS,
      messages: [{ role: "user", content: "swap dinner" }],
      maxToolRounds: 2, execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.deepEqual(r.executed, [], "a first-turn write is refused even beside ask_choices");
  assert.equal(r.choices.length, 1);
});

test("ask_choices: invalid input gets an INVALID_INPUT tool_result and the loop continues", async () => {
  const { client, seen } = stubClient([
    { content: [askCall("c1", { question: "Which one?", options: ["Only one"] })] },
    { deltas: ["Which dinner would you like instead?"] },
  ]);
  const r = recorder();
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.equal(out, "Which dinner would you like instead?");
  assert.equal(seen.length, 2, "the model gets another round to retry");
  assert.deepEqual(r.choices, []);
  assert.deepEqual(r.executed, [], "invalid ask_choices is not handed to execute");
  const block = (seen[1].messages.at(-1)!.content as { tool_use_id: string; content: string }[])[0];
  assert.equal(block.tool_use_id, "c1");
  assert.equal(JSON.parse(block.content).reason, "INVALID_INPUT");
});

test("ask_choices: a max_tokens round drops ask_choices with every other call", async () => {
  const { client, seen } = stubClient([
    { deltas: ["Shall I"], content: [textBlock("Shall I"), toolUse("p1", "plan_get"), askCall("c1")], stopReason: "max_tokens" },
  ]);
  const r = recorder();
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices, onError: () => {},
    })
  );
  assert.equal(out, "Shall I");
  assert.deepEqual(r.executed, []);
  assert.deepEqual(r.choices, []);
  assert.equal(seen.length, 1);
});

test("ask_choices: two calls in one round emit choices once", async () => {
  const { client } = stubClient([
    { content: [askCall("c1"), askCall("c2", { question: "Or lunch?", options: ["Lunch", "Dinner"] })] },
  ]);
  const r = recorder();
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.equal(out, "Swap tonight's dinner?");
  assert.deepEqual(r.choices, [SWAP]);
});

test("ask_choices: not intercepted when the route does not offer it (dish-checker unchanged)", async () => {
  const { client, seen } = stubClient([{ content: [askCall("c1")] }, { deltas: ["done"] }]);
  const r = recorder();
  await drain(
    await startClaraLoop({
      client, system: "s", tools: TOOLS, messages: [], maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices,
    })
  );
  assert.deepEqual(r.executed, [ASK_CHOICES_TOOL], "falls through to execute exactly as before");
  assert.deepEqual(r.choices, []);
  assert.equal(seen.length, 2);
});

// ─── writesAllowed: the explicit write guard (spec §3a) ─────────────────────

const CONFIRMED_HISTORY = [
  { role: "user" as const, content: "swap dinner" },
  { role: "assistant" as const, content: "Swap tonight's curry for the salmon?" },
  { role: "user" as const, content: "yes" },
];

test("writesAllowed false: a write is refused even with prior assistant turns", async () => {
  const { client, seen } = stubClient([
    { content: [toolUse("w1", "x_write")] },
    { content: [askCall("c1")] },
  ]);
  const r = recorder();
  await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: CONFIRMED_HISTORY, maxToolRounds: 2,
      execute: r.execute, onChoices: r.onChoices, writesAllowed: false,
    })
  );
  assert.deepEqual(r.executed, []);
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  const result = JSON.parse(block.content);
  assert.equal(result.reason, "CONFIRM_REQUIRED");
  assert.match(result.message, /ask_choices/, "points the model at answer boxes when they are offered");
});

test("writesAllowed false: read tools still run", async () => {
  const { client } = stubClient([{ content: [toolUse("p1", "plan_get")] }, { deltas: ["done"] }]);
  const r = recorder();
  await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS, messages: CONFIRMED_HISTORY, maxToolRounds: 2,
      execute: r.execute, writesAllowed: false,
    })
  );
  assert.deepEqual(r.executed, ["plan_get"]);
});

test("writesAllowed true: a write executes even on a first turn", async () => {
  const { client } = stubClient([{ content: [toolUse("w1", "x_write")] }, { deltas: ["Swapped."] }]);
  const r = recorder();
  await drain(
    await startClaraLoop({
      client, system: "s", tools: CHOICE_TOOLS,
      messages: [{ role: "user", content: "Yes, swap it" }],
      maxToolRounds: 2, execute: r.execute, writesAllowed: true,
    })
  );
  assert.deepEqual(r.executed, ["x_write"]);
});

test("writesAllowed undefined: the CONFIRM_REQUIRED message is unchanged when ask_choices is not offered", async () => {
  const { client, seen } = stubClient([{ content: [toolUse("w1", "x_write")] }, { deltas: ["ok"] }]);
  await drain(
    await startClaraLoop({
      client, system: "s", tools: WRITE_TOOLS,
      messages: [{ role: "user", content: "log it" }],
      maxToolRounds: 2, execute: okTool,
    })
  );
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.deepEqual(JSON.parse(block.content), {
    ok: false,
    reason: "CONFIRM_REQUIRED",
    message:
      "This change needs the user's explicit confirmation first. Propose it in plain words and wait for their yes.",
  });
});
