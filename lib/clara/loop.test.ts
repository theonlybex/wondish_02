import { test } from "node:test";
import assert from "node:assert/strict";
import { startClaraLoop, EMPTY_ANSWER_FALLBACK } from "./loop";
import type {
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
