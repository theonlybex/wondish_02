import type Anthropic from "@anthropic-ai/sdk";
import type {
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
} from "./types";

export const CLARA_MODEL = "claude-sonnet-5";
/**
 * 2048, up from the pre-runtime 1024 (AMENDMENT 2026-07-31, user-directed):
 * adaptive thinking is now on, and thinking tokens count against max_tokens —
 * at 1024 a round could burn its whole budget thinking and truncate the
 * tool call, which the loop then (correctly) refuses to execute.
 */
export const CLARA_MAX_TOKENS = 2048;

/**
 * The ONLY Anthropic-aware file in the runtime. Adapts the SDK's streaming
 * message API to the ModelClient port so every loop path stays unit-testable.
 *
 * `cache_control` on the system block marks the system+tools prefix as
 * cacheable. The prefix is per-user and per-day, not global — `buildSystemPrompt`
 * embeds the first name, the food map and the date — so the win is cache reads
 * across the rounds of one turn and across a user's turns that day, not a
 * shared cache. Note also that a prefix below the model's minimum cacheable
 * length (~1024 tokens) simply will not cache: harmless, silent, and likely for
 * the no-toolbox variant.
 */
export function createAnthropicClient(anthropic: Anthropic): ModelClient {
  return {
    async openRound(req: ModelRoundRequest): Promise<AsyncIterable<ModelRoundEvent>> {
      // AMENDMENT 2026-07-31 (user-directed): the `thinking` param is OMITTED,
      // which on Sonnet 5 means ADAPTIVE thinking. This reverses the C6-era
      // "disabled for latency" choice: with thinking off the model is
      // measurably less likely to reach for tools, and tool use is the point
      // of this runtime. Adaptive lets quick turns stay quick while tool
      // decisions get thought.
      const stream = anthropic.messages.stream({
        model: CLARA_MODEL,
        max_tokens: CLARA_MAX_TOKENS,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        ...(req.tools.length > 0 ? { tools: req.tools } : {}),
        messages: req.messages as Anthropic.MessageParam[],
      });

      // Surfaces connect-time errors (429/529/etc) at await time, exactly as the
      // pre-loop route did, so round 1 can still answer with JSON.
      await stream.withResponse();

      return (async function* () {
        let drained = false;
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              yield { type: "text", text: event.delta.text };
            }
          }
          drained = true;
        } finally {
          // Abort ONLY on early exit — a client disconnect abandons this
          // generator mid-iteration. Aborting after a clean drain would break
          // the finalMessage() call below. The SDK's iterator return() happens
          // to abort today, but stating it here keeps the teardown guarantee
          // local instead of resting on an implementation detail.
          if (!drained && !stream.aborted) stream.abort();
        }
        // The accumulated message is the authoritative record of the round:
        // tool_use inputs stream as partial JSON deltas and are only complete
        // here, and the block list preserves real order and grouping (deltas
        // do not). The loop replays this content verbatim.
        const final = await stream.finalMessage();
        const content: ModelContentBlock[] = [];
        for (const block of final.content) {
          if (block.type === "text") {
            content.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            content.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
            });
          } else if (block.type === "thinking") {
            // Replayed verbatim, signature included: with thinking enabled the
            // API rejects a tool_use follow-up whose assistant turn lost the
            // thinking block that preceded it. Never streamed to the user.
            content.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
          } else if (block.type === "redacted_thinking") {
            content.push({ type: "redacted_thinking", data: block.data });
          }
          // Any genuinely unknown block kind is still dropped — replaying a
          // shape we don't understand risks a 400.
        }
        yield { type: "end", content, stopReason: final.stop_reason ?? null };
      })();
    },
  };
}
