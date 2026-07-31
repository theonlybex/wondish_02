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
      reason: "NOT_FOUND" | "AMBIGUOUS" | "OUT_OF_RANGE" | "INVALID_INPUT" | "NEEDS_PREMIUM" | "FAILED";
      message: string;
    };

/** Anthropic tool definition. `input_schema` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
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
  /** "YYYY-MM-DD" — the caller's local today (lib/clara/dates.ts). */
  today: string;
  surface: "web" | "ios" | "unknown";
}

export interface SkillTool {
  def: ToolDef;
  handler: (ctx: ClaraContext, input: Record<string, unknown>) => Promise<ToolResult>;
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
  | { type: "tool_result"; tool_use_id: string; content: string };

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

export type ModelRoundEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ModelClient {
  /**
   * Awaiting this performs the connect (mirrors `stream.withResponse()`), so
   * round-1 connection errors surface BEFORE the route commits to a 200.
   */
  openRound(req: ModelRoundRequest): Promise<AsyncIterable<ModelRoundEvent>>;
}
