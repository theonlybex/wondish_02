import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySodiumLimitMg, DAILY_SODIUM_MAX_MG, HEART_SODIUM_MAX_MG } from "./sodium-limit";
import { CONDITION_GROUPS } from "./condition-groups";

test("no condition, or an unrelated one: the general 2,300 mg guideline", () => {
  assert.equal(DAILY_SODIUM_MAX_MG, 2300);
  assert.equal(dailySodiumLimitMg([]), 2300);
  assert.equal(dailySodiumLimitMg(["GERD", "Type 2 Diabetes"]), 2300);
});

test("any cardiovascular or cerebrovascular condition: 1,500 mg", () => {
  assert.equal(HEART_SODIUM_MAX_MG, 1500);
  const group = CONDITION_GROUPS.find((g) => g.title === "Cardiovascular and cerebrovascular")!;
  assert.ok(group.conditions.length >= 5);
  for (const c of group.conditions) assert.equal(dailySodiumLimitMg([c.name]), 1500, c.name);
  assert.equal(dailySodiumLimitMg(["GERD", "Stroke"]), 1500);
});
