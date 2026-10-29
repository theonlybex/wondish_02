// Answer boxes (spec §3). `ask_choices` is a runtime tool the loop intercepts:
// it is never executed. The loop streams the question as text, hands the
// parsed choices to the route, and ends the turn. Types-only imports: the loop
// imports this module and must stay free of prisma.
import type { ClaraChoices, Skill } from "./types";

export const ASK_CHOICES_TOOL = "ask_choices";

export const ASK_CHOICES_MIN_OPTIONS = 2;
export const ASK_CHOICES_MAX_OPTIONS = 4;
export const ASK_CHOICES_MAX_QUESTION_CHARS = 300;
export const ASK_CHOICES_MAX_OPTION_CHARS = 60;

/** What the model is told when its ask_choices input is rejected, so it can retry. */
export const ASK_CHOICES_INVALID_MESSAGE =
  `ask_choices needs a non-empty question (max ${ASK_CHOICES_MAX_QUESTION_CHARS} characters) and ` +
  `${ASK_CHOICES_MIN_OPTIONS}-${ASK_CHOICES_MAX_OPTIONS} different, non-empty options ` +
  `(max ${ASK_CHOICES_MAX_OPTION_CHARS} characters each). Do not include "Other" — the app adds it.`;

/**
 * Validates an ask_choices input. Values are trimmed. A bare "Other" (any
 * case) is the client's own box, so it is dropped before counting. Any bad
 * entry rejects the whole call (null) rather than being silently repaired, so
 * the model sees INVALID_INPUT and retries.
 */
export function parseChoices(input: Record<string, unknown>): ClaraChoices | null {
  if (typeof input.question !== "string") return null;
  const question = input.question.trim();
  if (question.length === 0 || question.length > ASK_CHOICES_MAX_QUESTION_CHARS) return null;

  if (!Array.isArray(input.options)) return null;
  const options: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.options) {
    if (typeof raw !== "string") return null;
    const option = raw.trim();
    if (option.length === 0 || option.length > ASK_CHOICES_MAX_OPTION_CHARS) return null;
    const key = option.toLowerCase();
    if (key === "other") continue;
    if (seen.has(key)) return null;
    seen.add(key);
    options.push(option);
  }
  if (options.length < ASK_CHOICES_MIN_OPTIONS || options.length > ASK_CHOICES_MAX_OPTIONS) return null;

  return { question, options };
}

export const askChoicesSkill: Skill = {
  name: "choices",
  promptFragment:
    "About ask_choices: it shows the user tappable answer boxes under your message. Use it when there is a short set of likely answers (2 to 4), for example which meal they mean or which of two swaps they prefer. ALWAYS use it for the yes/no confirm step of any change before you make it — propose the change in a sentence, then call ask_choices with options such as \"Yes, swap it\" and \"No, keep it\". Do not use it for open questions (\"What did you eat?\"). Keep each option short and in the user's own voice. Never list \"Other\" as an option; the app adds it. The question you pass is shown to the user as the end of your message, so do not repeat it in your text. After calling it, stop and wait for their answer. Never mention the tool name to the user.",
  tools: [
    {
      def: {
        name: ASK_CHOICES_TOOL,
        description:
          "Ask the user a question with 2-4 short tappable answers, and end your turn. Always use it for the yes/no confirm of a change. Not for open questions. Never include \"Other\" — the app adds it.",
        input_schema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: `The question shown to the user, max ${ASK_CHOICES_MAX_QUESTION_CHARS} characters.`,
            },
            options: {
              type: "array",
              items: { type: "string" },
              minItems: ASK_CHOICES_MIN_OPTIONS,
              maxItems: ASK_CHOICES_MAX_OPTIONS,
              description: `${ASK_CHOICES_MIN_OPTIONS}-${ASK_CHOICES_MAX_OPTIONS} different short answers, max ${ASK_CHOICES_MAX_OPTION_CHARS} characters each, e.g. ["Yes, swap it", "No, keep it"].`,
            },
          },
          required: ["question", "options"],
        },
      },
      // The loop intercepts ask_choices before `execute`, so this never runs.
      // If a route ever forgets to intercept, the model gets a narratable
      // failure rather than a silent success.
      handler: async () => ({
        ok: false,
        reason: "FAILED",
        message: "Answer boxes are not available right now. Ask the question in plain words instead.",
      }),
    },
  ],
};
