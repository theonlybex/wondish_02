// One more try when the model provider says it is busy.
//
// Clara's chat makes each model round once: a 429 (our rate limit) or a 529
// (the provider is overloaded) went straight to "Clara is busy". Both answers
// come back at once, and at a busy hour many clear within a second, so one
// retry after a short random wait turns most of them into a normal reply.
// Timeouts and connection failures are NOT retried: they have already cost
// the full wait, and a second one could outlive the request.
//
// The wait is random so that a crowd refused in the same instant does not come
// back in the same instant.
import Anthropic from "@anthropic-ai/sdk";
import { claraSignal } from "./signal";
import type { ModelClient } from "./types";

export const BUSY_RETRY_WAIT_MS = { min: 400, max: 1200 } as const;

/** True for the provider's immediate "busy" answers; false for timeouts, connection failures and real errors. */
export function isFastBusy(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return false;
  return err instanceof Anthropic.APIError && (err.status === 429 || err.status === 529);
}

export function withBusyRetry(
  client: ModelClient,
  opts: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): ModelClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = opts.random ?? Math.random;
  return {
    ...client,
    async openRound(req) {
      try {
        return await client.openRound(req);
      } catch (err) {
        if (!isFastBusy(err)) throw err;
        claraSignal("model-busy-retried", `status ${(err as { status?: number }).status}`);
        await sleep(BUSY_RETRY_WAIT_MS.min + random() * (BUSY_RETRY_WAIT_MS.max - BUSY_RETRY_WAIT_MS.min));
        return client.openRound(req);
      }
    },
  };
}
