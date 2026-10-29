import { test } from "node:test";
import assert from "node:assert/strict";
import { readClaraEvents } from "./ndjson-client";
import type { ClaraEvent } from "./ndjson";

const enc = new TextEncoder();

/** A body that delivers exactly these chunks, in order. */
function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ClaraEvent[]> {
  const out: ClaraEvent[] = [];
  for await (const e of readClaraEvents(body)) out.push(e);
  return out;
}

test("readClaraEvents: one event split across three chunks arrives whole", async () => {
  const line = JSON.stringify({ type: "text", text: "Hello there" }) + "\n";
  const events = await collect(streamOf([line.slice(0, 5), line.slice(5, 17), line.slice(17)]));
  assert.deepEqual(events, [{ type: "text", text: "Hello there" }]);
});

test("readClaraEvents: two events in one chunk arrive as two events", async () => {
  const chunk =
    JSON.stringify({ type: "meta", conversationId: "c1" }) + "\n" + JSON.stringify({ type: "text", text: "Hi" }) + "\n";
  const events = await collect(streamOf([chunk]));
  assert.deepEqual(events, [
    { type: "meta", conversationId: "c1" },
    { type: "text", text: "Hi" },
  ]);
});

test("readClaraEvents: a trailing line without a newline is still read", async () => {
  const chunk = JSON.stringify({ type: "text", text: "a" }) + "\n" + JSON.stringify({ type: "done", messageId: "m1" });
  const events = await collect(streamOf([chunk]));
  assert.deepEqual(events, [
    { type: "text", text: "a" },
    { type: "done", messageId: "m1" },
  ]);
});

test("readClaraEvents: a malformed line is skipped and blank lines are ignored", async () => {
  const chunk =
    "\n" +
    "{not json\n" +
    "   \n" +
    JSON.stringify({ type: "choices", question: "Swap?", options: ["Yes", "No"] }) +
    "\n" +
    JSON.stringify({ type: "done", messageId: null }) +
    "\n";
  const events = await collect(streamOf([chunk]));
  assert.deepEqual(events, [
    { type: "choices", question: "Swap?", options: ["Yes", "No"] },
    { type: "done", messageId: null },
  ]);
});

test("readClaraEvents: a JSON value that is not an event is skipped", async () => {
  const chunk = "42\n" + JSON.stringify({ nope: true }) + "\n" + JSON.stringify({ type: "text", text: "ok" }) + "\n";
  const events = await collect(streamOf([chunk]));
  assert.deepEqual(events, [{ type: "text", text: "ok" }]);
});

test("readClaraEvents: a multi-byte character split across chunks is not mangled", async () => {
  const bytes = enc.encode(JSON.stringify({ type: "text", text: "café 🌿" }) + "\n");
  const cut = bytes.length - 4; // inside the 4-byte emoji
  const events = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]));
  assert.deepEqual(events, [{ type: "text", text: "café 🌿" }]);
});
