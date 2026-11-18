import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestionName, SUGGESTION_NAME_MAX } from "./dish-library";

test("the notification dish is the best ranked recipe with a short name", () => {
  assert.equal(suggestionName([{ name: "Lentil soup" }, { name: "Chicken salad" }]), "Lentil soup");
});

test("a name too long for a lock screen is skipped", () => {
  const long = "A".repeat(SUGGESTION_NAME_MAX + 1);
  assert.equal(suggestionName([{ name: long }, { name: "  Baked salmon  " }]), "Baked salmon");
});

test("no suitable recipe gives no suggestion", () => {
  assert.equal(suggestionName([]), null);
  assert.equal(suggestionName([{ name: "   " }]), null);
});

const route = readFileSync("app/api/clara/meal-suggestions/route.ts", "utf8");
const dish = readFileSync("lib/clara/skills/dish.ts", "utf8");

test("the route takes the person from sign-in only, is rate limited, and asks for lunch and dinner", () => {
  assert.match(route, /resolveClaraCaller\(\)/);
  assert.match(route, /rateLimit\("clara-meal-suggestions", caller\.userId, 30, 60\)/);
  assert.match(route, /mealSuggestionNames\(caller\.patient\.id, today\.value, \["lunch", "dinner"\]\)/);
});

test("the names go through the library's rule filter and skip recent dishes, with no model call", () => {
  const body = dish.slice(dish.indexOf("export async function mealSuggestionNames"), dish.indexOf("/** How many ranked library recipes"));
  assert.match(body, /rankLibrary\(/);
  assert.match(body, /person\.matchers/);
  assert.match(body, /recent,/);
  assert.doesNotMatch(body, /anthropic|messages\.create/i);
});
