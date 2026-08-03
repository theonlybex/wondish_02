import type { ModelClient, ModelContentBlock, ModelMessage, ToolDef, ToolResult } from "./types";

export interface LoopParams {
  client: ModelClient;
  system: string;
  tools: ToolDef[];
  /** The sanitized conversation so far. Never contains tool blocks. */
  messages: ModelMessage[];
  maxToolRounds: number;
  execute: (name: string, input: Record<string, unknown>, toolUseId: string) => Promise<ToolResult>;
  /** Server-side observability for mid-stream failures. */
  onError?: (err: unknown) => void;
}

/** What the user sees when a round fails after the response already started. */
export const MID_STREAM_FALLBACK =
  " Sorry — I lost my train of thought there. Could you ask me that again?";

/**
 * A turn that produced no text at all would otherwise return HTTP 200 with a
 * zero-byte body, which both clients render as an empty assistant bubble with
 * no error to show.
 */
export const EMPTY_ANSWER_FALLBACK =
  "Sorry — I couldn't put an answer together just then. Could you ask me that again?";

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

  // S3 structural confirm guard: a first-turn conversation (no assistant turn
  // in the CLIENT-SENT history) cannot contain a proposed+confirmed write —
  // whatever the model thinks. Zero false positives: any real confirm flow has
  // at least one prior assistant message. Checked against params.messages, NOT
  // the loop's growing copy (which gains assistant turns every round).
  const hasPriorAssistantTurn = params.messages.some((m) => m.role === "assistant");

  const firstRound = await params.client.openRound({
    system: params.system,
    messages,
    tools: params.tools,
  });

  async function* run(): AsyncGenerator<string> {
    let stream = firstRound;
    let toolRoundsUsed = 0;
    let emitted = false;

    for (;;) {
      // The assistant turn is taken from the round's terminal event, NEVER
      // rebuilt from deltas: one delta is not one content block, empty and
      // whitespace-only blocks are rejected by the API, and delta order does
      // not preserve real block order.
      let assistant: ModelContentBlock[] = [];
      let stopReason: string | null = null;

      try {
        for await (const event of stream) {
          if (event.type === "text") {
            if (event.text.length > 0) emitted = true;
            yield event.text;
          } else {
            assistant = event.content;
            stopReason = event.stopReason;
          }
        }
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }

      const calls = assistant.filter(
        (b): b is Extract<ModelContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      // A round truncated by max_tokens has partially-parsed tool inputs — the
      // SDK accumulates input_json_delta without throwing, so a truncated call
      // looks valid. Executing it would act on half-read arguments. Stop and
      // let whatever prose was produced stand.
      if (stopReason === "max_tokens" && calls.length > 0) {
        params.onError?.(new Error("clara loop: round truncated by max_tokens, tool calls dropped"));
        if (!emitted) yield EMPTY_ANSWER_FALLBACK;
        return;
      }

      if (calls.length === 0) {
        if (!emitted) yield EMPTY_ANSWER_FALLBACK;
        return;
      }

      // HARD STOP. Passing `tools: []` only *asks* the model not to call tools;
      // it does not make it impossible. Without this the loop would keep
      // executing and re-opening rounds forever on a client that ignores it —
      // an unbounded spend loop in a paid path, guarded only by a remote
      // service's good behaviour. The budget is enforced here, locally.
      if (toolRoundsUsed >= params.maxToolRounds) {
        params.onError?.(
          new Error("clara loop: tool_use returned after the round budget was spent")
        );
        if (!emitted) yield EMPTY_ANSWER_FALLBACK;
        return;
      }

      messages.push({ role: "assistant", content: assistant });

      const results: ModelContentBlock[] = [];
      const seenCallIds = new Set<string>();
      for (const call of calls) {
        // Two tool_result blocks sharing one tool_use_id is a 400 on the next
        // round; drop the duplicate rather than poison the turn.
        if (seenCallIds.has(call.id)) continue;
        seenCallIds.add(call.id);
        let result: ToolResult;
        const def = params.tools.find((t) => t.name === call.name);
        if (def?.isWrite && !hasPriorAssistantTurn) {
          result = {
            ok: false,
            reason: "CONFIRM_REQUIRED",
            message:
              "This change needs the user's explicit confirmation first. Propose it in plain words and wait for their yes.",
          };
        } else {
          try {
            result = await params.execute(call.name, call.input, call.id);
          } catch (err) {
            // A handler that throws is a bug, not a user-facing event: log it and
            // hand the model a narratable result so the turn still completes.
            params.onError?.(err);
            result = { ok: false, reason: "FAILED", message: "The tool did not respond." };
          }
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
