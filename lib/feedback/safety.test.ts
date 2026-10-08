import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafetyReport } from "./safety";

test("allergy / banned-food reports are safety reports", () => {
  for (const t of [
    "I'm allergic to peanuts and the plan has peanut butter",
    "I chose vegetarian but the shopping list has bacon",
    "I'm vegan and got chicken, minor",
    "Clara suggested shrimp even though shellfish is banned for me",
    "this dish made me sick, I think it had gluten and I have celiac",
    "anaphylaxis risk: sesame in my lunch",
  ]) assert.ok(isSafetyReport(t), t);
});

test("ordinary bugs are not", () => {
  for (const t of ["The save button does nothing", "Calories look too high on Monday", "I'd love a dark mode", "The page is slow to load"]) {
    assert.ok(!isSafetyReport(t), t);
  }
});

// Final review (2026-10-07): phrasings the first version missed, incl. the
// form's own placeholder, and a false positive.
test("diet word after the food, curly apostrophes, more foods, across a full stop", () => {
  for (const t of [
    "My shopping list shows bacon although I'm vegetarian.",
    "I can’t eat peanuts and the plan has peanut sauce",
    "vegetarian and the plan has lamb",
    "I'm pescatarian but got sausage for lunch",
    "I'm vegan. Yet tonight's dinner is chicken curry",
    "prawns in my dinner and I'm vegetarian",
  ]) assert.ok(isSafetyReport(t), t);
});

test("'not allowed' about something that is not food is not a safety report", () => {
  for (const t of ["I'm not allowed to change my email", "It says I'm not allowed to upload a photo", "Bacon recipes look great, more please"]) {
    assert.ok(!isSafetyReport(t), t);
  }
});

test("a diet mention with no excluded food in it is not a safety report", () => {
  for (const t of ["I'm vegan, can you add a recipe idea for dinner?", "A keto meal plan option would be nice", "As a vegetarian I love this app"]) assert.ok(!isSafetyReport(t), t);
});
