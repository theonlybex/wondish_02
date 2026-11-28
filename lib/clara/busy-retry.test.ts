import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { BUSY_RETRY_WAIT_MS, isFastBusy, withBusyRetry } from "./busy-retry";
import { resetClaraSignalThrottle, setClaraSignalReporter } from "./signal";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest } from "./types";

const apiError = (status: number) => new Anthropic.APIError(status, { type: "error" }, `status ${status}`, new Headers());
const REQ = { system: "s", messages: [], tools: [] } as unknown as ModelRoundRequest;
const ok = async function* (): AsyncGenerator<ModelRoundEvent> {
  yield { type: "end", content: [], stopReason: null } as ModelRoundEvent;
};

function client(fails: unknown[]) {
  let calls = 0;
  const c: ModelClient = {
    async openRound() {
      calls++;
      const err = fails.shift();
      if (err) throw err;
      return ok();
    },
  };
  return { c, calls: () => calls };
}

test("a busy answer is tried once more after a short random wait, and the second answer stands", async () => {
  const waits: number[] = [];
  const seen: string[] = [];
  const before = setClaraSignalReporter((kind) => seen.push(kind));
  resetClaraSignalThrottle();
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const status of [429, 529]) {
      const { c, calls } = client([apiError(status)]);
      const stream = await withBusyRetry(c, { sleep: async (ms) => void waits.push(ms), random: () => 0.5 }).openRound(REQ);
      assert.ok(stream);
      assert.equal(calls(), 2);
    }
    assert.deepEqual(waits, [800, 800]);
    assert.ok(waits.every((w) => w >= BUSY_RETRY_WAIT_MS.min && w <= BUSY_RETRY_WAIT_MS.max));
    assert.deepEqual(seen, ["model-busy-retried"]); // the second one is inside the reporting minute
  } finally {
    console.warn = warn;
    setClaraSignalReporter(before);
    resetClaraSignalThrottle();
  }
});

test("busy twice is still busy: the second error is the one thrown, after exactly two tries", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const second = apiError(529);
    const { c, calls } = client([apiError(529), second]);
    await assert.rejects(() => withBusyRetry(c, { sleep: async () => {} }).openRound(REQ), (e) => e === second);
    assert.equal(calls(), 2);
  } finally {
    console.warn = warn;
    resetClaraSignalThrottle();
  }
});

test("a timeout, a connection failure and a real error are never retried", async () => {
  const timeout = new Anthropic.APIConnectionTimeoutError({ message: "timed out" });
  const reset = new Anthropic.APIConnectionError({ message: "reset" });
  const bad = apiError(400);
  assert.deepEqual([timeout, reset, bad, new Error("bug")].map(isFastBusy), [false, false, false, false]);
  for (const err of [timeout, reset, bad]) {
    const { c, calls } = client([err]);
    await assert.rejects(() => withBusyRetry(c, { sleep: async () => assert.fail("must not wait") }).openRound(REQ), (e) => e === err);
    assert.equal(calls(), 1);
  }
});
