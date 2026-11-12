import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCookService, parseCookBody, type CookDeps } from "./cook";
import type { MealLogCreateData } from "@/lib/meal-log";

const recipe = {
  name: "Lentil soup",
  servings: 2,
  minutes: 30,
  ingredients: [{ name: "lentils", quantity: 200, unit: "g" }],
  steps: ["Rinse.", "Simmer."],
  perServing: { calories: 400, protein: 20, carbs: 60, fat: 8, fibre: 12, sodium: 300 as number | null },
};
const dish = { dishId: "d1", name: "Lentil soup", recipe };

interface Row {
  id: string;
  patientId: string;
  title: string;
  dishName: string | null;
  recipe: unknown;
  cookedAt: Date | null;
}

function fake(rows: Row[] = [{ id: "c1", patientId: "p1", title: "x", dishName: null, recipe: null, cookedAt: null }]) {
  const logs: MealLogCreateData[] = [];
  const deps: CookDeps = {
    getCook: async (id, pid) => {
      const r = rows.find((x) => x.id === id && x.patientId === pid);
      return r ? { dishName: r.dishName, recipe: r.recipe } : null;
    },
    saveStart: async (id, pid, v) => {
      const r = rows.find((x) => x.id === id && x.patientId === pid);
      if (!r) return false;
      Object.assign(r, v);
      return true;
    },
    markDone: async (id, pid, at) => {
      const r = rows.find((x) => x.id === id && x.patientId === pid);
      if (!r) return false;
      r.cookedAt = at;
      return true;
    },
    logOnce: async (data) => {
      if (logs.some((l) => l.patientId === data.patientId && l.clientRequestId === data.clientRequestId)) return;
      logs.push(data);
    },
  };
  return { deps, rows, logs };
}

const parsed = (raw: unknown) => {
  const r = parseCookBody(raw);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};

test("parseCookBody rejects unknown actions and non-objects", () => {
  assert.equal(parseCookBody({ action: "stir" }).ok, false);
  assert.equal(parseCookBody(null).ok, false);
  assert.equal(parseCookBody([]).ok, false);
  assert.equal(parseCookBody({}).ok, false);
});

test("parseCookBody: ate accepts only portion 1 or 0.5", () => {
  assert.equal(parseCookBody({ action: "ate", portion: 2 }).ok, false);
  assert.equal(parseCookBody({ action: "ate", portion: 0.25 }).ok, false);
  assert.equal(parseCookBody({ action: "ate" }).ok, false);
  assert.equal(parseCookBody({ action: "ate", portion: "1" }).ok, false);
  const a = parsed({ action: "ate", portion: 0.5 });
  assert.deepEqual(a, { action: "ate", portion: 0.5, mealType: "dinner", today: undefined });
});

test("parseCookBody: ate validates today and mealType", () => {
  const bad = parseCookBody({ action: "ate", portion: 1, today: "tomorrow" });
  assert.ok(!bad.ok && bad.status === 400);
  assert.equal(parseCookBody({ action: "ate", portion: 1, today: 20261112 }).ok, false);
  assert.equal(parseCookBody({ action: "ate", portion: 1, mealType: "brunch" }).ok, false);
  assert.deepEqual(parsed({ action: "ate", portion: 1, today: "2026-11-12", mealType: "lunch" }), {
    action: "ate",
    portion: 1,
    today: "2026-11-12",
    mealType: "lunch",
  });
});

test("parseCookBody: start needs a dish with a valid recipe", () => {
  assert.equal(parseCookBody({ action: "start" }).ok, false);
  assert.equal(parseCookBody({ action: "start", dish: { dishId: "d1", name: "x" } }).ok, false);
  assert.equal(parseCookBody({ action: "start", dish: { ...dish, dishId: "" } }).ok, false);
  assert.equal(parseCookBody({ action: "start", dish: { ...dish, name: " " } }).ok, false);
  const v = parsed({ action: "start", dish });
  assert.equal(v.action, "start");
});

test("parseCookBody: recipe bounds are enforced", () => {
  const bad = (over: object) => parseCookBody({ action: "start", dish: { ...dish, recipe: { ...recipe, ...over } } }).ok;
  assert.equal(bad({ servings: 0 }), false);
  assert.equal(bad({ servings: 51 }), false);
  assert.equal(bad({ minutes: -1 }), false);
  assert.equal(bad({ minutes: Number.NaN }), false);
  assert.equal(bad({ steps: [] }), false);
  assert.equal(bad({ steps: [5] }), false);
  assert.equal(bad({ steps: Array(41).fill("x") }), false);
  assert.equal(bad({ ingredients: "salt" }), false);
  assert.equal(bad({ ingredients: [{ name: "a", quantity: -1, unit: "g" }] }), false);
  assert.equal(bad({ perServing: { ...recipe.perServing, calories: -5 } }), false);
  assert.equal(bad({ perServing: { ...recipe.perServing, protein: 99999 } }), false);
  assert.equal(bad({ perServing: { ...recipe.perServing, fibre: undefined } }), false);
  assert.equal(bad({ perServing: { ...recipe.perServing, sodium: 1e6 } }), false);
  assert.equal(bad({ perServing: { ...recipe.perServing, sodium: null } }), true);
  assert.equal(bad({ ingredients: [{ name: "salt", quantity: null, unit: "" }] }), true);
});

test("parseCookBody: start drops unknown keys from the recipe", () => {
  const v = parsed({ action: "start", dish: { ...dish, extra: 1, recipe: { ...recipe, evil: "x" } } });
  assert.ok(v.action === "start");
  assert.deepEqual(v.dish.recipe, recipe);
  assert.equal("extra" in v.dish, false);
});

test("start sets title and dishName (60-char cap) and stores the recipe", async () => {
  const f = fake();
  const svc = makeCookService(f.deps);
  const long = "L".repeat(80);
  const res = await svc.apply("c1", "p1", parsed({ action: "start", dish: { ...dish, name: long } }));
  assert.deepEqual(res, { ok: true });
  assert.equal(f.rows[0].title.length, 60);
  assert.equal(f.rows[0].dishName, f.rows[0].title);
  assert.deepEqual(f.rows[0].recipe, recipe);
  assert.equal(f.logs.length, 0);
});

test("done sets cookedAt and creates no log", async () => {
  const f = fake();
  const at = new Date("2026-11-12T18:00:00Z");
  const svc = makeCookService(f.deps, () => at);
  assert.deepEqual(await svc.apply("c1", "p1", { action: "done" }), { ok: true });
  assert.equal(f.rows[0].cookedAt, at);
  assert.equal(f.logs.length, 0);
});

test("a chat that is not the caller's is 404 for every action, and nothing changes", async () => {
  const f = fake();
  const svc = makeCookService(f.deps);
  for (const a of [
    parsed({ action: "start", dish }),
    { action: "done" as const },
    parsed({ action: "ate", portion: 1 }),
  ]) {
    const r = await svc.apply("c1", "someone-else", a);
    assert.deepEqual(r, { ok: false, status: 404, error: "Conversation not found" });
  }
  assert.equal(f.rows[0].dishName, null);
  assert.equal(f.rows[0].cookedAt, null);
  assert.equal(f.logs.length, 0);
});

test("ate before start is 409 and logs nothing", async () => {
  const f = fake();
  const r = await makeCookService(f.deps).apply("c1", "p1", parsed({ action: "ate", portion: 1 }));
  assert.ok(!r.ok && r.status === 409);
  assert.equal(f.logs.length, 0);
});

test("ate with a corrupt stored recipe is 409", async () => {
  const f = fake([{ id: "c1", patientId: "p1", title: "x", dishName: "Soup", recipe: { name: 3 }, cookedAt: null }]);
  const r = await makeCookService(f.deps).apply("c1", "p1", parsed({ action: "ate", portion: 1 }));
  assert.ok(!r.ok && r.status === 409);
  assert.equal(f.logs.length, 0);
});

test("ate logs the dish from the stored recipe", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, () => new Date("2026-11-12T23:30:00Z"));
  await svc.apply("c1", "p1", parsed({ action: "start", dish }));
  const r = await svc.apply("c1", "p1", parsed({ action: "ate", portion: 0.5, today: "2026-11-13", mealType: "lunch" }));
  assert.deepEqual(r, { ok: true });
  assert.equal(f.logs.length, 1);
  const l = f.logs[0];
  assert.equal(l.patientId, "p1");
  assert.equal(l.name, "Lentil soup");
  assert.equal(l.source, "CLARA");
  assert.equal(l.servings, 0.5);
  assert.equal(l.localDate, "2026-11-13");
  assert.equal(l.mealType, "lunch");
  assert.equal(l.calories, 400);
  assert.equal(l.protein, 20);
  assert.equal(l.carbs, 60);
  assert.equal(l.fat, 8);
  assert.equal(l.fiber, 12);
  assert.equal(l.sodium, 300);
  assert.equal(l.estimated, false);
  assert.equal(l.incomplete, false);
  assert.equal(l.clientRequestId, "cook-c1");
});

test("ate defaults to dinner and the server date; null sodium is omitted", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, () => new Date("2026-11-12T10:00:00"));
  const noSodium = { ...dish, recipe: { ...recipe, perServing: { ...recipe.perServing, sodium: null } } };
  await svc.apply("c1", "p1", parsed({ action: "start", dish: noSodium }));
  await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1 }));
  assert.equal(f.logs[0].mealType, "dinner");
  assert.equal(f.logs[0].localDate, "2026-11-12");
  assert.equal("sodium" in f.logs[0] && f.logs[0].sodium !== undefined, false);
});

test("ate twice (double tap, offline replay) creates one log and both answer ok", async () => {
  const f = fake();
  const svc = makeCookService(f.deps);
  await svc.apply("c1", "p1", parsed({ action: "start", dish }));
  const a = parsed({ action: "ate", portion: 1 });
  assert.deepEqual(await svc.apply("c1", "p1", a), { ok: true });
  assert.deepEqual(await svc.apply("c1", "p1", a), { ok: true });
  await Promise.all([svc.apply("c1", "p1", a), svc.apply("c1", "p1", a)]);
  assert.equal(f.logs.length, 1);
});
