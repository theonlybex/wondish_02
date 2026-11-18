// The saved-chat Clara turn behind POST /api/clara/chat (spec §2, §3, §3a, §4).
// Everything with an effect is injected (store, memory, model client, today's
// plan), so every path — including the confirm rule — is unit-tested with
// fakes. The route stays a thin shell: auth, burst limit, body, spend, stream.
import { MAX_MESSAGE_CHARS } from "@/lib/chat-history";
import { buildFoodMapText, type FoodMapPatient } from "@/lib/food-map";
import { claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";
import { startClaraLoop, MID_STREAM_FALLBACK, TOOL_THREW_MESSAGE } from "./loop";
import { ALL_SKILLS, resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool } from "./registry";
import { memorySkill, buildMemoryBlock, type MemoryDeps } from "./skills/memory";
import { askChoicesSkill, ASK_CHOICES_TOOL } from "./ask-choices";
import { resolveToday } from "./dates";
import { detectIntent, mealForLocalMinutes } from "./intent";
import { buildTodaysPlanText } from "./today-plan";
import type { ConversationStore, ToolTraceEntry } from "./conversations";
import type { ClaraRequestOptions } from "./request";
import type { ClaraEvent } from "./ndjson";
import { partAsText, type ClaraPart } from "./parts";
import {
  inPhotoFlow,
  isLogAnswer,
  parsePhoto,
  photoContent,
  photoFollowUpInstructions,
  photoInstructions,
  photoReplayText,
  photoStoredText,
  type ClaraPhoto,
} from "./photo";
import type { ClaraChoices, ClaraContext, ModelClient, ModelMessage, Skill, ToolResult } from "./types";

/** Tool rounds on this route: the same for every tier (spec §2). */
export const CLARA_APP_TOOL_ROUNDS = 5;

/** At most this many executed calls are saved per assistant turn (the first ones). */
export const TOOL_TRACE_MAX_CALLS = 8;
/** Each saved `input` and `result` JSON string is cut to this many characters. */
export const TOOL_TRACE_MAX_CHARS = 600;

/**
 * Cut by code points, not UTF-16 units: a lone surrogate at the cut would be
 * rejected when the row is saved as JSONB (same reason as titleFrom).
 */
function cutForTrace(json: string): string {
  if (json.length <= TOOL_TRACE_MAX_CHARS) return json;
  const chars = Array.from(json);
  return chars.length <= TOOL_TRACE_MAX_CHARS ? json : chars.slice(0, TOOL_TRACE_MAX_CHARS).join("");
}

/** JSON.stringify, but never throws and never yields undefined. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

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
  /**
   * Called when the intent router forced a tool. Never carries user content:
   * the tool, and whether the router read a `wants`. Defaults to a console.info line.
   */
  onIntent?: (e: { tool: string; wants: boolean }) => void;
  /** Called when the answer-box conversion round ran (no user content). Defaults to a console.info line. */
  onConversion?: (e: { produced: boolean; ms: number }) => void;
  /** The clock, for the meal that fits the person's local time. Defaults to the real one. */
  now?: () => Date;
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
):
  | { ok: true; message: string; conversationId: string | undefined; parts?: boolean; photo?: ClaraPhoto }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (typeof b.message !== "string") return { ok: false, error: "Invalid message" };
  const message = b.message.trim();
  // Optional photo (lib/clara/photo.ts). A photo may come with no words.
  const photoParse = parsePhoto(b.photo);
  if (!photoParse.ok) return { ok: false, error: photoParse.error };
  const photo = photoParse.photo;
  if (message.length === 0 && !photo) return { ok: false, error: "Invalid message" };
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
  // Optional boolean: the build asks for typed parts. The key is present only
  // when the body sent it, so a body without it parses exactly as before.
  if (b.parts !== undefined) {
    if (typeof b.parts !== "boolean") return { ok: false, error: "Invalid parts" };
    return { ok: true, message, conversationId, parts: b.parts, ...(photo ? { photo } : {}) };
  }
  return { ok: true, message, conversationId, ...(photo ? { photo } : {}) };
}

const DISH_TOOLS = new Set(["dish_suggest", "dish_plan_today"]);

/**
 * The intent router's decision as the loop takes it, or undefined to leave the
 * round to the model:
 *   - cook a named thing / what to eat → dish_suggest (the router's wants as a fill);
 *   - "something else" → dish_suggest, only when this chat already has a dish;
 *   - plan the day → dish_plan_today when they said what today is like,
 *     otherwise the "Anything happening today?" answer boxes come first
 *     (ask_choices, when it is offered) and nothing is planned yet.
 */
export function routeIntent(
  message: string,
  history: ModelMessage[],
  skills: Skill[]
): { tool: string; fill?: Record<string, unknown> } | undefined {
  const intent = detectIntent(message);
  if (!intent) return undefined;
  const offered = (name: string) => findTool(skills, name) !== undefined;
  if (intent.tool === "dish_plan_today") {
    const tool = intent.askFirst ? ASK_CHOICES_TOOL : intent.tool;
    return offered(tool) ? { tool } : undefined;
  }
  if (!offered(intent.tool)) return undefined;
  if (intent.followUp) {
    const hadDish = history.some(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && DISH_TOOLS.has(b.name))
    );
    if (!hadDish) return undefined;
    const shown = dishesShown(history);
    return { tool: intent.tool, ...(shown.length > 0 ? { fill: { avoid: shown } } : {}) };
  }
  return { tool: intent.tool, ...(intent.wants !== undefined ? { fill: { wants: intent.wants } } : {}) };
}

/** The names of the dishes this chat's dish tools already returned, oldest first (from the replayed tool results). */
function dishesShown(history: ModelMessage[]): string[] {
  const dishIds = new Set<string>();
  const names: string[] = [];
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use" && DISH_TOOLS.has(b.name)) dishIds.add(b.id);
      if (b.type !== "tool_result" || !dishIds.has(b.tool_use_id)) continue;
      try {
        const data = (JSON.parse(b.content) as { data?: { dish?: { name?: unknown }; dishes?: { name?: unknown }[] } }).data;
        for (const d of [data?.dish, ...(data?.dishes ?? [])]) if (typeof d?.name === "string" && !names.includes(d.name)) names.push(d.name);
      } catch {
        // A result cut for storage may no longer parse: that dish is simply not listed.
      }
    }
  }
  return names;
}

/**
 * One line of context: the meal that fits the person's local time (from the
 * offset their app sent), and the rule that a dish asked for with no meal
 * named gets that meal instead of a "which meal?" question. A meal, not a
 * clock time, so the cached prompt changes a few times a day, not every minute.
 */
export function mealForNowLine(firstName: string, tzOffsetMinutes: number | undefined, now: Date): string {
  const rule = `When ${firstName} asks for a dish without naming a meal, do not ask which meal:`;
  if (typeof tzOffsetMinutes !== "number") return `${rule} pick the meal that fits the dish, or dinner.`;
  const local = now.getUTCHours() * 60 + now.getUTCMinutes() + tzOffsetMinutes;
  return `Meal for now: ${mealForLocalMinutes(local)} (from ${firstName}'s local time). ${rule} use this meal, unless the dish they ask for clearly belongs to another.`;
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
    /** The build can draw typed parts (body `parts: true`). Omitted ⇒ plain text. */
    parts?: boolean;
    /** A photo sent with this message (lib/clara/photo.ts). */
    photo?: ClaraPhoto;
  }
): Promise<ClaraAppTurnResult> {
  const { patient, account, options } = input;
  const onError = deps.onError ?? ((err: unknown) => console.error("[clara-chat]", err));

  // The route checks this before spending too; this is the service's own floor.
  if (!patient) {
    return { ok: false, status: 409, body: { error: PROFILE_INCOMPLETE_ERROR, code: "PROFILE_INCOMPLETE" } };
  }

  const message = input.message.trim();
  const photo = input.photo;
  // What is saved for the member's row: their words, behind a photo marker
  // when a photo came with them (the photo itself is not stored).
  const storedMessage = photo ? photoStoredText(photo.id, message) : message;
  const surface = options.surface;
  const firstName = account.firstName ?? "there";
  const resolution = resolveToday(options.clientDate, options.tzOffsetMinutes, new Date());
  // A server-derived date is NOT the caller's (see dish-checker): assert a
  // date in the prompt only when they sent one.
  const promptToday = resolution.source === "server" ? null : resolution.localDate;

  // Ownership FIRST: someone else's (or an unknown) id is a 404 with nothing
  // read and nothing written (Review Focus 2). Appends do not re-check.
  let history: { messages: ModelMessage[]; lastAssistantHadChoices: boolean; photoId?: string } = {
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
  // Photo meals (2026-11-14): while a photo's gram questions run, only a log
  // answer ("Log as lunch") is a yes to writing; "Medium, about 180 g" is not.
  // The photo turn itself never writes: Clara asks first.
  const photoFlow = !photo && inPhotoFlow(history.messages);
  const writesAllowed: boolean =
    newest !== undefined &&
    newest.role === "assistant" &&
    history.lastAssistantHadChoices &&
    !photo &&
    (!photoFlow || isLogAnswer(message));

  // Prompt context, read before anything is written so a failure here leaves
  // no orphan user row.
  const [memoryRows, todaysPlanText] = await Promise.all([
    deps.memory.list(patient.id),
    (deps.todaysPlan ?? buildTodaysPlanText)(patient.id, resolution.localDate),
  ]);
  // The memory fragment points at "the memory block above", so it is always
  // present — with an explicit empty state rather than nothing.
  const memoryBlock = buildMemoryBlock(firstName, memoryRows) || `What you remember about ${firstName}\n(nothing saved yet)`;
  const skills = deps.skills;
  const dishOn = skills.some((s) => s.name === "dish");
  // OFF 2026-11 (Clara-first, spec §8.6): with the dish skill on, the context also names the meal for the person's local time, so a dish asked for with no meal named never needs a "which meal?" question. Restore: uncomment this line and delete the lines below it.
  // const extraContext = [todaysPlanText.trim(), memoryBlock].filter((s) => s.length > 0).join("\n\n");
  const extraContext = [
    todaysPlanText.trim(),
    memoryBlock,
    dishOn ? mealForNowLine(firstName, options.tzOffsetMinutes, (deps.now ?? (() => new Date()))()) : "",
    // A photo turn also tells Clara how to read it (and to ask before logging).
    photo ? photoInstructions(firstName) : "",
    // The turns after a photo no longer have it, but its questions go on.
    photoFlow ? photoFollowUpInstructions(firstName) : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  const activeNames = new Set(skills.map((s) => s.name));
  const ctx: ClaraContext = {
    patientId: patient.id,
    accountId: account.id,
    firstName,
    isPremium: input.isPremium,
    today: resolution.localDate,
    surface,
    disabledSkills: ALL_SKILLS.filter((s) => !activeNames.has(s.name)).map((s) => s.name),
    // A meal logged while a photo's questions run is tied to that photo.
    ...(photoFlow && history.photoId ? { photoId: history.photoId } : {}),
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
    // A saved photo row reads back as its replay text (conversations.ts).
    newest.content.trim() === (photo ? photoReplayText(storedMessage) : message);
  let conversationId: string;
  if (input.conversationId !== undefined) {
    conversationId = input.conversationId;
    if (!reuseTrailingUser) await deps.store.appendUser(conversationId, storedMessage, surface);
  } else {
    conversationId = (await deps.store.create(patient.id, storedMessage, surface)).id;
  }

  const runTool = async (name: string, toolInput: Record<string, unknown>, toolUseId: string): Promise<ToolResult> => {
    const tool = findTool(skills, name);
    // Deliberately does not echo the model-supplied name back.
    if (!tool) return { ok: false, reason: "FAILED", message: "That tool does not exist." };
    return tool.handler(ctx, toolInput, toolUseId);
  };

  // Every call that reaches execute is recorded and saved on the assistant
  // row, so the next turn replays it as real tool blocks (conversations.ts
  // history()). Calls the loop answers itself — ask_choices (already saved as
  // `choices`) and writes refused with CONFIRM_REQUIRED — never get here.
  const toolTrace: ToolTraceEntry[] = [];
  const record = (id: string, name: string, toolInput: unknown, result: ToolResult) => {
    if (name === ASK_CHOICES_TOOL || toolTrace.length >= TOOL_TRACE_MAX_CALLS) return;
    // Parts ride on the trace entry of the call that produced them (the only
    // existing JSON column we may use; no client reads it, the model replay
    // ignores the extra key). They are kept out of the cut `result` string.
    const parts = result.ok && result.parts && result.parts.length > 0 ? result.parts : undefined;
    const { parts: _p, ...plain } = result.ok ? result : ({ ...result } as ToolResult & { parts?: never });
    toolTrace.push({
      id,
      name,
      input: cutForTrace(safeJson(toolInput)),
      result: cutForTrace(safeJson(plain)),
      ...(parts ? { parts } : {}),
    });
  };
  const execute = async (name: string, toolInput: Record<string, unknown>, toolUseId: string): Promise<ToolResult> => {
    let result: ToolResult;
    try {
      result = await runTool(name, toolInput, toolUseId);
    } catch (err) {
      // The loop turns a throw into this exact result for the model; record
      // what it will see, then let the loop handle the error as before.
      record(toolUseId, name, toolInput, { ok: false, reason: "FAILED", message: TOOL_THREW_MESSAGE });
      throw err;
    }
    record(toolUseId, name, toolInput, result);
    return result;
  };

  // The intent router: a deterministic read of what they typed. Only with the
  // dish skill on, and never on a reply to a question Clara just asked (answer
  // boxes, or a saved reply that ended in a question): that answer is the
  // model's to read.
  const answeringClara =
    newest !== undefined &&
    newest.role === "assistant" &&
    (history.lastAssistantHadChoices || (typeof newest.content === "string" && /\?\s*$/.test(newest.content)));
  // A photo turn is never routed: what is in the picture is the model's to read.
  // Nor are the turns answering its gram questions.
  const forceFirst = dishOn && !answeringClara && !photo && !photoFlow ? routeIntent(message, history.messages, skills) : undefined;
  if (forceFirst) {
    const event = { tool: forceFirst.tool, wants: forceFirst.fill?.wants !== undefined };
    // No user content: the tool and whether a wants was read, nothing else.
    (deps.onIntent ?? ((e) => console.info(`[clara-intent] forced ${e.tool}${e.wants ? " (wants)" : ""}`)))(event);
  }

  // Only records the value — it must never throw inside the loop.
  let choices: ClaraChoices | null = null;
  // Every part the turn's tools produced, in order (stored, and sent as events
  // only to builds that asked).
  const turnParts: ClaraPart[] = [];

  // Round 1 is opened here, before the route commits to a 200, so connect
  // errors still become JSON. No assistant row is written; the conversation id
  // rides along so the client can retry into the same conversation.
  let generator: AsyncGenerator<string>;
  try {
    generator = await startClaraLoop({
      client: deps.client,
      system,
      tools: buildToolDefs(skills),
      // This turn's member message: the photo and words when a photo came
      // (replacing a reused row's replay text), else the words as before.
      messages: photo
        ? [...(reuseTrailingUser ? history.messages.slice(0, -1) : history.messages), { role: "user", content: photoContent(photo, message) }]
        : reuseTrailingUser
          ? history.messages
          : [...history.messages, { role: "user", content: message }],
      maxToolRounds: CLARA_APP_TOOL_ROUNDS,
      execute,
      onError,
      writesAllowed,
      onChoices: (c) => {
        choices = c;
      },
      onPart: (p) => {
        turnParts.push(p);
      },
      partsEnabled: input.parts === true,
      ...(forceFirst ? { forceFirst } : {}),
      // Every question gets answer boxes: a reply that asked in plain text is
      // given them by one short extra round (the loop skips it without the
      // choices skill, after a card, and when the turn already has boxes).
      questionBoxes: true,
      // No user content: whether boxes came out, and the added time.
      onConversion:
        deps.onConversion ?? ((e) => console.info(`[clara-choices] conversion round: ${e.produced ? "choices" : "none"} (${e.ms} ms)`)),
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
    if (input.parts === true) for (const part of turnParts) yield { type: "part", part };
    if (finalChoices) yield { type: "choices", question: finalChoices.question, options: finalChoices.options };

    // Spec §2 / Review Focus 4: a reply that failed before any model text
    // writes NO assistant row (messageId null), so the client offers retry.
    // Partial text + the fallback is saved as it stands.
    const failedBeforeText = fellBack && !modelText;
    let messageId: string | null = null;
    // A reply that is only parts (the model said nothing) is saved as the
    // parts written out, so a reopened chat is never blank on any build.
    if (text.length === 0 && turnParts.length > 0 && !failedBeforeText) {
      text = turnParts.map(partAsText).join("\n\n");
    }
    if (text.length > 0 && !failedBeforeText) {
      try {
        messageId = (
          await deps.store.appendAssistant(conversationId, text, finalChoices, surface, toolTrace.length > 0 ? toolTrace : null)
        ).id;
      } catch (err) {
        onError(err);
      }
    }
    yield { type: "done", messageId };
  }

  return { ok: true, conversationId, events: events() };
}
