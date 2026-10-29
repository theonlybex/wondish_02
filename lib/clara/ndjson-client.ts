import type { ClaraEvent } from "./ndjson";

// Client side of the /api/clara/chat wire format: NDJSON, one event per line.
// Network chunks do not respect line boundaries, so bytes are buffered until a
// newline arrives. Blank lines are ignored and a line that is not a valid
// event is skipped, so one bad line never ends the reply.

function toEvent(line: string): ClaraEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  switch (e.type) {
    case "meta":
      return typeof e.conversationId === "string" ? { type: "meta", conversationId: e.conversationId } : null;
    case "text":
      return typeof e.text === "string" ? { type: "text", text: e.text } : null;
    case "choices":
      return typeof e.question === "string" &&
        Array.isArray(e.options) &&
        e.options.every((o) => typeof o === "string")
        ? { type: "choices", question: e.question, options: e.options as string[] }
        : null;
    case "done":
      return typeof e.messageId === "string" || e.messageId === null
        ? { type: "done", messageId: e.messageId as string | null }
        : null;
    default:
      return null;
  }
}

export async function* readClaraEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ClaraEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      // A multi-byte character split across chunks stays in the decoder until
      // the next chunk (or the final flush) completes it.
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = toEvent(line);
        if (event) yield event;
      }
      if (done) break;
    }
    // The last line may arrive without its newline.
    const rest = buffer.trim();
    if (rest) {
      const event = toEvent(rest);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
