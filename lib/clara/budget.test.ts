import { test } from "node:test";
import assert from "node:assert/strict";
import { maxToolRounds, MAX_TOOL_ROUNDS_FREE, MAX_TOOL_ROUNDS_PREMIUM } from "./budget";

test("free accounts get 2 tool rounds, premium 5", () => {
  assert.equal(MAX_TOOL_ROUNDS_FREE, 2);
  assert.equal(MAX_TOOL_ROUNDS_PREMIUM, 5);
  assert.equal(maxToolRounds(false), 2);
  assert.equal(maxToolRounds(true), 5);
});
