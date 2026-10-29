import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_CHOICES_TOOL,
  ASK_CHOICES_MAX_OPTIONS,
  ASK_CHOICES_MAX_OPTION_CHARS,
  ASK_CHOICES_MAX_QUESTION_CHARS,
  ASK_CHOICES_MIN_OPTIONS,
  askChoicesSkill,
  parseChoices,
} from "./ask-choices";

const q = "Swap tonight's dinner?";

test("parseChoices: a valid question with two options passes through trimmed", () => {
  assert.deepEqual(parseChoices({ question: `  ${q} `, options: [" Yes, swap it ", "No, keep it"] }), {
    question: q,
    options: ["Yes, swap it", "No, keep it"],
  });
});

test("parseChoices: the bounds are the ones in the brief", () => {
  assert.equal(ASK_CHOICES_MIN_OPTIONS, 2);
  assert.equal(ASK_CHOICES_MAX_OPTIONS, 4);
  assert.equal(ASK_CHOICES_MAX_QUESTION_CHARS, 300);
  assert.equal(ASK_CHOICES_MAX_OPTION_CHARS, 60);
});

test("parseChoices: question must be a non-empty string of at most 300 chars", () => {
  const opts = ["a", "b"];
  assert.equal(parseChoices({ options: opts }), null);
  assert.equal(parseChoices({ question: 42, options: opts }), null);
  assert.equal(parseChoices({ question: "", options: opts }), null);
  assert.equal(parseChoices({ question: "   ", options: opts }), null);
  assert.notEqual(parseChoices({ question: "x".repeat(300), options: opts }), null);
  assert.equal(parseChoices({ question: "x".repeat(301), options: opts }), null);
});

test("parseChoices: options must be an array of 2 to 4 entries", () => {
  assert.equal(parseChoices({ question: q }), null);
  assert.equal(parseChoices({ question: q, options: "Yes" }), null);
  assert.equal(parseChoices({ question: q, options: [] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes"] }), null);
  assert.deepEqual(parseChoices({ question: q, options: ["a", "b", "c", "d"] })?.options, ["a", "b", "c", "d"]);
  assert.equal(parseChoices({ question: q, options: ["a", "b", "c", "d", "e"] }), null);
});

test("parseChoices: every option must be a non-empty string of at most 60 chars", () => {
  assert.equal(parseChoices({ question: q, options: ["Yes", 2] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", null] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", ""] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", "   "] }), null);
  assert.notEqual(parseChoices({ question: q, options: ["Yes", "n".repeat(60)] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", "n".repeat(61)] }), null);
});

test("parseChoices: options must be distinct (case- and space-insensitive)", () => {
  assert.equal(parseChoices({ question: q, options: ["Yes", "Yes"] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", " yes "] }), null);
  assert.equal(parseChoices({ question: q, options: ["Yes", "No", "YES"] }), null);
});

test("parseChoices: \"Other\" in any case is removed before counting", () => {
  assert.deepEqual(parseChoices({ question: q, options: ["Yes", "No", "Other"] })?.options, ["Yes", "No"]);
  assert.deepEqual(parseChoices({ question: q, options: ["OTHER", "Yes", " other ", "No"] })?.options, [
    "Yes",
    "No",
  ]);
  // Four real options plus "Other" is still four.
  assert.deepEqual(parseChoices({ question: q, options: ["a", "b", "c", "d", "Other"] })?.options, [
    "a",
    "b",
    "c",
    "d",
  ]);
  // Stripping "Other" can leave too few.
  assert.equal(parseChoices({ question: q, options: ["Yes", "Other"] }), null);
  // Only the bare word is the client's own box; a real option that contains it stays.
  assert.deepEqual(parseChoices({ question: q, options: ["Yes", "Other dish"] })?.options, [
    "Yes",
    "Other dish",
  ]);
});

test("askChoicesSkill: one ask_choices tool, never a write", () => {
  assert.equal(ASK_CHOICES_TOOL, "ask_choices");
  assert.equal(askChoicesSkill.tools.length, 1);
  const def = askChoicesSkill.tools[0].def;
  assert.equal(def.name, ASK_CHOICES_TOOL);
  assert.ok(!def.isWrite, "ask_choices must not be flagged isWrite");
  assert.deepEqual(def.input_schema.required, ["question", "options"]);
  const props = def.input_schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.question.type, "string");
  assert.equal(props.options.type, "array");
  assert.equal(props.options.minItems, 2);
  assert.equal(props.options.maxItems, 4);
  assert.deepEqual(props.options.items, { type: "string" });
});

test("askChoicesSkill: the handler is a refusal, because the loop intercepts the call", async () => {
  const result = await askChoicesSkill.tools[0].handler(
    {
      patientId: "p",
      accountId: "a",
      firstName: "Sam",
      isPremium: false,
      today: "2026-10-28",
      surface: "web",
      disabledSkills: [],
    },
    { question: q, options: ["Yes", "No"] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "FAILED");
});

test("askChoicesSkill: the prompt fragment carries the usage rules", () => {
  const f = askChoicesSkill.promptFragment;
  assert.match(f, /ask_choices/);
  assert.match(f, /always/i, "always for the confirm step of a change");
  assert.match(f, /confirm/i);
  assert.match(f, /open question/i, "not for open questions");
  assert.match(f, /"Other"/, "never list Other");
});
