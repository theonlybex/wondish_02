// Shared vocabulary for the Clara skill runtime. No logic lives here — every
// consumer (loop, registry, skills, route) imports its shapes from this file
// so a skill cycle never has to reach into the loop's internals.
//
// Program spec: docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md

/** Typed handler outcome. Handlers NEVER throw — the model narrates these. */
export type ToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "AMBIGUOUS"
        | "OUT_OF_RANGE"
        | "INVALID_INPUT"
        | "NEEDS_PREMIUM"
        | "CONFIRM_REQUIRED"
        | "FAILED";
      message: string;
    };

/** Anthropic tool definition. `input_schema` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  /**
   * S3 structural confirm guard: the loop refuses to execute a flagged tool
   * when the request history holds no assistant turn (nothing can have been
   * proposed+confirmed yet). Every write tool MUST set this.
   */
  isWrite?: boolean;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Everything a handler may know about the caller. `patientId` is resolved from
 * Clerk auth by the route — no tool input may carry an identity field.
 */
export interface ClaraContext {
  patientId: string;
  accountId: string;
  firstName: string;
  isPremium: boolean;
  /**
   * "YYYY-MM-DD" — the caller's local today (lib/clara/dates.ts). ALWAYS a
   * usable date, because handlers need one; but when the client sent none this
   * is server-derived and the system prompt deliberately asserts NO date. A
   * future date-using skill must therefore treat this as the authority and not
   * assume the model was told the same day.
   */
  today: string;
  surface: "web" | "ios" | "unknown";
  /**
   * Product skills that are registered but switched off by CLARA_SKILLS. The
   * server is the only party that can tell "never built" from "built but
   * disabled" — the model sees the same absence either way.
   */
  disabledSkills: readonly string[];
}

export interface SkillTool {
  def: ToolDef;
  /**
   * `toolUseId` is the model's tool-call id, forwarded by the loop (S1
   * amendment). Write handlers derive a dedupe key from it ("clara:<id>").
   * HONEST SCOPE: this dedupes an exact tool-call replay only — a user
   * re-sending "yes" after a dropped stream produces a NEW id and a second
   * row. Cross-retry idempotency would need a content-derived key; not built.
   */
  handler: (
    ctx: ClaraContext,
    input: Record<string, unknown>,
    toolUseId?: string
  ) => Promise<ToolResult>;
}

export interface Skill {
  /** Registry key and CLARA_SKILLS token, e.g. "profile". */
  name: string;
  /** Appended to the system prompt only when this skill is active. */
  promptFragment: string;
  tools: SkillTool[];
}

// ─── ModelClient port ────────────────────────────────────────────────────────
// The loop talks to this, never to the Anthropic SDK, so every loop path is
// unit-testable with a scripted stub and zero network.

export type ModelContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  // Thinking blocks pass through VERBATIM (signature included): with thinking
  // enabled, the API requires the thinking block that preceded a tool_use to be
  // replayed in the assistant turn, or the follow-up round is rejected. They
  // are never streamed to the user — only text deltas are.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ModelContentBlock[];
}

export interface ModelRoundRequest {
  system: string;
  messages: ModelMessage[];
  /** Empty array ⇒ the model cannot call tools this round (forced final answer). */
  tools: ToolDef[];
}

/**
 * Text deltas stream as they arrive (that is what reaches the user); the single
 * terminal `end` event carries the round's AUTHORITATIVE assistant content and
 * stop reason.
 *
 * The loop must replay `end.content` verbatim rather than rebuilding the turn
 * from deltas: one delta is not one content block, and a message of
 * [text, tool_use, text] would otherwise be replayed reordered and split into
 * dozens of blocks — some of them empty or whitespace-only, which the API
 * rejects. `stopReason` is how the loop learns a round was truncated by
 * max_tokens, whose tool inputs are partially-parsed and must not be executed.
 */
export type ModelRoundEvent =
  | { type: "text"; text: string }
  | { type: "end"; content: ModelContentBlock[]; stopReason: string | null };

export interface ModelClient {
  /**
   * Awaiting this performs the connect (mirrors `stream.withResponse()`), so
   * round-1 connection errors surface BEFORE the route commits to a 200.
   */
  openRound(req: ModelRoundRequest): Promise<AsyncIterable<ModelRoundEvent>>;
}
