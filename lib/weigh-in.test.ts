import { test } from "node:test";
import assert from "node:assert/strict";
import { recordWeighIn, validateWeighInBody, weightUnitLabel, type WeighInDeps } from "./weigh-in";

const now = new Date(2026, 10, 12, 15, 30);
const bad = (body: unknown) => validateWeighInBody(body, now);

test("validation: body must be an object", () => {
  for (const b of [null, "x", 5, [], undefined]) {
    const r = bad(b);
    assert.ok(!r.ok && r.field === "body" && r.status === 422);
  }
});

test("validation: date", () => {
  for (const d of [undefined, "2026-11-1", "11/12/2026", "2026-02-30", "2026-13-01", 20261112, "2026-11-14"]) {
    const r = bad({ date: d, weight: 150 });
    assert.ok(!r.ok && r.field === "date", String(d));
  }
  assert.ok(bad({ date: "2026-11-13", weight: 150 }).ok); // tomorrow allowed
  assert.ok(bad({ date: "2026-11-12", weight: 150 }).ok);
  assert.ok(bad({ date: "2024-02-29", weight: 150 }).ok);
});

test("validation: weight", () => {
  for (const w of [undefined, null, "150", NaN, Infinity, 49.9, 700.1, 0, -5]) {
    const r = bad({ date: "2026-11-12", weight: w });
    assert.ok(!r.ok && r.field === "weight", String(w));
  }
  const r = bad({ date: "2026-11-12", weight: 50 });
  assert.ok(r.ok && r.weight === 50 && r.date.getHours() === 0 && r.date.getDate() === 12);
  assert.ok(bad({ date: "2026-11-12", weight: 700 }).ok);
});

function fakeDeps(row: { id: string; mood: string | null; notes: string | null; weight: number | null } | null) {
  const calls = { sync: 0, created: [] as unknown[], window: null as null | [Date, Date] };
  const store = { row };
  const deps: WeighInDeps = {
    findDayEntry: async (_p, s, e) => { calls.window = [s, e]; return store.row; },
    updateWeight: async (_id, w) => { store.row!.weight = w; },
    createEntry: async (patientId, date, weight) => { calls.created.push({ patientId, date, weight }); },
    syncPatient: async () => { calls.sync++; },
  };
  return { deps, calls, store };
}

test("existing entry: only weight changes, mood/notes kept, sync once", async () => {
  const { deps, calls, store } = fakeDeps({ id: "e1", mood: "good", notes: "hi", weight: 160 });
  const r = await recordWeighIn(deps, { patientId: "p", date: new Date(2026, 10, 12), weight: 155.5 });
  assert.equal(r.created, false);
  assert.deepEqual(store.row, { id: "e1", mood: "good", notes: "hi", weight: 155.5 });
  assert.equal(calls.created.length, 0);
  assert.equal(calls.sync, 1);
  assert.equal(calls.window![0].getHours(), 0);
  assert.equal(calls.window![1].getHours(), 23);
});

test("no entry: created at local midnight with date + weight only, sync once", async () => {
  const { deps, calls } = fakeDeps(null);
  const r = await recordWeighIn(deps, { patientId: "p", date: new Date(2026, 10, 12, 9), weight: 150 });
  assert.equal(r.created, true);
  assert.deepEqual(calls.created, [{ patientId: "p", date: new Date(2026, 10, 12), weight: 150 }]);
  assert.equal(calls.sync, 1);
});

test("unit label follows loadWeight's rule", () => {
  assert.equal(weightUnitLabel("kg"), "kg");
  assert.equal(weightUnitLabel("lbs"), "lbs");
  assert.equal(weightUnitLabel(null), "lbs");
});
