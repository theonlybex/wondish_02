import type {
  ClaraChoices,
  ModelClient,
  ModelContentBlock,
  ModelMessage,
  ToolDef,
  ToolResult,
} from "./types";
import { partAsText, type ClaraPart } from "./parts";
import { ASK_CHOICES_INVALID_MESSAGE, ASK_CHOICES_MAX_QUESTION_CHARS, ASK_CHOICES_TOOL, parseChoices } from "./ask-choices";
import { asksAlready, finalQuestion } from "./question";

export interface LoopParams {
  client: ModelClient;
  system: string;
  tools: ToolDef[];
  /**
   * The conversation so far. Saved chats may replay earlier turns' completed
   * tool calls as tool_use/tool_result pairs (without thinking blocks).
   */
  messages: ModelMessage[];
  maxToolRounds: number;
  execute: (name: string, input: Record<string, unknown>, toolUseId: string) => Promise<ToolResult>;
  /** Server-side observability for mid-stream failures. */
  onError?: (err: unknown) => void;
  /**
   * Explicit confirm guard (spec §3a). When set, it REPLACES the first-turn
   * `hasPriorAssistantTurn` check for `isWrite` tools: true lets writes run,
   * false refuses them with CONFIRM_REQUIRED whatever the history holds.
   * Omitted ⇒ the first-turn guard (what dish-checker relies on).
   */
  writesAllowed?: boolean;
  /**
   * Called once when a round ends the turn with answer boxes (`ask_choices`),
   * after the question has been streamed as text. Only fires when the caller
   * offers the ask_choices tool.
   */
  onChoices?: (choices: ClaraChoices) => void;
  /**
   * Called for every part a tool result carried, as it is executed (always,
   * so the caller can store them). Whether the member's build gets them as
   * events is the caller's call; `partsEnabled` only decides the text.
   */
  onPart?: (part: ClaraPart) => void;
  /**
   * true ⇒ the client draws parts itself, so no text is added. false/omitted ⇒
   * each part is written out with partAsText() at the end of the reply, so an
   * old build never shows a blank or part-less answer.
   */
  partsEnabled?: boolean;
  /**
   * The intent router's decision (lib/clara/intent.ts): force this tool on the
   * FIRST round only. The model still writes the arguments; `fill` supplies an
   * argument it left out or left empty (the router's `wants`), never one it
   * gave. Ignored when the tool is not in `tools`. Later rounds are unforced.
   */
  forceFirst?: { tool: string; fill?: Record<string, unknown> };
  /**
   * true ⇒ a reply that ends in plain text with a question to the person gets
   * answer boxes: ONE extra short round forces ask_choices for likely answers
   * (see convertQuestion). Needs the ask_choices tool in `tools`. Omitted ⇒
   * the turn ends exactly as it always did.
   */
  questionBoxes?: boolean;
  /** How long that extra round may take before it is dropped (CONVERSION_BUDGET_MS when absent). */
  conversionBudgetMs?: number;
  /** Called once when that extra round ran. No user content: whether it produced boxes, and how long it took. */
  onConversion?: (e: { produced: boolean; ms: number }) => void;
}

/** The extra round's time budget: past it the reply stands without boxes. */
export const CONVERSION_BUDGET_MS = 3_000;

/** What the forced round is told, after the reply it is about. */
export const CONVERSION_NOTE =
  "(Your reply ended with a question. Offer 2 to 4 short likely answers to that question, in the person's own voice, by calling ask_choices with that same question. The app adds \"Other\" itself. Write nothing else.)";

const CONFIRM_REQUIRED_MESSAGE =
  "This change needs the user's explicit confirmation first. Propose it in plain words and wait for their yes.";
const CONFIRM_REQUIRED_WITH_CHOICES_MESSAGE =
  "This change needs the user's explicit confirmation first. Propose it in one sentence, then call ask_choices with a yes and a no option (e.g. \"Yes, swap it\" / \"No, keep it\") and wait for their answer.";

/** Appended after the last tool results once the tool-round budget is spent. */
export const TOOL_BUDGET_SPENT_NOTE =
  "(No more tool calls are possible this turn. Answer now with what you have, without calling any tool.)";

/** The tool_result message the model gets when a handler throws. */
export const TOOL_THREW_MESSAGE = "The tool did not respond.";

/** What the user sees when a round fails after the response already started. */
export const MID_STREAM_FALLBACK =
  " Sorry — I lost my train of thought there. Could you ask me that again?";

/**
 * A turn that produced no text at all would otherwise return HTTP 200 with a
 * zero-byte body, which both clients render as an empty assistant bubble with
 * no error to show.
 */
export const EMPTY_ANSWER_FALLBACK =
  "Sorry — I couldn't put an answer together just then. Could you ask me that again?";

/** The model's own arguments win; only a missing, null or blank one is filled. */
function withFilled(input: Record<string, unknown>, fill: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fill) return input;
  const out = { ...input };
  for (const [key, value] of Object.entries(fill)) {
    const given = out[key];
    if (given === undefined || given === null || (typeof given === "string" && given.trim().length === 0)) out[key] = value;
  }
  return out;
}

/**
 * Runs Clara's bounded tool-use loop.
 *
 * Round 1 is opened eagerly (awaited) so a connect failure rejects BEFORE the
 * route commits to a 200 text/plain response — that is what preserves today's
 * JSON error bodies for 429/503/500. Every later round runs inside the
 * generator, where the response is already streaming and failures can only be
 * narrated as prose.
 *
 * Budget: `maxToolRounds` rounds may call tools. When it is spent the loop runs
 * one more round, with the SAME tools and TOOL_BUDGET_SPENT_NOTE appended after
 * the last tool results, so the model answers with what it has; a tool call on
 * that round is never executed (the hard stop below).
 *
 * Why not `tools: []` (the old way): on Haiku 5.5 each thinking block is bound
 * to the exact system, tools and earlier messages that produced it, and this
 * round replays the turn's thinking blocks — a changed tools array is a 400.
 * The note is a text block after the tool_result blocks rather than a
 * mid-conversation `role: "system"` message: the claude-api migration guide
 * gives both as append-only, but the system role is a 400 on models without
 * it (Haiku 4.5, Sonnet 5), and a text block cannot 400 on any model.
 */
export async function startClaraLoop(params: LoopParams): Promise<AsyncGenerator<string>> {
  // Copy: the caller's history array is theirs, and the loop appends to its own.
  const messages: ModelMessage[] = [...params.messages];

  // S3 structural confirm guard: a first-turn conversation (no assistant turn
  // in the CLIENT-SENT history) cannot contain a proposed+confirmed write —
  // whatever the model thinks. Zero false positives: any real confirm flow has
  // at least one prior assistant message. Checked against params.messages, NOT
  // the loop's growing copy (which gains assistant turns every round).
  const hasPriorAssistantTurn = params.messages.some((m) => m.role === "assistant");
  // An explicit decision from the route (spec §3a: writes only on the turn
  // directly after a saved ask_choices message) overrides the structural check.
  const writesAllowed = params.writesAllowed ?? hasPriorAssistantTurn;

  // ask_choices is intercepted only when the route offers it. A route that
  // does not (dish-checker) sees exactly the old behaviour, including for a
  // model that hallucinates the tool name.
  const offersChoices = params.tools.some((t) => t.name === ASK_CHOICES_TOOL);

  const partsEnabled = params.partsEnabled === true;

  /**
   * Answer boxes for a reply that asked its question in plain text. One forced
   * ask_choices round, appended after the reply (same system and tools, so
   * nothing already sent changes). The question is ALREADY on screen: nothing
   * is streamed, and the boxes carry that sentence as their question so the
   * stored message and the stream agree. null on any failure, a bad answer or
   * the budget running out — the reply is never held or lost for boxes.
   */
  async function convertQuestion(assistant: ModelContentBlock[], question: string): Promise<ClaraChoices | null> {
    const started = Date.now();
    let abandoned = false;
    const attempt = (async (): Promise<ClaraChoices | null> => {
      const round = await params.client.openRound({
        system: params.system,
        messages: [...messages, { role: "assistant", content: assistant }, { role: "user", content: [{ type: "text", text: CONVERSION_NOTE }] }],
        tools: params.tools,
        toolChoice: { type: "tool", name: ASK_CHOICES_TOOL },
      });
      for await (const event of round) {
        if (abandoned) break; // ends the round's stream
        if (event.type !== "end" || event.stopReason === "max_tokens") continue;
        const call = event.content.find((b) => b.type === "tool_use" && b.name === ASK_CHOICES_TOOL);
        if (!call || call.type !== "tool_use") return null;
        // The model's options under the question as the person already read it.
        return parseChoices({ ...call.input, question: question.slice(-ASK_CHOICES_MAX_QUESTION_CHARS) });
      }
      return null;
    })().catch((err) => {
      if (!abandoned) params.onError?.(err);
      return null;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        abandoned = true;
        resolve(null);
      }, params.conversionBudgetMs ?? CONVERSION_BUDGET_MS);
    });
    const choices = await Promise.race([attempt, late]);
    clearTimeout(timer);
    params.onConversion?.({ produced: choices !== null, ms: Date.now() - started });
    return choices;
  }

  const forced =
    params.forceFirst && params.tools.some((t) => t.name === params.forceFirst!.tool) ? params.forceFirst : null;

  // OFF 2026-11 (Clara-first, spec §8.6): the first round may now carry a forced tool from the intent router; with no forced tool the request is the same three keys. Restore: uncomment these lines and delete the call below them.
  // const firstRound = await params.client.openRound({
  //   system: params.system,
  //   messages,
  //   tools: params.tools,
  // });
  const firstRound = await params.client.openRound({
    system: params.system,
    messages,
    tools: params.tools,
    ...(forced ? { toolChoice: { type: "tool" as const, name: forced.tool } } : {}),
  });

  async function* run(): AsyncGenerator<string> {
    let stream = firstRound;
    let toolRoundsUsed = 0;
    let emitted = false;
    // Last character streamed to the user. Narration before a tool call
    // ("Let me check your plan.") and the answer after it ("No — …") are
    // separate model rounds; without a separator they render glued together
    // ("…tonight.No — …", desktop QA 2026-09-11).
    let lastChar = "";
    // Parts collected from tool results this turn, not yet written out as text.
    const fallbackParts: ClaraPart[] = [];
    let partsShown = false;
    // Whether any tool result this turn carried a part (a card with its own buttons).
    let hadParts = false;

    // At every normal end of the turn: the old-build text for the parts.
    function* partsText(): Generator<string> {
      for (const part of fallbackParts.splice(0)) {
        const t = partAsText(part);
        if (t.length === 0) continue;
        if (emitted && /\S$/.test(lastChar) && /^\S/.test(t)) yield "\n\n";
        emitted = true;
        lastChar = t.slice(-1);
        yield t;
      }
    }

    for (;;) {
      // The assistant turn is taken from the round's terminal event, NEVER
      // rebuilt from deltas: one delta is not one content block, empty and
      // whitespace-only blocks are rejected by the API, and delta order does
      // not preserve real block order.
      let assistant: ModelContentBlock[] = [];
      let stopReason: string | null = null;
      let roundEmitted = false;

      try {
        for await (const event of stream) {
          if (event.type === "text") {
            if (event.text.length > 0) {
              if (!roundEmitted && emitted && /\S$/.test(lastChar) && /^\S/.test(event.text)) yield "\n\n";
              emitted = true;
              roundEmitted = true;
              lastChar = event.text.slice(-1);
            }
            yield event.text;
          } else {
            assistant = event.content;
            stopReason = event.stopReason;
          }
        }
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }

      const calls = assistant.filter(
        (b): b is Extract<ModelContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      // A round truncated by max_tokens has partially-parsed tool inputs — the
      // SDK accumulates input_json_delta without throwing, so a truncated call
      // looks valid. Executing it would act on half-read arguments. Stop and
      // let whatever prose was produced stand.
      if (stopReason === "max_tokens" && calls.length > 0) {
        params.onError?.(new Error("clara loop: round truncated by max_tokens, tool calls dropped"));
        yield* partsText();
        if (!emitted && !partsShown) yield EMPTY_ANSWER_FALLBACK;
        return;
      }

      if (calls.length === 0) {
        yield* partsText();
        if (!emitted && !partsShown) yield EMPTY_ANSWER_FALLBACK;
        // The reply is complete and on screen. If it ended by asking the person
        // something in plain text, give the question answer boxes: once per
        // turn (the turn ends here either way), never when a card was shown,
        // never for a cut-off or declined reply.
        if (params.questionBoxes === true && offersChoices && !hadParts && stopReason !== "max_tokens" && stopReason !== "refusal") {
          const said = assistant.filter((b): b is Extract<ModelContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
          const question = finalQuestion(said);
          if (question) {
            const choices = await convertQuestion(assistant, question);
            if (choices) params.onChoices?.(choices);
          }
        }
        return;
      }

      // HARD STOP. The budget note only *asks* the model not to call tools;
      // it does not make it impossible. Without this the loop would keep
      // executing and re-opening rounds forever on a client that ignores it —
      // an unbounded spend loop in a paid path, guarded only by a remote
      // service's good behaviour. The budget is enforced here, locally.
      if (toolRoundsUsed >= params.maxToolRounds) {
        params.onError?.(
          new Error("clara loop: tool_use returned after the round budget was spent")
        );
        yield* partsText();
        if (!emitted && !partsShown) yield EMPTY_ANSWER_FALLBACK;
        return;
      }

      messages.push({ role: "assistant", content: assistant });

      const results: ModelContentBlock[] = [];
      const seenCallIds = new Set<string>();
      // Answer boxes are terminal, but the round's OTHER calls still run first
      // (in their own order, through the same guard); the question is streamed
      // and the turn ends only after this loop.
      let choices: ClaraChoices | null = null;
      for (const call of calls) {
        // Two tool_result blocks sharing one tool_use_id is a 400 on the next
        // round; drop the duplicate rather than poison the turn.
        if (seenCallIds.has(call.id)) continue;
        seenCallIds.add(call.id);
        let result: ToolResult;
        const def = params.tools.find((t) => t.name === call.name);
        if (offersChoices && call.name === ASK_CHOICES_TOOL) {
          // Never executed. Valid ⇒ the first one wins and ends the turn;
          // invalid ⇒ an ordinary failed tool result so the model can retry.
          const parsed = parseChoices(call.input);
          if (parsed) {
            choices ??= parsed;
            result = { ok: true, data: { shown: true } };
          } else {
            result = { ok: false, reason: "INVALID_INPUT", message: ASK_CHOICES_INVALID_MESSAGE };
          }
        } else if (def?.isWrite && !writesAllowed) {
          result = {
            ok: false,
            reason: "CONFIRM_REQUIRED",
            message: offersChoices ? CONFIRM_REQUIRED_WITH_CHOICES_MESSAGE : CONFIRM_REQUIRED_MESSAGE,
          };
        } else {
          try {
            // OFF 2026-11 (Clara-first, spec §8.6): the forced tool's input may get the router's arguments filled in first. Restore: uncomment this line and delete the two below it.
            // result = await params.execute(call.name, call.input, call.id);
            const input = forced && toolRoundsUsed === 0 && call.name === forced.tool ? withFilled(call.input, forced.fill) : call.input;
            result = await params.execute(call.name, input, call.id);
          } catch (err) {
            // A handler that throws is a bug, not a user-facing event: log it and
            // hand the model a narratable result so the turn still completes.
            params.onError?.(err);
            result = { ok: false, reason: "FAILED", message: TOOL_THREW_MESSAGE };
          }
        }
        let forModel: ToolResult = result;
        if (result.ok && Array.isArray(result.parts) && result.parts.length > 0) {
          hadParts = true;
          for (const part of result.parts) {
            params.onPart?.(part);
            if (partsEnabled) partsShown = true;
            else fallbackParts.push(part);
          }
          // The model does not need the card payload back; it knows it showed one.
          const { parts: _shown, ...rest } = result;
          forModel = rest;
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(forModel),
        });
        // The tool's own words, written here so they never depend on the model repeating them
        // (live run 2026-11-27: a meal was priced and the reply went straight to "Log as lunch?").
        if (result.ok && typeof result.say === "string" && result.say.trim().length > 0) {
          if (emitted && /\S$/.test(lastChar)) yield "\n\n";
          emitted = true;
          lastChar = result.say.slice(-1);
          yield result.say;
        }
      }
      toolRoundsUsed += 1;
      // Budget spent: the note goes at the END of this new message (appended,
      // so nothing already sent changes), and the tools stay the same.
      if (toolRoundsUsed >= params.maxToolRounds && !choices) {
        results.push({ type: "text", text: TOOL_BUDGET_SPENT_NOTE });
      }
      messages.push({ role: "user", content: results });

      if (choices) {
        // The question stays the end of the message, so parts go before it.
        yield* partsText();
        // The model sometimes writes its question in the text AND passes it to
        // ask_choices (seen live): the person would read it twice. When this
        // round's own text already ends by asking, that sentence IS the
        // question — nothing more is written, and the boxes carry it.
        const said = assistant.filter((b): b is Extract<ModelContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
        const asked = params.questionBoxes === true ? finalQuestion(said) : null;
        if (asked) {
          params.onChoices?.({ ...choices, question: asked.slice(-ASK_CHOICES_MAX_QUESTION_CHARS) });
          return;
        }
        // The same question earlier in the text, in other words: also not written again.
        if (params.questionBoxes === true && asksAlready(said, choices.question)) {
          params.onChoices?.(choices);
          return;
        }
        // Same separator rule as between rounds: the question is a new piece
        // of text after whatever this or an earlier round streamed.
        if (emitted && /\S$/.test(lastChar) && /^\S/.test(choices.question)) yield "\n\n";
        emitted = true;
        lastChar = choices.question.slice(-1);
        yield choices.question;
        params.onChoices?.(choices);
        return;
      }

      try {
        stream = await params.client.openRound({
          system: params.system,
          messages,
          tools: params.tools,
        });
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }
    }
  }

  return run();
}
