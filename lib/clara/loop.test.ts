import { test } from "node:test";
import assert from "node:assert/strict";
import { startClaraLoop } from "./loop";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest, ToolResult } from "./types";

/** Scripts one array of events per round; records what each round was asked. */
function stubClient(rounds: ModelRoundEvent[][]) {
  const seen: ModelRoundRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async openRound(req) {
      seen.push(structuredClone(req));
      const events = rounds[i++] ?? [];
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
  return { client, seen };
}

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

const okTool = async (): Promise<ToolResult> => ({ ok: true, data: { hits: 1 } });

test("a text-only round streams and stops after one model call", async () => {
  const { client, seen } = stubClient([[{ type: "text", text: "Hello there." }]]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Hello there.");
  assert.equal(seen.length, 1);
});

test("narration text from a tool round reaches the user before the answer", async () => {
  const { client } = stubClient([
    [{ type: "text", text: "Let me check. " }, { type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "You had ramen." }],
  ]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Let me check. You had ramen.");
});

test("tool results are appended as a user tool_result block for the next round", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: { a: 1 } }],
    [{ type: "text", text: "done" }],
  ]);
  await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
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
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "tool_use", id: "t2", name: "x_get", input: {} }],
    [{ type: "text", text: "final answer" }],
  ]);
  const tools = [
    { name: "x_get", description: "d", input_schema: { type: "object" as const, properties: {} } },
  ];
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools, messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "final answer");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[1].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[2].tools, []); // budget spent ⇒ forced final answer
});

test("a handler failure is narrated as a typed result, not thrown", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "I could not find that." }],
  ]);
  const failing = async (): Promise<ToolResult> => ({
    ok: false,
    reason: "NOT_FOUND",
    message: "nothing there",
  });
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: failing })
  );
  assert.equal(out, "I could not find that.");
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /NOT_FOUND/);
});

test("a handler that throws becomes a FAILED result instead of killing the turn", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "something went wrong on my end" }],
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

test("an unknown tool name is reported back instead of crashing the turn", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "ghost_get", input: {} }],
    [{ type: "text", text: "sorry" }],
  ]);
  const execute = async (name: string): Promise<ToolResult> =>
    name === "ghost_get"
      ? { ok: false, reason: "FAILED", message: "Unknown tool" }
      : { ok: true, data: null };
  await drain(await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute }));
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /Unknown tool/);
});

test("parallel tool calls in one round all execute and answer in order", async () => {
  const { client, seen } = stubClient([
    [
      { type: "tool_use", id: "t1", name: "a_get", input: {} },
      { type: "tool_use", id: "t2", name: "b_get", input: {} },
    ],
    [{ type: "text", text: "both done" }],
  ]);
  const called: string[] = [];
  const execute = async (name: string): Promise<ToolResult> => {
    called.push(name);
    return { ok: true, data: name };
  };
  await drain(await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute }));
  assert.deepEqual(called, ["a_get", "b_get"]);
  const blocks = seen[1].messages.at(-1)!.content as { tool_use_id: string }[];
  assert.deepEqual(blocks.map((b) => b.tool_use_id), ["t1", "t2"]);
});

test("the caller's conversation history is never mutated", async () => {
  const history = [{ role: "user" as const, content: "hi" }];
  const { client } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "done" }],
  ]);
  await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: history, maxToolRounds: 2, execute: okTool })
  );
  assert.deepEqual(history, [{ role: "user", content: "hi" }]);
});

test("a round-1 connect failure rejects before any text is produced", async () => {
  const client: ModelClient = {
    async openRound() {
      throw new Error("connect failed");
    },
  };
  await assert.rejects(
    startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool }),
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
          yield { type: "tool_use", id: "t1", name: "x_get", input: {} } as ModelRoundEvent;
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
