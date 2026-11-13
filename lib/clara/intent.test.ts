// The deterministic intent router (lib/clara/intent.ts): which messages force
// a dish tool on the first round, and — as important — which never do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent, mealForLocalMinutes, INTENT_MAX_CHARS } from "./intent";

type Want = { tool: "dish_suggest" | "dish_plan_today"; wants?: string; followUp?: true; askFirst?: true } | null;
const suggest = (wants?: string): Want => ({ tool: "dish_suggest", ...(wants !== undefined ? { wants } : {}) });
const another: Want = { tool: "dish_suggest", followUp: true };
const planAsk: Want = { tool: "dish_plan_today", askFirst: true };
const plan: Want = { tool: "dish_plan_today" };

const TABLE: [string, Want][] = [
  // ── cook a named thing → dish_suggest with wants ──
  ["help me cook eggs", suggest("eggs")],
  ["Help me cook eggs!", suggest("eggs")],
  ["HELP ME COOK EGGS", suggest("eggs")],
  ["help me cook eggs pls", suggest("eggs")],
  ["please help me cook eggs", suggest("eggs")],
  ["hey Clara, help me cook eggs", suggest("eggs")],
  ["cook salmon with me", suggest("salmon")],
  ["how do I make pancakes", suggest("pancakes")],
  ["How do I make pancakes?", suggest("pancakes")],
  ["how to make an omelette", suggest("an omelette")],
  ["I want to make a lentil soup", suggest("a lentil soup")],
  ["i'd like to cook a chicken stir-fry tonight", suggest("a chicken stir-fry")],
  ["let's cook pasta", suggest("pasta")],
  ["lets make tacos", suggest("tacos")],
  ["recipe for chicken curry", suggest("chicken curry")],
  ["give me a recipe for banana bread", suggest("banana bread")],
  ["chicken curry recipe", suggest("chicken curry")],
  ["make me a smoothie", suggest("a smoothie")],
  ["can you help me make dinner with rice", suggest("rice")],
  ["could you help me cook scrambled eggs please", suggest("scrambled eggs")],
  ["I want to cook salmon for dinner", suggest("salmon")],
  ["show me how to make hummus", suggest("hummus")],
  ["how can I cook quinoa", suggest("quinoa")],
  ["cook some rice with me", suggest("some rice")],
  ["bake banana bread with me", suggest("banana bread")],
  ["I’d like to make shakshuka", suggest("shakshuka")],
  // nothing usable left → the tool, no wants
  ["help me cook", suggest()],
  ["let's cook", suggest()],
  ["help me make dinner", suggest()],
  ["I want to cook something", suggest()],
  ["cook with me", suggest()],
  // ── what to eat → dish_suggest, no wants ──
  ["what should I eat", suggest()],
  ["What should I eat?", suggest()],
  ["what can I cook tonight", suggest()],
  ["what should we have for dinner", suggest()],
  ["what to eat", suggest()],
  ["give me a dinner idea", suggest()],
  ["suggest a lunch", suggest()],
  ["any dinner ideas?", suggest()],
  ["I'm hungry", suggest()],
  ["im so hungry", suggest()],
  ["suggest something to eat", suggest()],
  ["recommend a quick breakfast", suggest()],
  // another dish (the service forces it only after a dish in this chat)
  ["something else", another],
  ["Another one", another],
  ["a different dish", another],
  ["give me another", another],
  ["show me something else please", another],
  // ── plan the day → dish_plan_today ──
  ["plan today's dishes", planAsk],
  ["Plan today’s dishes", planAsk],
  ["plan my day", planAsk],
  ["what should I eat today", planAsk],
  ["plan my meals for today", planAsk],
  ["plan today's dishes for me please", planAsk],
  ["plan my day, we have guests tonight", plan],
  ["plan today's dishes - I have very little time", plan],
  ["plan my day, I'm eating out tonight", plan],

  // ── never: stays with the model ──
  // technique and fact questions
  ["how long do I boil an egg?", null],
  ["is salmon ok for me?", null],
  ["can I eat eggs with IBS?", null],
  ["how many calories in an egg?", null],
  ["what temperature for chicken?", null],
  ["how do I know when salmon is done", null],
  ["how do I make it less salty", null],
  ["how do I make sure I get enough iron", null],
  ["how do I cook chicken safely", null],
  ["how do I make my kid eat vegetables", null],
  ["what should I eat before a run", null],
  ["what can I eat with IBS", null],
  ["what should I eat to lose weight", null],
  ["is it ok to cook with olive oil", null],
  ["why do pancakes stick", null],
  // the saved plan, the log, the journal, numbers, pills, weight
  ["what's for dinner", null],
  ["what's on my meal plan today", null],
  ["swap tonight's dinner for something else", null],
  ["make a change to my plan", null],
  ["log my breakfast", null],
  ["add eggs to my log", null],
  ["show me my numbers", null],
  ["how much protein have I had", null],
  ["I take a vitamin D pill", null],
  ["my weight is 70 kg", null],
  ["how did I sleep this week", null],
  ["give me a high-protein dinner idea", null],
  // negations
  ["I don't want to cook", null],
  ["I do not want to make dinner tonight", null],
  ["I can't cook eggs", null],
  ["don't suggest a lunch", null],
  ["I hate cooking", null],
  // past tense: logging
  ["I cooked eggs", null],
  ["I ate eggs", null],
  ["I made pasta yesterday", null],
  ["I cooked eggs this morning", null],
  ["we had salmon for dinner", null],
  ["I just made a smoothie", null],
  // replies and things the app itself sends
  ["A normal day", null],
  ["Eating out", null],
  ["Very little time", null],
  ["yes", null],
  ["dinner", null],
  ["Cook this with me: Scrambled Eggs with Butter and Chives", null],
  ["make it quick", null],
  ["make this healthier", null],
  ["help me cook healthier", null],
  // not understood → null, never a guess
  ["hlep me cook eggs", null],
  ["eggs", null],
  ["hi", null],
  ["", null],
  ["thanks, that was great", null],
  ["tell me about salmon", null],
];

test(`detectIntent: ${TABLE.length} phrases`, () => {
  assert.ok(TABLE.length >= 60);
  assert.ok(TABLE.filter(([, want]) => want === null).length >= 25);
  for (const [message, want] of TABLE) assert.deepEqual(detectIntent(message), want, JSON.stringify(message));
});

test("detectIntent: a long message goes to the model untouched", () => {
  const long = `help me cook eggs ${"and also ".repeat(30)}`;
  assert.ok(long.length > INTENT_MAX_CHARS);
  assert.equal(detectIntent(long), null);
  assert.equal(detectIntent(`how do I make ${"very ".repeat(12)}good pancakes`), null, "a long thing to cook is not a dish name");
});

test("detectIntent is pure text in, plain data out: non-strings and whitespace are null", () => {
  assert.equal(detectIntent(undefined as unknown as string), null);
  assert.equal(detectIntent("   \n "), null);
  assert.deepEqual(detectIntent("  help me cook   eggs  \n"), { tool: "dish_suggest", wants: "eggs" });
});

test("mealForLocalMinutes: the meal for the person's local time of day", () => {
  assert.equal(mealForLocalMinutes(7 * 60), "breakfast");
  assert.equal(mealForLocalMinutes(10 * 60 + 29), "breakfast");
  assert.equal(mealForLocalMinutes(10 * 60 + 30), "lunch");
  assert.equal(mealForLocalMinutes(14 * 60 + 59), "lunch");
  assert.equal(mealForLocalMinutes(15 * 60), "dinner");
  assert.equal(mealForLocalMinutes(23 * 60), "dinner");
  assert.equal(mealForLocalMinutes(2 * 60), "dinner");
  assert.equal(mealForLocalMinutes(4 * 60), "breakfast");
});
