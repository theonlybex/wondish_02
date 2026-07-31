import { test } from "node:test";
import assert from "node:assert/strict";
import { profileSkill } from "./profile";

test("the profile skill exposes exactly one read tool", () => {
  assert.equal(profileSkill.name, "profile");
  assert.deepEqual(profileSkill.tools.map((t) => t.def.name), ["profile_get"]);
});

test("profile_get takes no input at all — nothing to spoof", () => {
  const schema = profileSkill.tools[0].def.input_schema;
  assert.deepEqual(schema.properties, {});
  assert.equal(schema.required, undefined);
});

test("its description tells Clara what it is NOT for", () => {
  assert.match(profileSkill.tools[0].def.description, /not.*(change|update|add)/i);
});
