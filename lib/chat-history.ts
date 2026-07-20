export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 20;

/**
 * Normalizes an untrusted chat history payload for the Anthropic Messages API.
 * Returns null when the payload is not an array. The result always starts
 * with a user message (Anthropic rejects leading assistant messages) and is
 * capped to the most recent MAX_MESSAGES entries.
 */
export function sanitizeChatHistory(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;

  const valid = input
    .filter(
      (m): m is { role: string; content: string } =>
        !!m &&
        typeof m === "object" &&
        (m as { role?: unknown }).role !== undefined &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }));

  let recent = valid.slice(-MAX_MESSAGES);
  while (recent.length > 0 && recent[0].role === "assistant") {
    recent = recent.slice(1);
  }
  return recent;
}
