import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDietCard, uniqueNames } from "./diet-card";
import { makeDietShareStore, memoryKV, DIET_SHARE_DAYS } from "./diet-share";
import type { FoodMapPatient } from "./food-map";

const person = (over: Partial<FoodMapPatient> = {}): FoodMapPatient => ({
  mealType: null,
  foodAllergies: [],
  foodToAvoid: [],
  foodPreferences: [],
  healthConditions: [],
  motivations: [],
  ingredientPreferences: [],
  ...over,
});

test("allergies come first as never-use groups with what they cover", () => {
  const card = buildDietCard("Mia", person({
    foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [{ name: "peanut butter" }, { name: "Peanuts" }, { name: "peanut oil" }] } }],
  }), { showConditions: false });
  assert.deepEqual(card.never, [{ name: "Peanuts", includes: ["peanut butter", "peanut oil"] }]);
  assert.equal(card.empty, false);
});

test("leave-out joins avoided foods, dislikes, plan and condition foods once each, without the allergies", () => {
  const card = buildDietCard("Mia", person({
    foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [{ name: "peanut oil" }] } }],
    foodToAvoid: [{ food: { name: "Pork", bannedIngredients: [{ name: "bacon" }] } }, { food: { name: "pork" } }],
    ingredientPreferences: [{ liked: false, ingredient: { name: "Coriander" } }, { liked: true, ingredient: { name: "Salmon" } }],
    foodPreferences: [{ food: { name: "Vegetarian", bannedIngredients: [{ name: "beef" }, { name: "peanut oil" }] } }],
    healthConditions: [{ condition: { name: "Hypertension", bannedIngredients: [{ name: "stock cubes" }, { name: "Bacon" }] } }],
  }), { showConditions: false });
  assert.deepEqual(card.avoid, ["Pork", "bacon", "Coriander", "beef", "stock cubes"]);
  assert.deepEqual(card.eatingStyle, ["Vegetarian"]);
});

test("conditions stay private by default: the salt rule shows, the name and its guidance do not", () => {
  const p = person({ healthConditions: [{ condition: { name: "Hypertension", bannedIngredients: [] } }] });
  const hidden = buildDietCard("Sam", p, { showConditions: false });
  assert.equal(hidden.conditions, undefined);
  assert.equal(hidden.goEasy.length, 1);
  assert.match(hidden.goEasy[0], /^Low salt: about 1,500 mg/);
  assert.doesNotMatch(JSON.stringify(hidden), /hypertension/i);

  const shown = buildDietCard("Sam", p, { showConditions: true });
  assert.deepEqual(shown.conditions, ["Hypertension"]);
  assert.equal(shown.goEasy.length, 2);
  assert.match(shown.goEasy[1], /^Keep sodium low/);
});

test("likes are listed, never an allergen; a person with no rules gets an empty card", () => {
  const card = buildDietCard("Mia", person({ foodAllergies: [{ food: { name: "Salmon", bannedIngredients: [] } }] }), {
    showConditions: false,
    likes: ["Salmon", "Spinach", "spinach"],
  });
  assert.deepEqual(card.likes, ["Spinach"]);
  assert.equal(buildDietCard("", person(), { showConditions: false }).empty, true);
  assert.equal(buildDietCard("", null, { showConditions: true }).firstName, "This person");
  assert.deepEqual(uniqueNames([" a ", "A", "", "b"]), ["a", "b"]);
});

// ── share links ──

test("one link per person: turning it on twice keeps the address and updates what it shows", async () => {
  const store = makeDietShareStore(memoryKV());
  const first = await store.enable("p1", false);
  assert.match(first.token, /^[A-Za-z0-9_-]{24}$/);
  const again = await store.enable("p1", true);
  assert.equal(again.token, first.token);
  assert.equal(again.expiresAt, first.expiresAt);
  assert.equal((await store.byToken(first.token))?.showConditions, true);
  assert.equal((await store.current("p1"))?.token, first.token);
  assert.equal(await store.current("p2"), null);
});

test("a link that is turned off stops working at once, and a new one has a new address", async () => {
  const store = makeDietShareStore(memoryKV());
  const first = await store.enable("p1", false);
  await store.revoke("p1");
  assert.equal(await store.byToken(first.token), null);
  assert.equal(await store.current("p1"), null);
  assert.notEqual((await store.enable("p1", false)).token, first.token);
});

test("a link expires after 90 days; unknown and malformed tokens open nothing", async () => {
  let t = Date.parse("2026-11-20T12:00:00Z");
  const store = makeDietShareStore(memoryKV(() => t), () => t);
  const share = await store.enable("p1", false);
  assert.equal(share.expiresAt, new Date(t + DIET_SHARE_DAYS * 86_400_000).toISOString());
  t += (DIET_SHARE_DAYS - 1) * 86_400_000;
  assert.ok(await store.byToken(share.token));
  t += 2 * 86_400_000;
  assert.equal(await store.byToken(share.token), null);
  assert.equal(await store.byToken("short"), null);
  assert.equal(await store.byToken("../../etc/passwd-aaaaaaaaaaaa"), null);
  assert.equal(await store.byToken("A".repeat(24)), null);
});

// ── the route and the page ──

const route = readFileSync("app/api/diet-share/route.ts", "utf8");
const page = readFileSync("app/diet/[token]/page.tsx", "utf8");
const middleware = readFileSync("middleware.ts", "utf8");

test("the API takes the person from sign-in only and is rate limited", () => {
  assert.match(route, /resolveClaraCaller\(\)/);
  assert.match(route, /rateLimit\("diet-share", c\.userId, 30, 60\)/);
  assert.doesNotMatch(route, /patientId: body|body\.patientId/);
});

test("the chef's page is public, not indexed, not cached, and the sample is off in production", () => {
  assert.match(middleware, /"\/diet\/\(\.\*\)"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /process\.env\.NODE_ENV !== "production" && params\.token\.startsWith\("sample"\)/);
});
