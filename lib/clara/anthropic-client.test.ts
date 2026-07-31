import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicClient, CLARA_MODEL, CLARA_MAX_TOKENS } from "./anthropic-client";
import type { ModelRoundEvent } from "./types";

/**
 * This adapter is the ONLY Anthropic-aware file, so it is the only place a wire
 * regression can land — the model id, token cap, thinking setting, the
 * system-as-block-array shape and the conditional `tools` key all live here and
 * are pinned nowhere else.
 */
function fakeAnthropic(opts: {
  deltas?: string[];
  content?: unknown[];
  stopReason?: string | null;
  connectError?: Error;
}) {
  const sent: Record<string, unknown>[] = [];
  let aborted = false;
  const anthropic = {
    messages: {
      stream(params: Record<string, unknown>) {
        sent.push(params);
        const deltas = opts.deltas ?? [];
        return {
          get aborted() {
            return aborted;
          },
          abort() {
            aborted = true;
          },
          async withResponse() {
            if (opts.connectError) throw opts.connectError;
          },
          async *[Symbol.asyncIterator]() {
            for (const text of deltas) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
            }
          },
          async finalMessage() {
            return {
              content: opts.content ?? deltas.map((text) => ({ type: "text", text })),
              stop_reason: opts.stopReason ?? "end_turn",
            };
          },
        };
      },
    },
  };
  return { anthropic, sent, wasAborted: () => aborted };
}

async function collect(iterable: AsyncIterable<ModelRoundEvent>): Promise<ModelRoundEvent[]> {
  const out: ModelRoundEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

const TOOL = {
  name: "x_get",
  description: "d",
  input_schema: { type: "object" as const, properties: {} },
};

test("model, token cap and disabled thinking are sent on every round", async () => {
  const { anthropic, sent } = fakeAnthropic({ deltas: ["hi"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  assert.equal(sent[0].model, CLARA_MODEL);
  assert.equal(sent[0].model, "claude-sonnet-5");
  assert.equal(sent[0].max_tokens, CLARA_MAX_TOKENS);
  assert.deepEqual(sent[0].thinking, { type: "disabled" });
});

// An empty toolbox must produce a request with NO tools key at all — that is
// what makes the no-Patient path reproduce the pre-runtime request shape.
test("an empty tools array omits the tools key entirely", async () => {
  const { anthropic, sent } = fakeAnthropic({ deltas: ["hi"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  assert.ok(!("tools" in sent[0]), "tools must be absent, not an empty array");
});

test("a non-empty toolbox is passed through unchanged", async () => {
  const { anthropic, sent } = fakeAnthropic({ deltas: ["hi"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await collect(await client.openRound({ system: "S", messages: [], tools: [TOOL] }));
  assert.deepEqual(sent[0].tools, [TOOL]);
});

test("system is a cacheable text block carrying the prompt verbatim", async () => {
  const { anthropic, sent } = fakeAnthropic({ deltas: ["hi"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await collect(await client.openRound({ system: "PROMPT-TEXT", messages: [], tools: [] }));
  assert.deepEqual(sent[0].system, [
    { type: "text", text: "PROMPT-TEXT", cache_control: { type: "ephemeral" } },
  ]);
});

test("text deltas stream through, then one terminal end event", async () => {
  const { anthropic } = fakeAnthropic({
    deltas: ["Let ", "me ", "check."],
    content: [{ type: "text", text: "Let me check." }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  const events = await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  assert.deepEqual(
    events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text),
    ["Let ", "me ", "check."]
  );
  const end = events.at(-1)!;
  assert.equal(end.type, "end");
  assert.deepEqual((end as { content: unknown }).content, [{ type: "text", text: "Let me check." }]);
});

// The accumulated message is authoritative: tool_use inputs are only complete
// there, and it preserves real block order, which deltas do not.
test("the end event carries real block order and completed tool inputs", async () => {
  const { anthropic } = fakeAnthropic({
    deltas: ["before ", "after"],
    content: [
      { type: "text", text: "before " },
      { type: "tool_use", id: "t1", name: "x_get", input: { q: "ramen" } },
      { type: "text", text: "after" },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  const events = await collect(await client.openRound({ system: "S", messages: [], tools: [TOOL] }));
  const end = events.at(-1) as { type: string; content: { type: string }[] };
  assert.deepEqual(end.content.map((b) => b.type), ["text", "tool_use", "text"]);
  assert.deepEqual(end.content[1], {
    type: "tool_use",
    id: "t1",
    name: "x_get",
    input: { q: "ramen" },
  });
});

test("stop_reason is surfaced so the loop can refuse truncated tool calls", async () => {
  const { anthropic } = fakeAnthropic({ deltas: ["cut off"], stopReason: "max_tokens" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  const events = await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  assert.equal((events.at(-1) as { stopReason: string }).stopReason, "max_tokens");
});

test("unknown block kinds are dropped rather than replayed", async () => {
  const { anthropic } = fakeAnthropic({
    deltas: ["hi"],
    content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "hi" }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  const events = await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  const end = events.at(-1) as { content: { type: string }[] };
  assert.deepEqual(end.content, [{ type: "text", text: "hi" }]);
});

// Round 1 opens eagerly so this rejects BEFORE the route commits to a 200,
// which is what preserves the JSON error bodies for 429/503/500.
test("a connect failure rejects at openRound, not mid-stream", async () => {
  const { anthropic } = fakeAnthropic({ connectError: new Error("overloaded") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await assert.rejects(
    client.openRound({ system: "S", messages: [], tools: [] }),
    /overloaded/
  );
});

test("abandoning the round aborts the underlying stream", async () => {
  const { anthropic, wasAborted } = fakeAnthropic({ deltas: ["one", "two", "three"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  const iterable = await client.openRound({ system: "S", messages: [], tools: [] });
  for await (const _e of iterable) break; // consumer disconnects
  assert.equal(wasAborted(), true);
});

test("a fully drained round is NOT aborted — that would break finalMessage", async () => {
  const { anthropic, wasAborted } = fakeAnthropic({ deltas: ["one"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAnthropicClient(anthropic as any);
  await collect(await client.openRound({ system: "S", messages: [], tools: [] }));
  assert.equal(wasAborted(), false);
});
