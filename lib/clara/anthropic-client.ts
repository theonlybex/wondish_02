import type Anthropic from "@anthropic-ai/sdk";
import type {
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
} from "./types";

// 2026-09-10 (user-directed): Clara chat runs on Haiku like every other
// Anthropic surface — tiers differ in availability (lib/ai-budget.ts), not
// model. Haiku 4.5 does no thinking unless asked; `thinking` stays omitted.
export const CLARA_MODEL = "claude-haiku-4-5";
/**
 * 2048, up from the pre-runtime 1024 (AMENDMENT 2026-07-31, user-directed):
 * adaptive thinking is now on, and thinking tokens count against max_tokens —
 * at 1024 a round could burn its whole budget thinking and truncate the
 * tool call, which the loop then (correctly) refuses to execute.
 */
export const CLARA_MAX_TOKENS = 2048;

/**
 * One round's token counts. `input_tokens` is the UNCACHED input only; the two
 * cache fields carry the rest (the system+tools prefix is cache-marked), so a
 * cost estimate must add all three or it undercounts.
 */
export interface ClaraUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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
export function createAnthropicClient(
  anthropic: Anthropic,
  /**
   * Optional per-round token counts, read from the final message's `usage`.
   * Omitted ⇒ no behaviour change. Used by the cost-measurement script.
   */
  onUsage?: (u: ClaraUsage) => void
): ModelClient {
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
        // Strip runtime-only metadata (isWrite, and whatever flags come later)
        // at the wire boundary: the Messages API rejects unknown tool keys, so
        // a leaked flag would 400 every request whose toolbox carries it.
        ...(req.tools.length > 0
          ? {
              tools: req.tools.map(({ name, description, input_schema }) => ({
                name,
                description,
                input_schema,
              })),
            }
          : {}),
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
        if (onUsage && final.usage) {
          onUsage({
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
          });
        }
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
