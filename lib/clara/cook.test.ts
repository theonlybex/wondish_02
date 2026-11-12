import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCookService, parseCookBody, type CookDeps } from "./cook";
import type { MealLogCreateData } from "@/lib/meal-log";
import { cookDishesJson } from "./cook-dishes";

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
  const find = (id: string, pid: string) => rows.find((x) => x.id === id && x.patientId === pid);
  const deps: CookDeps = {
    getCook: async (id, pid) => {
      const r = find(id, pid);
      return r ? { dishName: r.dishName, cookedAt: r.cookedAt, recipe: r.recipe } : null;
    },
    updateCook: async (id, pid, change) => {
      const r = find(id, pid);
      if (!r) return null;
      // Round-trip through JSON like the Json column does.
      const { write, result } = change({ dishName: r.dishName, cookedAt: r.cookedAt, recipe: JSON.parse(JSON.stringify(r.recipe)) });
      if (write) {
        if (write.title !== undefined) r.title = write.title;
        if (write.dishName !== undefined) r.dishName = write.dishName;
        r.cookedAt = write.cookedAt;
        if (write.recipe !== undefined) r.recipe = JSON.parse(JSON.stringify(cookDishesJson(write.recipe)));
      }
      return result;
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
  const stored = f.rows[0].recipe as Record<string, { name: string; recipe: unknown; startedAt: string; cookedAt: string | null }>;
  assert.deepEqual(Object.keys(stored), ["d1"], "kept per dish, keyed by the dishId it was started with");
  assert.deepEqual(stored.d1.recipe, recipe);
  assert.equal(stored.d1.name, f.rows[0].title);
  assert.equal(stored.d1.cookedAt, null);
  assert.equal(typeof stored.d1.startedAt, "string");
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
  assert.equal(l.clientRequestId, "cook-c1-d1", "no dishId: the most recent dish, keyed by chat and dish");
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

// ─── Per dish: "Plan today's dishes" puts up to three cookable dishes in one chat ───

const porridge = {
  name: "Oat porridge",
  servings: 1,
  minutes: 10,
  ingredients: [{ name: "oats", quantity: 50, unit: "g" }],
  steps: ["Simmer the oats."],
  perServing: { calories: 250, protein: 9, carbs: 40, fat: 5, fibre: 6, sodium: 80 as number | null },
};
const breakfast = { dishId: "dB", name: "Oat porridge", recipe: porridge };
const lunch = { dishId: "dL", name: "Lentil soup", recipe };

/** A clock that moves a minute per call, so starts are ordered. */
function ticking(from = Date.parse("2026-11-12T08:00:00Z")) {
  let t = from;
  return () => new Date((t += 60_000));
}

test("parseCookBody: ate and done take an optional dishId", () => {
  assert.deepEqual(parsed({ action: "ate", portion: 1, dishId: "dB" }), {
    action: "ate", portion: 1, mealType: "dinner", today: undefined, dishId: "dB",
  });
  assert.deepEqual(parsed({ action: "done", dishId: "dB" }), { action: "done", dishId: "dB" });
  assert.deepEqual(parsed({ action: "done" }), { action: "done" });
  assert.equal(parseCookBody({ action: "ate", portion: 1, dishId: "" }).ok, false);
  assert.equal(parseCookBody({ action: "ate", portion: 1, dishId: 7 }).ok, false);
  assert.equal(parseCookBody({ action: "ate", portion: 1, dishId: "x".repeat(129) }).ok, false);
  assert.equal(parseCookBody({ action: "done", dishId: " " }).ok, false);
});

test("two dishes cooked in one chat, both answered 'I ate it': two logs, each with its own dish", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dB" }));
  await svc.apply("c1", "p1", parsed({ action: "start", dish: lunch }));
  await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dL" }));
  assert.deepEqual(await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "dB", mealType: "breakfast" })), { ok: true });
  assert.deepEqual(await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "dL", mealType: "lunch" })), { ok: true });
  assert.equal(f.logs.length, 2);
  const [b, l] = f.logs;
  assert.deepEqual([b.name, b.calories, b.fiber, b.sodium, b.mealType, b.clientRequestId], ["Oat porridge", 250, 6, 80, "breakfast", "cook-c1-dB"]);
  assert.deepEqual([l.name, l.calories, l.fiber, l.sodium, l.mealType, l.clientRequestId], ["Lentil soup", 400, 12, 300, "lunch", "cook-c1-dL"]);
});

test("lunch started before the breakfast check-in is answered: the breakfast answer logs breakfast", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dB" }));
  await svc.apply("c1", "p1", parsed({ action: "start", dish: lunch }));
  await svc.apply("c1", "p1", parsed({ action: "ate", portion: 0.5, dishId: "dB", mealType: "breakfast" }));
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0].name, "Oat porridge");
  assert.equal(f.logs[0].calories, 250);
  assert.equal(f.logs[0].servings, 0.5);
  // The chat itself reflects the most recently started dish.
  assert.equal(f.rows[0].dishName, "Lentil soup");
  assert.equal(f.rows[0].title, "Lentil soup");
  assert.equal(f.rows[0].cookedAt, null, "lunch is not cooked yet");
});

test("the same dish answered twice (and raced) gives one row", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  await svc.apply("c1", "p1", parsed({ action: "start", dish: lunch }));
  const a = parsed({ action: "ate", portion: 1, dishId: "dB" });
  await svc.apply("c1", "p1", a);
  await svc.apply("c1", "p1", a);
  await Promise.all([svc.apply("c1", "p1", a), svc.apply("c1", "p1", a)]);
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0].name, "Oat porridge");
});

test("an ate with and without dishId for the most recent dish share one row (old and new app builds)", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  await svc.apply("c1", "p1", parsed({ action: "start", dish: lunch }));
  await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1 }));
  await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "dL" }));
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0].name, "Lentil soup", "no dishId logs the most recently started dish");
});

test("an ate for a dish never started in this chat is 409 and logs nothing", async () => {
  const f = fake();
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  const r = await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "dNever" }));
  assert.ok(!r.ok && r.status === 409, JSON.stringify(r));
  assert.match((r as { error: string }).error, /start cooking this dish/i);
  assert.equal(f.logs.length, 0);
});

test("an old single-recipe stored value still logs, under the chat's old key", async () => {
  const f = fake([{ id: "c1", patientId: "p1", title: "Lentil soup", dishName: "Lentil soup", recipe, cookedAt: new Date("2026-11-12T12:00:00Z") }]);
  const svc = makeCookService(f.deps, ticking());
  assert.deepEqual(await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1 })), { ok: true });
  // A newer build that does send a dishId still reaches the one stored dish, and the replay is the same row.
  assert.deepEqual(await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "d1" })), { ok: true });
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0].name, "Lentil soup");
  assert.equal(f.logs[0].calories, 400);
  assert.equal(f.logs[0].clientRequestId, "cook-c1", "same key as before, so an earlier log is not repeated");
});

test("starting a new dish on an old single-recipe chat keeps the old dish loggable by an older build", async () => {
  const cookedAt = new Date("2026-11-12T12:00:00Z");
  const f = fake([{ id: "c1", patientId: "p1", title: "Lentil soup", dishName: "Lentil soup", recipe, cookedAt }]);
  const svc = makeCookService(f.deps, ticking());
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  assert.equal(f.rows[0].dishName, "Oat porridge");
  assert.equal(f.rows[0].cookedAt, null);
  await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1 }));
  assert.equal(f.logs[0].name, "Oat porridge", "no dishId: the most recent dish");
  const r = await svc.apply("c1", "p1", parsed({ action: "ate", portion: 1, dishId: "d1" }));
  assert.ok(!r.ok && r.status === 409, "the old dish's id was never stored, and a newer dish exists");
});

test("done with a dishId marks that dish; the chat's cookedAt follows the most recent dish only", async () => {
  const f = fake();
  const clock = ticking();
  const svc = makeCookService(f.deps, clock);
  await svc.apply("c1", "p1", parsed({ action: "start", dish: breakfast }));
  await svc.apply("c1", "p1", parsed({ action: "start", dish: lunch }));
  await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dB" }));
  const stored = () => f.rows[0].recipe as Record<string, { cookedAt: string | null }>;
  assert.equal(typeof stored().dB.cookedAt, "string");
  assert.equal(stored().dL.cookedAt, null);
  assert.equal(f.rows[0].cookedAt, null, "breakfast done does not mark the lunch chat cooked");
  await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dL" }));
  const chatCookedAt = f.rows[0].cookedAt as Date | null;
  assert.ok(chatCookedAt instanceof Date);
  assert.equal(chatCookedAt.toISOString(), stored().dL.cookedAt);
  const r = await svc.apply("c1", "p1", parsed({ action: "done", dishId: "dNever" }));
  assert.ok(!r.ok && r.status === 409);
});

test("done without a dishId marks the most recent dish, as before", async () => {
  const f = fake();
  const at = new Date("2026-11-12T18:00:00Z");
  const svc = makeCookService(f.deps, () => at);
  await svc.apply("c1", "p1", parsed({ action: "start", dish }));
  await svc.apply("c1", "p1", { action: "done" });
  assert.equal(f.rows[0].cookedAt!.toISOString(), at.toISOString());
  assert.equal((f.rows[0].recipe as Record<string, { cookedAt: string }>).d1.cookedAt, at.toISOString());
});
