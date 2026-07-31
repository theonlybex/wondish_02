import type { ModelClient, ModelContentBlock, ModelMessage, ToolDef, ToolResult } from "./types";

export interface LoopParams {
  client: ModelClient;
  system: string;
  tools: ToolDef[];
  /** The sanitized conversation so far. Never contains tool blocks. */
  messages: ModelMessage[];
  maxToolRounds: number;
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Server-side observability for mid-stream failures. */
  onError?: (err: unknown) => void;
}

/** What the user sees when a round fails after the response already started. */
export const MID_STREAM_FALLBACK =
  " Sorry — I lost my train of thought there. Could you ask me that again?";

/**
 * Runs Clara's bounded tool-use loop.
 *
 * Round 1 is opened eagerly (awaited) so a connect failure rejects BEFORE the
 * route commits to a 200 text/plain response — that is what preserves today's
 * JSON error bodies for 429/503/500. Every later round runs inside the
 * generator, where the response is already streaming and failures can only be
 * narrated as prose.
 *
 * Budget: `maxToolRounds` rounds may call tools. When it is spent the loop runs
 * one more round with an empty tools array, so the model must answer with what
 * it has instead of dangling on a tool call it cannot make.
 */
export async function startClaraLoop(params: LoopParams): Promise<AsyncGenerator<string>> {
  // Copy: the caller's history array is theirs, and the loop appends to its own.
  const messages: ModelMessage[] = [...params.messages];

  const firstRound = await params.client.openRound({
    system: params.system,
    messages,
    tools: params.tools,
  });

  async function* run(): AsyncGenerator<string> {
    let stream = firstRound;
    let toolRoundsUsed = 0;

    for (;;) {
      const assistant: ModelContentBlock[] = [];
      const calls: { id: string; name: string; input: Record<string, unknown> }[] = [];

      try {
        for await (const event of stream) {
          if (event.type === "text") {
            assistant.push({ type: "text", text: event.text });
            yield event.text;
          } else {
            assistant.push({ type: "tool_use", id: event.id, name: event.name, input: event.input });
            calls.push({ id: event.id, name: event.name, input: event.input });
          }
        }
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }

      if (calls.length === 0) return;

      messages.push({ role: "assistant", content: assistant });

      const results: ModelContentBlock[] = [];
      for (const call of calls) {
        let result: ToolResult;
        try {
          result = await params.execute(call.name, call.input);
        } catch (err) {
          // A handler that throws is a bug, not a user-facing event: log it and
          // hand the model a narratable result so the turn still completes.
          params.onError?.(err);
          result = { ok: false, reason: "FAILED", message: "The tool did not respond." };
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: results });

      toolRoundsUsed += 1;
      const toolsForNextRound = toolRoundsUsed >= params.maxToolRounds ? [] : params.tools;

      try {
        stream = await params.client.openRound({
          system: params.system,
          messages,
          tools: toolsForNextRound,
        });
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }
    }
  }

  return run();
}
