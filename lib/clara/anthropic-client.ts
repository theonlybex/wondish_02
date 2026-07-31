import type Anthropic from "@anthropic-ai/sdk";
import type {
  ModelClient,
  ModelContentBlock,
  ModelRoundEvent,
  ModelRoundRequest,
} from "./types";

export const CLARA_MODEL = "claude-sonnet-5";
export const CLARA_MAX_TOKENS = 1024;

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
      const stream = anthropic.messages.stream({
        model: CLARA_MODEL,
        max_tokens: CLARA_MAX_TOKENS,
        // Sonnet 5 defaults to adaptive thinking when omitted; chat latency wants it off (C6).
        thinking: { type: "disabled" },
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
          }
          // Any other block kind (e.g. thinking) is deliberately dropped:
          // thinking is disabled, and replaying unknown blocks risks a 400.
        }
        yield { type: "end", content, stopReason: final.stop_reason ?? null };
      })();
    },
  };
}
