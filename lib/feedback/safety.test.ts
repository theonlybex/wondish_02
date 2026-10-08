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
