// "Does this reply end by asking the person something?" (lib/clara/question.ts):
// the test that decides whether a plain-text reply gets answer boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asksAlready, endsWithQuestion, finalQuestion } from "./question";

const CASES: [string, boolean][] = [
  ["Which meal is it for?", true],
  ["I can log that. Was it breakfast or lunch?", true],
  ["Was it breakfast or lunch?   \n\n", true],
  ["Want me to log it? 😊", true],
  ["Want me to log it?🙂🙂", true],
  ['Shall I swap it for "Lentil Stew"?', true],
  ['She asked: "Shall I swap it?"', true],
  ["Shall I swap it?)", true],
  ["**Which one would you like?**", true],
  ["¿Qué comiste hoy?", true],
  ["どの食事ですか？", true],
  ["Why fibre? It keeps you full. Which meal should I plan?", true],
  ["Eggs or oats?\nWhich do you prefer?", true],
  ["Is that right ?", true],
  // statements, including ones with a question earlier
  ["Salmon is fine for you.", false],
  ["Why does fibre matter? Because it keeps you full.", false],
  ["Wondering what to eat? Here is a dish that fits you.", false],
  ["Done! I logged it.", false],
  ["Tap the card to cook…", false],
  ["Here is today: oats, lentil soup, salmon", false],
  ["", false],
  ["   \n ", false],
  ["?", false],
  ["😊", false],
  ["Is it done? Yes.", false],
  ["Ask me \"what's for dinner?\" any time.", false],
  ["See https://example.com/search?q=eggs", false],
];

test(`endsWithQuestion: ${CASES.length} replies`, () => {
  assert.ok(CASES.length >= 20);
  for (const [text, want] of CASES) assert.equal(endsWithQuestion(text), want, JSON.stringify(text));
});

test("finalQuestion: the last sentence, as it is on screen", () => {
  assert.equal(finalQuestion("I can log that. Was it breakfast or lunch?"), "Was it breakfast or lunch?");
  assert.equal(finalQuestion("Two eggs, about 150 kcal.\n\nShould I log them as breakfast? 😊"), "Should I log them as breakfast?");
  assert.equal(finalQuestion("Which meal is it for?"), "Which meal is it for?");
  assert.equal(finalQuestion("It has 2.5 g of fibre. Want more?"), "Want more?");
  assert.equal(finalQuestion("Salmon is fine for you."), null);
});

test("asksAlready: the reply's text already asks the same thing as the boxes' question", () => {
  const live = "What did you have for lunch? Tell me the dish, or pick one of these if it's close.";
  assert.equal(asksAlready(live, "What did you eat for lunch today?"), true, "seen live: the same question in other words");
  assert.equal(asksAlready("Sure. What did you have for lunch?", "What did you have for lunch?"), true);
  assert.equal(asksAlready("Why fibre? It keeps you full.", "Which meal should I plan?"), false, "a different question earlier in the text");
  assert.equal(asksAlready("I can swap it for the lentil stew.", "Swap it?"), false, "no question in the text");
  assert.equal(asksAlready("", "Swap it?"), false);
  assert.equal(asksAlready("Is it lunch? Fine.", "Ok?"), false, "too little to compare");
});
