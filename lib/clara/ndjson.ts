// The /api/clara/chat wire format (spec §2): NDJSON, one JSON object per line.
// meta first, then text deltas, optional part events (only for requests that
// sent `parts: true`), an optional choices event, then done.
import type { ClaraPart } from "./parts";

export type ClaraEvent =
  | { type: "meta"; conversationId: string }
  | { type: "text"; text: string }
  | { type: "part"; part: ClaraPart }
  | { type: "choices"; question: string; options: string[] }
  | { type: "done"; messageId: string | null };

const encoder = new TextEncoder();

/** One event → one line. JSON.stringify escapes newlines, so a line is never split. */
export function encodeEvent(e: ClaraEvent): Uint8Array {
  return encoder.encode(JSON.stringify(e) + "\n");
}
