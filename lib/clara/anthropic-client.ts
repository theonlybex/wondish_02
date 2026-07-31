import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest } from "./types";

export const CLARA_MODEL = "claude-sonnet-5";
export const CLARA_MAX_TOKENS = 1024;

/**
 * The ONLY Anthropic-aware file in the runtime. Adapts the SDK's streaming
 * message API to the ModelClient port so every loop path stays unit-testable.
 *
 * `cache_control` on the system block marks the stable system+tools prefix as
 * cacheable — with an always-on toolbox that prefix is identical on every round
 * and every turn, which is what keeps the always-on strategy affordable
 * (spec §4.2).
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
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }
        // tool_use inputs stream as partial JSON deltas, so a call is only
        // complete once the message is: read them off the accumulated message.
        const final = await stream.finalMessage();
        for (const block of final.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
            };
          }
        }
      })();
    },
  };
}
