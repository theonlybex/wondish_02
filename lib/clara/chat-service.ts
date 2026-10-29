// The saved-chat Clara turn behind POST /api/clara/chat (spec §2, §3, §3a, §4).
// Everything with an effect is injected (store, memory, model client, today's
// plan), so every path — including the confirm rule — is unit-tested with
// fakes. The route stays a thin shell: auth, burst limit, body, spend, stream.
import { MAX_MESSAGE_CHARS } from "@/lib/chat-history";
import { buildFoodMapText, type FoodMapPatient } from "@/lib/food-map";
import { claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";
import { startClaraLoop, MID_STREAM_FALLBACK } from "./loop";
import { ALL_SKILLS, resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool } from "./registry";
import { memorySkill, buildMemoryBlock, type MemoryDeps } from "./skills/memory";
import { askChoicesSkill } from "./ask-choices";
import { resolveToday } from "./dates";
import { buildTodaysPlanText } from "./today-plan";
import type { ConversationStore } from "./conversations";
import type { ClaraRequestOptions } from "./request";
import type { ClaraEvent } from "./ndjson";
import type { ClaraChoices, ClaraContext, ModelClient, ModelMessage, Skill, ToolResult } from "./types";

/** Tool rounds on this route: the same for every tier (spec §2). */
export const CLARA_APP_TOOL_ROUNDS = 5;

export const PROFILE_INCOMPLETE_ERROR = "Finish setting up your profile to chat with Clara.";
const UNAVAILABLE_ERROR = "Clara is unavailable right now";

export type ClaraAppPatient = FoodMapPatient & { id: string };
export interface ClaraAppAccount {
  id: string;
  firstName: string | null;
}

export interface ChatServiceDeps {
  store: ConversationStore;
  /** Reads the memory block for the prompt. The memory TOOLS come in via `skills`. */
  memory: MemoryDeps;
  client: ModelClient;
  /** The full toolbox for this turn — the route passes `claraAppSkills(...)`. */
  skills: Skill[];
  /** Today's plan text for the prompt. Defaults to the Prisma-backed builder. */
  todaysPlan?: (patientId: string, localDate: string) => Promise<string>;
  /** Server-side observability. Defaults to console.error. */
  onError?: (err: unknown) => void;
}

export type ClaraAppTurnResult =
  | { ok: false; status: number; body: object }
  | { ok: true; conversationId: string; events: AsyncGenerator<ClaraEvent> };

/**
 * This route's toolbox: product skills filtered by CLARA_SKILLS (gap_report is
 * appended by resolveActiveSkills and cannot be switched off), plus memory and
 * ask_choices, which are always on — even under the empty-string kill switch.
 */
export function claraAppSkills(envValue: string | undefined): Skill[] {
  return [...resolveActiveSkills(ALL_SKILLS, envValue), memorySkill, askChoicesSkill];
}

/**
 * Body validation, before any spend. `message` is trimmed and must be 1–4,000
 * characters (an empty message would also give titleFrom ""). `conversationId`
 * is optional but, when present, a non-empty string. `clientDate`,
 * `tzOffsetMinutes` and `surface` are parsed leniently by parseClaraRequestOptions.
 */
export function parseClaraChatBody(
  body: unknown
): { ok: true; message: string; conversationId: string | undefined } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (typeof b.message !== "string") return { ok: false, error: "Invalid message" };
  const message = b.message.trim();
  if (message.length === 0) return { ok: false, error: "Invalid message" };
  if (message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `A message can be at most ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` };
  }
  let conversationId: string | undefined;
  if (b.conversationId !== undefined) {
    if (typeof b.conversationId !== "string" || b.conversationId.trim().length === 0) {
      return { ok: false, error: "Invalid conversationId" };
    }
    conversationId = b.conversationId.trim();
  }
  return { ok: true, message, conversationId };
}

export async function startClaraAppTurn(
  deps: ChatServiceDeps,
  input: {
    patient: ClaraAppPatient | null;
    account: ClaraAppAccount;
    isPremium: boolean;
    conversationId?: string;
    message: string;
    options: ClaraRequestOptions;
  }
): Promise<ClaraAppTurnResult> {
  const { patient, account, options } = input;
  const onError = deps.onError ?? ((err: unknown) => console.error("[clara-chat]", err));

  // The route checks this before spending too; this is the service's own floor.
  if (!patient) {
    return { ok: false, status: 409, body: { error: PROFILE_INCOMPLETE_ERROR, code: "PROFILE_INCOMPLETE" } };
  }

  const message = input.message.trim();
  const surface = options.surface;
  const firstName = account.firstName ?? "there";
  const resolution = resolveToday(options.clientDate, options.tzOffsetMinutes, new Date());
  // A server-derived date is NOT the caller's (see dish-checker): assert a
  // date in the prompt only when they sent one.
  const promptToday = resolution.source === "server" ? null : resolution.localDate;

  // Ownership FIRST: someone else's (or an unknown) id is a 404 with nothing
  // read and nothing written (Review Focus 2). Appends do not re-check.
  let history: { messages: ModelMessage[]; lastAssistantHadChoices: boolean } = {
    messages: [],
    lastAssistantHadChoices: false,
  };
  if (input.conversationId !== undefined) {
    if (!(await deps.store.owned(input.conversationId, patient.id))) {
      return { ok: false, status: 404, body: { error: "Conversation not found" } };
    }
    // Loaded BEFORE this turn's user message is appended: the confirm rule is
    // about what was saved before the member's reply.
    history = await deps.store.history(input.conversationId);
  }

  // Spec §3a: writes run only on the turn DIRECTLY after a saved assistant
  // message that ended in answer boxes. "Directly" means that message is the
  // newest saved row overall — an unanswered user row after it (a retry after
  // a dropped stream) or a brand-new conversation both mean false. Always an
  // explicit boolean: undefined would fall back to the loop's weaker
  // first-turn guard.
  const newest = history.messages.at(-1);
  const writesAllowed: boolean = newest !== undefined && newest.role === "assistant" && history.lastAssistantHadChoices;

  // Prompt context, read before anything is written so a failure here leaves
  // no orphan user row.
  const [memoryRows, todaysPlanText] = await Promise.all([
    deps.memory.list(patient.id),
    (deps.todaysPlan ?? buildTodaysPlanText)(patient.id, resolution.localDate),
  ]);
  // The memory fragment points at "the memory block above", so it is always
  // present — with an explicit empty state rather than nothing.
  const memoryBlock = buildMemoryBlock(firstName, memoryRows) || `What you remember about ${firstName}\n(nothing saved yet)`;
  const extraContext = [todaysPlanText.trim(), memoryBlock].filter((s) => s.length > 0).join("\n\n");

  const skills = deps.skills;
  const activeNames = new Set(skills.map((s) => s.name));
  const ctx: ClaraContext = {
    patientId: patient.id,
    accountId: account.id,
    firstName,
    isPremium: input.isPremium,
    today: resolution.localDate,
    surface,
    disabledSkills: ALL_SKILLS.filter((s) => !activeNames.has(s.name)).map((s) => s.name),
  };
  const system = buildSystemPrompt(firstName, buildFoodMapText(patient), skills, promptToday, "assistant", extraContext);

  // Save what the member typed BEFORE the model runs: a dropped stream never
  // loses it (Review Focus 4).
  //
  // Retry de-duplication (ruling R10): when the newest saved row is a user
  // message with the same trimmed text — a retry after a turn that failed
  // before any model text — that row is reused rather than saved twice, and
  // the model sees it once. writesAllowed above was computed from the history
  // as it stood, so a reused row after answer boxes still refuses writes.
  const reuseTrailingUser =
    newest !== undefined &&
    newest.role === "user" &&
    typeof newest.content === "string" &&
    newest.content.trim() === message;
  let conversationId: string;
  if (input.conversationId !== undefined) {
    conversationId = input.conversationId;
    if (!reuseTrailingUser) await deps.store.appendUser(conversationId, message, surface);
  } else {
    conversationId = (await deps.store.create(patient.id, message, surface)).id;
  }

  const execute = async (name: string, toolInput: Record<string, unknown>, toolUseId: string): Promise<ToolResult> => {
    const tool = findTool(skills, name);
    // Deliberately does not echo the model-supplied name back.
    if (!tool) return { ok: false, reason: "FAILED", message: "That tool does not exist." };
    return tool.handler(ctx, toolInput, toolUseId);
  };

  // Only records the value — it must never throw inside the loop.
  let choices: ClaraChoices | null = null;

  // Round 1 is opened here, before the route commits to a 200, so connect
  // errors still become JSON. No assistant row is written; the conversation id
  // rides along so the client can retry into the same conversation.
  let generator: AsyncGenerator<string>;
  try {
    generator = await startClaraLoop({
      client: deps.client,
      system,
      tools: buildToolDefs(skills),
      messages: reuseTrailingUser ? history.messages : [...history.messages, { role: "user", content: message }],
      maxToolRounds: CLARA_APP_TOOL_ROUNDS,
      execute,
      onError,
      writesAllowed,
      onChoices: (c) => {
        choices = c;
      },
    });
  } catch (err) {
    onError(err);
    const busy = claraBusyStatus(err);
    if (busy) return { ok: false, status: busy, body: { error: CLARA_BUSY_MESSAGE, conversationId } };
    return { ok: false, status: 500, body: { error: UNAVAILABLE_ERROR, conversationId } };
  }

  async function* events(): AsyncGenerator<ClaraEvent> {
    yield { type: "meta", conversationId };
    let text = "";
    // Whether the model itself produced any text. The loop yields
    // MID_STREAM_FALLBACK as its own chunk when a round's stream throws or a
    // later round fails to connect — also when nothing was emitted before it
    // (an overloaded_error during thinking, a round-2 connect failure after a
    // tool-only round 1). That chunk is not model text.
    let modelText = false;
    let fellBack = false;
    try {
      // The loop narrates its own failures and never ends without text; this
      // catch is only for a bug that escapes it.
      for await (const chunk of generator) {
        if (chunk.length === 0) continue;
        if (chunk === MID_STREAM_FALLBACK) fellBack = true;
        else if (chunk.trim().length > 0) modelText = true;
        text += chunk;
        yield { type: "text", text: chunk };
      }
    } catch (err) {
      onError(err);
      fellBack = true;
      text += MID_STREAM_FALLBACK;
      yield { type: "text", text: MID_STREAM_FALLBACK };
    }
    // The generator is fully drained here, so `choices` is final.
    const finalChoices = choices as ClaraChoices | null;
    if (finalChoices) yield { type: "choices", question: finalChoices.question, options: finalChoices.options };

    // Spec §2 / Review Focus 4: a reply that failed before any model text
    // writes NO assistant row (messageId null), so the client offers retry.
    // Partial text + the fallback is saved as it stands.
    const failedBeforeText = fellBack && !modelText;
    let messageId: string | null = null;
    if (text.length > 0 && !failedBeforeText) {
      try {
        messageId = (await deps.store.appendAssistant(conversationId, text, finalChoices, surface)).id;
      } catch (err) {
        onError(err);
      }
    }
    yield { type: "done", messageId };
  }

  return { ok: true, conversationId, events: events() };
}
