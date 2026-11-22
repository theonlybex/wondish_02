import { test } from "node:test";
import assert from "node:assert/strict";
import { planSave, parseSaveBody } from "./ingredients-save";

const visible = new Set(["salmon", "beef", "chicken", "spinach"]);
const current = () => ({
  pantry: new Set(["chicken", "offCatalog", "bannedOwned"]),
  liked: new Map([["chicken", true], ["spinach", false], ["offCatalog", true], ["kale", false]]),
});

test("planSave lists only real changes and leaves unseen ids alone", () => {
  const plan = planSave(visible, current(), { atHome: ["salmon", "beef", "ghost"], favorites: ["salmon", "spinach"] });
  assert.deepEqual(plan.pantryAdd.sort(), ["beef", "salmon"]);
  assert.deepEqual(plan.pantryRemove, ["chicken"]);
  assert.deepEqual(plan.likeUpsert.sort(), ["salmon", "spinach"]);
  assert.deepEqual(plan.likeDelete, ["chicken"]);
});

test("saving the current state again changes nothing", () => {
  const plan = planSave(visible, current(), { atHome: ["chicken"], favorites: ["chicken"] });
  assert.deepEqual(plan, { pantryAdd: [], pantryRemove: [], likeUpsert: [], likeDelete: [] });
});

test("duplicated ids count once", () => {
  const plan = planSave(visible, current(), { atHome: ["salmon", "salmon", "chicken"], favorites: ["chicken", "beef", "beef"] });
  assert.deepEqual(plan.pantryAdd, ["salmon"]);
  assert.deepEqual(plan.likeUpsert, ["beef"]);
});

test("parseSaveBody accepts the shape and rejects the rest", () => {
  assert.deepEqual(parseSaveBody({ atHome: ["a"], favorites: [] }), { atHome: ["a"], favorites: [] });
  assert.equal(parseSaveBody({ atHome: ["a"] }), null);
  assert.equal(parseSaveBody({ atHome: "a", favorites: [] }), null);
  assert.equal(parseSaveBody({ atHome: [1], favorites: [] }), null);
  assert.equal(parseSaveBody(null), null);
});
