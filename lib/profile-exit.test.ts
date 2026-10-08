import { test } from "node:test";
import assert from "node:assert/strict";
import { profileExitPath } from "./profile-exit";

const origin = "https://app.wondish.io";

test("Save Profile returns to the page the profile was opened from", () => {
  assert.equal(profileExitPath(`${origin}/meal-plan`, origin), "/meal-plan");
  assert.equal(profileExitPath(`${origin}/pantry?tab=buy`, origin), "/pantry?tab=buy");
});

test("…and to Overview when there is no safe page to return to", () => {
  assert.equal(profileExitPath("", origin), "/overview");
  assert.equal(profileExitPath(undefined, origin), "/overview");
  assert.equal(profileExitPath("https://evil.example/meal-plan", origin), "/overview");
  assert.equal(profileExitPath(`${origin}/profile`, origin), "/overview");
  assert.equal(profileExitPath(`${origin}/login`, origin), "/overview");
  assert.equal(profileExitPath(`${origin}/`, origin), "/overview");
  assert.equal(profileExitPath("http://[bad", origin), "/overview");
});

test("a recorded in-app path works as well as a full URL", () => {
  assert.equal(profileExitPath("/journal", origin), "/journal");
  assert.equal(profileExitPath("/profile?onboarding=true", origin), "/overview");
});
